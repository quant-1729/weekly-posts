// Palette roles resolved from a brand kit and a colour scheme (G-1, G-6). Themes ask for roles
// (background, surface, solid block, accent), never raw kit colours, so a bad kit (yellow on white,
// navy on black) still gives readable pairs: ink is picked per surface by chooseInk, and accent
// fills are only used where they stand apart from what is behind them.

import type { BrandKit, DesignOption } from './types';
import { chooseFill, contrast, isDark, lum, mix } from './colors';

export type Scheme = DesignOption['scheme'];
export const SCHEMES: readonly Scheme[] = ['primary', 'light', 'dark', 'accent'];

export interface Palette {
  scheme: Scheme;
  /** Page background. */
  bg: string;
  /** A card or plate colour that stands apart from the background. */
  surface: string;
  /** A solid brand block (bands, panels) that stands apart from the background. */
  solid: string;
  /** Kit colours in order of preference for highlights (buttons, tags, rules). */
  accents: string[];
  /** Headline ink candidates on the page background, branded first. */
  head: string[];
  /** Body ink candidates on the page background. */
  body: string[];
  /** Neutral light and dark, tinted a little with the primary colour. */
  light: string;
  dark: string;
  kit: BrandKit['colors'];
}

const WHITE = '#ffffff';

/** Ink candidates for a given surface colour: the kit colours that differ, then neutrals (chooseInk adds pure white/black). */
export function inkCandidates(pal: Palette, surface: string, branded: boolean): string[] {
  const dark = isDark(surface);
  const neutral = dark ? [pal.light, WHITE] : [pal.dark, '#111111'];
  if (!branded) return neutral;
  const k = pal.kit;
  return [k.primary, k.secondary, k.accent, k.background].filter((c) => c.toLowerCase() !== surface.toLowerCase()).concat(neutral);
}

export function buildPalette(kit: BrandKit, scheme: Scheme): Palette {
  const k = kit.colors;
  const light = mix(WHITE, k.primary, 0.05);
  const dark = mix('#0d0f14', k.primary, 0.14);
  let bg: string;
  let surface: string;
  let solid: string;
  switch (scheme) {
    case 'light': {
      bg = lum(k.background) >= 0.5 ? k.background : light;
      surface = contrast(WHITE, bg) >= 1.06 ? WHITE : mix(bg, k.primary, 0.08);
      solid = k.primary;
      if (contrast(solid, bg) < 1.8) solid = dark;
      break;
    }
    case 'dark': {
      bg = lum(k.background) <= 0.06 ? k.background : dark;
      surface = mix(bg, WHITE, 0.09);
      solid = k.primary;
      if (contrast(solid, bg) < 1.5) solid = mix(bg, WHITE, 0.18);
      break;
    }
    case 'accent': {
      bg = k.accent;
      surface = isDark(bg) ? mix(bg, WHITE, 0.9) : mix(bg, WHITE, 0.82);
      solid = contrast(k.primary, bg) >= 1.8 ? k.primary : isDark(bg) ? mix(bg, WHITE, 0.2) : mix(bg, '#000000', 0.62);
      break;
    }
    case 'primary':
    default: {
      bg = k.primary;
      surface = contrast(k.secondary, bg) >= 1.5 ? k.secondary : isDark(bg) ? mix(bg, WHITE, 0.92) : mix(bg, '#000000', 0.9);
      solid = isDark(bg) ? mix(bg, '#000000', 0.3) : mix(bg, '#000000', 0.55);
    }
  }
  const pal: Palette = {
    scheme,
    bg,
    surface,
    solid,
    accents: [k.accent, k.secondary, k.primary].filter((c) => c.toLowerCase() !== bg.toLowerCase()),
    head: [],
    body: [],
    light,
    dark,
    kit: k,
  };
  pal.head = inkCandidates(pal, bg, true);
  pal.body = inkCandidates(pal, bg, false);
  return pal;
}

/** CTA/tag fill for a surface: the first kit accent that stands apart from it, else the surface's own ink. */
export function accentFor(pal: Palette, bgs: readonly string[]): string {
  const c = chooseFill(bgs, pal.accents, 1.8);
  if (c) return c;
  return isDark(bgs[0]) ? pal.light : pal.dark;
}

/** The scheme a kit starts from in a theme: the theme's light or dark default, by the kit's mode. */
export function defaultScheme(kit: BrandKit, themeDefaults: { light: Scheme; dark: Scheme }): Scheme {
  return kit.style.mode === 'dark' ? themeDefaults.dark : themeDefaults.light;
}
