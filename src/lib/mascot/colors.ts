// Tween's colours for a brand (D9). Tween's body ink, eyes and feather never change; the scarf takes the brand's
// main colour, and the coral prop accents (confetti, letter seal) take the brand's accent. No server imports.

import { contrast, normaliseHex, parseHex, toHex, type Rgb } from '@/lib/render/color';

export interface TweenColors {
  /** Body, limbs, pupils. */
  ink: string;
  /** Slightly lighter ink for details drawn on the body (finger lines, wrist cuff). */
  inkLight: string;
  /** Eyes and mouth. */
  eye: string;
  /** The scarf, and the thought dots and confetti that echo it. */
  scarf: string;
  scarfDark: string;
  scarfLight: string;
  /** Prop accents: confetti squares and the letter seal. */
  coral: string;
}

/** The exact palette of the owner's Tween kit. */
export const TWEEN_INK = '#0B1C30';
export const TWEEN_BLUE = '#2B4CFF';
export const TWEEN_CORAL = '#FF6B4A';

export const DEFAULT_TWEEN_COLORS: TweenColors = {
  ink: TWEEN_INK,
  inkLight: '#35557A',
  eye: '#FFFFFF',
  scarf: TWEEN_BLUE,
  scarfDark: '#203CD9',
  scarfLight: '#5B78FF',
  coral: TWEEN_CORAL,
};

/** The scarf must stand out from the navy body by at least this contrast ratio. */
export const MIN_SCARF_CONTRAST = 3;
/** A colour closer to white than this contrast ratio against white counts as near-white. */
const NEAR_WHITE_CONTRAST = 1.5;

const HEX = /^#[0-9a-f]{6}$/i;
const HEX3 = /^#[0-9a-f]{3}$/i;

/** "#rrggbb" in lower case, or null when the value is not a hex colour. */
export function cleanHex(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (!HEX.test(t) && !HEX3.test(t)) return null;
  return normaliseHex(t);
}

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return { r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t };
}

/** Dark and light shades of a scarf colour, in the same proportions as Tween's cobalt. */
export function scarfShades(hex: string): { scarf: string; scarfDark: string; scarfLight: string } {
  const base = parseHex(hex);
  return {
    scarf: toHex(base),
    scarfDark: toHex(mix(base, { r: 0, g: 0, b: 0 }, 0.15)),
    scarfLight: toHex(mix(base, { r: 255, g: 255, b: 255 }, 0.23)),
  };
}

/** Can this colour be the scarf? Enough contrast against the navy body, and not near-white. */
export function usableScarf(hex: string): boolean {
  return contrast(hex, TWEEN_INK) >= MIN_SCARF_CONTRAST && contrast(hex, '#ffffff') >= NEAR_WHITE_CONTRAST;
}

export interface BrandColorsInput {
  primary?: string | null;
  secondary?: string | null;
  accent?: string | null;
}

/**
 * The scarf colour for a brand: the primary colour, else the secondary, else the accent, else Tween blue.
 * A colour is skipped when it does not stand out from the navy body (contrast under 3:1) or is near-white.
 */
export function pickScarf(brand: BrandColorsInput | null | undefined): string {
  for (const v of [brand?.primary, brand?.secondary, brand?.accent]) {
    const hex = cleanHex(v);
    if (hex && usableScarf(hex)) return hex;
  }
  return TWEEN_BLUE;
}

/**
 * Tween's colours for a brand. `override` is the scarf colour the owner chose on the mascot screen: it wins over the
 * brand's palette and is not second-guessed. With no brand colours the result is Tween's own palette.
 */
export function tweenColorsFor(brand: BrandColorsInput | null | undefined, override?: string | null): TweenColors {
  const chosen = cleanHex(override);
  const scarf = chosen ?? pickScarf(brand);
  const accent = cleanHex(brand?.accent);
  // Tween's own blue keeps the kit's exact shades.
  const shades =
    scarf.toLowerCase() === TWEEN_BLUE.toLowerCase()
      ? { scarf: TWEEN_BLUE, scarfDark: DEFAULT_TWEEN_COLORS.scarfDark, scarfLight: DEFAULT_TWEEN_COLORS.scarfLight }
      : scarfShades(scarf);
  return {
    ...DEFAULT_TWEEN_COLORS,
    ...shades,
    coral: accent ?? TWEEN_CORAL,
  };
}

/** Swatches the owner can pick for the scarf: the brand's own colours (no duplicates), then Tween blue. */
export function scarfSwatches(brand: BrandColorsInput | null | undefined): { hex: string; kind: 'primary' | 'secondary' | 'accent' | 'tween' }[] {
  const out: { hex: string; kind: 'primary' | 'secondary' | 'accent' | 'tween' }[] = [];
  const seen = new Set<string>();
  for (const kind of ['primary', 'secondary', 'accent'] as const) {
    const hex = cleanHex(brand?.[kind]);
    if (hex && !seen.has(hex)) {
      seen.add(hex);
      out.push({ hex, kind });
    }
  }
  if (!seen.has(TWEEN_BLUE.toLowerCase())) out.push({ hex: TWEEN_BLUE.toLowerCase(), kind: 'tween' });
  return out;
}
