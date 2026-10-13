/** Brand colours: preset palettes, hex helpers, and a palette from one primary colour. Pure; safe in the browser. */

export interface Palette {
  primary: string;
  secondary: string;
  accent: string;
}

/** Six ready palettes. `id` keys the display name in i18n (s.brand.palettes). */
export const PRESET_PALETTES: readonly (Palette & { id: string })[] = [
  { id: "saffron", primary: "#E4572E", secondary: "#FFF3E0", accent: "#1B998B" },
  { id: "red_gold", primary: "#B5121B", secondary: "#FFF4E0", accent: "#F2A900" },
  { id: "green", primary: "#1B7F3B", secondary: "#F1F8E9", accent: "#FFB400" },
  { id: "blue", primary: "#1F4E9C", secondary: "#EAF1FB", accent: "#F59E0B" },
  { id: "purple", primary: "#7B2D8E", secondary: "#FBEFFC", accent: "#F4A261" },
  { id: "charcoal", primary: "#222831", secondary: "#F5F5F5", accent: "#D4A017" },
];

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

export function isHexColor(v: unknown): v is string {
  return typeof v === "string" && HEX_RE.test(v);
}

export function normalizeHex(v: string): string {
  return v.trim().toUpperCase();
}

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex(r: number, g: number, b: number): string {
  const c = (x: number) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`.toUpperCase();
}

/** [h 0-360, s 0-1, l 0-1] */
export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === rn) h = ((gn - bn) / d) % 6;
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return [h, s, l];
}

export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0, g = 0, b = 0;
  if (hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = l - c / 2;
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

/** Mixes `hex` with white; amount 0 = unchanged, 1 = white. */
export function tint(hex: string, amount: number): string {
  const [r, g, b] = hexToRgb(hex);
  return rgbToHex(r + (255 - r) * amount, g + (255 - g) * amount, b + (255 - b) * amount);
}

/** A full palette from one chosen colour: light tint as secondary, a contrasting hue as accent. */
export function paletteFromPrimary(primaryHex: string): Palette {
  const primary = normalizeHex(primaryHex);
  const [h, s, l] = rgbToHsl(...hexToRgb(primary));
  const accent = rgbToHex(...hslToRgb(h + 150, Math.max(0.55, Math.min(0.85, s)), Math.max(0.4, Math.min(0.55, l))));
  return { primary, secondary: tint(primary, 0.92), accent };
}

export function samePalette(a: Partial<Palette> | undefined, b: Partial<Palette> | undefined): boolean {
  if (!a || !b) return false;
  return (
    a.primary?.toUpperCase() === b.primary?.toUpperCase() &&
    a.secondary?.toUpperCase() === b.secondary?.toUpperCase() &&
    a.accent?.toUpperCase() === b.accent?.toUpperCase()
  );
}
