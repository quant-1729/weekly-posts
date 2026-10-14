// Drawing a post with the design engine: the brand's assets (kit, logo, photo, mascot, background),
// the three options shown on the design step and the small previews (PRD v3 G-4 to G-6; change C-16).
// Server-only. The engine itself (`@/lib/design`) is pure code; this file only feeds it.

import sharp from 'sharp';
import type { Brief } from '@/lib/briefs/types';
import { getDb } from '@/lib/db';
import {
  SCHEMES,
  THEME_IDS,
  designOptions,
  listLayouts,
  renderDesignDetailed,
  type DesignDetail,
} from '@/lib/design';
import type { BrandKit, DesignContent, DesignFormat, DesignInput, DesignOption, DesignReport, TypeDefault } from '@/lib/design/types';
import { getBrandKit, getTypeDefault, saveTypeDefault } from '@/lib/kit/service';
export { getTypeDefault, saveTypeDefault };
import { loadUsableMascot, mascotForRender } from '@/lib/mascot/posts';
import { getBackgroundFor } from '@/lib/style/backgrounds';
import { getStorage, type Storage } from '@/lib/storage';
import { loadLogoFile, loadPhotoFile } from '@/lib/weekly/render-post';
import { showsLogo } from './content';
import type { CreateBrand } from './types';

// ---------------------------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------------------------

export interface DesignAssets {
  /** The brand's kit; its theme is the remembered one for this type of post. */
  kit: BrandKit;
  typeDefault: TypeDefault | null;
  logo: Buffer | null;
  photo: Buffer | null;
  /** Tween is on this post's picture. */
  mascotId: string | null;
  mascotColors: ReturnType<typeof mascotColorsOf> | null;
  storage: Storage;
  userId: string;
  brandId: string;
  brandName: string;
  language: string;
}

const mascotColorsOf = (m: NonNullable<Awaited<ReturnType<typeof loadUsableMascot>>>) => m.colors;

/** Everything the engine needs besides the content. */
export async function loadDesignAssets(args: { userId: string; brandId: string; brief: Brief; brand: CreateBrand; storage?: Storage }): Promise<DesignAssets> {
  const { userId, brandId, brief, brand } = args;
  const storage = args.storage ?? getStorage();
  const [baseKit, typeDefault] = await Promise.all([getBrandKit(userId, brandId), getTypeDefault(userId, brandId, brief.postType)]);
  const logoOn = showsLogo(brief);
  const kit: BrandKit = { ...baseKit, themeId: typeDefault?.themeId ?? baseKit.themeId, textLogo: logoOn ? baseKit.textLogo : false };

  const [logo, photo, mascot] = await Promise.all([
    logoOn ? loadLogoFile(brand.logoPath, storage) : Promise.resolve(undefined),
    (async () => {
      if (!brief.photoId) return null;
      const [p] = await getDb().withUser(userId, (tx) =>
        tx.query<{ storage_path: string | null }>("select storage_path from public.photos where id = $1 and brand_id = $2 and kind = 'photo'", [brief.photoId, brandId]),
      );
      return loadPhotoFile(storage, p?.storage_path);
    })(),
    brand.mascotOn ? loadUsableMascot(brandId) : Promise.resolve(null),
  ]);
  return {
    kit,
    typeDefault,
    logo: logo ?? null,
    photo,
    mascotId: mascot?.id ?? null,
    mascotColors: mascot ? mascotColorsOf(mascot) : null,
    storage,
    userId,
    brandId,
    brandName: brand.name,
    language: brief.language ?? brand.language,
  };
}

// ---------------------------------------------------------------------------------------------
// Options and drawing
// ---------------------------------------------------------------------------------------------

/** True when `option` names a theme, a layout of that theme (for some size the brief needs) and a colour scheme that exist. */
export function validOption(option: DesignOption, formats: readonly DesignFormat[], hasPhoto: boolean): boolean {
  if (!(THEME_IDS as readonly string[]).includes(option.themeId)) return false;
  if (!(SCHEMES as readonly string[]).includes(option.scheme)) return false;
  return formats.some((f) => listLayouts(option.themeId, f, hasPhoto).some((l) => l.id === option.layoutId));
}

