// Imagen abstract backgrounds (C-18). Generated once per brand + theme + palette + variant on an explicit
// action, checked for text, stored, and reused. Page loads and renders never generate: they call
// getBackgroundFor, which returns the stored file or null (the themes then draw their own background).
//
// Rules (CLAUDE.md): abstract only, no text in AI images (checked here before use: an image with any
// letters, numbers or words is discarded, retried once with another seed, then given up), more than
// $0.50 needs approval (one background costs a few cents; the weekly cap is 6 new ones).

import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { z } from 'zod';
import { aiMode, generateJson } from '@/lib/ai/client';
import { generateImagenImage, imagenAvailable, imagenModel, type ImagenAspect, type ImagenFn } from '@/lib/ai/imagen';
import { IMAGEN_BACKGROUND_PROMPT_VERSION, IMAGEN_NEGATIVE, buildImagenBackgroundPrompt } from '@/lib/ai/prompts/v3';
import { requireBrandMember } from '@/lib/brand/current';
import { getDb } from '@/lib/db';
import { FORMAT_SIZE, type BrandKit, type DesignFormat, type ThemeId } from '@/lib/design/types';
import { getStorage, type Storage } from '@/lib/storage';
import { assertUnderDailyCap, DailyCapError, failedCallUsd, recordUsage } from '@/lib/usage';
import { assertUnderWeeklyCap, WeeklyCapError } from '@/lib/usage/caps';
import { shrinkForModel } from '@/lib/uploads/image';

export type LeaveSpace = 'center' | 'top' | 'bottom' | 'left' | 'right';

/** Backgrounds are made square; getBackgroundFor crops them to each format. */
export const BACKGROUND_ASPECT: ImagenAspect = '1:1';
export const MAX_BACKGROUND_ATTEMPTS = 2;

const TEXT_CHECK_SYSTEM =
  'You check a generated background image before it is used behind a post. Answer has_text true if the image contains ANY letters, numbers, words, symbols that look like writing, logos or watermarks, even partial, tiny, mirrored or in another script. Answer has_figurative true only if it shows people, faces, hands, animals, food, products, vehicles, buildings, landscapes or other real-world scenes or objects. Stylised decorative shapes such as leaves, blobs, dots, stripes, gradients and patterns are fine and are not figurative. Return JSON.';
const TEXT_CHECK_USER = 'Does this image contain any letters, numbers or words? Does it show people, animals, food, products or real-world scenes? Return has_text and has_figurative.';
const textCheckSchema = z.object({ has_text: z.boolean(), has_figurative: z.boolean().default(false) });
const textCheckJsonSchema = {
  type: 'object',
  properties: { has_text: { type: 'boolean' }, has_figurative: { type: 'boolean' } },
  required: ['has_text', 'has_figurative'],
} as const;

/** hasText is true for text and also for anything figurative (people, products ...): either way the image is not used. */
export type TextCheckFn = (image: Buffer) => Promise<{ hasText: boolean; usd: number }>;

/** The default text check: one cheap Gemini vision call. Under fixture mode it reports no text. */
export const geminiTextCheck: TextCheckFn = async (image) => {
  const small = await shrinkForModel(image, 1024);
  const { data, stats } = await generateJson({
    system: TEXT_CHECK_SYSTEM,
    user: TEXT_CHECK_USER,
    media: [{ mimeType: 'image/jpeg', data: small }],
    zodSchema: textCheckSchema,
    jsonSchema: textCheckJsonSchema,
    temperature: 0,
    timeoutMs: 20_000,
    budgetMs: 30_000,
    fixture: { has_text: false, has_figurative: false },
  });
  return { hasText: data.has_text || data.has_figurative, usd: stats?.usd ?? 0 };
};

/** Colours and mode a kit's background is made for. Same input gives the same hash, so the cache is stable. */
export function backgroundPalette(kit: BrandKit): { colors: string[]; mode: 'light' | 'dark' } {
  const c = kit.colors;
  const colors = [c.primary, c.accent, c.background, c.secondary].map((x) => x.toLowerCase());
  return { colors: [...new Set(colors)], mode: kit.style.mode };
}

export function paletteHash(colors: string[], mode: 'light' | 'dark'): string {
  const norm = colors.map((c) => c.trim().toLowerCase()).join(',');
  return createHash('sha256').update(`${IMAGEN_BACKGROUND_PROMPT_VERSION}|${mode}|${norm}`).digest('hex').slice(0, 16);
}

