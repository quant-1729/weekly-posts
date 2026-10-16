// The design renderer (G-4): content + brand kit + theme -> SVG -> PNG, with the hierarchy, auto-fit,
// contrast, safe-zone and QR rules applied and reported. Pure code: no AI call, no network.
//
// Fit order for one design: text shrinks towards each role's minimum and wraps; if that is not
// enough the next layout variant (more room) is tried, then the next layout family; only then is
// lower-priority content dropped (secondary lines first, then the subline) and reported in
// `report.dropped`. What still does not fit is reported in `report.overflow` (text is never cut silently).

import { Resvg } from '@resvg/resvg-js';
import type { CharacterRole } from '@/lib/characters';
import { detectDirection, initShaping, type Box } from '@/lib/render';
import type { Dir } from '@/lib/render/shape';
import { verifyRendered } from '@/lib/qr/decode';
import { fitsSlot } from '@/lib/qr/size';
import { CHAR_STEPS, drawCharLayout, layoutCharacter, planCharacter, signTextFor, type CharLayout } from './character';
import { recipeForV2, renderClassicV2 } from './classic';
import { applyPostFilter } from './filters';
import { filterActive } from './filter-presets';
import { fadeMaskSvg, photoBlurUri, photoUri, prepareLogo, textureUri, usablePhoto } from './assets';
import { MIN_CONTRAST, MIN_CONTRAST_LARGE, LARGE_TEXT_PX, minContrast } from './colors';
import {
  CLS,
  HEADLINE_LED_MIN,
  QR_RULE_WIDTH,
  SAFE_ZONES,
  CONTENT_BOX,
  rr,
  type CharSpec,
  type Faces,
  type Plan,
  type PlanCtx,
  type QrTile,
  type Recipe,
  type ThemeDef,
} from './core';
import { buildPalette, defaultScheme, type Palette, type Scheme } from './palette';
import { TEXTURE_ALPHA, buildPlans, mirrorPlan } from './plan';
import {
  computeQrTile,
  drawContacts,
  drawLogo,
  drawMarker,
  drawMascot,
  drawQrTile,
  drawStack,
  fitStack,
  stackItems,
  type ContactsDraw,
  type Placed,
  type PreparedLogo,
  type StackFit,
  type StackItem,
  type StyleCtx,
} from './scene';
import { getTheme } from './themes';
import { FORMAT_RULES, FORMAT_SIZE, FORMAT_USP_CAPACITY, type DesignBlock, type DesignInput, type DesignReport, type DesignResult, type FontChoice } from './types';

/** The result plus what the tests and the contact sheets inspect. */
export interface DesignDetail extends DesignResult {
  scheme: Scheme;
  placements: Placed[];
  qrBox: Box | null;
  dir: Dir;
  faces: Faces;
  mascotDropped: boolean;
  /** Share of the canvas free of text, codes, logo and character. */
  freeSpace: number;
  /** CH-2: the character the layout drew (null when none: no role, or no layout could carry it). */
  character: { role: CharacterRole; action: string; box: Box; sign: { text: string; box: Box } | null; bubble: { text: string; box: Box } | null; pointAt: { x: number; y: number } | null; side: 'left' | 'right'; svg: string } | null;
  /** 'engine' for the new renderer, 'v2' when the classic v2 templates drew it. */
  engine: 'engine' | 'v2';
}

const isPhotoRecipe = (r: Recipe) => r.arch.startsWith('photo');

/** Layouts with a panel top edge: a peeker hides behind it, a percher sits on it. */
const PANEL_ARCHS: readonly Recipe['arch'][] = ['card', 'band', 'photoSplit', 'photoCard'];

/** A role a layout cannot carry becomes the one that can: a narrator's bubble needs the open stage of a layout without a photo; peeking and perching need a panel edge. */
export function adaptRole(role: CharacterRole, arch: Recipe['arch']): CharacterRole {
  if (role === 'narrator' && arch.startsWith('photo')) return 'presenter';
  if (role === 'peeker' && !PANEL_ARCHS.includes(arch)) return 'presenter';
  if (role === 'percher' && !PANEL_ARCHS.includes(arch) && arch !== 'plain') return 'presenter';
  return role;
}

