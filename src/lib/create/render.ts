// Drawing a post with the design engine: the brand's assets (kit, logo, photo, mascot, background),
// the three options shown on the design step and the small previews (PRD v3 G-4 to G-6; change C-16).
// Server-only. The engine itself (`@/lib/design`) is pure code; this file only feeds it.

import sharp from 'sharp';
import type { Brief } from '@/lib/briefs/types';
import { getDb } from '@/lib/db';
import { CHARACTER_ROLES, type CharacterId } from '@/lib/characters/types';
import {
  SCHEMES,
  THEME_IDS,
  designOptions,
  listLayouts,
  renderDesignDetailed,
  renderSlideSet,
  type DesignDetail,
} from '@/lib/design';
import { IMAGE_POSE } from '@/lib/design/character';
import { faceLayerInput, facePoseSource } from '@/lib/design/face-layer';
import { hashSeed, type OptionContext } from '@/lib/design/options';
import type { PostFilter } from '@/lib/design/filter-presets';
import type { BrandKit, CharacterSource, DesignContent, DesignFormat, DesignInput, DesignOption, DesignReport, SlideText, TypeDefault } from '@/lib/design/types';
import { relOfStored } from '@/lib/faces/paths';
import { faceShownFor } from '@/lib/faces/rules';
import { FACE_POSES, type FacePose } from '@/lib/faces/types';
import { getBrandKit, getTypeDefault, saveTypeDefault } from '@/lib/kit/service';
export { getTypeDefault, saveTypeDefault };
import { loadUsableMascot, mascotForRender } from '@/lib/mascot/posts';
import { getBackgroundFor } from '@/lib/style/backgrounds';
import { getStorage, type Storage } from '@/lib/storage';
import { loadLogoFile, loadPhotoFile } from '@/lib/weekly/render-post';
import { showsLogo } from './content';
import type { CreateBrand, CreateFace } from './types';

// ---------------------------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------------------------

export interface DesignAssets {
  /** The brand's kit; its theme is the remembered one for this type of post. */
  kit: BrandKit;
  typeDefault: TypeDefault | null;
  logo: Buffer | null;
  photo: Buffer | null;
  /** Tween is on this post's picture (a mascot face). */
  mascotId: string | null;
  mascotColors: ReturnType<typeof mascotColorsOf> | null;
  /** The brand's face for this brief (null when none, or not drawn on this type of post). */
  face: CreateFace | null;
  /** The kit character a mascot face is drawn as (Tween when none was chosen); null for any other face. */
  characterId: CharacterId | null;
  /** The post has a face of any kind: it has a speech bubble and a pose. */
  faceOn: boolean;
  /** Pose images already read from storage (a face that is not Tween). */
  facePoseCache: Map<FacePose, Buffer | null>;
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

