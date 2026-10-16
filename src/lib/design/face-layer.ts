// The face layer (F-2): a Brand Face that is not Tween is drawn from its approved pose image (a transparent PNG made
// once, never per post) in the slot the Tween mascot has, with the same size, speech bubble and collision rules.
// Pure code except for reading the image size (sharp). All text, here the "AI" tag, is drawn by code with the shipped
// fonts; the image holds no text.
//
// A pose image becomes a `MascotInput` whose group is authored in the 400 x 400 mascot space, so `drawMascot` and the
// older templates place it exactly as they place Tween.

import sharp from 'sharp';
import type { CharacterDrawing } from '@/lib/characters/types';
import type { FacePlacement } from '@/lib/faces/types';
import type { MascotInput } from '@/lib/render';
import { baselineOffset } from '@/lib/render/layout';
import { shapeText, shapedToSvg } from '@/lib/render/shape';
import { MASCOT_BOX } from '@/lib/render/templates';

/** The tag a realistic AI person always carries. */
export const AI_TAG_TEXT = 'AI';
/** Tag size in the 400-unit mascot space: at the smallest slot (150 px) it is about 30 px tall with 20 px letters. */
export const AI_TAG = { h: 84, font: 54, padX: 28, margin: 6, fill: '#111111', ink: '#ffffff' } as const;

/** The longest side the pose image is stored at in the picture (the slot is at most 260 px, so this is plenty). */
const MAX_SIDE = 640;

/** How much of the slot the face fills. The slot is the largest it can be; "small" leaves room around it. */
export const SIZE_FACTOR: Record<NonNullable<FacePlacement['size']>, number> = { small: 0.78, medium: 1, large: 1 };

export interface FaceLayerOptions {
  /** Draw the "AI" tag (a realistic AI person). */
  aiTag: boolean;
  size?: FacePlacement['size'];
}

/** Where the image sits in the 400-unit space and its tag, for tests and the layout checks. */
export interface FaceLayout {
  image: { x: number; y: number; w: number; h: number };
  tag: { x: number; y: number; w: number; h: number } | null;
}

export function layoutFace(w: number, h: number, opts: FaceLayerOptions): FaceLayout {
  const factor = SIZE_FACTOR[opts.size ?? 'medium'];
  const k = Math.min(MASCOT_BOX / w, MASCOT_BOX / h) * factor;
  const iw = w * k;
  const ih = h * k;
  const image = { x: (MASCOT_BOX - iw) / 2, y: MASCOT_BOX - ih, w: iw, h: ih };
  if (!opts.aiTag) return { image, tag: null };
  const tw = shapeText(AI_TAG_TEXT, 800, 'ltr').widthEm * AI_TAG.font + 2 * AI_TAG.padX;
  // The bottom right corner of the image; the tag always stays inside the 400-unit box.
  const x = Math.min(MASCOT_BOX - tw - AI_TAG.margin, image.x + image.w - tw);
  const y = MASCOT_BOX - AI_TAG.h - AI_TAG.margin;
  return { image, tag: { x: Math.max(0, x), y, w: tw, h: AI_TAG.h } };
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** The SVG group (400-unit space) of a pose image and, for a realistic AI person, the "AI" tag. */
export function faceGroup(uri: string, w: number, h: number, opts: FaceLayerOptions): string {
  const { image, tag } = layoutFace(w, h, opts);
  let svg = `<image x="${r2(image.x)}" y="${r2(image.y)}" width="${r2(image.w)}" height="${r2(image.h)}" xlink:href="${uri}" preserveAspectRatio="xMidYMax meet"/>`;
  if (tag) {
    const lh = AI_TAG.font * 1.32;
    const shaped = shapeText(AI_TAG_TEXT, 800, 'ltr');
    const ty = tag.y + (tag.h - lh) / 2 + baselineOffset(800, AI_TAG.font, lh);
    svg += `<rect x="${r2(tag.x)}" y="${r2(tag.y)}" width="${r2(tag.w)}" height="${r2(tag.h)}" rx="${r2(tag.h / 2)}" fill="${AI_TAG.fill}"/>`;
    svg += shapedToSvg(shaped, tag.x + AI_TAG.padX, ty, AI_TAG.font, AI_TAG.ink);
  }
  return svg;
}

/**
 * A pose image as a character drawing (CH-2), in the 400-unit space: a ground shadow, the image and, for a realistic AI person,
 * the "AI" tag. The anchors let a role place it like a rig character (hands at the sides, eyes in the upper part).
 */
export function faceImageDrawing(uri: string, w: number, h: number, opts: FaceLayerOptions): CharacterDrawing {
  const { image, tag } = layoutFace(w, h, { aiTag: opts.aiTag, size: 'medium' });
  const cx = image.x + image.w / 2;
  const shadow = `<ellipse cx="${r2(cx)}" cy="${MASCOT_BOX - 4}" rx="${r2(image.w * 0.34)}" ry="9" fill="#17253b" fill-opacity="0.16"/>`;
  const bounds = { x: image.x, y: image.y, w: image.w, h: image.h };
  void tag;
  return {
    body: shadow + faceGroup(uri, w, h, { aiTag: opts.aiTag, size: 'medium' }),
    anchors: {
      bounds,
      handL: { x: image.x + image.w * 0.12, y: image.y + image.h * 0.55 },
      handR: { x: image.x + image.w * 0.88, y: image.y + image.h * 0.55 },
      face: { x: cx, y: image.y + image.h * 0.2 },
      feet: { x: cx, y: MASCOT_BOX },
    },
  };
}

/** A pose image scaled once for use as a role's character (the picture stays light), with its size. */
export async function facePoseSource(png: Buffer): Promise<{ uri: string; w: number; h: number }> {
  const small = await sharp(png).resize({ width: MAX_SIDE, height: MAX_SIDE, fit: 'inside', withoutEnlargement: true }).png().toBuffer({ resolveWithObject: true });
  return { uri: `data:image/png;base64,${small.data.toString('base64')}`, w: small.info.width, h: small.info.height };
}

/**
 * The engine's mascot input for a pose image (a transparent PNG). The image is scaled down once so the picture stays
 * light; the engine draws it in the mascot slot of the layout, with the bubble beside it.
 */
export async function faceLayerInput(png: Buffer, opts: FaceLayerOptions): Promise<MascotInput> {
  const small = await sharp(png).resize({ width: MAX_SIDE, height: MAX_SIDE, fit: 'inside', withoutEnlargement: true }).png().toBuffer({ resolveWithObject: true });
  const uri = `data:image/png;base64,${small.data.toString('base64')}`;
  const { width, height } = small.info;
  const svg = () => faceGroup(uri, width, height, opts);
  // Shaping needs the fonts loaded; the engine does that before it draws. `build` runs at draw time.
  return { svg: '', build: () => svg() };
}