const hits = (a: Box, b: Box) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

/** The character's visible box meets a zone that text, contacts, the code, the logo or the slide marker use. */
function charClash(plan: Plan, tile: { w: number; h: number } | null, W: number, drawn: Box): boolean {
  const z = plan.char;
  if (!z) return false;
  // What is really drawn (a pose can be narrower than the zone reserved for the widest one); a peeker's lower part is hidden.
  const seen: Box = z.behind ? { ...drawn, h: Math.max(0, Math.min(drawn.y + drawn.h, z.floorY) - drawn.y) } : drawn;
  const boxes: (Box | null)[] = [plan.text.box, plan.contacts?.box ?? null, plan.logo?.box ?? null, plan.marker?.box ?? null, plan.qr && tile ? { x: plan.qr.x, y: plan.qr.y, w: tile.w, h: tile.h } : null];
  const gap = Math.round(W * 0.03) - 1; // a pixel of slack for rounding
  const v = { x: seen.x - gap, y: seen.y - gap, w: seen.w + 2 * gap, h: seen.h + 2 * gap };
  return boxes.some((b) => b && b.w > 0 && b.h > 0 && hits(v, b));
}

/** Recipes to try, best first: the requested one (if usable), then the theme's others of the same kind. */
export function candidateRecipes(theme: ThemeDef, hasPhoto: boolean, requested?: string): Recipe[] {
  const base = theme.recipes.filter((r) => isPhotoRecipe(r) === hasPhoto);
  // Last resort for a photo post: a full-photo layout with a large caption panel, in the theme's own type and palette.
  if (hasPhoto) base.push({ id: `${theme.id}-photo-roomy`, name: 'Photo, roomy caption', arch: 'photoFull', align: 'left', deco: [] });
  const req = requested ? [...theme.recipes, ...base].find((r) => r.id === requested) : undefined;
  if (req && (!isPhotoRecipe(req) || hasPhoto)) return [req, ...base.filter((r) => r !== req)];
  return base;
}

export function resolveFaces(theme: ThemeDef, kitFonts: { headline: FontChoice; body: FontChoice }, source: string): Faces {
  const f = source === 'default' ? theme.fonts : kitFonts;
  return { head: f.headline, body: f.body };
}

interface Level {
  sec: number;
  sub: boolean;
}

interface Attempt {
  recipe: Recipe;
  plan: Plan;
  ctx: PlanCtx;
  sc: StyleCtx;
  fit: StackFit;
  contacts: ContactsDraw | null;
  dropped: string[];
  overflow: string[];
  /** The character's sign and bubble, fitted. */
  charLay: CharLayout | null;
  complete: boolean;
  score: number;
  /** Among complete variants the one with the larger type wins (headline first). */
  quality: number;
  /** The headline reached at least 62% of its maximum size: a variant like this is taken in plan order. */
  good: boolean;
}

const cleanBlocks = (blocks: DesignBlock[]): DesignBlock[] => blocks.filter((b) => b.kind !== 'logo' && b.text.trim());

const FORMAT_NOUN: Record<string, string> = { thumbnail: 'thumbnails', banner: 'banners', landscape: 'landscape images' };

/**
 * FORMAT_RULES: a QR or contact lines a format may not carry are left out by rule and reported in
 * report.dropped (they are not an overflow). Contact lines are kept in the order given.
 */
export function applyFormatRules(input: DesignInput): { input: DesignInput; ruleDropped: string[] } {
  const rules = FORMAT_RULES[input.format];
  const noun = FORMAT_NOUN[input.format] ?? 'this format';
  const ruleDropped: string[] = [];
  let content = input.content;
  if (content.qr && !rules.qr) {
    ruleDropped.push(`qr: not shown on ${noun}`);
    content = { ...content, qr: null };
  }
  const blocks = cleanBlocks(content.blocks);
  if (blocks.length > rules.maxContacts) {
    for (const b of blocks.slice(rules.maxContacts)) ruleDropped.push(`contact: not shown on ${noun}: ${b.text}`);
    content = { ...content, blocks: blocks.slice(0, rules.maxContacts) };
  }
  return { input: content === input.content ? input : { ...input, content }, ruleDropped };
}

