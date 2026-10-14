// "Keep my look" (C-17, G-2): turn a style read into a full brand kit. Pure functions, no AI.
//
// Colours are ordered by share (how much of the brand's own graphics they cover) and checked for
// contrast with the existing colour helpers: shapes and buttons need 3:1 against the background,
// text colour is chosen by the engine (pickInk), which always reaches 4.5:1.

import type { StyleRead } from '@/lib/ai/schemas-v3';
import { hexToRgb, hslToRgb, normalizeHex, paletteFromPrimary, rgbToHex, rgbToHsl, tint } from '@/lib/brand/colors';
import { brandKitSchema, type BrandKit } from '@/lib/design/types';
import { contrast, luminance, parseHex, pickInk } from '@/lib/render/color';
import { styleCopy } from './copy';

export type KitSource = 'instagram' | 'website' | 'mixed';

export interface KitSuggestion {
  kit: BrandKit;
  /** False when the read was not confident: the kit is the current one, unchanged. */
  clear: boolean;
  /** Plain-words message for the owner when `clear` is false. */
  message: string | null;
  /** What was adjusted, e.g. "Darkened the main colour so it stands out on the background." */
  notes: string[];
}

/** Below this the images do not agree on one look. */
export const MIN_CONFIDENCE = 0.4;
/** Shapes, buttons and frames must stand out from the background at least this much (WCAG non-text contrast). */
export const MIN_SHAPE_CONTRAST = 3;

const lum = (hex: string) => luminance(parseHex(hex));
const sat = (hex: string) => rgbToHsl(...hexToRgb(hex))[1];

/** Moves a colour's lightness away from the background until it reaches `min` contrast. Same hue and saturation. */
export function fixContrast(color: string, background: string, min = MIN_SHAPE_CONTRAST): { hex: string; changed: boolean; ok: boolean } {
  if (contrast(color, background) >= min) return { hex: color, changed: false, ok: true };
  const [h, s, l] = rgbToHsl(...hexToRgb(color));
  const darker = lum(background) > 0.18; // light background: go darker; dark background: go lighter
  for (let step = 1; step <= 25; step++) {
    const nl = Math.max(0, Math.min(1, l + (darker ? -1 : 1) * step * 0.04));
    const hex = normalizeHex(rgbToHex(...hslToRgb(h, s, nl)));
    if (contrast(hex, background) >= min) return { hex, changed: true, ok: true };
  }
  const end = darker ? '#111111' : '#F5F5F5';
  return { hex: end.toUpperCase(), changed: true, ok: contrast(end, background) >= min };
}

function pickBackground(mode: 'light' | 'dark', byShare: string[], primaryGuess: string): string {
  if (mode === 'light') {
    const light = byShare.find((c) => lum(c) >= 0.55);
    if (light) return light;
    return tint(primaryGuess, 0.94);
  }
  const dark = byShare.find((c) => lum(c) <= 0.12);
  if (dark) return dark;
  const [h, s] = rgbToHsl(...hexToRgb(primaryGuess));
  return normalizeHex(rgbToHex(...hslToRgb(h, Math.min(s, 0.35), 0.09)));
}

/** The read's colours, valid and unique, biggest share first. */
export function readColors(read: StyleRead): string[] {
  const seen = new Set<string>();
  return [...read.colors]
    .filter((c) => /^#[0-9a-fA-F]{6}$/.test(c.hex))
    .sort((a, b) => b.share - a.share)
    .map((c) => normalizeHex(c.hex))
    .filter((hex) => (seen.has(hex) ? false : (seen.add(hex), true)));
}

/**
 * Maps a style read to a full kit. Colours come from the read (primary = the biggest colourful one,
 * background = the biggest light or dark one for the mode); fonts, style and theme come from the read;
 * the logo setting and mascot switch stay as they are. Low confidence returns the current kit unchanged.
 */
export function suggestKitDetailed(read: StyleRead, current: BrandKit, source: KitSource = 'instagram'): KitSuggestion {
  if (read.confidence < MIN_CONFIDENCE) {
    return { kit: current, clear: false, message: styleCopy.noClearLook, notes: [] };
  }
  const colors = readColors(read);
  if (colors.length === 0) {
    return { kit: current, clear: false, message: styleCopy.noClearLook, notes: [] };
  }
  const notes: string[] = [];

  // Primary: the biggest colour that is actually coloured (not white, grey or black), else the biggest.
  const colourful = colors.filter((c) => sat(c) >= 0.2 && lum(c) > 0.02 && lum(c) < 0.9);
  let primary = colourful[0] ?? colors.find((c) => lum(c) < 0.9 && lum(c) > 0.02) ?? colors[0];
  const background = pickBackground(read.mode, colors.filter((c) => c !== primary), primary);

  const rest = colors.filter((c) => c !== primary && c !== background);
  let secondary = rest[0] ?? (read.mode === 'dark' ? tint(primary, 0.25) : tint(primary, 0.85));
  // Accent: the next colour that differs from the primary in hue, else a complementary one.
  const [ph] = rgbToHsl(...hexToRgb(primary));
  const hueGap = (c: string) => {
    const d = Math.abs(rgbToHsl(...hexToRgb(c))[0] - ph);
    return Math.min(d, 360 - d);
  };
  const accentPick = rest.slice(1).find((c) => sat(c) >= 0.2) ?? rest.slice(1)[0];
  let accent = accentPick && (hueGap(accentPick) >= 30 || rest.length > 2) ? accentPick : paletteFromPrimary(primary).accent;

  const p = fixContrast(primary, background);
  if (p.changed) {
    primary = p.hex;
    notes.push(p.ok ? styleCopy.noteMainAdjusted : styleCopy.noteMainWeak);
  }
  const a = fixContrast(accent, background);
  if (a.changed) {
    accent = a.hex;
    notes.push(a.ok ? styleCopy.noteAccentAdjusted : styleCopy.noteAccentWeak);
  }
  // Text on the background and on the main colour is chosen by the engine; make sure that always works.
  for (const bg of [background, primary]) {
    if (contrast(pickInk(bg), bg) < 4.5) notes.push(styleCopy.noteTextWeak);
  }
  secondary = normalizeHex(secondary);

  const kit = brandKitSchema.parse({
    colors: { primary: normalizeHex(primary), secondary, accent: normalizeHex(accent), background: normalizeHex(background) },
    fonts: { headline: read.headline_font, body: read.body_font },
    style: { corners: read.corners, mode: read.mode, energy: read.energy },
    themeId: read.theme,
    textLogo: current.textLogo,
    mascot: current.mascot,
    source,
  });
  return { kit, clear: true, message: null, notes };
}

/** The suggested kit only. See suggestKitDetailed for the notes and the low-confidence message. */
export function suggestKit(read: StyleRead, currentKit: BrandKit, source: KitSource = 'instagram'): BrandKit {
  return suggestKitDetailed(read, currentKit, source).kit;
}
