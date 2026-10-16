// Layout lists and design options (G-6): three genuinely different compositions of the same content.
// Deterministic: the same kit, format, photo state, brand seed and brief always give the same options.

import type { PostType } from '@/lib/briefs/types';
import type { CharacterRole } from '@/lib/characters/types';
import { rolesFor } from './character';
import { isV2Format, v2Layouts } from './classic';
import { THEMES } from './themes';
import { defaultScheme, type Scheme } from './palette';
import type { BrandKit, CharacterSource, DesignContent, DesignFormat, DesignOption, ThemeId } from './types';

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

/** A stable number from a brand id (FNV-1a): two brands with the same inputs get different option sets, one brand always the same. */
export function hashSeed(key: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** What the option chooser knows about the post besides the kit. */
export interface OptionContext {
  /** From the brand id; 0 when unknown. */
  seed?: number;
  postType?: PostType;
  /** Extra types of the brief (the main type drives the layout; extras add context). */
  extras?: readonly PostType[];
  /** The kind of character the brand has on this post (none: no roles). */
  character?: CharacterSource['kind'] | null;
}

const PANEL_ARCHS = ['card', 'band', 'photoSplit', 'photoCard'];
/** The layout family of a recipe (classic's v2 template ids are not recipes: they count as a plain page). */
export const archOf = (themeId: ThemeId, layoutId: string): string => THEMES[themeId].recipes.find((r) => r.id === layoutId)?.arch ?? 'plain';

/**
 * The role for the option whose layout is the post's main composition, from what the post is about (docs/mascot-inspiration.md
 * section A): festival, event: celebrate; a scan call to action: point at the code; an offer: hold it on a sign; a new product:
 * present it beside the photo; timings and addresses: point at them; hours on a card: perch on it.
 */
export function primaryRole(content: DesignContent, ctx: OptionContext, hasPhoto: boolean): CharacterRole {
  const types = [ctx.postType, ...(ctx.extras ?? [])];
  if (ctx.postType === 'occasion' || ctx.postType === 'event') return 'celebrator';
  if (content.qr && content.cta?.kind === 'scan') return 'pointer';
  if (content.offerLine || ctx.postType === 'offer') return 'sign_holder';
  if (ctx.postType === 'new_product') return hasPhoto ? 'presenter' : 'pointer';
  if (ctx.postType === 'announcement') return 'pointer';
  if (types.includes('occasion') || types.includes('event')) return 'celebrator';
  if (types.includes('offer')) return 'sign_holder';
  if (content.blocks.some((b) => b.kind === 'hours') && !hasPhoto) return 'percher';
  return hasPhoto ? 'presenter' : 'narrator';
}

const rot = <T,>(list: readonly T[], by: number): T[] => (list.length ? list.map((_, i) => list[(i + by) % list.length]) : [...list]);

/**
 * `count` (default 3) designs for the same content, three genuinely different compositions: the kit's theme with one layout, then a
 * layout of another family (photo-led or typographic, panel or none) in a different colour scheme, then a neighbouring theme's layout
 * of a third family. Each carries a role for the brand's character (when there is one): the first a quiet accent (peeking or perching,
 * the photo or the type leads), the second the role the post type calls for, the third another role or no character at all. The brand
 * seed rotates the layout, theme and role picks so two brands with the same inputs differ. More options cycle through further layouts,
 * themes and schemes.
 */
export function designOptions(args: { kit: BrandKit; content: DesignContent; format: DesignFormat; hasPhoto: boolean; count?: number } & OptionContext): DesignOption[] {
  const { kit, format, hasPhoto, content } = args;
  const seed = args.seed ?? 0;
  const count = Math.max(1, args.count ?? 3);
  const theme = THEMES[kit.themeId];
  const base = defaultScheme(kit, theme.schemes);
  const own = listLayouts(theme.id, format, hasPhoto);
  const neighbours = theme.neighbours.map((id) => THEMES[id]);
  const out: DesignOption[] = [];
  const seen = new Set<string>();
  const push = (themeId: ThemeId, layoutId: string | undefined, scheme: Scheme, role?: CharacterRole | null) => {
    if (!layoutId) return;
    const key = `${themeId}|${layoutId}|${scheme}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(role === undefined ? { themeId, layoutId, scheme } : { themeId, layoutId, scheme, role });
  };
  const nbLayouts = neighbours.map((t) => listLayouts(t.id, format, hasPhoto));
  const nbBase = neighbours.map((t) => defaultScheme(kit, t.schemes));

  // Compositions: a layout family per slot, different families first.
  const aLayout = rot(own, seed % Math.max(1, own.length))[0];
  const aArch = aLayout ? archOf(theme.id, aLayout.id) : '';
  const bLayout = rot(own, (seed + 1) % Math.max(1, own.length)).find((l) => archOf(theme.id, l.id) !== aArch) ?? own.find((l) => l.id !== aLayout?.id) ?? own[0];
  const bArch = bLayout ? archOf(theme.id, bLayout.id) : '';
  const nbIdx = (seed >>> 1) % neighbours.length;
  const cTheme = neighbours[nbIdx];
  const cList = nbLayouts[nbIdx];
  const cLayout = rot(cList, seed % Math.max(1, cList.length)).find((l) => ![aArch, bArch].includes(archOf(cTheme.id, l.id))) ?? cList[0];
  const cArch = cLayout ? archOf(cTheme.id, cLayout.id) : '';

  // Roles.
  const roles = args.character ? rolesFor(args.character, format) : [];
  const withRole = roles.length > 0;
  const used = new Set<CharacterRole>();
  const take = (r: CharacterRole | undefined): CharacterRole | undefined => {
    if (!r || !roles.includes(r) || used.has(r)) return undefined;
    used.add(r);
    return r;
  };
  const fits = (r: CharacterRole, arch: string): boolean => {
    if (r === 'narrator') return !arch.startsWith('photo');
    if (r === 'peeker') return PANEL_ARCHS.includes(arch);
    if (r === 'percher') return PANEL_ARCHS.includes(arch) || arch === 'plain';
    if (r === 'sign_holder') return !!content.offerLine || !!content.headline.trim();
    return true;
  };
  // The post type's role goes to the second option; the quiet and the third options differ from it.
  const wantB = primaryRole(content, args, hasPhoto);
  const bRole = take(fits(wantB, bArch) ? wantB : undefined) ?? take(rot(['presenter', 'pointer', 'celebrator'] as CharacterRole[], seed % 3).find((r) => roles.includes(r) && !used.has(r) && fits(r, bArch)));
  const quiet: CharacterRole[] = rot(['peeker', 'percher'], seed % 2);
  const aRole =
    take(quiet.find((r) => roles.includes(r) && !used.has(r) && fits(r, aArch))) ?? take(rot(['pointer', 'presenter'] as CharacterRole[], seed % 2).find((r) => roles.includes(r) && !used.has(r)));
  const third: CharacterRole[] = rot(['pointer', 'presenter', 'narrator', 'celebrator', 'sign_holder'], (seed >>> 2) % 5);
  const cRole = take(third.find((r) => roles.includes(r) && !used.has(r) && fits(r, cArch) && (r !== 'sign_holder' || !!content.offerLine)));
  const roleOf = (r: CharacterRole | undefined): CharacterRole | null | undefined => (withRole ? (r ?? null) : undefined);

  push(theme.id, aLayout?.id, base, roleOf(aRole));
  push(theme.id, bLayout?.id, ALT[base], roleOf(bRole));
  push(cTheme.id, cLayout?.id, nbBase[nbIdx], roleOf(cRole));
  // Further options for count > 3 (the same roles, further layouts).
  const other = neighbours[(nbIdx + 1) % neighbours.length];
  const otherList = nbLayouts[(nbIdx + 1) % neighbours.length];
  const otherBase = nbBase[(nbIdx + 1) % neighbours.length];
  push(theme.id, (own[2] ?? own[0])?.id, THIRD[base], roleOf(aRole));
  push(other.id, otherList[0]?.id, otherBase, roleOf(bRole));
  push(cTheme.id, (cList[1] ?? cList[0])?.id, ALT[nbBase[nbIdx]], roleOf(cRole));
  push(theme.id, own[1]?.id ?? own[0]?.id, base, roleOf(bRole));
  push(other.id, (otherList[1] ?? otherList[0])?.id, ALT[otherBase], roleOf(aRole));
  for (const s of ['primary', 'light', 'dark', 'accent'] as const) push(theme.id, own[0]?.id, s, roleOf(aRole));
  return out.slice(0, count);
}
