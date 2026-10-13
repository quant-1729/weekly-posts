// Image rendering (R6, D5): SVG templates with HarfBuzz-shaped Noto text,
// rasterised to PNG by resvg. No AI call, no <text> element, no system fonts.

import { Resvg } from '@resvg/resvg-js';
import sharp from 'sharp';
import { detectDirection, initShaping, type Dir } from './shape';
import {
  Canvas,
  FORMATS,
  FORMAT_SIZE,
  TEMPLATES,
  getTemplate,
  normaliseFormat,
  type Format,
  type FormatInput,
  type LogoImage,
  type Placement,
  type PostText,
  type TemplateDef,
} from './templates';

export type { Format, FormatInput, Placement, PostText };
export { FORMATS, FORMAT_SIZE, MASCOT_BOX, STORY_SAFE, normaliseFormat } from './templates';
export { detectDirection, initShaping, measureText, textToSvg } from './shape';
export type { Dir } from './shape';
export { fitText } from './layout';
export type { Box, FitResult } from './layout';
export { contrast, pickInk } from './color';

export interface RenderInput {
  /** 'tall' is the v1 name for 'vertical' and is still accepted. */
  format: FormatInput;
  templateId: string;
  brand: {
    name: string;
    colors: { primary: string; secondary: string; accent: string };
    logo?: Buffer; // PNG
  };
  photo?: Buffer; // owner photo, any common format; may be absent
  text: PostText; // any may be ''
  /** SVG group for the mascot pose, authored in a 400x400 space. Slot only for now. */
  mascot?: { svg: string } | null;
  /** Text direction of the post. Default: detected from the headline, subline and CTA. */
  dir?: Dir | 'auto';
}

export interface RenderResult {
  png: Buffer;
  width: number;
  height: number;
  /** Template actually drawn (differs from the requested one when a photo template had no usable photo). */
  templateId: string;
  fellBack: boolean;
  mascotDropped: boolean;
  placements: Placement[];
  svg: string;
  /** Text direction used for layout. */
  dir: Dir;
}

export function listTemplates(format: FormatInput): { id: string; name: string; needsPhoto: boolean }[] {
  const f = normaliseFormat(format);
  return TEMPLATES.filter((t) => t.format === f).map((t) => ({ id: t.id, name: t.name, needsPhoto: t.needsPhoto }));
}

export function templateInfo(id: string): Pick<TemplateDef, 'id' | 'format' | 'needsPhoto' | 'probe' | 'logoSlot' | 'photoFrame'> | undefined {
  const t = getTemplate(id);
  return t && { id: t.id, format: t.format, needsPhoto: t.needsPhoto, probe: t.probe, logoSlot: t.logoSlot, photoFrame: t.photoFrame };
}

async function prepareLogo(buf: Buffer | undefined): Promise<LogoImage | null> {
  if (!buf || !buf.length) return null;
  try {
    const { data, info } = await sharp(buf, { failOn: 'none' })
      .resize(480, 480, { fit: 'inside', withoutEnlargement: true })
      .png()
      .toBuffer({ resolveWithObject: true });
    return { uri: `data:image/png;base64,${data.toString('base64')}`, w: info.width, h: info.height };
  } catch {
    return null;
  }
}

async function preparePhoto(buf: Buffer | undefined, frame: { w: number; h: number }): Promise<string | null> {
  if (!buf || !buf.length) return null;
  try {
    const jpg = await sharp(buf, { failOn: 'none' })
      .rotate()
      .resize(frame.w, frame.h, { fit: 'cover', position: 'centre' })
      .jpeg({ quality: 88 })
      .toBuffer();
    return `data:image/jpeg;base64,${jpg.toString('base64')}`;
  } catch {
    return null;
  }
}

function rasterise(svg: string): Buffer {
  return Buffer.from(new Resvg(svg, { font: { loadSystemFonts: false }, fitTo: { mode: 'original' } }).render().asPng());
}

function draw(tpl: TemplateDef, input: RenderInput, dir: Dir, photoUri: string | null, logo: LogoImage | null, withMascot: boolean) {
  const { w, h } = FORMAT_SIZE[tpl.format];
  const canvas = new Canvas({
    format: tpl.format,
    dir,
    colors: input.brand.colors,
    brandName: input.brand.name ?? '',
    text: {
      headline: input.text.headline ?? '',
      subline: input.text.subline ?? '',
      cta: input.text.cta ?? '',
      bubble: input.text.bubble ?? '',
    },
    photoUri,
    logo,
    mascot: withMascot ? (input.mascot ?? null) : null,
  });
  const body = tpl.build(canvas);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    body +
    '</svg>';
  return { svg, placements: canvas.placements };
}

/** Text direction of a post: the explicit setting, else detected from the visible text. */
function postDirection(input: RenderInput): Dir {
  if (input.dir === 'ltr' || input.dir === 'rtl') return input.dir;
  const t = input.text;
  return detectDirection([t.headline, t.subline, t.cta].filter(Boolean).join(' '));
}

