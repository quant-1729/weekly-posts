/** Kit defaults: a background derived from the colours, and a starting look from the colours' energy. Pure; safe in the browser. */
import { hexToRgb, hslToRgb, isHexColor, normalizeHex, PRESET_PALETTES, rgbToHex, rgbToHsl, tint } from "@/lib/brand/colors";
import { DEFAULT_KIT, type BrandKit, type FontChoice, type ThemeId } from "@/lib/design/types";
import { relativeLuminance } from "./contrast";

/** Colours for a brand that has none yet: the calm blue preset. */
const BLUE = PRESET_PALETTES.find((p) => p.id === "blue")!;
export const DEFAULT_COLORS: Pick<BrandKit["colors"], "primary" | "secondary" | "accent"> = {
  primary: BLUE.primary,
  secondary: BLUE.secondary,
  accent: BLUE.accent,
};

export type Mode = BrandKit["style"]["mode"];

/**
 * The background colour when the owner has not chosen one. Light: the secondary colour when it is
 * a light tint, else white. Dark: a very dark shade of the primary.
 */
export function deriveBackground(colors: { primary: string; secondary?: string }, mode: Mode): string {
  if (mode === "light") {
    const sec = colors.secondary;
    return sec && isHexColor(sec) && relativeLuminance(sec) >= 0.8 ? normalizeHex(sec) : "#FFFFFF";
  }
  const [h, s] = rgbToHsl(...hexToRgb(colors.primary));
  return rgbToHex(...hslToRgb(h, Math.min(s, 0.35), 0.09));
}

interface Look {
  themeId: ThemeId;
  fonts: BrandKit["fonts"];
  style: BrandKit["style"];
}

function pick(fonts: [FontChoice, FontChoice], themeId: ThemeId, style: Partial<BrandKit["style"]>): Look {
  return { themeId, fonts: { headline: fonts[0], body: fonts[1] }, style: { ...DEFAULT_KIT.style, ...style } };
}

/** The theme, fonts and style that suit a primary colour's energy: dark and quiet is premium, loud and warm is a sale, and so on. */
function lookForPrimary(primary: string): Look {
  const [h, s, l] = rgbToHsl(...hexToRgb(primary));
  if (l < 0.12) return pick(["sans", "sans"], "minimal_dark", { mode: "dark", corners: "sharp" });
  if (s < 0.12) return pick(["sans", "sans"], "clean", {}); // greys
  if (l < 0.3 && s < 0.55) return pick(["serif", "sans"], "premium", { corners: "sharp" });
  if (h >= 75 && h <= 170) return pick(["rounded", "sans"], "fresh", {});
  if (h >= 270 && h <= 345 && s >= 0.45) return pick(["rounded", "rounded"], "playful", { energy: "bold" });
  if ((h <= 25 || h >= 345) && s >= 0.6 && l >= 0.3) return pick(["condensed", "sans"], "bold_sale", { energy: "bold" });
  return pick(["sans", "sans"], "clean", {});
}

export type ColorsInput = Partial<Record<"primary" | "secondary" | "accent" | "background", string | null | undefined>>;

/** Keeps the valid colours of a loose object, fills the rest from the default palette; background derived when missing. */
export function completeColors(input: ColorsInput | null | undefined, mode: Mode): BrandKit["colors"] {
  const ok = (v: string | null | undefined): v is string => typeof v === "string" && isHexColor(v);
  const primary = ok(input?.primary) ? normalizeHex(input!.primary!) : DEFAULT_COLORS.primary;
  const secondary = ok(input?.secondary) ? normalizeHex(input!.secondary!) : ok(input?.primary) ? tint(primary, 0.92) : DEFAULT_COLORS.secondary;
  const accent = ok(input?.accent) ? normalizeHex(input!.accent!) : DEFAULT_COLORS.accent;
  const background = ok(input?.background) ? normalizeHex(input!.background!) : deriveBackground({ primary, secondary }, mode);
  return { primary, secondary, accent, background };
}

/**
 * A starting kit from a palette (a logo's, a website's, a preset): theme by colour energy and a font
 * pairing that goes with it (a serif headline for premium, and so on). Source stays "default": the
 * owner has not chosen it. Always valid per brandKitSchema.
 */
export function kitFromColors(colors: ColorsInput | null | undefined): BrandKit {
  const base = completeColors(colors, "light");
  const look = lookForPrimary(base.primary);
  return {
    colors: completeColors({ ...colors, background: colors?.background }, look.style.mode),
    fonts: look.fonts,
    style: look.style,
    themeId: look.themeId,
    textLogo: DEFAULT_KIT.textLogo,
    mascot: DEFAULT_KIT.mascot,
    source: "default",
  };
}
