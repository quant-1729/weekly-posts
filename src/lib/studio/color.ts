// Colour helpers for the studio (pure).

export type RGB = [number, number, number];

export function hexToRgb(hex: string): RGB {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [0, 0, 0];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const h2 = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
export const rgbToHex = ([r, g, b]: RGB): string => `#${h2(r)}${h2(g)}${h2(b)}`.toUpperCase();

export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

export function mix(a: string, b: string, t: number): string {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  return rgbToHex([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t]);
}

export function rgbToHsl([r, g, b]: RGB): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h * 60, s, l];
}

export function hslToHex(h: number, s: number, l: number): string {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return rgbToHex([(r + m) * 255, (g + m) * 255, (b + m) * 255]);
}

export const hslOf = (hex: string) => rgbToHsl(hexToRgb(hex));

/** The colour with its lightness set (0..1). */
export function withLightness(hex: string, l: number): string {
  const [h, s] = hslOf(hex);
  return hslToHex(h, s, l);
}

export function shift(hex: string, { h = 0, s = 0, l = 0 }: { h?: number; s?: number; l?: number }): string {
  const [hh, ss, ll] = hslOf(hex);
  return hslToHex(hh + h, Math.max(0, Math.min(1, ss + s)), Math.max(0, Math.min(1, ll + l)));
}

/** Black or white ink, whichever reads better on `bg` (prefers white on mid tones). */
export const inkOn = (bg: string, dark = '#141414', light = '#FFFFFF'): string => (contrast(bg, light) >= Math.min(4.5, contrast(bg, dark)) ? light : dark);

/** Picks the candidate with the most contrast on `bg`. */
export function bestOn(bg: string, candidates: string[]): string {
  return candidates.reduce((best, c) => (contrast(bg, c) > contrast(bg, best) ? c : best), candidates[0]);
}

export const isHex = (v: string) => /^#[0-9a-fA-F]{6}$/.test(v);
