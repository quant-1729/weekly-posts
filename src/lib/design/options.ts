// Layout lists and design options (G-6): three visibly different designs of the same content.
// Deterministic: the same kit, format and photo state always give the same options.

import { isV2Format, v2Layouts } from './classic';
import { THEMES } from './themes';
import { defaultScheme, type Scheme } from './palette';
import type { BrandKit, DesignContent, DesignFormat, DesignOption, ThemeId } from './types';

export interface LayoutInfo {
  id: string;
  name: string;
  needsPhoto: boolean;
}

/**
 * Layout families of a theme for a format. Photo layouts need an owner photo; pass `hasPhoto` to get
 * only the layouts that apply. Classic lists the v2 template ids for square, vertical and landscape.
 */
export function listLayouts(themeId: ThemeId, format: DesignFormat, hasPhoto?: boolean): LayoutInfo[] {
  const all: LayoutInfo[] =
    themeId === 'classic' && isV2Format(format)
      ? v2Layouts(format)
      : THEMES[themeId].recipes.map((r) => ({ id: r.id, name: r.name, needsPhoto: r.arch.startsWith('photo') }));
  return hasPhoto === undefined ? all : all.filter((l) => l.needsPhoto === hasPhoto);
}

const ALT: Record<Scheme, Scheme> = { light: 'primary', primary: 'light', dark: 'light', accent: 'dark' };
const THIRD: Record<Scheme, Scheme> = { light: 'dark', primary: 'dark', dark: 'primary', accent: 'light' };

/**
 * `count` (default 3) designs for the same content: the kit's theme in its own scheme, the same theme's
 * second layout in a different colour scheme, and the first layout of a neighbouring theme; more
 * options cycle through further layouts, themes and schemes.
 */
export function designOptions(args: { kit: BrandKit; content: DesignContent; format: DesignFormat; hasPhoto: boolean; count?: number }): DesignOption[] {
  const { kit, format, hasPhoto } = args;
  const count = Math.max(1, args.count ?? 3);
  const theme = THEMES[kit.themeId];
  const base = defaultScheme(kit, theme.schemes);
  const own = listLayouts(theme.id, format, hasPhoto);
  const neighbours = theme.neighbours.map((id) => THEMES[id]);
  const out: DesignOption[] = [];
  const seen = new Set<string>();
  const push = (themeId: ThemeId, layoutId: string | undefined, scheme: Scheme) => {
    if (!layoutId) return;
    const key = `${themeId}|${layoutId}|${scheme}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ themeId, layoutId, scheme });
  };
  const nbLayouts = neighbours.map((t) => listLayouts(t.id, format, hasPhoto));
  const nbBase = neighbours.map((t) => defaultScheme(kit, t.schemes));

  push(theme.id, own[0]?.id, base);
  push(theme.id, (own[1] ?? own[0])?.id, ALT[base]);
  push(neighbours[0].id, nbLayouts[0][0]?.id, nbBase[0]);
  // Further options for count > 3.
  push(theme.id, own[2]?.id ?? own[0]?.id, THIRD[base]);
  push(neighbours[1].id, nbLayouts[1][0]?.id, nbBase[1]);
  push(neighbours[0].id, (nbLayouts[0][1] ?? nbLayouts[0][0])?.id, ALT[nbBase[0]]);
  push(theme.id, own[1]?.id ?? own[0]?.id, base);
  push(neighbours[1].id, (nbLayouts[1][1] ?? nbLayouts[1][0])?.id, ALT[nbBase[1]]);
  for (const s of ['primary', 'light', 'dark', 'accent'] as const) push(theme.id, own[0]?.id, s);
  return out.slice(0, count);
}