  // A face limited to some post types, and a realistic AI person on a testimonial, stay off this brief (Brand Face rules).
  const face = brand.face && faceShownFor(brand.face, brief.postType) ? brand.face : null;
  const [logo, photo, mascot] = await Promise.all([
    logoOn ? loadLogoFile(brand.logoPath, storage) : Promise.resolve(undefined),
    (async () => {
      if (!brief.photoId) return null;
      const [p] = await getDb().withUser(userId, (tx) =>
        tx.query<{ storage_path: string | null }>("select storage_path from public.photos where id = $1 and brand_id = $2 and kind = 'photo'", [brief.photoId, brandId]),
      );
      return loadPhotoFile(storage, p?.storage_path);
    })(),
    face?.kind === 'mascot' ? loadUsableMascot(brandId) : Promise.resolve(null),
  ]);
  const imageFace = face && face.kind !== 'mascot' && face.poses ? face : null;
  return {
    kit,
    typeDefault,
    logo: logo ?? null,
    photo,
    mascotId: mascot?.id ?? null,
    mascotColors: mascot ? mascotColorsOf(mascot) : null,
    face: mascot || imageFace ? face : null,
    characterId: mascot ? (face?.character ?? 'tween') : null,
    faceOn: mascot !== null || imageFace !== null,
    facePoseCache: new Map(),
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
  if (option.role != null && !(CHARACTER_ROLES as readonly string[]).includes(option.role)) return false;
  return formats.some((f) => listLayouts(option.themeId, f, hasPhoto).some((l) => l.id === option.layoutId));
}

/**
 * The three options the owner is shown (G-6): different layouts of the same details. When the owner used a
 * design for this type of post before (G-7), it comes first.
 */
export function optionsFor(assets: DesignAssets, content: DesignContent, format: DesignFormat, count = 3, ctx: Pick<OptionContext, 'postType' | 'extras'> = {}): DesignOption[] {
  const hasPhoto = !!assets.photo;
  const character: CharacterSource['kind'] | null = assets.characterId ? 'rig' : assets.faceOn ? 'image' : null;
  const base = designOptions({ kit: assets.kit, content, format, hasPhoto, count, seed: hashSeed(assets.brandId), character, ...ctx });
  const d = assets.typeDefault;
  if (!d || !listLayouts(d.themeId, format, hasPhoto).some((l) => l.id === d.layoutId)) return base;
  // The design chosen last time (G-7) comes first; it keeps the role the same layout had in this set of options, else the first one's.
  const sameDesign = (a: DesignOption, b: Pick<DesignOption, 'themeId' | 'layoutId' | 'scheme'>) => a.themeId === b.themeId && a.layoutId === b.layoutId && a.scheme === b.scheme;
  const first: DesignOption = { themeId: d.themeId, layoutId: d.layoutId, scheme: d.scheme };
  const role = (base.find((o) => o.themeId === d.themeId && o.layoutId === d.layoutId) ?? base[0])?.role;
  if (role !== undefined) first.role = role;
  return [first, ...base.filter((o) => !sameDesign(o, first))].slice(0, count);
}

export interface RenderRequest {
  format: DesignFormat;
  option: DesignOption;
  content: DesignContent;
  /** The face's pose, when the post has a face. */
  pose?: string;
  slide?: { index: number; total: number } | null;
  /** The post's colour filter (photo and background only); none when absent. */
  filter?: PostFilter | null;
}

/** The pose image of a face that is not Tween: the pose asked for, else `wave`. Null when the file is missing. */
async function loadPoseImage(assets: DesignAssets, face: CreateFace, pose: string | undefined): Promise<Buffer | null> {
  if (!face.poses) return null;
  const want: FacePose = (FACE_POSES as readonly string[]).includes(pose ?? '') ? (pose as FacePose) : 'wave';
  for (const p of want === 'wave' ? [want] : [want, 'wave' as const]) {
    if (!assets.facePoseCache.has(p)) {
      const rel = relOfStored(face.poses[p]);
      const file = rel ? await assets.storage.get('mascots', rel).catch(() => null) : null;
      assets.facePoseCache.set(p, file ? Buffer.from(file.bytes) : null);
    }
    const hit = assets.facePoseCache.get(p);
    if (hit) return hit;
  }
  return null;
}

/**
 * The face layer's input for a picture. Tween is drawn by the rig exactly as before; any other face is its approved
 * pose image (transparent PNG) in the same slot, with an "AI" tag for a realistic AI person.
 */
async function faceInput(assets: DesignAssets, pose: string | undefined) {
  if (assets.mascotColors) return mascotForRender(assets.mascotColors, pose ?? 'wave');
  const face = assets.face;
  if (!face || face.kind === 'mascot') return null;
  const png = await loadPoseImage(assets, face, pose);
  return png ? faceLayerInput(png, { aiTag: face.kind === 'photoreal', size: face.placement.size }) : null;
}

/**
 * The character a role is drawn as (CH-2): the kit's rig for a mascot face, the approved pose image the role needs for any other face.
 * Null when the face cannot take the role (a pose image is missing).
 */
async function characterFor(assets: DesignAssets, role: NonNullable<DesignOption['role']>): Promise<CharacterSource | null> {
  if (assets.characterId) return { kind: 'rig', id: assets.characterId };
  const face = assets.face;
  if (!face || face.kind === 'mascot') return null;
  const pose = IMAGE_POSE[role];
  if (!pose) return null;
  const png = await loadPoseImage(assets, face, pose);
  if (!png) return null;
  return { kind: 'image', images: { [pose]: await facePoseSource(png) }, aiTag: face.kind === 'photoreal' };
}

/** The engine input for one picture (the Imagen background comes from the cache; it is null when none is stored). */
export async function buildInput(assets: DesignAssets, req: RenderRequest): Promise<DesignInput> {
  const background = await getBackgroundFor(assets.userId, assets.brandId, req.option.themeId, assets.kit, req.format);
  // An option with a role (CH-2) puts the character into the layout; an older one without (undefined) keeps the header sticker;
  // a null role is a typographic option with no character.
  const role = req.option.role;
  const roleMode = assets.faceOn && role !== undefined;
  const character = roleMode && role ? await characterFor(assets, role) : null;
  const mascot = roleMode ? null : await faceInput(assets, req.pose);
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
    character,
    role: character ? role : null,
    poseHint: req.pose,
    seed: hashSeed(assets.brandId),
    language: assets.language,
    content: req.content,
    slide: req.slide ?? null,
    scheme: req.option.scheme,
    filter: req.filter ?? null,
  };
}

