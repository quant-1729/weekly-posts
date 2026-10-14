// The design renderer (G-4): content + brand kit + theme -> SVG -> PNG, with the hierarchy, auto-fit,
// contrast, safe-zone and QR rules applied and reported. Pure code: no AI call, no network.
//
// Fit order for one design: text shrinks towards each role's minimum and wraps; if that is not
// enough the next layout variant (more room) is tried, then the next layout family; only then is
// lower-priority content dropped (secondary lines first, then the subline) and reported in
// `report.dropped`. What still does not fit is reported in `report.overflow` (text is never cut silently).

import { Resvg } from '@resvg/resvg-js';
import { detectDirection, initShaping, type Box } from '@/lib/render';
import type { Dir } from '@/lib/render/shape';
import { verifyRendered } from '@/lib/qr/decode';
import { fitsSlot } from '@/lib/qr/size';
import { recipeForV2, renderClassicV2 } from './classic';
import { photoUri, prepareLogo, textureUri, usablePhoto } from './assets';
import { MIN_CONTRAST, MIN_CONTRAST_LARGE, LARGE_TEXT_PX, minContrast } from './colors';
import {
  CLS,
  HEADLINE_LED_MIN,
  QR_RULE_WIDTH,
  SAFE_ZONES,
  CONTENT_BOX,
  rr,
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
  /** 'engine' for the new renderer, 'v2' when the classic v2 templates drew it. */
  engine: 'engine' | 'v2';
}

const isPhotoRecipe = (r: Recipe) => r.arch.startsWith('photo');

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

export async function renderDesignDetailed(rawInput: DesignInput): Promise<DesignDetail> {
  await initShaping();
  const { input, ruleDropped } = applyFormatRules(rawInput);
  const { format, content, kit } = input;
  const size = FORMAT_SIZE[format];
  const W = size.width;
  const H = size.height;
  const cls = CLS[format];
  const theme = getTheme(input.themeId);

  // v2 delegation for the classic theme (kept byte-for-byte for plain content).
  if (input.themeId === 'classic') {
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
    mascot: !!input.mascot && !input.slide && cls !== 'wide' && cls !== 'strip',
    marker: !!input.slide,
    texture: !!input.background && !isPhotoRecipe(recipe),
    radius,
    relaxed,
  });

  const evaluate = (recipe: Recipe, plan: Plan, ctx: PlanCtx, level: Level): Attempt => {
    const sc: StyleCtx = { th: theme, pal: ctx.pal, faces, dir, radius, format };
    const items: StackItem[] = stackItems(content, sc, { secondary: level.sec, subline: level.sub });
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
    const overflow = [...fit.truncated, ...(contacts?.truncated.map((t) => `contact: ${t}`) ?? []), ...(tile?.truncated ? ['qr-label'] : [])];
    const sizeOf = (role: string) => fit.fitted.find((f) => f.item.role === role)?.fit.size ?? 0;
    const head = fit.fitted.find((f) => f.item.role === 'headline');
    // Headline-led formats (thumbnail): extra lines show only while the headline stays large; the last level has nothing left to drop.
    const headFrac = HEADLINE_LED_MIN[format];
    const lastLevel = level.sec === 0 && (!level.sub || !content.subline);
    const headOk = !headFrac || lastLevel || !head || head.fit.size >= headFrac * head.item.spec.max * theme.style.headScale;
    const complete = fit.ok && headOk && !contacts?.dropped.length && !contacts?.truncated.length;
    const good = !head || head.fit.size >= 0.62 * head.item.spec.max * theme.style.headScale;
    const quality = sizeOf('headline') * 1000 + sizeOf('primary') * 10 + sizeOf('subline') + sizeOf('cta');
    return { recipe, plan, ctx, sc, fit, contacts, dropped, overflow, complete, score: overflow.length * 100 + dropped.length, quality, good };
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

  // Layers (background, photo, panels, decoration).
  let body = '';
  for (const layer of plan.layers) {
    if (layer.kind === 'svg') body += layer.svg;
    else if (layer.kind === 'photo') {
      const uri = env.photo ? await photoUri(env.photo, layer.frame) : null;
      if (uri) body += `<image x="${rr(layer.frame.x)}" y="${rr(layer.frame.y)}" width="${rr(layer.frame.w)}" height="${rr(layer.frame.h)}" xlink:href="${uri}" preserveAspectRatio="none"/>`;
    } else {
      const uri = await textureUri(input.background, W, H);
      if (uri) body += `<image x="0" y="0" width="${W}" height="${H}" xlink:href="${uri}" preserveAspectRatio="xMidYMid slice"/><rect width="${W}" height="${H}" fill="${ctx.pal.bg}" fill-opacity="${TEXTURE_ALPHA}"/>`;
    }
  }

  const placements: Placed[] = [];
  const stack = drawStack(a.fit.fitted, plan.text, sc);
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

  const build = (withMascot: boolean) => {
    let svg = body + content_svg;
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
    if (!(plan.mascot && input.mascot)) throw err;
    mascotDropped = true;
    drawn = build(false);
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
