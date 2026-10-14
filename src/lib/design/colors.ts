// Colour helpers for the design engine: mixing, contrast against several possible backgrounds, and
// choosing a readable ink. Builds on the renderer's WCAG helpers.

import { contrast, luminance, parseHex, toHex } from '@/lib/render/color';

export { contrast };

/** Text must reach this against every colour it might sit on; the engine aims a little higher. */
export const MIN_CONTRAST = 4.5;
export const MIN_CONTRAST_LARGE = 3;
export const TARGET_CONTRAST = 5;
/** Headline-size text counts as large text (3:1 is enough) from this size up, in pixels. */
export const LARGE_TEXT_PX = 56;

export const lum = (c: string): number => luminance(parseHex(c));
export const isDark = (c: string): boolean => lum(c) < 0.18;

/** Linear mix in sRGB space: t = 0 gives a, t = 1 gives b. */
export function mix(a: string, b: string, t: number): string {
  const x = parseHex(a);
  const y = parseHex(b);
  return toHex({ r: x.r + (y.r - x.r) * t, g: x.g + (y.g - x.g) * t, b: x.b + (y.b - x.b) * t });
}

/** The lowest contrast of `ink` against any of the backgrounds it may appear on. */
export function minContrast(ink: string, bgs: readonly string[]): number {
  let m = Infinity;
  for (const bg of bgs) m = Math.min(m, contrast(ink, bg));
  return m;
}

/**
 * Pick an ink from the candidates (in order of preference) that reads on every background; then try
 * the neutral near-white and near-black; then the best of everything. White or black always reaches
 * 4.58:1 on any single solid colour, so only a mixed surface (a texture, a photo) can fall short.
 */
export function chooseInk(bgs: readonly string[], prefs: readonly string[], target = TARGET_CONTRAST): { ink: string; ratio: number } {
  const all = [...prefs, '#fafafa', '#111111', '#ffffff', '#000000'];
  for (const t of [target, MIN_CONTRAST]) {
    for (const c of all) {
      const r = minContrast(c, bgs);
      if (r >= t) return { ink: c, ratio: r };
    }
  }
  let best = all[0];
  let bestR = -1;
  for (const c of all) {
    const r = minContrast(c, bgs);
    if (r > bestR) {
      best = c;
      bestR = r;
    }
  }
  return { ink: best, ratio: bestR };
}

/** Colour for a filled shape (button, tag) that should stand apart from the surface and carry its own ink. */
export function chooseFill(bgs: readonly string[], prefs: readonly string[], minApart = 1.8): string | null {
  for (const c of prefs) if (minContrast(c, bgs) >= minApart) return c;
  return null;
}

/** Deterministic pseudo-random numbers (mulberry32), so decoration is the same for the same input. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