/** Draws one picture. The layout may not exist for this size (a layout belongs to a theme, sizes differ); the engine then picks another of the theme. */
export async function renderOne(assets: DesignAssets, req: RenderRequest): Promise<DesignDetail> {
  return renderDesignDetailed(await buildInput(assets, req));
}

/**
 * Draws every slide of a carousel in one option (a slide SET, owner request 2026-10-16). With the brand's face on and a role in the
 * option the slides take part with it by kind of slide; otherwise they are typographic with a "2/5" marker.
 */
export async function renderSlides(assets: DesignAssets, req: RenderRequest & { slides: SlideText[] }): Promise<DesignDetail[]> {
  const input = await buildInput(assets, { ...req, slide: null });
  const role = req.option.role;
  const withCharacter = assets.faceOn && role != null;
  return renderSlideSet({ input, slides: req.slides, characterFor: withCharacter ? (r) => characterFor(assets, r) : undefined });
}

export interface SlideSetPreview {
  option: DesignOption;
  used: DesignOption;
  /** One small JPEG data URL per slide, in order. */
  srcs: string[];
  /** The report of each slide. */
  reports: DesignReport[];
  width: number;
  height: number;
}

/** A small preview of every slide of one option. */
export async function previewSlides(assets: DesignAssets, req: RenderRequest & { slides: SlideText[] }, previewWidth = 360): Promise<SlideSetPreview> {
  const set = await renderSlides(assets, req);
  const srcs = await Promise.all(
    set.map(async (r) => `data:image/jpeg;base64,${(await sharp(r.png).resize({ width: previewWidth }).jpeg({ quality: 80 }).toBuffer()).toString('base64')}`),
  );
  return {
    option: req.option,
    used: { themeId: set[0].themeId, layoutId: set[0].layoutId, scheme: set[0].scheme, ...(req.option.role !== undefined ? { role: req.option.role } : {}) },
    srcs,
    reports: set.map((r) => r.report),
    width: set[0].width,
    height: set[0].height,
  };
}

/** One report for a set: the slides' lines together; a problem says which slide it is on. */
export function reportLinesForSlides(reports: readonly DesignReport[]): { noRoom: string[]; notShown: string[]; problems: string[] } {
  const out = { noRoom: [] as string[], notShown: [] as string[], problems: [] as string[] };
  reports.forEach((rep, i) => {
    const l = reportLines(rep);
    for (const x of l.noRoom) if (!out.noRoom.includes(x)) out.noRoom.push(x);
    for (const x of l.notShown) if (!out.notShown.includes(x)) out.notShown.push(x);
    for (const x of l.problems) out.problems.push(`Slide ${i + 1}: ${x}`);
  });
  return out;
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
