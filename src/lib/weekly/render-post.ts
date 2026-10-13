// Render one post in its three formats and save the files (Req 9, 10). Shared by weekly
// generation (generate.ts) and the approval operations (src/lib/approvals/ops.ts), so a post
// looks the same whether it was just generated or has been edited since.

import { PRESET_PALETTES, isHexColor } from '@/lib/brand/colors';
import { getDb } from '@/lib/db';
import { renderPostFormats, type Format } from '@/lib/render';
import type { Storage } from '@/lib/storage';

export const FORMATS: Format[] = ['square', 'vertical', 'landscape'];

export interface RenderBrand {
  name: string;
  colors: { primary: string; secondary: string; accent: string };
  logo?: Buffer;
}

export interface StoredImage {
  format: Format;
  templateId: string;
  /** `renders/{brand}/{post}/{format}.png` (what post_images.image_path holds). */
  path: string;
}

/** The brand's colours, falling back to the first preset palette for any that is missing or invalid. */
export function resolveBrandColors(colors: { primary?: string; secondary?: string; accent?: string }): RenderBrand['colors'] {
  const palette = PRESET_PALETTES[0];
  const pick = (v: string | undefined, fallback: string) => (v && isHexColor(v) ? v : fallback);
  return {
    primary: pick(colors.primary, palette.primary),
    secondary: pick(colors.secondary, palette.secondary),
    accent: pick(colors.accent, palette.accent),
  };
}

/** The logo file from `brand-assets/...`, or undefined when there is none or it is gone. */
export async function loadLogoFile(logoPath: string | null | undefined, storage: Storage): Promise<Buffer | undefined> {
  if (!logoPath?.startsWith('brand-assets/')) return undefined;
  const file = await storage.get('brand-assets', logoPath.slice('brand-assets/'.length)).catch(() => null);
  return file ? Buffer.from(file.bytes) : undefined;
}

/** A library photo (`photos/{brand}/{id}.jpg`), or null when the file is not there. */
export async function loadPhotoFile(storage: Storage, storagePath: string | null | undefined): Promise<Buffer | null> {
  if (!storagePath?.startsWith('photos/')) return null;
  const file = await storage.get('photos', storagePath.slice('photos/'.length));
  return file ? Buffer.from(file.bytes) : null;
}

/** The brand name, colours and logo that the templates need (service role; the caller has checked access). */
export async function loadRenderBrand(brandId: string, storage: Storage): Promise<RenderBrand> {
  const [row] = await getDb().withService((tx) =>
    tx.query<{ name: string; colors: { primary?: string; secondary?: string; accent?: string } | null; logo_path: string | null }>(
      `select coalesce(nullif(trim(m.business_name), ''), b.name) as name, m.colors, m.logo_path
         from public.brands b left join public.brand_memory m on m.brand_id = b.id where b.id = $1`,
      [brandId],
    ),
  );
  if (!row) throw new Error('Brand not found');
  return { name: row.name, colors: resolveBrandColors(row.colors ?? {}), logo: await loadLogoFile(row.logo_path, storage) };
}

/**
 * Renders the three formats and writes them to `renders/{brand}/{post}/{format}.png`
 * (overwriting any earlier render). `onWrite` is told each relative path as it is written, so a
 * caller can remove them again if its run does not finish.
 */
export async function renderAndStore(args: {
  storage: Storage;
  brandId: string;
  postId: string;
  brand: RenderBrand;
  photo?: Buffer;
  text: { headline: string; subline: string; cta: string; bubble?: string };
  /** The mascot in the pose to draw (the square and vertical images only), or none. */
  mascot?: { svg: string } | null;
  /** Picks which template of a kind to use (the post's index in its week), so a week does not look the same. */
  seed: number;
  onWrite?: (relativePath: string) => void;
}): Promise<StoredImage[]> {
  const out = await renderPostFormats({
    brand: args.brand,
    photo: args.photo,
    // The bubble belongs to the mascot: no mascot, no bubble.
    text: { headline: args.text.headline, subline: args.text.subline, cta: args.text.cta, bubble: args.mascot ? (args.text.bubble ?? '') : '' },
    mascot: args.mascot ?? null,
    seed: args.seed,
    dir: 'auto',
  });
  const images: StoredImage[] = [];
  for (const format of FORMATS) {
    const rel = `${args.brandId}/${args.postId}/${format}.png`;
    await args.storage.put('renders', rel, out[format], 'image/png');
    args.onWrite?.(rel);
    images.push({ format, templateId: out.used[format], path: `renders/${rel}` });
  }
  return images;
}
