/** Colour contrast for the brand kit (WCAG ratios). Pure; safe in the browser. */
import { hexToRgb, hslToRgb, normalizeHex, rgbToHex, rgbToHsl } from "@/lib/brand/colors";

/** Brand colour on the background is used for big text, buttons and shapes: 3:1 is the floor (WCAG large text). */
export const MIN_PRIMARY_CONTRAST = 3;

function channel(v: number): number {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG contrast ratio, 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * The colour closest to `fg` (same hue and saturation, lightness moved away from the background)
 * that reaches `min` against `bg`. Falls back to black or white, which always reach it.
 */
export function readableVersion(fg: string, bg: string, min = MIN_PRIMARY_CONTRAST): string {
  const f = normalizeHex(fg);
  if (contrastRatio(f, bg) >= min) return f;
  const [h, s, l] = rgbToHsl(...hexToRgb(f));
  const darker = relativeLuminance(bg) > 0.18; // on a light background go darker, else lighter
  for (let step = 1; step <= 50; step++) {
    const nl = Math.max(0, Math.min(1, l + (darker ? -1 : 1) * step * 0.02));
    const candidate = rgbToHex(...hslToRgb(h, s, nl));
    if (contrastRatio(candidate, bg) >= min) return candidate;
  }
  return darker ? "#000000" : "#FFFFFF";
}

/** White or near-black, whichever gives `fg` more contrast: an alternative to changing the brand colour. */
export function bestPlainBackground(fg: string): string {
  return contrastRatio(fg, "#FFFFFF") >= contrastRatio(fg, "#111111") ? "#FFFFFF" : "#111111";
}

export interface ContrastWarning {
  pair: "primary-on-background";
  ratio: number;
  min: number;
  suggestion: {
    /** A version of the primary colour that reads on the current background. */
    primary: string;
    /** A plain background that suits the current primary. */
    background: string;
  };
}

/** Warns when the primary colour on the background is under 3:1, and suggests the fix. Empty when fine. */
export function contrastWarnings(colors: { primary: string; background: string }): ContrastWarning[] {
  const ratio = contrastRatio(colors.primary, colors.background);
  if (ratio >= MIN_PRIMARY_CONTRAST) return [];
  return [
    {
      pair: "primary-on-background",
      ratio: Math.round(ratio * 100) / 100,
      min: MIN_PRIMARY_CONTRAST,
      suggestion: {
        primary: readableVersion(colors.primary, colors.background),
        background: bestPlainBackground(colors.primary),
      },
    },
  ];
}