/**
 * The three options the owner is shown (G-6): different layouts of the same details. When the owner used a
 * design for this type of post before (G-7), it comes first.
 */
export function optionsFor(assets: DesignAssets, content: DesignContent, format: DesignFormat, count = 3): DesignOption[] {
  const hasPhoto = !!assets.photo;
  const base = designOptions({ kit: assets.kit, content, format, hasPhoto, count });
  const d = assets.typeDefault;
  if (!d || !listLayouts(d.themeId, format, hasPhoto).some((l) => l.id === d.layoutId)) return base;
  const first: DesignOption = { themeId: d.themeId, layoutId: d.layoutId, scheme: d.scheme };
  const same = (a: DesignOption, b: DesignOption) => a.themeId === b.themeId && a.layoutId === b.layoutId && a.scheme === b.scheme;
  return [first, ...base.filter((o) => !same(o, first))].slice(0, count);
}

export interface RenderRequest {
  format: DesignFormat;
  option: DesignOption;
  content: DesignContent;
  /** The mascot's pose, when the post has the mascot. */
  pose?: string;
  slide?: { index: number; total: number } | null;
}

/** The engine input for one picture (the Imagen background comes from the cache; it is null when none is stored). */
export async function buildInput(assets: DesignAssets, req: RenderRequest): Promise<DesignInput> {
  const background = await getBackgroundFor(assets.userId, assets.brandId, req.option.themeId, assets.kit, req.format);
  const mascot = assets.mascotColors ? mascotForRender(assets.mascotColors, req.pose ?? 'wave') : null;
  return {
    format: req.format,
    themeId: req.option.themeId,
    layoutId: req.option.layoutId,
    kit: assets.kit,
    brandName: assets.brandName,
    logo: assets.logo,
    photo: assets.photo,
    background,
    mascot,
    language: assets.language,
    content: req.content,
    slide: req.slide ?? null,
    scheme: req.option.scheme,
  };
}

/** Draws one picture. The layout may not exist for this size (a layout belongs to a theme, sizes differ); the engine then picks another of the theme. */
export async function renderOne(assets: DesignAssets, req: RenderRequest): Promise<DesignDetail> {
  return renderDesignDetailed(await buildInput(assets, req));
}

export interface OptionPreview {
  option: DesignOption;
  /** The layout and scheme the engine ended up using (it may pick another layout when the text does not fit). */
  used: DesignOption;
  /** A small JPEG as a data URL. */
  src: string;
  report: DesignReport;
  width: number;
  height: number;
}

/** A small preview of one option with its report (what did not fit, contrast, QR). */
export async function previewOption(assets: DesignAssets, req: RenderRequest, previewWidth = 560): Promise<OptionPreview> {
  const r = await renderOne(assets, req);
  const jpeg = await sharp(r.png).resize({ width: previewWidth }).jpeg({ quality: 82 }).toBuffer();
  return {
    option: req.option,
    used: { themeId: r.themeId, layoutId: r.layoutId, scheme: r.scheme },
    src: `data:image/jpeg;base64,${jpeg.toString('base64')}`,
    report: r.report,
    width: r.width,
    height: r.height,
  };
}

/** The lines of a report as words for the owner: "No room for: ..." and what a size does not carry. */
export function reportLines(report: DesignReport): { noRoom: string[]; notShown: string[]; problems: string[] } {
  const item = (d: string) =>
    (/^(?:secondary line over the \w+ limit|(?:secondary line|subline|contact) \(no room\)|contact: not shown on \w+): ([\s\S]*)$/.exec(d)?.[1] ?? d).trim();
  const noRoom: string[] = [];
  const notShown: string[] = [];
  for (const d of report.dropped) (/not shown on/i.test(d) ? notShown : noRoom).push(item(d));
  const problems: string[] = [];
  if (report.overflow.length > 0) problems.push(`Text does not fit: ${report.overflow.join(', ')}`);
  if (report.qr && !report.qr.ok) problems.push('The QR code does not read back correctly');
  return { noRoom, notShown, problems };
}