/** Negative space (docs/mascot-inspiration.md B7): at least this share of a post with a character is free of text, character and logo. */
export const MIN_FREE_SPACE = 0.3;

/** The share of the canvas that no text line, code, logo, icon or character covers (the owner's photo and the colour field count as free). */
export function freeSpaceShare(placements: Placed[], W: number, H: number): number {
  const cell = 12;
  const cols = Math.ceil(W / cell);
  const rows = Math.ceil(H / cell);
  const grid = new Uint8Array(cols * rows);
  const mark = (b: Box) => {
    if (b.w <= 0 || b.h <= 0) return;
    const x0 = Math.max(0, Math.floor(b.x / cell));
    const x1 = Math.min(cols - 1, Math.floor((b.x + b.w) / cell));
    const y0 = Math.max(0, Math.floor(b.y / cell));
    const y1 = Math.min(rows - 1, Math.floor((b.y + b.h) / cell));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) grid[y * cols + x] = 1;
  };
  for (const p of placements) {
    if (p.kind === 'qr' || p.kind === 'logo' || p.kind === 'mascot' || p.kind === 'icon') mark(p.box);
    else if (p.lines.length) p.lines.forEach(mark);
    else mark(p.box);
  }
  let used = 0;
  for (const v of grid) used += v;
  return 1 - used / grid.length;
}

/** What a result costs the owner: text that does not fit, unreadable pairs, things in the unsafe zone, a QR that does not read, dropped lines. */
const trouble = (d: DesignDetail): number =>
  d.report.overflow.length * 100 + d.report.contrast.length * 50 + d.report.safeZone.length * 50 + (d.report.qr && !d.report.qr.ok ? 1000 : 0) + (d.character && d.freeSpace < MIN_FREE_SPACE ? 40 : 0) + d.report.dropped.filter((x) => !/^(qr|contact): not shown/.test(x)).length;

export async function renderDesignDetailed(rawInput: DesignInput): Promise<DesignDetail> {
  const wants = !!rawInput.role && !!rawInput.character && (!rawInput.slide || !!rawInput.slide.kind);
  if (!wants) return renderOnce(rawInput);
  // When the text does not fit beside the character, the character shrinks to the next size (and band) before the type does; one
  // that cannot be placed cleanly at any size never costs the post its text: the post is drawn without the character instead.
  let best: DesignDetail | null = null;
  for (let step = 0; step < CHAR_STEPS; step++) {
    let r: DesignDetail | null = null;
    try {
      r = await renderOnce(rawInput, step);
    } catch {
      r = null;
    }
    if (!r || !r.character) continue;
    const t = trouble(r);
    if (t === 0) return r;
    if (!best || t < trouble(best)) best = r;
  }
  const plain = await renderOnce({ ...rawInput, role: null, character: null });
  return best && trouble(best) <= trouble(plain) ? best : plain;
}

