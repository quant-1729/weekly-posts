// The studio's typefaces: shipped open-licence (OFL) files in assets/fonts, served by /api/fonts/{file}.
// Pure data, safe in the browser. The shaper loads the files by these names on both sides, so what the owner
// sees while editing is exactly what the stored picture shows.

export interface StudioFont {
  key: string;
  label: string;
  /** How the picker groups it. */
  group: 'Clean' | 'Bold' | 'Elegant' | 'Fun' | 'Handwritten' | 'Indian';
  /** File base name: `${base}_${weightName}.ttf`. */
  base: string;
  weights: number[];
  /** The face also draws Devanagari (else Devanagari falls back to Noto Sans Devanagari). */
  deva?: boolean;
  /** A good size multiplier for display use (condensed faces can go bigger). */
  scale?: number;
}

export const WEIGHT_NAME: Record<number, string> = {
  400: '400Regular',
  500: '500Medium',
  600: '600SemiBold',
  700: '700Bold',
  800: '800ExtraBold',
  900: '900Black',
};

export const STUDIO_FONTS: StudioFont[] = [
  { key: 'poppins', label: 'Poppins', group: 'Clean', base: 'Poppins', weights: [400, 500, 700, 800, 900] },
  { key: 'montserrat', label: 'Montserrat', group: 'Clean', base: 'Montserrat', weights: [400, 500, 700, 800, 900] },
  { key: 'noto', label: 'Noto Sans', group: 'Clean', base: 'NotoSans', weights: [400, 500, 700, 800] },
  { key: 'nunito', label: 'Nunito', group: 'Fun', base: 'Nunito', weights: [400, 500, 700, 800] },
  { key: 'anton', label: 'Anton', group: 'Bold', base: 'Anton', weights: [400], scale: 1.1 },
  { key: 'bebas', label: 'Bebas Neue', group: 'Bold', base: 'BebasNeue', weights: [400], scale: 1.2 },
  { key: 'oswald', label: 'Oswald', group: 'Bold', base: 'Oswald', weights: [400, 500, 700], scale: 1.05 },
  { key: 'archivo', label: 'Archivo Black', group: 'Bold', base: 'ArchivoBlack', weights: [400], scale: 0.9 },
  { key: 'playfair', label: 'Playfair Display', group: 'Elegant', base: 'PlayfairDisplay', weights: [400, 500, 700, 800] },
  { key: 'dmserif', label: 'DM Serif Display', group: 'Elegant', base: 'DMSerifDisplay', weights: [400] },
  { key: 'pacifico', label: 'Pacifico', group: 'Handwritten', base: 'Pacifico', weights: [400], scale: 0.85 },
  { key: 'lobster', label: 'Lobster', group: 'Handwritten', base: 'Lobster', weights: [400] },
  { key: 'caveat', label: 'Caveat', group: 'Handwritten', base: 'Caveat', weights: [400, 700], scale: 1.15 },
  { key: 'baloo', label: 'Baloo 2', group: 'Indian', base: 'Baloo2', weights: [400, 500, 700, 800], deva: true },
  { key: 'yatra', label: 'Yatra One', group: 'Indian', base: 'YatraOne', weights: [400], deva: true },
];

export const FONT_BY_KEY: Record<string, StudioFont> = Object.fromEntries(STUDIO_FONTS.map((f) => [f.key, f]));
export const DEFAULT_FONT = 'poppins';

/** Kit font roles (brand Look section) mapped to studio faces. */
export const KIT_ROLE_FONT: Record<string, string> = { sans: 'poppins', serif: 'playfair', rounded: 'nunito', condensed: 'oswald', display: 'archivo' };

export const fontOf = (key: string): StudioFont => FONT_BY_KEY[key] ?? FONT_BY_KEY[DEFAULT_FONT];

export function nearestWeight(font: StudioFont, weight: number): number {
  let best = font.weights[0];
  for (const w of font.weights) if (Math.abs(w - weight) < Math.abs(best - weight) || (Math.abs(w - weight) === Math.abs(best - weight) && w > best)) best = w;
  return best;
}

export const fontFile = (font: StudioFont, weight: number): string => `${font.base}_${WEIGHT_NAME[nearestWeight(font, weight)]}.ttf`;

/** Fallback files for scripts the chosen face lacks. */
export const DEVA_FALLBACK = 'NotoSansDevanagari';
export const ARAB_FALLBACK = 'NotoSansArabic';
export const LATIN_FALLBACK = 'NotoSans';
const FALLBACK_WEIGHTS = [400, 500, 700, 800];
export function fallbackFile(base: string, weight: number): string {
  let best = FALLBACK_WEIGHTS[0];
  for (const w of FALLBACK_WEIGHTS) if (Math.abs(w - weight) <= Math.abs(best - weight)) best = w;
  return `${base}_${WEIGHT_NAME[best]}.ttf`;
}

/** Pairings offered by "Shuffle fonts" and used by the starting designs: [display, body]. */
export const FONT_PAIRS: { id: string; display: string; displayWeight: number; body: string; label: string }[] = [
  { id: 'modern', display: 'poppins', displayWeight: 800, body: 'poppins', label: 'Modern' },
  { id: 'loud', display: 'anton', displayWeight: 400, body: 'montserrat', label: 'Loud' },
  { id: 'classy', display: 'dmserif', displayWeight: 400, body: 'montserrat', label: 'Classy' },
  { id: 'sweet', display: 'pacifico', displayWeight: 400, body: 'nunito', label: 'Sweet' },
  { id: 'poster', display: 'bebas', displayWeight: 400, body: 'poppins', label: 'Poster' },
  { id: 'desi', display: 'baloo', displayWeight: 800, body: 'baloo', label: 'Desi' },
  { id: 'editorial', display: 'playfair', displayWeight: 800, body: 'noto', label: 'Editorial' },
  { id: 'friendly', display: 'nunito', displayWeight: 800, body: 'nunito', label: 'Friendly' },
];
