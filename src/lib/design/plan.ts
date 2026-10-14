// Layout planning: turns a recipe (layout family) into concrete regions for one format. A recipe
// gives several plans in order of preference ("roomier" variants: QR in a side column instead of a
// footer, contacts moved, ...); the renderer takes the first one the content fits. Plans are built
// left-to-right and mirrored for right-to-left posts.

import type { Box } from '@/lib/render';
import { decorate, decoSurfaces, toneTints, type DecoGeom } from './deco';
import { chooseInk, contrast, mix } from './colors';
import {
  CLS,
  HEADER_H,
  THUMB_TEXT_SHARE,
  LOGO_W,
  MASCOT_PX,
  TYPE_SCALE,
  boxBottom,
  boxRight,
  inset,
  rr,
  type Cls,
  type ContactZone,
  type Layer,
  type LogoZone,
  type MascotZone,
  type Plan,
  type PlanCtx,
  type QrZone,
  type TextZone,
} from './core';
import { bottomPanel, circle, edgeRise, roundRect, sidePanel } from './shapes';

const GAP: Record<Cls, number> = { tall: 36, boxy: 30, wide: 26, strip: 28 };
const MIN_TEXT: Record<Cls, { w: number; h: number }> = {
  tall: { w: 520, h: 520 },
  boxy: { w: 420, h: 320 },
  wide: { w: 330, h: 210 },
  strip: { w: 420, h: 250 },
};
/** Black scrim over a photo: the lightest it can look is the photo's white seen through (1 - alpha). */
export const SCRIM_ALPHA = 0.76;
export const SCRIM_BG = mix('#000000', '#ffffff', 1 - SCRIM_ALPHA);
export const TEXTURE_ALPHA = 0.82;

const rowH = (ctx: PlanCtx) => Math.round(TYPE_SCALE[ctx.format].contact.max * 1.5);

/** Colours the page may show behind text: the background, a texture over it, motifs painted under it. */
export function pageBgs(ctx: PlanCtx): string[] {
  const bg = ctx.pal.bg;
  const out = [bg];
  if (ctx.texture) out.push(mix(bg, '#000000', 1 - TEXTURE_ALPHA), mix(bg, '#ffffff', 1 - TEXTURE_ALPHA));
  out.push(...decoSurfaces(ctx.pal, ctx.recipe.deco, toneFor(ctx).tints));
  return out;
}

/** Tone-on-tone decoration colours for this palette, chosen so the page inks stay readable behind them. */
function toneFor(ctx: PlanCtx) {
  const bg = ctx.pal.bg;
  const inks = [chooseInk([bg], ctx.pal.head).ink, chooseInk([bg], ctx.pal.body).ink];
  return toneTints(ctx.pal, inks);
}

export function panelFill(ctx: PlanCtx, fallback: 'solid' | 'surface' | 'bg'): string {
  const role = ctx.recipe.panel ?? fallback;
  return role === 'solid' ? ctx.pal.solid : role === 'surface' ? ctx.pal.surface : ctx.pal.bg;
}

const validText = (cls: Cls, b: Box, relaxed?: boolean) => (relaxed ? b.w >= 120 && b.h >= 70 : b.w >= MIN_TEXT[cls].w && b.h >= MIN_TEXT[cls].h);

// ---------------------------------------------------------------------------------------------
// Header: logo, mascot with its bubble, carousel marker
// ---------------------------------------------------------------------------------------------

interface Header {
  h: number;
  logo: LogoZone | null;
  mascot: MascotZone | null;
  marker: { box: Box; bgs: string[] } | null;
}