async function renderOnce(rawInput: DesignInput, step = 0): Promise<DesignDetail> {
  await initShaping();
  const { input: ruled, ruleDropped } = applyFormatRules(rawInput);
  // The post filter (UX-2) touches the photo and the Imagen background only; everything drawn after is exact.
  const input: DesignInput = filterActive(ruled.filter)
    ? { ...ruled, photo: (await applyPostFilter(ruled.photo, ruled.filter)) ?? null, background: (await applyPostFilter(ruled.background, ruled.filter)) ?? null }
    : ruled;
  const { format, content, kit } = input;
  const size = FORMAT_SIZE[format];
  const W = size.width;
  const H = size.height;
  const cls = CLS[format];
  const theme = getTheme(input.themeId);

  const charOn = !!input.role && !!input.character && (!input.slide || !!input.slide.kind);
  const seed = input.seed ?? 0;

  // v2 delegation for the classic theme (kept byte-for-byte for plain content, and when the layout has no character).
  if (input.themeId === 'classic' && !charOn) {
    const v2 = await renderClassicV2(input);
    if (v2) return v2;
  }

  const dir: Dir =
    input.dir === 'ltr' || input.dir === 'rtl' ? input.dir : detectDirection([content.headline, content.subline, content.primary?.text ?? '', content.cta?.text ?? ''].filter(Boolean).join(' '));
  const rtl = dir === 'rtl';
  const faces = resolveFaces(theme, kit.fonts, kit.source);

  const [logo, photo] = await Promise.all([prepareLogo(input.logo), usablePhoto(input.photo)]);
  const hasPhoto = !!photo;
  const showLogo = !!logo || (kit.textLogo && !!input.brandName.trim());
  const blocks = cleanBlocks(content.blocks);

  let tile: (QrTile & { truncated: boolean }) | null = null;
  if (content.qr) {
    tile = computeQrTile(content.qr, format, dir);
    const fit = fitsSlot({ text: content.qr.text, slot: { width: tile.qrPx, height: tile.qrPx }, canvasWidth: QR_RULE_WIDTH[format] });
    if (!fit.fits) throw new Error(`The QR code cannot be drawn readably in ${format}: ${fit.reason}`);
  }

  const mode = kit.style.mode;
  const palettes = new Map<Scheme, Palette>();
  const paletteFor = (r: Recipe): { pal: Palette; scheme: Scheme } => {
    const scheme = input.scheme ?? r.schemes?.[mode] ?? defaultScheme(kit, theme.schemes);
    let pal = palettes.get(scheme);
    if (!pal) {
      pal = buildPalette(kit, scheme);
      palettes.set(scheme, pal);
    }
    return { pal, scheme };
  };

  const radius = kit.style.corners === 'sharp' ? 0 : theme.style.radius;
  const capacity = FORMAT_USP_CAPACITY[format].secondary;
  const nSec = Math.min(content.secondary.length, capacity);
  const levels: Level[] = [];
  for (let k = nSec; k >= 0; k--) levels.push({ sec: k, sub: true });
  if (content.subline) levels.push({ sec: 0, sub: false });

  const specs = new Map<string, CharSpec | null>();
  const specFor = (recipe: Recipe): CharSpec | null => {
    if (!charOn || !input.role || !input.character) return null;
    const photo = recipe.arch.startsWith('photo');
    const key = recipe.arch;
    if (!specs.has(key)) {
      const role = adaptRole(input.role, recipe.arch);
      const args = { source: input.character, format, H, seed, rtl, photo, step, side: input.charSide, band: input.charBand };
      specs.set(key, planCharacter({ ...args, role }) ?? (role !== 'presenter' ? planCharacter({ ...args, role: 'presenter' }) : null));
    }
    return specs.get(key) ?? null;
  };

  const ctxFor = (recipe: Recipe, relaxed: boolean): PlanCtx => ({
    format,
    W,
    H,
    cls,
    cb: CONTENT_BOX[format],
    pal: paletteFor(recipe).pal,
    th: theme,
    recipe,
    rtl,
    photo: isPhotoRecipe(recipe) && hasPhoto,
    showLogo,
    qr: tile,
    nBlocks: blocks.length,
    mascot: !!input.mascot && !charOn && !input.slide && cls !== 'wide' && cls !== 'strip',
    char: specFor(recipe),
    marker: !!input.slide,
    texture: !!input.background && !isPhotoRecipe(recipe),
    radius,
    relaxed,
  });

  const evaluate = (recipe: Recipe, plan: Plan, ctx: PlanCtx, level: Level): Attempt => {
    const sc: StyleCtx = { th: theme, pal: ctx.pal, faces, dir, radius, format };
    let items: StackItem[] = stackItems(content, sc, { secondary: level.sec, subline: level.sub });
    // What the character carries is not said twice: the sign holds the offer line (or the headline), the narrator's bubble the headline.
    const role = plan.char?.role;
    const signKey = role === 'sign_holder' ? signTextFor(content)?.key : undefined;
    if (role === 'narrator' || signKey === 'headline') items = items.filter((i) => i.key !== 'headline');
    if (signKey === 'offer') items = items.filter((i) => i.key !== 'offer');
    let fit = fitStack(items, plan.text.box, sc);
    // A long headline or primary line may take one more line before the layout is given up on.
    if (!fit.ok && fit.truncated.length) {
      const more = fitStack(items, plan.text.box, sc, 1);
      if (more.ok) fit = more;
    }
    const contacts = plan.contacts && blocks.length ? drawContacts(plan.contacts, blocks, sc) : null;
    const dropped: string[] = [];
    content.secondary.forEach((s, i) => {
      if (i >= capacity) dropped.push(`secondary line over the ${format} limit: ${s.text}`);
      else if (i >= level.sec) dropped.push(`secondary line (no room): ${s.text}`);
    });
    if (!level.sub && content.subline) dropped.push(`subline (no room): ${content.subline}`);
    for (const b of contacts?.dropped ?? []) dropped.push(`contact (no room): ${b.text}`);
    const charLay = plan.char && input.character ? layoutCharacter({ zone: plan.char, source: input.character, sc, content, seed, hint: input.poseHint, target: null }) : null;
    const charIssues: string[] = [];
    if (plan.char && charLay) {
      if (plan.char.role === 'sign_holder' && (!charLay.sign || charLay.sign.fit.truncated)) charIssues.push('sign');
      if (plan.char.role === 'narrator' && (!charLay.bubble || charLay.bubble.fit.truncated)) charIssues.push('headline');
      if (charClash(plan, tile, W, charLay.box)) charIssues.push('character');
    }
    const overflow = [...fit.truncated, ...charIssues, ...(contacts?.truncated.map((t) => `contact: ${t}`) ?? []), ...(tile?.truncated ? ['qr-label'] : [])];
    const sizeOf = (role: string) => fit.fitted.find((f) => f.item.role === role)?.fit.size ?? 0;
    const head = fit.fitted.find((f) => f.item.role === 'headline');
    // Headline-led formats (thumbnail): extra lines show only while the headline stays large; the last level has nothing left to drop.
    const headFrac = HEADLINE_LED_MIN[format];
    const lastLevel = level.sec === 0 && (!level.sub || !content.subline);
    const headOk = !headFrac || lastLevel || !head || head.fit.size >= headFrac * head.item.spec.max * theme.style.headScale;
    const complete = fit.ok && headOk && !contacts?.dropped.length && !contacts?.truncated.length && charIssues.length === 0;
    const good = !head || head.fit.size >= 0.62 * head.item.spec.max * theme.style.headScale;
    const quality = sizeOf('headline') * 1000 + sizeOf('primary') * 10 + sizeOf('subline') + sizeOf('cta');
    return { recipe, plan, ctx, sc, fit, contacts, dropped, overflow, charLay, complete, score: overflow.length * 100 + dropped.length, quality, good };
  };

  const plansFor = (recipe: Recipe, relaxed: boolean): { plan: Plan; ctx: PlanCtx }[] => {
    const ctx = ctxFor(recipe, relaxed);
    const plans = buildPlans(ctx);
    return plans.map((p) => ({ plan: rtl ? mirrorPlan(p, W, tile) : p, ctx }));
  };

  const recipes = candidateRecipes(theme, hasPhoto, input.layoutId ? (recipeForV2(input.layoutId) ?? input.layoutId) : undefined);
  const state: { chosen: Attempt | null; best: Attempt | null } = { chosen: null, best: null };
  const consider = (a: Attempt) => {
    if (!state.best || a.score < state.best.score) state.best = a;
  };
  search: for (const relaxed of [false, true]) {
    const cache = new Map<string, { plan: Plan; ctx: PlanCtx }[]>();
    for (const level of levels) {
      for (const recipe of recipes) {
        let list = cache.get(recipe.id);
        if (!list) {
          list = plansFor(recipe, relaxed);
          cache.set(recipe.id, list);
        }
        let top: Attempt | null = null;
        for (const { plan, ctx } of list) {
          const a = evaluate(recipe, plan, ctx, level);
          consider(a);
          if (!a.complete) continue;
          if (!top || (!top.good && (a.good || a.quality > top.quality))) top = a;
        }
        if (top) {
          state.chosen = top;
          break search;
        }
      }
    }
    if (state.best) break;
  }
  const pick: Attempt | null = state.chosen ?? state.best;
  if (!pick) throw new Error(`No layout of the ${theme.id} theme fits ${format}`);
  return compose(input, pick, { W, H, dir, faces, logo, photo, blocks, tile, ruleDropped });
}

