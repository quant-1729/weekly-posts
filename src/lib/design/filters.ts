// Post filters (UX-2): a colour treatment applied by code to the owner's PHOTO and the Imagen BACKGROUND, and to nothing else.
// Text, logo, QR, panels, decoration and the face/mascot are drawn after the filter on exact brand colours, so a filter can
// never change a brand colour or make a QR code unreadable. No AI is involved; the same input always gives the same bytes.

import sharp from 'sharp';
import { filterActive, type PostFilter, type PostFilterPreset } from './filter-presets';

export * from './filter-presets';

interface Look {
  /** Saturation multiplier (0 = grey). */
  sat: number;
  /** Per-channel multiplier (colour cast). */
  gain: [number, number, number];
  /** Contrast about mid-grey. */
  contrast: number;
  /** Added to every channel after contrast (lifts the blacks for a faded look). */
  lift: number;
  /** Gaussian blur radius in px at full strength (soft focus). */
  blur: number;
}

const NEUTRAL: Look = { sat: 1, gain: [1, 1, 1], contrast: 1, lift: 0, blur: 0 };

const LOOKS: Record<Exclude<PostFilterPreset, 'none'>, Look> = {
  warm: { sat: 1.08, gain: [1.09, 1.01, 0.86], contrast: 1.03, lift: 4, blur: 0 },
  cool: { sat: 0.98, gain: [0.88, 0.99, 1.12], contrast: 1.02, lift: 0, blur: 0 },
  vivid: { sat: 1.55, gain: [1, 1, 1], contrast: 1.14, lift: 0, blur: 0 },
  soft: { sat: 0.88, gain: [1.01, 1, 1], contrast: 0.86, lift: 18, blur: 1.4 },
  mono: { sat: 0, gain: [1, 1, 1], contrast: 1.1, lift: 0, blur: 0 },
  vintage: { sat: 0.68, gain: [1.07, 1.0, 0.82], contrast: 0.88, lift: 16, blur: 0 },
};

/** The look at `k` (0-1) of the way from the picture as it is to the full preset. */
export function lookAt(preset: PostFilterPreset, intensity: number): Look {
  if (preset === 'none') return NEUTRAL;
  const k = Math.max(0, Math.min(100, intensity)) / 100;
  const full = LOOKS[preset];
  const mixN = (a: number, b: number) => a + (b - a) * k;
  return {
    sat: mixN(1, full.sat),
    gain: [mixN(1, full.gain[0]), mixN(1, full.gain[1]), mixN(1, full.gain[2])],
    contrast: mixN(1, full.contrast),
    lift: mixN(0, full.lift),
    blur: full.blur * k,
  };
}

const MAX_SIDE = 2400;

/**
 * The picture with the filter applied (JPEG), orientation baked in. "none", intensity 0 or an unreadable picture
 * returns the input buffer itself, so a post without a filter is byte-for-byte what it was.
 */
export async function applyPostFilter(buf: Buffer | null | undefined, filter: PostFilter | null | undefined): Promise<Buffer | null | undefined> {
  if (!buf || !buf.length || !filterActive(filter)) return buf;
  const look = lookAt(filter.preset, filter.intensity);
  try {
    // Saturation about the luma axis, then the colour cast, as one 3x3 matrix.
    const lum = [0.2126, 0.7152, 0.0722];
    const m: number[][] = [0, 1, 2].map((row) => [0, 1, 2].map((col) => look.gain[row] * ((row === col ? look.sat : 0) + (1 - look.sat) * lum[col])));
    let img = sharp(buf, { failOn: 'none' })
      .rotate()
      .resize(MAX_SIDE, MAX_SIDE, { fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' })
      .toColourspace('srgb')
      .recomb(m as [[number, number, number], [number, number, number], [number, number, number]])
      .linear(look.contrast, 128 * (1 - look.contrast) + look.lift);
    if (look.blur >= 0.3) img = img.blur(look.blur);
    return await img.jpeg({ quality: 92 }).toBuffer();
  } catch {
    return buf;
  }
}
