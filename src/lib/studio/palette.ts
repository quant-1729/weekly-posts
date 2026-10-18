// Colour palettes for the starting designs: made from the brand's colours, the photo's colours, or a few tried
// and tested sets. Each palette carries readable ink for each surface.

import { contrast, hslOf, hslToHex, inkOn, mix, shift, withLightness } from './color';

export interface StudioPalette {
  id: string;
  label: string;
  /** Canvas. */
  bg: string;
  /** Second background tone (gradients, panels). */
  bg2: string;
  /** Cards and plates. */
  surface: string;
  /** Text on bg. */
  ink: string;
  /** Quieter text on bg. */
  soft: string;
  /** Main brand colour (buttons, shapes). */
  primary: string;
  onPrimary: string;
  /** Pop colour (offer badges). */
  accent: string;
  onAccent: string;
  /** Third colour for decoration. */
  deco: string;
  /** Text on surface. */
  surfaceInk: string;
}

const DARK = '#151515';
const WHITE = '#FFFFFF';

function readable(on: string, prefer: string): string {
  if (contrast(on, prefer) >= 4.5) return prefer;
  return inkOn(on, DARK, WHITE);
}

/** Pushes a colour until it reads on `bg` (keeps the hue). */
export function legibleOn(bg: string, color: string, min = 3): string {
  let c = color;
  const dark = hslOf(bg)[2] < 0.5;
  for (let i = 0; i < 12 && contrast(bg, c) < min; i++) c = shift(c, { l: dark ? 0.06 : -0.06 });
  return contrast(bg, c) >= min ? c : inkOn(bg);
}

function make(id: string, label: string, p: { bg: string; bg2?: string; surface?: string; primary: string; accent: string; deco?: string; ink?: string }): StudioPalette {
  const bg = p.bg;
  const surface = p.surface ?? (hslOf(bg)[2] > 0.6 ? WHITE : mix(bg, WHITE, 0.92));
  const ink = p.ink ? readable(bg, p.ink) : inkOn(bg, DARK, WHITE);
  const accent = p.accent;
  return {
    id,
    label,
    bg,
    bg2: p.bg2 ?? shift(bg, { l: hslOf(bg)[2] > 0.5 ? -0.06 : 0.07, h: 8 }),
    surface,
    ink,
    soft: mix(ink, bg, 0.3),
    primary: p.primary,
    onPrimary: inkOn(p.primary, DARK, WHITE),
    accent,
    onAccent: inkOn(accent, DARK, WHITE),
    deco: p.deco ?? mix(p.primary, bg, 0.55),
    surfaceInk: inkOn(surface, DARK, WHITE),
  };
}

const distinct = (a: string, b: string) => contrast(a, b) > 1.6 || Math.abs(hslOf(a)[0] - hslOf(b)[0]) > 30;

/** A pop colour that stands out on `bg`: the brand accent when it does, else a warm complement. */
function popOn(bg: string, accent: string): string {
  if (distinct(bg, accent) && contrast(bg, accent) > 1.35) return accent;
  const [h, s] = hslOf(bg);
  return hslToHex(h + 160, Math.max(0.7, s), 0.56);
}

export function brandPalettes(colors: { primary: string; secondary: string; accent: string; background: string }): StudioPalette[] {
  const { primary, secondary, accent } = colors;
  const [ph, ps] = hslOf(primary);
  const cream = hslToHex(ph + 20, Math.min(0.5, ps * 0.6 + 0.15), 0.95);
  const deep = hslToHex(ph, Math.min(0.6, ps), 0.12);
  return [
    make('brand', 'Brand bold', { bg: primary, bg2: shift(primary, { l: -0.1, h: -6 }), primary: legibleOn(primary, secondary, 1.4) === secondary ? secondary : mix(primary, WHITE, 0.85), accent: popOn(primary, accent), deco: shift(primary, { l: 0.1 }) }),
    make('light', 'Brand light', { bg: cream, bg2: withLightness(cream, 0.9), primary, accent: popOn(cream, accent), deco: mix(primary, cream, 0.8), ink: legibleOn(cream, deep, 7) }),
    make('dark', 'Brand night', { bg: deep, bg2: shift(deep, { l: 0.06 }), primary: shift(primary, { l: Math.max(0, 0.55 - hslOf(primary)[2]) }), accent: popOn(deep, accent), deco: shift(deep, { l: 0.12 }) }),
    make('accent', 'Accent pop', { bg: accent, bg2: shift(accent, { l: -0.08 }), primary: deep, accent: popOn(accent, primary), deco: shift(accent, { l: 0.12 }) }),
  ];
}

/** Palettes from a photo's colours, so the poster looks made for the picture. */
export function photoPalettes(photoColors: string[], brandAccent: string): StudioPalette[] {
  if (photoColors.length === 0) return [];
  const sorted = [...photoColors];
  const vivid = sorted.filter((c) => hslOf(c)[1] > 0.25 && hslOf(c)[2] > 0.2 && hslOf(c)[2] < 0.8);
  const main = vivid[0] ?? sorted[0];
  const [h, s] = hslOf(main);
  const deep = hslToHex(h, Math.min(0.55, s), 0.16);
  const soft = hslToHex(h, Math.min(0.45, s), 0.93);
  const pop = vivid[1] && distinct(vivid[1], main) ? vivid[1] : hslToHex(h + 150, 0.75, 0.55);
  return [
    make('photo-deep', 'Photo match', { bg: deep, bg2: hslToHex(h + 10, Math.min(0.5, s), 0.24), primary: main, accent: popOn(deep, distinct(brandAccent, deep) ? brandAccent : pop), deco: hslToHex(h, s, 0.3) }),
    make('photo-soft', 'Photo soft', { bg: soft, bg2: hslToHex(h, Math.min(0.4, s), 0.88), primary: hslToHex(h, Math.max(0.45, s), 0.35), accent: popOn(soft, pop), deco: hslToHex(h, Math.min(0.5, s), 0.8) }),
  ];
}

/** A few sets that look good for small-business posters, whatever the brand colours are. */
export const CURATED: StudioPalette[] = [
  make('sunset', 'Sunset', { bg: '#FF6B35', bg2: '#F7931E', primary: '#2B1B17', accent: '#FFE66D', deco: '#FF8C61', ink: '#FFFFFF' }),
  make('mint', 'Fresh mint', { bg: '#E8F6EF', bg2: '#CDEBDD', primary: '#0E6E55', accent: '#FF7A59', deco: '#B8E2CF', ink: '#0B3D30' }),
  make('royal', 'Royal', { bg: '#2D1B69', bg2: '#4A2C8F', primary: '#F5C542', accent: '#FF5E8A', deco: '#5B3FA6', ink: '#FFFFFF' }),
  make('festive', 'Festive', { bg: '#7A0F2E', bg2: '#9E1B3F', primary: '#F2C14E', accent: '#F2C14E', deco: '#A3284E', ink: '#FFF6E5' }),
  make('candy', 'Candy', { bg: '#FFD6E0', bg2: '#FFB3C6', primary: '#7B2CBF', accent: '#FF006E', deco: '#FFC2D4', ink: '#3C096C' }),
  make('mono', 'Black & white', { bg: '#111111', bg2: '#222222', primary: '#FFFFFF', accent: '#FFD60A', deco: '#2A2A2A', ink: '#FFFFFF' }),
];

export const ALL_CURATED_IDS = CURATED.map((p) => p.id);
