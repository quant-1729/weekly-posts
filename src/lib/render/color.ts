// Colour helpers: parsing, WCAG contrast, automatic text colour.

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export function parseHex(input: string, fallback = '#444444'): Rgb {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec((input ?? '').trim());
  let hex = m ? m[1] : fallback.replace('#', '');
  if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
  const n = parseInt(hex, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/** Normalised "#rrggbb". Always safe to put into an SVG attribute. */
export function toHex({ r, g, b }: Rgb): string {
  return '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
}

export function normaliseHex(input: string, fallback?: string): string {
  return toHex(parseHex(input, fallback));
}

function channel(v: number): number {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

export function luminance(c: Rgb): number {
  return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
}

/** WCAG contrast ratio, 1 to 21. */
export function contrast(a: string | Rgb, b: string | Rgb): number {
  const la = luminance(typeof a === 'string' ? parseHex(a) : a);
  const lb = luminance(typeof b === 'string' ? parseHex(b) : b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

export const WHITE = '#ffffff';
export const NEAR_BLACK = '#050505';
export const MIN_TEXT_CONTRAST = 4.5;

/**
 * Text colour for a solid background: white or near-black, whichever reads
 * better. If neither reaches 4.5:1 (only possible for a narrow band of mid-tones
 * with near-black), pure black or white is used instead, which always does.
 */
export function pickInk(bg: string): string {
  const cw = contrast(WHITE, bg);
  const cb = contrast(NEAR_BLACK, bg);
  const best = cw >= cb ? WHITE : NEAR_BLACK;
  if (Math.max(cw, cb) >= MIN_TEXT_CONTRAST) return best;
  return contrast('#ffffff', bg) >= contrast('#000000', bg) ? '#ffffff' : '#000000';
}