function header(ctx: PlanCtx, box: Box, bgs: string[], opts: { plate: boolean; behind: string }): Header {
  const { cls } = ctx;
  const mPx = ctx.mascot ? MASCOT_PX[ctx.format] : 0;
  const markerW = ctx.marker ? 118 : 0;
  const hh = Math.max(HEADER_H[cls], mPx);
  if (!ctx.showLogo && !mPx && !ctx.marker) return { h: 0, logo: null, mascot: null, marker: null };
  const logoW = Math.max(160, Math.min(LOGO_W[cls], box.w - mPx - markerW - (mPx ? 340 : 24)));
  const logo: LogoZone | null = ctx.showLogo ? { box: { x: box.x, y: box.y, w: logoW, h: HEADER_H[cls] }, bgs, plate: opts.plate } : null;
  let mascot: MascotZone | null = null;
  if (mPx) {
    const m: Box = { x: boxRight(box) - mPx, y: box.y, w: mPx, h: mPx };
    const bx = box.x + logoW + 24;
    const bw = m.x - 30 - bx;
    mascot = {
      box: m,
      behind: opts.behind,
      bubble: bw >= 240 ? { box: { x: bx, y: box.y + 8, w: bw, h: Math.min(mPx - 20, 170) }, tail: { x: m.x + 14, y: m.y + mPx * 0.5 } } : null,
    };
  }
  const marker = ctx.marker ? { box: { x: boxRight(box) - markerW, y: box.y + 4, w: markerW, h: 46 }, bgs } : null;
  return { h: hh, logo, mascot, marker };
}

// ---------------------------------------------------------------------------------------------
// Flow: text, contacts and the QR tile inside a zone
// ---------------------------------------------------------------------------------------------

interface FlowOut {
  text: TextZone;
  contacts: ContactZone | null;
  qr: QrZone | null;
}