/** Render a post and report how it was laid out (used by tests and tooling). */
export async function renderPostDetailed(input: RenderInput, shared?: { logo: LogoImage | null }): Promise<RenderResult> {
  await initShaping();
  const format = normaliseFormat(input.format);
  const requested = getTemplate(input.templateId);
  if (!requested) throw new Error(`Unknown template: ${input.templateId}`);
  if (requested.format !== format) {
    throw new Error(`Template ${requested.id} is for ${requested.format}, not ${input.format}`);
  }

  let tpl = requested;
  let photoUri: string | null = null;
  if (tpl.needsPhoto) {
    photoUri = await preparePhoto(input.photo, tpl.photoFrame!);
    if (!photoUri) {
      // No usable photo: replace with a text-only template of the same format.
      tpl = TEMPLATES.find((t) => t.format === format && !t.needsPhoto)!;
    }
  }
  const logo = shared ? shared.logo : await prepareLogo(input.brand.logo);
  const dir = postDirection(input);

  let mascotDropped = false;
  let drawn = draw(tpl, input, dir, photoUri, logo, true);
  let png: Buffer;
  try {
    png = rasterise(drawn.svg);
  } catch (err) {
    if (!input.mascot) throw err;
    // A malformed mascot fragment must not stop the post: draw it without the mascot.
    mascotDropped = true;
    drawn = draw(tpl, input, dir, photoUri, logo, false);
    png = rasterise(drawn.svg);
  }
  const { w, h } = FORMAT_SIZE[format];
  return {
    png,
    width: w,
    height: h,
    templateId: tpl.id,
    fellBack: tpl.id !== requested.id,
    mascotDropped,
    placements: drawn.placements,
    svg: drawn.svg,
    dir,
  };
}

/** Render a post to a PNG of exactly the format size (1080x1080, 1080x1920 or 1200x630). */
export async function renderPost(input: RenderInput): Promise<Buffer> {
  return (await renderPostDetailed(input)).png;
}

// ---- v2: one post in all three formats ---------------------------------------------------

export interface RenderFormatsInput extends Omit<RenderInput, 'format' | 'templateId'> {
  /** Force a template per format. A photo template with no usable photo still falls back to text-only. */
  templates?: Partial<Record<Format, string>>;
  /** Picks which template of a format to use, so a week's posts differ: pass the post index. Default 0. */
  seed?: number;
}

export interface RenderFormatsResult {
  square: Buffer;
  vertical: Buffer;
  landscape: Buffer;
  /** Template actually drawn in each format. */
  used: Record<Format, string>;
}

/** Longest side of a photo kept for rendering; bigger photos are shrunk once and shared by the 3 renders. */
const PHOTO_MAX_SIDE = 2400;

async function usablePhoto(buf: Buffer | undefined): Promise<Buffer | undefined> {
  if (!buf || !buf.length) return undefined;
  try {
    const meta = await sharp(buf, { failOn: 'none' }).metadata();
    if (!meta.width || !meta.height) return undefined;
    if (Math.max(meta.width, meta.height) <= PHOTO_MAX_SIDE) return buf;
    return await sharp(buf, { failOn: 'none' })
      .rotate()
      .resize(PHOTO_MAX_SIDE, PHOTO_MAX_SIDE, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 92 })
      .toBuffer();
  } catch {
    return undefined;
  }
}

/** Default template for a format: photo templates when there is a photo, else text-only ones, rotated by seed. */
export function defaultTemplate(format: FormatInput, hasPhoto: boolean, seed = 0): string {
  const f = normaliseFormat(format);
  const list = TEMPLATES.filter((t) => t.format === f && t.needsPhoto === hasPhoto);
  const pool = list.length ? list : TEMPLATES.filter((t) => t.format === f);
  const i = ((Math.trunc(seed) % pool.length) + pool.length) % pool.length;
  return pool[i].id;
}

/**
 * Render one post as a square, a vertical and a landscape image (Req 9, 10).
 * The mascot is drawn in square and vertical; landscape has no mascot slot.
 */
export async function renderPostFormats(input: RenderFormatsInput): Promise<RenderFormatsResult> {
  await initShaping();
  const { templates, seed, ...rest } = input;
  const [photo, logo] = await Promise.all([usablePhoto(input.photo), prepareLogo(input.brand.logo)]);
  const hasPhoto = !!photo;
  const results = await Promise.all(
    FORMATS.map((format) =>
      renderPostDetailed(
        { ...rest, photo, format, templateId: templates?.[format] ?? defaultTemplate(format, hasPhoto, seed ?? 0) },
        { logo },
      ),
    ),
  );
  const by = Object.fromEntries(FORMATS.map((f, i) => [f, results[i]])) as Record<Format, RenderResult>;
  return {
    square: by.square.png,
    vertical: by.vertical.png,
    landscape: by.landscape.png,
    used: { square: by.square.templateId, vertical: by.vertical.templateId, landscape: by.landscape.templateId },
  };
}