// ---------------------------------------------------------------------------------------------
// Composition
// ---------------------------------------------------------------------------------------------

async function compose(
  input: DesignInput,
  a: Attempt,
  env: { W: number; H: number; dir: Dir; faces: Faces; logo: PreparedLogo | null; photo: Buffer | undefined; blocks: DesignBlock[]; tile: (QrTile & { truncated: boolean }) | null; ruleDropped: string[] },
): Promise<DesignDetail> {
  const { W, H, dir, faces } = env;
  const { plan, sc, ctx } = a;
  const { content } = input;

  const placements: Placed[] = [];
  const stack = drawStack(a.fit.fitted, plan.text, sc);

  // The character (CH-2): its action follows its role and, for a pointer, the line it points at.
  let charLay: CharLayout | null = null;
  let charSvg = '';
  if (plan.char && input.character) {
    const at = (key: string) => stack.placed.find((p) => p.name === key && p.kind === 'text')?.box ?? null;
    // A pointer points at the headline; on a carousel's closing slide at the code (the thing to do next), else at the call to action.
    const qrTarget: Box | null = input.slide?.kind === 'cta' && plan.qr && env.tile ? { x: plan.qr.x, y: plan.qr.y, w: env.tile.w, h: env.tile.h } : null;
    const target = plan.char.role === 'pointer' ? (qrTarget ?? at('headline') ?? at('primary') ?? at('cta') ?? plan.text.box) : null;
    charLay = layoutCharacter({ zone: plan.char, source: input.character, sc, content, seed: input.seed ?? 0, hint: input.poseHint, target });
    const d = drawCharLayout(charLay, sc);
    charSvg = d.svg;
    placements.push(...d.placed);
  }

  // Layers (background, photo, panels, decoration).
  let body = '';
  let charSlot = -1;
  let layerNo = 0;
  for (const layer of plan.layers) {
    if (layer.kind === 'char') charSlot = body.length;
    else if (layer.kind === 'svg') body += layer.svg;
    else if (layer.kind === 'photo') {
      if (!env.photo) continue;
      if (layer.blur) {
        const uri = await photoBlurUri(env.photo, W, H);
        if (uri) body += `<image x="0" y="0" width="${W}" height="${H}" xlink:href="${uri}" preserveAspectRatio="none"/>`;
        continue;
      }
      const uri = await photoUri(env.photo, layer.frame, layer.free);
      if (!uri) continue;
      const f = layer.frame;
      const maskId = layer.fade ? `pf${layerNo++}` : null;
      if (maskId && layer.fade) body += fadeMaskSvg(maskId, f, layer.fade);
      body += `<image x="${rr(f.x)}" y="${rr(f.y)}" width="${rr(f.w)}" height="${rr(f.h)}" xlink:href="${uri}" preserveAspectRatio="none"${maskId ? ` mask="url(#${maskId})"` : ''}/>`;
    } else {
      const uri = await textureUri(input.background, W, H);
      if (uri) body += `<image x="0" y="0" width="${W}" height="${H}" xlink:href="${uri}" preserveAspectRatio="xMidYMid slice"/><rect width="${W}" height="${H}" fill="${ctx.pal.bg}" fill-opacity="${TEXTURE_ALPHA}"/>`;
    }
  }

  placements.push(...stack.placed);
  let content_svg = stack.svg;
  if (a.contacts && a.contacts.svg) {
    content_svg += a.contacts.svg;
    placements.push(...a.contacts.placed);
  }
  let qrBox: Box | null = null;
  if (plan.qr && env.tile) {
    const q = drawQrTile(env.tile, plan.qr.x, plan.qr.y, dir, sc.radius);
    content_svg += q.svg;
    placements.push(...q.placed);
    qrBox = q.qrBox;
  }
  if (plan.logo) {
    const l = drawLogo(plan.logo, env.logo, input.brandName, sc);
    if (l) {
      content_svg += l.svg;
      placements.push(...l.placed);
    }
  }
  if (plan.marker && input.slide) {
    const m = drawMarker(plan.marker, input.slide.index, input.slide.total, sc);
    content_svg += m.svg;
    placements.push(...m.placed);
  }

  const build = (withMascot: boolean, withChar = true) => {
    let svg = (withChar && charSlot >= 0 ? body.slice(0, charSlot) + charSvg + body.slice(charSlot) : body) + content_svg;
    const extra: Placed[] = [];
    if (withMascot && plan.mascot && input.mascot) {
      const m = drawMascot(plan.mascot, input.mascot, W, content.bubble, sc);
      svg += m.svg;
      extra.push(...m.placed);
    }
    return { svg: `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${svg}</svg>`, extra };
  };
  let mascotDropped = false;
  let drawn = build(true);
  let png: Buffer;
  const raster = (svg: string) => Buffer.from(new Resvg(svg, { font: { loadSystemFonts: false }, fitTo: { mode: 'original' } }).render().asPng());
  try {
    png = raster(drawn.svg);
  } catch (err) {
    if (!(plan.mascot && input.mascot) && !charSvg) throw err;
    mascotDropped = true;
    charLay = null;
    drawn = build(false, false);
    png = raster(drawn.svg);
  }
  placements.push(...drawn.extra);

  // Reports.
  const overflow = [...new Set(a.overflow)];
  const dropped = [...env.ruleDropped, ...a.dropped];
  const contrastIssues: DesignReport['contrast'] = [];
  for (const p of placements) {
    if (!p.ink || !p.bgs?.length) continue;
    const ratio = minContrast(p.ink, p.bgs);
    const large = p.size >= LARGE_TEXT_PX && (p.weight ?? 400) >= 700;
    if (ratio < (large ? MIN_CONTRAST_LARGE : MIN_CONTRAST)) contrastIssues.push({ element: p.name, ratio: Math.round(ratio * 100) / 100 });
  }
  const safeZone = safeZoneIssues(input.format, placements);

  let qr: DesignReport['qr'] = null;
  if (content.qr && qrBox && env.tile) {
    const region = { left: Math.max(0, Math.floor(qrBox.x - 8)), top: Math.max(0, Math.floor(qrBox.y - 8)), width: Math.min(W, Math.ceil(qrBox.w + 16)), height: Math.min(H, Math.ceil(qrBox.h + 16)) };
    region.width = Math.min(region.width, W - region.left);
    region.height = Math.min(region.height, H - region.top);
    qr = await verifyRendered(png, content.qr.text, region);
  }
  return {
    png,
    svg: drawn.svg,
    width: W,
    height: H,
    themeId: input.themeId,
    layoutId: a.recipe.id,
    report: { overflow, dropped, contrast: contrastIssues, safeZone, qr },
    scheme: ctx.pal.scheme,
    placements,
    qrBox,
    dir,
    faces,
    mascotDropped,
    freeSpace: freeSpaceShare(placements, W, H),
    character: charLay
      ? {
          role: charLay.zone.role,
          action: charLay.action,
          box: charLay.box,
          sign: charLay.sign ? { text: charLay.sign.text, box: charLay.sign.box } : null,
          bubble: charLay.bubble ? { text: charLay.bubble.text, box: charLay.bubble.box } : null,
          pointAt: charLay.pointAt,
          side: charLay.zone.side,
          svg: charSvg,
        }
      : null,
    engine: 'engine',
  };
}

const inside = (b: Box, z: Box) => b.x >= z.x - 0.5 && b.y >= z.y - 0.5 && b.x + b.w <= z.x + z.w + 0.5 && b.y + b.h <= z.y + z.h + 0.5;
const intersects = (a: Box, b: Box) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

/** Important elements (text, QR, logo, mascot, icons, marker) that sit outside the format's safe area or on its unsafe corner. */
export function safeZoneIssues(format: DesignInput['format'], placements: Placed[]): string[] {
  const zone = SAFE_ZONES[format];
  const out: string[] = [];
  for (const p of placements) {
    const boxes = p.lines.length ? [p.box, ...p.lines] : [p.box];
    const bad = boxes.some((b) => b.w > 0 && b.h > 0 && (!inside(b, zone.inside) || zone.avoid.some((z) => intersects(b, z))));
    if (bad) out.push(p.name);
  }
  return out;
}