function flows(ctx: PlanCtx, zone: Box, bgs: string[], align: 'left' | 'center'): FlowOut[] {
  const { cls, qr } = ctx;
  const n = ctx.nBlocks;
  const g = GAP[cls];
  const rh = rowH(ctx);
  const maxRows = cls === 'tall' ? 4 : 3;
  const out: FlowOut[] = [];
  const mk = (text: Box, contacts: Box | null, cols: number, qrAt: { x: number; y: number } | null): FlowOut => ({
    text: { box: text, align, valign: 'center', bgs },
    contacts: contacts && n > 0 ? { box: contacts, cols, align: cols > 1 ? 'left' : align, bgs } : null,
    qr: qrAt ? { x: qrAt.x, y: qrAt.y, bgs } : null,
  });
  const tileFits = (v: FlowOut) => !v.qr || !qr || (v.qr.y >= zone.y - 1 && v.qr.y + qr.h <= zone.y + zone.h + 1 && v.qr.x >= zone.x - 1 && v.qr.x + qr.w <= zone.x + zone.w + 1);
  const ok = (v: FlowOut) => tileFits(v) && validText(cls, v.text.box, ctx.relaxed);
  const push = (v: FlowOut) => {
    if (ok(v)) out.push(v);
  };

  if (cls === 'tall' || cls === 'boxy') {
    if (qr) {
      const fh = qr.h;
      const cw = zone.w - qr.w - g;
      const tileX = n > 0 || align === 'left' ? zone.x + zone.w - qr.w : zone.x + (zone.w - qr.w) / 2;
      if (n === 0 || cw >= 300) {
        push(mk({ x: zone.x, y: zone.y, w: zone.w, h: zone.h - fh - g }, n > 0 ? { x: zone.x, y: zone.y + zone.h - fh, w: cw, h: fh } : null, 1, { x: tileX, y: zone.y + zone.h - fh }));
      }
      const tw = zone.w - qr.w - g;
      const ch = zone.h - qr.h - g;
      if (n === 0 || ch >= rh) {
        push(mk({ x: zone.x, y: zone.y, w: tw, h: zone.h }, n > 0 ? { x: zone.x + zone.w - qr.w, y: zone.y, w: qr.w, h: ch } : null, 1, { x: zone.x + zone.w - qr.w, y: zone.y + zone.h - qr.h }));
      }
    } else if (n > 0) {
      const cols = zone.w >= 760 ? 2 : 1;
      const rows = Math.min(maxRows, Math.ceil(n / cols));
      const fh = rows * rh;
      push(mk({ x: zone.x, y: zone.y, w: zone.w, h: zone.h - fh - g }, { x: zone.x, y: zone.y + zone.h - fh, w: zone.w, h: fh }, cols, null));
    } else {
      push(mk(zone, null, 1, null));
    }
    return out;
  }

  // wide and strip: columns
  const colGap = 36;
  if (qr) {
    const tx = zone.x + zone.w - qr.w;
    const leftW = zone.w - qr.w - colGap;
    const tileBottom = zone.y + zone.h - qr.h;
    const tileMid = zone.y + (zone.h - qr.h) / 2;
    const ch = zone.h - qr.h - 14;
    if (cls === 'strip' && n > 0) {
      const mw = 360;
      push(mk({ x: zone.x, y: zone.y, w: zone.w - qr.w - mw - 2 * colGap, h: zone.h }, { x: zone.x + zone.w - qr.w - mw - colGap, y: zone.y, w: mw, h: zone.h }, 1, { x: tx, y: tileMid }));
    }
    if (n === 0 || ch >= rh) {
      push(mk({ x: zone.x, y: zone.y, w: leftW, h: zone.h }, n > 0 ? { x: tx, y: zone.y, w: qr.w, h: ch } : null, 1, { x: tx, y: n > 0 ? tileBottom : tileMid }));
    }
    if (n > 0) {
      const cols = leftW >= 700 ? 2 : 1;
      const rows = Math.min(maxRows, Math.ceil(n / cols));
      const fh = rows * rh;
      push(mk({ x: zone.x, y: zone.y, w: leftW, h: zone.h - fh - g }, { x: zone.x, y: zone.y + zone.h - fh, w: leftW, h: fh }, cols, { x: tx, y: tileMid }));
    }
    return out;
  }
  if (n > 0) {
    const cols = Math.max(1, Math.min(3, Math.floor(zone.w / 400)));
    const rows = Math.min(maxRows, Math.ceil(n / cols));
    const fh = rows * rh;
    push(mk({ x: zone.x, y: zone.y, w: zone.w, h: zone.h - fh - g }, { x: zone.x, y: zone.y + zone.h - fh, w: zone.w, h: fh }, cols, null));
    const cw = Math.round(zone.w * 0.34);
    push(mk({ x: zone.x, y: zone.y, w: zone.w - cw - colGap, h: zone.h }, { x: zone.x + zone.w - cw, y: zone.y, w: cw, h: zone.h }, 1, null));
  } else {
    push(mk(zone, null, 1, null));
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Assembling plans
// ---------------------------------------------------------------------------------------------

function baseLayers(ctx: PlanCtx): { first: Layer[]; under: string; over: string } {
  const { W, H } = ctx;
  const tone = toneFor(ctx);
  const geom: DecoGeom = { W, H, cls: ctx.cls, cb: ctx.cb, pal: ctx.pal, seed: ctx.recipe.id.length * 131 + ctx.W, radius: ctx.radius, tints: tone.tints, raw: tone.raw };
  const d = decorate(ctx.recipe.deco, geom);
  const first: Layer[] = [{ kind: 'svg', svg: `<rect width="${W}" height="${H}" fill="${ctx.pal.bg}"/>` }];
  if (ctx.texture) first.push({ kind: 'texture' });
  return { first, under: d.under, over: d.over };
}

function borderSvg(ctx: PlanCtx, box: Box, r: number): string {
  const b = ctx.recipe.border;
  if (!b) return '';
  const c = ctx.pal.accents.find((a) => a !== ctx.pal.surface) ?? ctx.pal.dark;
  const w = b === 'thick' ? 8 : 3;
  let s = `<rect x="${rr(box.x)}" y="${rr(box.y)}" width="${rr(box.w)}" height="${rr(box.h)}" rx="${rr(r)}" fill="none" stroke="${c}" stroke-width="${w}"/>`;
  if (b === 'double') s += `<rect x="${rr(box.x + 12)}" y="${rr(box.y + 12)}" width="${rr(box.w - 24)}" height="${rr(box.h - 24)}" rx="${rr(Math.max(0, r - 8))}" fill="none" stroke="${c}" stroke-width="1.5"/>`;
  return s;
}

function assemble(ctx: PlanCtx, layers: Layer[], f: FlowOut, hd: Header, photoFrame: Box | null, textTop: number | null): Plan {
  // Carve the header out of the text zone's top when it is not already above the zone (wide/strip).
  let text = f.text;
  if (textTop !== null) {
    text = { ...text, box: { ...text.box, y: textTop, h: text.box.y + text.box.h - textTop } };
  }
  return { layers, text, contacts: f.contacts, qr: f.qr, logo: hd.logo, mascot: hd.mascot, marker: hd.marker, photoFrame };
}

/** Big concentric circles and a small accent dot: the "art" side of a thumbnail (no text goes here). `under` is the surface they sit on. */
function thumbArt(ctx: PlanCtx, cx: number, cy: number, under: string): string {
  const cols = ctx.pal.accents.filter((c) => contrast(c, under) >= 1.25);
  const c0 = cols[0] ?? mix(under, ctx.pal.light, 0.35);
  const c1 = cols[1] ?? mix(under, ctx.pal.dark, 0.3);
  const r = ctx.H * 0.36;
  return circle(cx, cy, r, c0, 0.55) + circle(cx, cy, r * 0.64, c1, 0.6) + circle(cx, cy, r * 0.3, c0, 0.9) + circle(cx + r * 0.9, cy - r * 0.95, r * 0.14, c1, 0.9);
}

/** Variants for one recipe and format, best first. May be empty if nothing fits (the renderer then tries other recipes). */
export function buildPlans(ctx: PlanCtx): Plan[] {
  const { cls, W, H, cb, recipe, pal } = ctx;
  const g = GAP[cls];
  const rad = ctx.radius;
  const base = baseLayers(ctx);
  const plans: Plan[] = [];
  const edge = recipe.edge ?? 'straight';
  const rise = edgeRise(edge);
  const wideLike = cls === 'wide' || cls === 'strip';
  const align = recipe.align;

  const finish = (layers: Layer[], zone: Box, bgs: string[], hdr: (zoneBox: Box) => Header, photoFrame: Box | null, headerInZone: boolean, over?: { qrAt: QrZone }) => {
    const fctx: PlanCtx = over ? { ...ctx, qr: null } : ctx;
    const add = (p: Plan) => plans.push(over ? { ...p, qr: over.qrAt } : p);
    if (!headerInZone || !wideLike) {
      // Header is a row across the top of the zone (boxy/tall) or lives outside it.
      if (headerInZone) {
        const hd = hdr(zone);
        const below: Box = { x: zone.x, y: zone.y + hd.h + (hd.h ? g * 0.6 : 0), w: zone.w, h: zone.h - hd.h - (hd.h ? g * 0.6 : 0) };
        for (const f of flows(fctx, below, bgs, align)) add(assemble(ctx, layers, f, hd, photoFrame, null));
      } else {
        const hd = hdr(zone);
        for (const f of flows(fctx, zone, bgs, align)) add(assemble(ctx, layers, f, hd, photoFrame, null));
      }
      return;
    }
    // wide/strip: header over the text column only
    for (const f of flows(fctx, zone, bgs, align)) {
      const hd = hdr(f.text.box);
      const top = hd.h ? f.text.box.y + hd.h + g * 0.6 : f.text.box.y;
      const trimmed = { ...f, text: { ...f.text, box: { ...f.text.box, y: top, h: f.text.box.y + f.text.box.h - top } } };
      if (validText(cls, trimmed.text.box, ctx.relaxed)) add(assemble(ctx, layers, trimmed, hd, photoFrame, null));
    }
  };

  const pg = pageBgs(ctx);

  // Thumbnails are headline-led: text on about 60% of the frame (left, mirrored for rtl), art or photo on the rest.
  // The bottom-right timestamp corner stays clear because nothing important is drawn there.
  if (ctx.format === 'thumbnail' && (recipe.arch === 'plain' || recipe.arch === 'card' || recipe.arch === 'band')) {
    const textRight = Math.round(W * THUMB_TEXT_SHARE);
    const solid = pal.solid;
    if (recipe.arch === 'plain') {
      const wp = Math.round(W * 0.34);
      const art = `<g transform="translate(${W} 0) scale(-1 1)">${sidePanel(wp, H, edge === 'straight' ? 'diag' : edge, solid)}</g>` + thumbArt(ctx, W - wp * 0.5, H / 2, solid);
      const layers: Layer[] = [...base.first, { kind: 'svg', svg: base.under }, { kind: 'svg', svg: art }, { kind: 'svg', svg: base.over }];
      finish(layers, { x: cb.x, y: cb.y, w: textRight - cb.x, h: cb.h }, pg, (z) => header(ctx, z, pg, { plate: false, behind: pal.bg }), null, true);
    } else if (recipe.arch === 'card') {
      const fill = panelFill(ctx, 'surface');
      const card: Box = { x: cb.x - 14, y: cb.y - 14, w: textRight - cb.x + 14 + 36, h: cb.h + 28 };
      const art = thumbArt(ctx, W - W * 0.17, H / 2, pal.bg);
      const layers: Layer[] = [
        ...base.first,
        { kind: 'svg', svg: base.under },
        { kind: 'svg', svg: art },
        { kind: 'svg', svg: roundRect(card, rad * 1.3, fill) + borderSvg(ctx, card, rad * 1.3) },
        { kind: 'svg', svg: base.over },
      ];
      const bgs = [fill];
      finish(layers, inset(card, 34, 26), bgs, (z) => header(ctx, z, bgs, { plate: false, behind: fill }), null, true);
    } else {
      const wp = Math.round(W * 0.66);
      const bgs = [panelFill(ctx, 'solid')];
      const art = sidePanel(wp, H, edge, bgs[0], rad > 0 ? rad * 1.6 : 0) + thumbArt(ctx, W - W * 0.15, H / 2, pal.bg);
      const layers: Layer[] = [...base.first, { kind: 'svg', svg: base.under }, { kind: 'svg', svg: art }, { kind: 'svg', svg: base.over }];
      finish(layers, { x: cb.x, y: cb.y, w: textRight - cb.x - 20, h: cb.h }, bgs, (z) => header(ctx, z, bgs, { plate: false, behind: bgs[0] }), null, true);
    }
    return plans;
  }

  switch (recipe.arch) {
    case 'plain': {
      const layers: Layer[] = [...base.first, { kind: 'svg', svg: base.under }, { kind: 'svg', svg: base.over }];
      finish(layers, cb, pg, (z) => header(ctx, z, pg, { plate: false, behind: pal.bg }), null, true);
      break;
    }
    case 'card': {
      const panel = inset(cb, -14);
      const fill = panelFill(ctx, 'surface');
      const r = rad * 1.3;
      const layers: Layer[] = [
        ...base.first,
        { kind: 'svg', svg: base.under },
        { kind: 'svg', svg: roundRect(panel, r, fill) + borderSvg(ctx, inset(panel, 0), r) },
        { kind: 'svg', svg: base.over },
      ];
      const padX = cls === 'tall' ? 40 : 32;
      const zone = inset(panel, padX, cls === 'wide' || cls === 'strip' ? 26 : padX);
      const bgs = [fill];
      finish(layers, zone, bgs, (z) => header(ctx, z, bgs, { plate: false, behind: fill }), null, true);
      break;
    }
    case 'band': {
      const hdrBox: Box = { x: cb.x, y: cb.y, w: cb.w, h: HEADER_H[cls] };
      const hdrH = ctx.mascot ? Math.max(HEADER_H[cls], MASCOT_PX[ctx.format]) : ctx.showLogo || ctx.marker ? HEADER_H[cls] : 0;
      const top = cb.y + hdrH + (hdrH ? 16 : 0);
      const fill = panelFill(ctx, 'solid');
      const layers: Layer[] = [
        ...base.first,
        { kind: 'svg', svg: base.under },
        { kind: 'svg', svg: bottomPanel(W, H, top, edge, fill, rad > 0 ? rad * 1.6 : 0) },
        { kind: 'svg', svg: base.over },
      ];
      const zoneTop = top + rise + (rise ? 24 : 34);
      const zone: Box = { x: cb.x, y: zoneTop, w: cb.w, h: boxBottom(cb) - zoneTop };
      const hd = header(ctx, hdrBox, pg, { plate: false, behind: pal.bg });
      // Wide/strip: the band hugs the content, so the logo sits in the strip above it.
      for (const f of flows(ctx, zone, [fill], align)) plans.push(assemble(ctx, layers, f, hd, null, null));
      break;
    }
    case 'photoSplit': {
      if (!ctx.photo) break;
      const fill = panelFill(ctx, 'solid');
      let frame: Box;
      let layers: Layer[];
      let zone: Box;
      if (!wideLike) {
        const ph = Math.round(H * (cls === 'tall' ? 0.4 : ctx.format === 'square' ? 0.42 : 0.4));
        frame = { x: 0, y: 0, w: W, h: ph + rise };
        layers = [...base.first, { kind: 'photo', frame }, { kind: 'svg', svg: bottomPanel(W, H, ph, edge, fill, rad > 0 ? rad * 1.6 : 0) }, { kind: 'svg', svg: base.over }];
        const zt = ph + rise + 34;
        zone = { x: cb.x, y: zt, w: cb.w, h: boxBottom(cb) - zt };
        const hd = header(ctx, { x: cb.x, y: cb.y, w: cb.w, h: HEADER_H[cls] }, [pal.light], { plate: true, behind: 'photo' });
        for (const f of flows(ctx, zone, [fill], align)) plans.push(assemble(ctx, layers, f, hd, frame, null));
      } else {
        // With a QR the code sits on the photo, on its own light plate, so the text panel keeps its width.
        const qrOver = !!ctx.qr && cls === 'wide';
        const pw = Math.round(W * (ctx.qr && !qrOver ? 0.24 : 0.4));
        frame = { x: 0, y: 0, w: pw + rise, h: H };
        // Panel drawn as a rectangle from the photo's right edge; diagonal/arch edges become straight on the side.
        layers = [...base.first, { kind: 'photo', frame }, { kind: 'svg', svg: `<rect x="${pw}" y="0" width="${W - pw}" height="${H}" fill="${fill}"/>` }, { kind: 'svg', svg: base.over }];
        const zx = pw + 40;
        zone = { x: Math.max(zx, cb.x), y: cb.y, w: boxRight(cb) - Math.max(zx, cb.x), h: cb.h };
        const bgs = [fill];
        finish(layers, zone, bgs, (z) => header(ctx, z, bgs, { plate: false, behind: fill }), frame, true, qrOver && ctx.qr ? { qrAt: { x: cb.x, y: boxBottom(cb) - ctx.qr.h, bgs: ['#ffffff'] } } : undefined);
      }
      break;
    }
    case 'photoFull': {
      if (!ctx.photo) break;
      const frame: Box = { x: 0, y: 0, w: W, h: H };
      const scrim = (b: Box, r: number) => roundRect(b, r, '#000000', `fill-opacity="${SCRIM_ALPHA}"`);
      const bgs = [SCRIM_BG];
      if (!wideLike) {
        for (const frac of cls === 'tall' ? [0.38, 0.27] : [0.4, 0.24]) {
          const top = Math.round(H * frac);
          const panel: Box = { x: 0, y: top, w: W, h: H - top };
          const layers: Layer[] = [...base.first, { kind: 'photo', frame }, { kind: 'svg', svg: scrim({ ...panel, h: panel.h + 80 }, rad * 2) }, { kind: 'svg', svg: base.over }];
          const zone: Box = { x: cb.x, y: top + 40, w: cb.w, h: boxBottom(cb) - top - 40 };
          const hd = header(ctx, { x: cb.x, y: cb.y, w: cb.w, h: HEADER_H[cls] }, [pal.light], { plate: true, behind: 'photo' });
          for (const f of flows(ctx, zone, bgs, align)) plans.push(assemble(ctx, layers, f, hd, frame, null));
        }
      } else {
        const panel = cls === 'strip' ? { x: cb.x - 30, y: -20, w: cb.w + 60, h: H + 40 } : ctx.format === 'thumbnail' ? { x: cb.x - 14, y: cb.y - 14, w: Math.round(W * THUMB_TEXT_SHARE) - cb.x + 14 + 36, h: cb.h + 28 } : inset(cb, -14);
        const layers: Layer[] = [...base.first, { kind: 'photo', frame }, { kind: 'svg', svg: scrim(panel, rad * 1.3) }, { kind: 'svg', svg: base.over }];
        const zone = inset(panel, cls === 'strip' ? 30 : 28, cls === 'strip' ? 56 : 26);
        finish(layers, zone, bgs, (z) => header(ctx, z, bgs, { plate: false, behind: SCRIM_BG }), frame, true);
      }
      break;
    }
    case 'photoCard': {
      if (!ctx.photo) break;
      const frame: Box = { x: 0, y: 0, w: W, h: H };
      const fill = panelFill(ctx, 'surface');
      const bgs = [fill];
      const r = rad * 1.5;
      if (!wideLike) {
        const top = Math.round(H * (cls === 'tall' ? 0.36 : 0.34));
        const panel: Box = { x: cb.x - 14, y: top, w: cb.w + 28, h: boxBottom(cb) + 14 - top };
        const layers: Layer[] = [...base.first, { kind: 'photo', frame }, { kind: 'svg', svg: roundRect(panel, r, fill) + borderSvg(ctx, panel, r) }, { kind: 'svg', svg: base.over }];
        const zone = inset(panel, cls === 'tall' ? 40 : 32);
        const hd = header(ctx, { x: cb.x, y: cb.y, w: cb.w, h: HEADER_H[cls] }, [pal.light], { plate: true, behind: 'photo' });
        for (const f of flows(ctx, zone, bgs, align)) plans.push(assemble(ctx, layers, f, hd, frame, null));
      } else {
        const qrOver = !!ctx.qr && cls === 'wide';
        const pw = ctx.format === 'thumbnail' ? Math.round(W * THUMB_TEXT_SHARE) : Math.round(cb.w * (ctx.qr && !qrOver ? 0.8 : 0.62));
        const panel: Box = { x: boxRight(cb) - pw + 14, y: cb.y - 14, w: pw, h: cb.h + 28 };
        const layers: Layer[] = [...base.first, { kind: 'photo', frame }, { kind: 'svg', svg: roundRect(panel, r, fill) + borderSvg(ctx, panel, r) }, { kind: 'svg', svg: base.over }];
        const zone = inset(panel, 28, 26);
        finish(layers, zone, bgs, (z) => header(ctx, z, bgs, { plate: false, behind: fill }), frame, true, qrOver && ctx.qr ? { qrAt: { x: cb.x, y: boxBottom(cb) - ctx.qr.h, bgs: ['#ffffff'] } } : undefined);
      }
      break;
    }
  }
  return plans;
}

// ---------------------------------------------------------------------------------------------
// Mirroring for right-to-left posts
// ---------------------------------------------------------------------------------------------

const mbox = (b: Box, W: number): Box => ({ ...b, x: W - b.x - b.w });

export function mirrorPlan(p: Plan, W: number, tile: { w: number } | null): Plan {
  return {
    layers: p.layers.map((l) => {
      if (l.kind === 'svg') return { kind: 'svg', svg: `<g transform="translate(${W} 0) scale(-1 1)">${l.svg}</g>` } as Layer;
      if (l.kind === 'photo') return { kind: 'photo', frame: mbox(l.frame, W) } as Layer;
      return l;
    }),
    text: { ...p.text, box: mbox(p.text.box, W) },
    contacts: p.contacts && { ...p.contacts, box: mbox(p.contacts.box, W) },
    qr: p.qr && tile ? { ...p.qr, x: W - p.qr.x - tile.w } : p.qr,
    logo: p.logo && { ...p.logo, box: mbox(p.logo.box, W) },
    mascot:
      p.mascot && {
        ...p.mascot,
        box: mbox(p.mascot.box, W),
        bubble: p.mascot.bubble && { box: mbox(p.mascot.bubble.box, W), tail: { x: W - p.mascot.bubble.tail.x, y: p.mascot.bubble.tail.y } },
      },
    marker: p.marker && { ...p.marker, box: mbox(p.marker.box, W) },
    photoFrame: p.photoFrame && mbox(p.photoFrame, W),
  };
}

export { CLS };