export function backgroundStorageKey(brandId: string, themeId: string, hash: string, variant: number): string {
  return `${brandId}/backgrounds/${themeId}-${hash}-v${variant}.png`;
}

interface Row {
  id: string;
  storage_path: string;
  width: number;
  height: number;
  model: string;
  usd: string | number;
}

export interface StoredBackground {
  id: string;
  storagePath: string;
  bytes: Buffer;
  width: number;
  height: number;
  model: string;
  usd: number;
}

const BUCKET = 'brand-assets' as const;
const toKey = (storagePath: string) => storagePath.replace(/^brand-assets\//, '');

/** The stored background for this brand + theme + palette + variant, or null. A row whose file is missing counts as not stored. */
export async function findCachedBackground(args: {
  userId: string;
  brandId: string;
  themeId: string;
  hash: string;
  variant: number;
  storage?: Storage;
}): Promise<StoredBackground | null> {
  const [row] = await getDb().withUser(args.userId, (tx) =>
    tx.query<Row>(
      `select id, storage_path, width, height, model, usd from public.backgrounds
        where brand_id = $1 and theme_id = $2 and palette_hash = $3 and variant = $4`,
      [args.brandId, args.themeId, args.hash, args.variant],
    ),
  );
  if (!row) return null;
  const file = await (args.storage ?? getStorage()).get(BUCKET, toKey(row.storage_path));
  if (!file) return null;
  return {
    id: row.id,
    storagePath: row.storage_path,
    bytes: Buffer.from(file.bytes),
    width: row.width,
    height: row.height,
    model: row.model,
    usd: Number(row.usd),
  };
}

export type BackgroundFailure =
  | 'unavailable' // fixture mode or Imagen not set up: nothing was called
  | 'text_found' // every image had text; given up
  | 'check_failed' // the text check could not run, so the image was not used
  | 'failed'; // Imagen itself failed (permission, quota, filtered)

export type BackgroundResult =
  | ({ ok: true; cached: boolean; attempts: number } & StoredBackground)
  | { ok: false; reason: BackgroundFailure; message: string; attempts: number; usd: number };

export interface BackgroundDeps {
  generate?: ImagenFn;
  checkText?: TextCheckFn;
  storage?: Storage;
}

function seedFor(hash: string, variant: number, attempt: number): number {
  return (parseInt(hash.slice(0, 7), 16) + variant * 7919 + attempt * 104729) % 2_000_000_000;
}

/**
 * Makes (or returns the stored) abstract background for a brand's theme. Explicit action only.
 * Order: cached row (no AI call) -> caps -> Imagen -> text check -> store + row + usage.
 * Throws BrandAccessError, DailyCapError, WeeklyCapError (before the first image); everything after
 * that is returned as `{ ok: false }` so the caller carries on with code-drawn backgrounds.
 */
export async function generateBackground(
  args: {
    userId: string;
    brandId: string;
    themeId: ThemeId | string;
    palette: string[];
    mode: 'light' | 'dark';
    leaveSpace?: LeaveSpace;
    variant?: number;
  },
  deps: BackgroundDeps = {},
): Promise<BackgroundResult> {
  const { userId, brandId, themeId } = args;
  const variant = Math.max(0, Math.min(9, Math.floor(args.variant ?? 0)));
  await requireBrandMember(userId, brandId);
  const hash = paletteHash(args.palette, args.mode);
  const storage = deps.storage ?? getStorage();

  const hit = await findCachedBackground({ userId, brandId, themeId, hash, variant, storage });
  if (hit) return { ok: true, cached: true, attempts: 0, ...hit };

  const generate = deps.generate ?? (aiMode() === 'live' && imagenAvailable() ? generateImagenImage : null);
  if (!generate) return { ok: false, reason: 'unavailable', message: 'Imagen is not available (fixture mode or no Vertex project).', attempts: 0, usd: 0 };
  const checkText = deps.checkText ?? geminiTextCheck;

  const prompt = buildImagenBackgroundPrompt({ themeId, colors: args.palette, mode: args.mode, leaveSpace: args.leaveSpace ?? 'center' });
  let spent = 0;
  let sawText = false;
  let attempts = 0;
  let lastError = '';

  for (let attempt = 0; attempt < MAX_BACKGROUND_ATTEMPTS; attempt++) {
    // Caps are checked before every image; a cap hit on the retry just ends the run (the first image is already paid for).
    try {
      await assertUnderDailyCap(brandId);
      await assertUnderWeeklyCap(brandId, 'image');
    } catch (e) {
      if (attempt === 0) throw e;
      if (e instanceof WeeklyCapError || e instanceof DailyCapError) {
        lastError = e.message;
        break;
      }
      throw e;
    }

    attempts++;
    let image;
    try {
      image = await generate({ prompt, negativePrompt: IMAGEN_NEGATIVE, aspectRatio: BACKGROUND_ASPECT, seed: seedFor(hash, variant, attempt) });
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
      return { ok: false, reason: 'failed', message: lastError, attempts, usd: spent };
    }

    // Every image Imagen returned is billed, used or not.
    let usd = image.usd;
    let checked: { hasText: boolean; usd: number };
    try {
      checked = await checkText(image.bytes);
    } catch (e) {
      usd += failedCallUsd(e);
      spent += usd;
      await recordUsage(brandId, userId, 'image', usd, { ok: false }); // image + partial check: no single model
      return { ok: false, reason: 'check_failed', message: e instanceof Error ? e.message : String(e), attempts, usd: spent };
    }
    usd += checked.usd;
    spent += usd;
    await recordUsage(brandId, userId, 'image', usd);

    if (checked.hasText) {
      sawText = true;
      continue; // discard and try another seed
    }

    let png: Buffer;
    let width: number;
    let height: number;
    try {
      const out = await sharp(image.bytes).png().toBuffer({ resolveWithObject: true });
      png = out.data;
      width = out.info.width;
      height = out.info.height;
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
      return { ok: false, reason: 'failed', message: `Imagen returned an unreadable image: ${lastError}`, attempts, usd: spent };
    }

    const key = backgroundStorageKey(brandId, String(themeId), hash, variant);
    await storage.put(BUCKET, key, png, 'image/png');
    const [row] = await getDb().withUser(userId, (tx) =>
      tx.query<{ id: string }>(
        `insert into public.backgrounds (brand_id, theme_id, palette_hash, variant, storage_path, width, height, model, usd)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         on conflict (brand_id, theme_id, palette_hash, variant)
         do update set storage_path = excluded.storage_path, width = excluded.width, height = excluded.height, model = excluded.model, usd = excluded.usd
         returning id`,
        [brandId, themeId, hash, variant, `${BUCKET}/${key}`, width, height, image.model || imagenModel(), usd],
      ),
    );
    return { ok: true, cached: false, attempts, id: row.id, storagePath: `${BUCKET}/${key}`, bytes: png, width, height, model: image.model, usd };
  }

  return {
    ok: false,
    reason: sawText ? 'text_found' : 'failed',
    message: sawText ? 'Every generated image contained text, so none was used.' : lastError || 'No background was made.',
    attempts,
    usd: spent,
  };
}

/**
 * The stored background for a theme, cropped to the format, or null. Never generates and never throws:
 * a render must work without it. Null in fixture mode (and whenever Imagen is not set up) so tests and
 * development use the code-drawn backgrounds.
 */
export async function getBackgroundFor(
  userId: string,
  brandId: string,
  themeId: ThemeId | string,
  kit: BrandKit,
  format: DesignFormat,
  opts: { variant?: number; storage?: Storage } = {},
): Promise<Buffer | null> {
  if (aiMode() === 'fixture' || !imagenAvailable()) return null;
  try {
    const { colors, mode } = backgroundPalette(kit);
    const hit = await findCachedBackground({ userId, brandId, themeId, hash: paletteHash(colors, mode), variant: opts.variant ?? 0, storage: opts.storage });
    if (!hit) return null;
    return await cropToFormat(hit.bytes, format);
  } catch (e) {
    console.warn('[style] background lookup failed, using the code-drawn background', e instanceof Error ? e.message : e);
    return null;
  }
}

/** Fills the format exactly (centre crop), as a PNG. */
export async function cropToFormat(image: Buffer, format: DesignFormat): Promise<Buffer> {
  const { width, height } = FORMAT_SIZE[format];
  return sharp(image).resize({ width, height, fit: 'cover', position: 'centre' }).png().toBuffer();
}
