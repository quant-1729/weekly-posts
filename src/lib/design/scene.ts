// Drawing the content of a design inside the zones a plan gives: the text stack (hierarchy and
// auto-fit), contact blocks, the QR tile, logo, mascot and slide marker. Every function returns SVG
// plus `Placed` records (where things ended up, in what ink, on what), which the renderer turns into
// the overflow, contrast and safe-zone reports.

import { fitText, type Box, type FitResult, type MascotInput } from '@/lib/render';
import { baselineOffset } from '@/lib/render/layout';
import { luminance, parseHex } from '@/lib/render/color';
import { shapeText, shapedToSvg, type Dir, type FaceId, type Weight } from '@/lib/render/shape';
import { Canvas, HALO_BELOW_LUMINANCE, MASCOT_BOX } from '@/lib/render/templates';
import { qrMatrix, qrSvg, totalModules } from '@/lib/qr/encode';
import { minQrPx } from '@/lib/qr/size';
import { accentFor, inkCandidates, type Palette } from './palette';
import { chooseFill, chooseInk, contrast } from './colors';
import { contactIcon } from './icons';
import { drawTextLogo } from './text-logo';
import {
  QR_RULE_WIDTH,
  TYPE_SCALE,
  rr,
  type ContactZone,
  type Faces,
  type LogoZone,
  type MascotZone,
  type QrTile,
  type Role,
  type RoleSize,
  type TextZone,
  type ThemeDef,
} from './core';
import type { DesignBlock, DesignContent, DesignFormat } from './types';

export interface Placed {
  name: string;
  kind: 'text' | 'qr' | 'logo' | 'mascot' | 'bubble' | 'marker' | 'icon';
  box: Box;
  lines: Box[];
  size: number;
  weight?: Weight;
  ink?: string;
  bgs?: string[];
  text?: string;
  truncated: boolean;
}

export interface StyleCtx {
  th: ThemeDef;
  pal: Palette;
  faces: Faces;
  dir: Dir;
  radius: number;
  format: DesignFormat;
}

const NONLATIN_RE = /[؀-ۿݐ-ݿऀ-ॿﭐ-﷿ﹰ-﻿]/;
const union = (boxes: Box[]): Box => {
  const x0 = Math.min(...boxes.map((b) => b.x));
  const y0 = Math.min(...boxes.map((b) => b.y));
  const x1 = Math.max(...boxes.map((b) => b.x + b.w));
  const y1 = Math.max(...boxes.map((b) => b.y + b.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
};

// ---------------------------------------------------------------------------------------------
// The text stack
// ---------------------------------------------------------------------------------------------

export interface StackItem {
  key: string;
  role: Role;
  text: string;
  weight: Weight;
  face: FaceId;
  spec: RoleSize;
  look: 'plain' | 'button' | 'tag' | 'bullet';
  padX: number;
  padY: number;
  indent: number;
  gapEm: number;
}

export interface FittedItem {
  item: StackItem;
  fit: FitResult;
  h: number;
  gapBefore: number;
}

const upper = (s: string) => s.toLocaleUpperCase();

/** The items of the hierarchy in order: headline, primary, offer/date, subline, secondary lines, CTA (G-4). */
export function stackItems(content: DesignContent, sc: StyleCtx, keep: { secondary: number; subline: boolean }): StackItem[] {
  const T = TYPE_SCALE[sc.format];
  const st = sc.th.style;
  const items: StackItem[] = [];
  const add = (it: Omit<StackItem, 'padX' | 'padY' | 'indent'> & Partial<Pick<StackItem, 'padX' | 'padY' | 'indent'>>) => {
    const text = it.text.replace(/\s+/g, ' ').trim();
    if (!text) return;
    items.push({ padX: 0, padY: 0, indent: 0, ...it, text });
  };
  const headline = content.headline.trim();
  add({ key: 'headline', role: 'headline', text: st.upper ? upper(headline) : headline, weight: st.headWeight, face: sc.faces.head, spec: T.headline, look: 'plain', gapEm: 0 });
  if (content.primary && content.primary.text.trim().toLowerCase() !== headline.toLowerCase()) {
    add({ key: 'primary', role: 'primary', text: content.primary.text, weight: 700, face: sc.faces.head, spec: T.primary, look: 'plain', gapEm: 0.5 });
  }
  if (content.offerLine) {
    const tag = st.offer !== 'plain';
    add({
      key: 'offer',
      role: 'offer',
      text: st.upper ? upper(content.offerLine) : content.offerLine,
      weight: 700,
      face: sc.faces.body,
      spec: T.offer,
      look: tag ? 'tag' : 'plain',
      padX: tag ? Math.round(T.offer.max * 0.55) : 0,
      padY: tag ? Math.round(T.offer.max * 0.22) : 0,
      gapEm: 0.6,
    });
  }
  if (keep.subline && content.subline) {
    add({ key: 'subline', role: 'subline', text: content.subline, weight: st.bodyWeight, face: sc.faces.body, spec: T.subline, look: 'plain', gapEm: 0.5 });
  }
  content.secondary.slice(0, keep.secondary).forEach((s, i) =>
    add({ key: `secondary-${i + 1}`, role: 'secondary', text: s.text, weight: 500, face: sc.faces.body, spec: T.secondary, look: 'bullet', indent: Math.round(T.secondary.max * 0.85), gapEm: 0.4 }),
  );
  if (content.cta) {
    add({
      key: 'cta',
      role: 'cta',
      text: st.upper ? upper(content.cta.text) : content.cta.text,
      weight: 700,
      face: sc.faces.body,
      spec: T.cta,
      look: 'button',
      padX: Math.round(T.cta.max * 0.8),
      padY: Math.round(T.cta.max * 0.4),
      gapEm: 1,
    });
  }
  return items;
}

function lineHeightFor(item: StackItem, sc: StyleCtx): number {
  const nonLatin = NONLATIN_RE.test(item.text);
  const base = item.role === 'headline' || item.role === 'primary' ? sc.th.style.lineHeight : 1.28;
  return nonLatin ? Math.max(1.32, base) : base;
}

export interface StackFit {
  ok: boolean;
  fitted: FittedItem[];
  height: number;
  truncated: string[];
}

/**
 * Fit the items into `box`: sizes shrink together from their maximum towards each role's minimum, text
 * wraps up to the role's line limit, and the result is ok only when everything fits without being cut.
 */
export function fitStack(items: StackItem[], box: Box, sc: StyleCtx, extraLines = 0): StackFit {
  if (!items.length) return { ok: true, fitted: [], height: 0, truncated: [] };
  let last: StackFit | null = null;
  let prevKey = '';
  for (let k = 0; k <= 34; k++) {
    const s = Math.max(0.3, 1 - k * 0.03);
    const caps = items.map((it) => Math.max(it.spec.min, Math.floor(it.spec.max * (it.role === 'headline' ? sc.th.style.headScale : 1) * s)));
    const key = caps.join(',');
    if (key === prevKey) break;
    prevKey = key;
    const fitted: FittedItem[] = items.map((it, i) => {
      const fit = fitText(it.text, {
        weight: it.weight,
        boxW: box.w - 2 * it.padX - it.indent,
        boxH: 1e5,
        maxSize: caps[i],
        minSize: it.spec.min,
        maxLines: it.spec.lines + (it.role === 'headline' || it.role === 'primary' ? extraLines : 0),
        lineHeight: lineHeightFor(it, sc),
        dir: sc.dir,
        face: it.face,
        balance: it.role === 'headline' || it.role === 'primary',
      });
      return { item: it, fit, h: fit.height + 2 * it.padY, gapBefore: 0 };
    });
    fitted.forEach((f, i) => {
      f.gapBefore = i === 0 ? 0 : Math.max(12, Math.round(f.item.gapEm * f.fit.size));
    });
    const height = fitted.reduce((a, f) => a + f.h + f.gapBefore, 0);
    const truncated = fitted.filter((f) => f.fit.truncated).map((f) => f.item.key);
    last = { ok: height <= box.h && !truncated.length, fitted, height, truncated };
    if (last.ok) return last;
  }
  return last!;
}

function bulletSvg(style: ThemeDef['style']['bullet'], x: number, cy: number, r: number, fill: string, ink: string): string {
  switch (style) {
    case 'check':
      return `<circle cx="${rr(x + r)}" cy="${rr(cy)}" r="${rr(r)}" fill="${fill}"/><path d="M${rr(x + r * 0.5)} ${rr(cy)} L${rr(x + r * 0.9)} ${rr(cy + r * 0.4)} L${rr(x + r * 1.5)} ${rr(cy - r * 0.45)}" fill="none" stroke="${ink}" stroke-width="${rr(Math.max(2, r * 0.26))}" stroke-linecap="round" stroke-linejoin="round"/>`;
    case 'diamond':
      return `<path d="M${rr(x + r)} ${rr(cy - r)} L${rr(x + 2 * r)} ${rr(cy)} L${rr(x + r)} ${rr(cy + r)} L${rr(x)} ${rr(cy)} Z" fill="${fill}"/>`;
    case 'spark': {
      const k = r * 0.3;
      const cx = x + r;
      return `<path d="M${rr(cx)} ${rr(cy - r)} L${rr(cx + k)} ${rr(cy - k)} L${rr(cx + r)} ${rr(cy)} L${rr(cx + k)} ${rr(cy + k)} L${rr(cx)} ${rr(cy + r)} L${rr(cx - k)} ${rr(cy + k)} L${rr(cx - r)} ${rr(cy)} L${rr(cx - k)} ${rr(cy - k)} Z" fill="${fill}"/>`;
    }
    case 'leaf':
      return `<path d="M${rr(x)} ${rr(cy + r)} C${rr(x)} ${rr(cy - r * 0.2)} ${rr(x + r * 0.9)} ${rr(cy - r)} ${rr(x + 2 * r)} ${rr(cy - r)} C${rr(x + 2 * r)} ${rr(cy + r * 0.1)} ${rr(x + r * 1.1)} ${rr(cy + r)} ${rr(x)} ${rr(cy + r)} Z" fill="${fill}"/>`;
    case 'dash':
      return `<rect x="${rr(x)}" y="${rr(cy - r * 0.18)}" width="${rr(r * 1.8)}" height="${rr(r * 0.36)}" rx="${rr(r * 0.18)}" fill="${fill}"/>`;
    default:
      return `<circle cx="${rr(x + r)}" cy="${rr(cy)}" r="${rr(r * 0.8)}" fill="${fill}"/>`;
  }
}

export interface StackDraw {
  svg: string;
  placed: Placed[];
}

/** Draw a fitted stack in the text zone; positions it by the zone's vertical alignment. */
export function drawStack(fitted: FittedItem[], zone: TextZone, sc: StyleCtx): StackDraw {
  const { pal, th, dir } = sc;
  const rtl = dir === 'rtl';
  const box = zone.box;
  const bgs = zone.bgs;
  const total = fitted.reduce((a, f) => a + f.h + f.gapBefore, 0);
  let y = zone.valign === 'top' ? box.y : zone.valign === 'bottom' ? box.y + box.h - total : box.y + (box.h - total) / 2;
  y = Math.max(box.y, y);
  const align: 'left' | 'center' | 'right' = zone.align === 'left' && rtl ? 'right' : zone.align;
  const alignX = (innerX: number, innerW: number, width: number) => (align === 'center' ? innerX + (innerW - width) / 2 : align === 'right' ? innerX + innerW - width : innerX);
  const headCands = inkCandidates(pal, bgs[0], true);
  const bodyCands = inkCandidates(pal, bgs[0], false);
  const neutrals = (fill: string) => inkCandidates(pal, fill, false);
  let svg = '';
  const placed: Placed[] = [];

  for (const f of fitted) {
    const it = f.item;
    y += f.gapBefore;
    const weight = it.weight;
    const baseOff = baselineOffset(weight, f.fit.size, f.fit.lineHeightPx);
    const widest = f.fit.lines.length ? Math.max(...f.fit.lines.map((l) => l.width)) : 0;
    const lineBoxes: Box[] = [];
    let ink: string;
    let inkBgs: string[] = bgs;
    const outerW = box.w;

    if (it.look === 'button' || it.look === 'tag') {
      const prefs = it.look === 'button' ? pal.accents : [...pal.accents.slice(1), pal.accents[0]].filter(Boolean);
      const fill = chooseFill(bgs, prefs, 1.8) ?? accentFor(pal, bgs);
      const innerW = widest;
      const pillW = innerW + 2 * it.padX + (it.look === 'button' && th.style.cta === 'arrow' ? Math.round(f.fit.size * 1.1) : 0);
      const pillX = alignX(box.x, outerW, pillW);
      const pill: Box = { x: pillX, y, w: pillW, h: f.h };
      const r = it.look === 'tag' ? (th.style.offer === 'ribbon' ? 0 : Math.min(f.h / 2, Math.max(sc.radius * 0.5, 6))) : th.style.cta === 'rect' ? Math.min(sc.radius * 0.45, f.h / 2) : f.h / 2;
      const apart = Math.min(...bgs.map((b) => contrast(fill, b)));
      const out = apart < 1.6 ? chooseInk(bgs, bodyCands).ink : null;
      const stroke = out ? `stroke="${out}" stroke-width="3"` : '';
      if (it.look === 'tag' && th.style.offer === 'ribbon') {
        const notch = f.h * 0.28;
        svg += `<path d="M${rr(pill.x)} ${rr(pill.y)} H${rr(pill.x + pill.w)} L${rr(pill.x + pill.w - notch)} ${rr(pill.y + pill.h / 2)} L${rr(pill.x + pill.w)} ${rr(pill.y + pill.h)} H${rr(pill.x)} Z" fill="${fill}" ${stroke}/>`;
      } else {
        svg += `<rect x="${rr(pill.x)}" y="${rr(pill.y)}" width="${rr(pill.w)}" height="${rr(pill.h)}" rx="${rr(r)}" fill="${fill}" ${stroke}/>`;
      }
      ink = chooseInk([fill], neutrals(fill)).ink;
      inkBgs = [fill];
      const arrowW = it.look === 'button' && th.style.cta === 'arrow' ? Math.round(f.fit.size * 1.1) : 0;
      const textAreaX = rtl ? pill.x + it.padX + arrowW : pill.x + it.padX;
      f.fit.lines.forEach((l, i) => {
        const x = textAreaX + (innerW - l.width) / 2;
        const ly = y + it.padY + i * f.fit.lineHeightPx;
        lineBoxes.push({ x, y: ly, w: l.width, h: f.fit.lineHeightPx });
        svg += shapedToSvg(shapeText(l.text, weight, dir, it.face), x, ly + baseOff, f.fit.size, ink);
      });
      if (arrowW) {
        const ax = rtl ? pill.x + it.padX * 0.6 : pill.x + pill.w - it.padX * 0.6 - arrowW * 0.8;
        const ay = y + f.h / 2;
        const aw = arrowW * 0.8;
        const dirSign = rtl ? -1 : 1;
        const x0 = rtl ? ax + aw : ax;
        svg += `<path d="M${rr(x0)} ${rr(ay)} H${rr(x0 + dirSign * aw)} M${rr(x0 + dirSign * aw * 0.62)} ${rr(ay - aw * 0.3)} L${rr(x0 + dirSign * aw)} ${rr(ay)} L${rr(x0 + dirSign * aw * 0.62)} ${rr(ay + aw * 0.3)}" fill="none" stroke="${ink}" stroke-width="${rr(Math.max(2.5, f.fit.size * 0.09))}" stroke-linecap="round" stroke-linejoin="round"/>`;
      }
      placed.push({ name: it.key, kind: 'text', box: union([pill, ...lineBoxes]), lines: lineBoxes, size: f.fit.size, weight, ink, bgs: inkBgs, text: it.text, truncated: f.fit.truncated });
    } else {
      const isHead = it.role === 'headline' || it.role === 'primary';
      let textInkPrefs = isHead ? headCands : bodyCands;
      if (it.role === 'offer') textInkPrefs = [...pal.accents, ...bodyCands];
      ink = chooseInk(bgs, textInkPrefs).ink;
      const indent = it.indent;
      f.fit.lines.forEach((l, i) => {
        const x = alignX(box.x + (rtl ? 0 : indent), outerW - indent, l.width);
        const ly = y + i * f.fit.lineHeightPx;
        lineBoxes.push({ x, y: ly, w: l.width, h: f.fit.lineHeightPx });
        svg += shapedToSvg(shapeText(l.text, weight, dir, it.face), x, ly + baseOff, f.fit.size, ink);
      });
      if (it.look === 'bullet' && lineBoxes.length) {
        const r = Math.max(8, Math.round(f.fit.size * 0.36));
        const fill = chooseFill(bgs, pal.accents, 1.8) ?? ink;
        const bxx = rtl ? lineBoxes[0].x + lineBoxes[0].w + r * 0.7 : lineBoxes[0].x - 2 * r - r * 0.7;
        const by = lineBoxes[0].y + f.fit.lineHeightPx / 2;
        svg += bulletSvg(th.style.bullet, bxx, by, r, fill, chooseInk([fill], neutrals(fill)).ink);
        placed.push({ name: `${it.key}-marker`, kind: 'icon', box: { x: bxx, y: by - r, w: 2 * r, h: 2 * r }, lines: [], size: 0, truncated: false });
      }
      placed.push({ name: it.key, kind: 'text', box: union(lineBoxes.length ? lineBoxes : [{ x: box.x, y, w: 0, h: 0 }]), lines: lineBoxes, size: f.fit.size, weight, ink, bgs, text: it.text, truncated: f.fit.truncated });
    }
    y += f.h;
  }
  return { svg, placed };
}

// ---------------------------------------------------------------------------------------------
// Contact blocks
// ---------------------------------------------------------------------------------------------

export interface ContactsDraw {
  svg: string;
  placed: Placed[];
  dropped: DesignBlock[];
  truncated: string[];
}

export function drawContacts(zone: ContactZone, blocks: DesignBlock[], sc: StyleCtx): ContactsDraw {
  const { pal, dir, faces } = sc;
  const rtl = dir === 'rtl';
  const T = TYPE_SCALE[sc.format].contact;
  const cols = Math.max(1, zone.cols);
  const gutter = 24;
  const cellW = (zone.box.w - gutter * (cols - 1)) / cols;
  const inkPick = chooseInk(zone.bgs, inkCandidates(pal, zone.bgs[0], false));
  const iconFill = chooseFill(zone.bgs, pal.accents, 1.8) ?? inkPick.ink;
  const iconInk = chooseInk([iconFill], inkCandidates(pal, iconFill, false)).ink;

  interface Laid {
    block: DesignBlock;
    fit: FitResult;
  }
  const layout = (items: DesignBlock[], size: number, wrap: boolean) => {
    const iconD = Math.round(size * 1.3);
    const gapX = Math.round(size * 0.45);
    const textW = cellW - iconD - gapX;
    const laid: Laid[] = items.map((b) => ({
      block: b,
      fit: fitText(b.text, { weight: 500, boxW: textW, boxH: 1e5, maxSize: size, minSize: size, maxLines: wrap || b.kind === 'address' ? 2 : 1, lineHeight: 1.25, dir, face: faces.body }),
    }));
    const rows: Laid[][] = [];
    laid.forEach((l, i) => {
      const r = Math.floor(i / cols);
      (rows[r] ??= []).push(l);
    });
    const rowGap = Math.round(size * 0.3);
    const rowHs = rows.map((r) => Math.max(iconD, ...r.map((l) => l.fit.height)));
    const height = rowHs.reduce((a, h) => a + h, 0) + rowGap * Math.max(0, rows.length - 1);
    return { iconD, gapX, textW, laid, rows, rowHs, rowGap, height, truncated: laid.filter((l) => l.fit.truncated) };
  };

  let items = [...blocks];
  let size = T.max;
  let wrap = false;
  let lay = layout(items, size, wrap);
  // Largest size at which every block fits its cell and the zone, then, at the minimum, drop from the end.
  while ((lay.height > zone.box.h || lay.truncated.length) && size > T.min) {
    size = Math.max(T.min, size - 2);
    lay = layout(items, size, wrap);
  }
  if (lay.truncated.length) {
    // A long unbreakable line (an email, a web address) may wrap onto two lines at the minimum size.
    wrap = true;
    lay = layout(items, size, wrap);
  }
  const dropped: DesignBlock[] = [];
  while (lay.height > zone.box.h && items.length > 1) {
    dropped.unshift(items[items.length - 1]);
    items = items.slice(0, -1);
    lay = layout(items, size, wrap);
  }
  if (lay.height > zone.box.h && items.length === 1 && zone.box.h < lay.iconD) {
    dropped.unshift(items[0]);
    items = [];
  }
  if (!items.length) return { svg: '', placed: [], dropped, truncated: [] };

  let svg = '';
  const placed: Placed[] = [];
  const maxRowW = Math.max(...lay.laid.map((l) => lay.iconD + lay.gapX + Math.max(...l.fit.lines.map((x) => x.width), 0)));
  const groupW = cols === 1 ? Math.min(cellW, maxRowW) : zone.box.w;
  const groupX = zone.align === 'center' && cols === 1 ? zone.box.x + (zone.box.w - groupW) / 2 : zone.box.x;
  let y = zone.box.y + Math.max(0, (zone.box.h - lay.height) / 2);
  lay.rows.forEach((row, ri) => {
    const rh = lay.rowHs[ri];
    row.forEach((l, ci) => {
      const cellX = groupX + ci * (cellW + gutter);
      const iconX = rtl ? cellX + (cols === 1 ? groupW : cellW) - lay.iconD : cellX;
      const cy = y + rh / 2;
      svg += contactIcon(l.block.kind, iconX + lay.iconD / 2, cy, lay.iconD, iconFill, iconInk);
      placed.push({ name: `icon-${l.block.kind}`, kind: 'icon', box: { x: iconX, y: cy - lay.iconD / 2, w: lay.iconD, h: lay.iconD }, lines: [], size: 0, truncated: false });
      const base = baselineOffset(500, l.fit.size, l.fit.lineHeightPx);
      const top = cy - l.fit.height / 2;
      const boxes: Box[] = [];
      l.fit.lines.forEach((ln, li) => {
        const x = rtl ? iconX - lay.gapX - ln.width : iconX + lay.iconD + lay.gapX;
        const ly = top + li * l.fit.lineHeightPx;
        boxes.push({ x, y: ly, w: ln.width, h: l.fit.lineHeightPx });
        svg += shapedToSvg(shapeText(ln.text, 500, dir, faces.body), x, ly + base, l.fit.size, inkPick.ink);
      });
      placed.push({ name: `contact-${l.block.kind}`, kind: 'text', box: union(boxes), lines: boxes, size: l.fit.size, weight: 500, ink: inkPick.ink, bgs: zone.bgs, text: l.block.text, truncated: l.fit.truncated });
    });
    y += rh + lay.rowGap;
  });
  return { svg, placed, dropped, truncated: lay.truncated.map((l) => l.block.text) };
}

// ---------------------------------------------------------------------------------------------
// QR tile
// ---------------------------------------------------------------------------------------------

const TILE_PAD = 14;

/** The QR tile for a format: the code at (at least) the minimum size, on a light plate, with its label and payee lines. */
export function computeQrTile(qr: NonNullable<DesignContent['qr']>, format: DesignFormat, dir: Dir): QrTile & { truncated: boolean } {
  const modules = totalModules(qrMatrix(qr.text).size);
  const min = minQrPx(QR_RULE_WIDTH[format]);
  const modulePx = Math.ceil(min / modules);
  const qrPx = modulePx * modules;
  const w = qrPx + 2 * TILE_PAD;
  const textW = w - 2 * TILE_PAD;
  const lines: QrTile['lines'] = [];
  let truncated = false;
  const add = (text: string, weight: Weight, maxSize: number, minSize: number, maxLines: number) => {
    const fit = fitText(text, { weight, boxW: textW, boxH: 1e5, maxSize, minSize, maxLines, dir, lineHeight: 1.25 });
    if (fit.truncated) truncated = true;
    for (const l of fit.lines) lines.push({ text: l.text, size: fit.size, weight });
  };
  add(qr.label, 700, 28, 20, 1);
  if (qr.payment) {
    add(qr.payment.payeeName, 700, 26, 18, 2);
    add(qr.payment.address, 500, 22, 16, 2);
  }
  const textH = lines.reduce((a, l) => a + Math.round(l.size * 1.25), 0);
  const h = TILE_PAD + qrPx + 6 + textH + TILE_PAD;
  return { text: qr.text, label: qr.label, payment: qr.payment, modules, modulePx, qrPx, pad: TILE_PAD, w, h, lines, truncated };
}

export interface QrDraw {
  svg: string;
  placed: Placed[];
  /** The QR square itself (quiet zone included), for decoding. */
  qrBox: Box;
}

export function drawQrTile(tile: QrTile, x: number, y: number, dir: Dir, radius: number): QrDraw {
  const r = Math.min(radius, 22);
  let svg = `<rect x="${rr(x)}" y="${rr(y)}" width="${tile.w}" height="${tile.h}" rx="${rr(r)}" fill="#ffffff" stroke="#000000" stroke-opacity="0.18" stroke-width="2"/>`;
  const qx = x + tile.pad;
  const qy = y + tile.pad;
  const inner = qrSvg(tile.text, { dark: '#000000', light: '#ffffff' }).replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');
  svg += `<g transform="translate(${qx} ${qy}) scale(${tile.modulePx})" shape-rendering="crispEdges">${inner}</g>`;
  const placed: Placed[] = [];
  let ty = qy + tile.qrPx + 6;
  const lineBoxes: Box[] = [];
  for (const l of tile.lines) {
    const lh = Math.round(l.size * 1.25);
    const shaped = shapeText(l.text, l.weight, dir);
    const width = shaped.widthEm * l.size;
    const lx = x + (tile.w - width) / 2;
    svg += shapedToSvg(shaped, lx, ty + baselineOffset(l.weight, l.size, lh), l.size, '#111111');
    lineBoxes.push({ x: lx, y: ty, w: width, h: lh });
    ty += lh;
  }
  const qrBox = { x: qx, y: qy, w: tile.qrPx, h: tile.qrPx };
  placed.push({ name: 'qr', kind: 'qr', box: { x, y, w: tile.w, h: tile.h }, lines: [qrBox], size: 0, truncated: false });
  if (lineBoxes.length) {
    placed.push({ name: 'qr-label', kind: 'text', box: union(lineBoxes), lines: lineBoxes, size: tile.lines[0].size, weight: 700, ink: '#111111', bgs: ['#ffffff'], text: tile.lines.map((l) => l.text).join(' '), truncated: false });
  }
  return { svg, placed, qrBox };
}

// ---------------------------------------------------------------------------------------------
// Logo, slide marker, mascot
// ---------------------------------------------------------------------------------------------

export interface PreparedLogo {
  uri: string;
  w: number;
  h: number;
}

export function drawLogo(z: LogoZone, logo: PreparedLogo | null, name: string, sc: StyleCtx): { svg: string; placed: Placed[] } | null {
  const rtl = sc.dir === 'rtl';
  const b = z.box;
  if (logo) {
    const pad = 10;
    const k = Math.min((b.w - 2 * pad) / logo.w, (b.h - 2 * pad) / logo.h);
    const w = logo.w * k;
    const h = logo.h * k;
    const plate: Box = { x: rtl ? b.x + b.w - w - 2 * pad : b.x, y: b.y + (b.h - h - 2 * pad) / 2, w: w + 2 * pad, h: h + 2 * pad };
    const svg =
      `<rect x="${rr(plate.x)}" y="${rr(plate.y)}" width="${rr(plate.w)}" height="${rr(plate.h)}" rx="${rr(Math.min(sc.radius * 0.6, 18))}" fill="#ffffff" fill-opacity="0.95"/>` +
      `<image x="${rr(plate.x + pad)}" y="${rr(plate.y + pad)}" width="${rr(w)}" height="${rr(h)}" xlink:href="${logo.uri}" preserveAspectRatio="none"/>`;
    return { svg, placed: [{ name: 'logo', kind: 'logo', box: plate, lines: [{ x: plate.x + pad, y: plate.y + pad, w, h }], size: 0, truncated: false }] };
  }
  if (!name.trim()) return null;
  const T = TYPE_SCALE[sc.format].logo;
  const padX = z.plate ? 18 : 0;
  const padY = z.plate ? 8 : 0;
  const inner: Box = { x: b.x + padX, y: b.y + padY, w: b.w - 2 * padX, h: b.h - 2 * padY };
  const surfaces = z.plate ? ['#ffffff'] : z.bgs;
  const ink = chooseInk(surfaces, z.plate ? ['#111111'] : inkCandidates(sc.pal, z.bgs[0], true)).ink;
  const accent = chooseFill(surfaces, sc.pal.accents, 1.8);
  const d = drawTextLogo(name, inner, { face: sc.faces.head, ink, accent, max: T.max, min: T.min, lines: T.lines, dir: sc.dir });
  if (!d) return null;
  const text = union(d.lines);
  let svg = d.svg;
  let box = text;
  if (z.plate) {
    box = { x: text.x - padX, y: text.y - padY, w: text.w + 2 * padX, h: text.h + 2 * padY + (accent ? 12 : 0) };
    svg = `<rect x="${rr(box.x)}" y="${rr(box.y)}" width="${rr(box.w)}" height="${rr(box.h)}" rx="${rr(Math.min(box.h / 2, 22))}" fill="#ffffff" fill-opacity="0.95"/>` + svg;
  }
  return {
    svg,
    placed: [{ name: 'logo-text', kind: 'text', box, lines: d.lines, size: d.size, weight: 800, ink, bgs: surfaces, text: name, truncated: d.truncated }],
  };
}

export function drawMarker(m: { box: Box; bgs: string[] }, index: number, total: number, sc: StyleCtx): { svg: string; placed: Placed[] } {
  const text = `${index}/${total}`;
  const fill = chooseFill(m.bgs, sc.pal.accents, 1.8) ?? accentFor(sc.pal, m.bgs);
  const ink = chooseInk([fill], inkCandidates(sc.pal, fill, false)).ink;
  const fit = fitText(text, { weight: 700, boxW: m.box.w - 24, boxH: m.box.h, maxSize: 30, minSize: 22, maxLines: 1, dir: 'ltr' });
  const w = Math.max(fit.lines[0].width + 28, 70);
  const x = sc.dir === 'rtl' ? m.box.x : m.box.x + m.box.w - w;
  const pill: Box = { x, y: m.box.y, w, h: m.box.h };
  let svg = `<rect x="${rr(pill.x)}" y="${rr(pill.y)}" width="${rr(pill.w)}" height="${rr(pill.h)}" rx="${rr(pill.h / 2)}" fill="${fill}"/>`;
  const lh = fit.lineHeightPx;
  const lx = pill.x + (pill.w - fit.lines[0].width) / 2;
  const ly = pill.y + (pill.h - lh) / 2;
  svg += shapedToSvg(shapeText(text, 700, 'ltr'), lx, ly + baselineOffset(700, fit.size, lh), fit.size, ink);
  return {
    svg,
    placed: [{ name: 'marker', kind: 'marker', box: pill, lines: [{ x: lx, y: ly, w: fit.lines[0].width, h: lh }], size: fit.size, weight: 700, ink, bgs: [fill], text, truncated: false }],
  };
}

export function drawMascot(z: MascotZone, mascot: MascotInput, W: number, bubbleText: string, sc: StyleCtx): { svg: string; placed: Placed[]; dropped: boolean } {
  const a = z.box;
  const cx = a.x + a.w / 2;
  const side: 'left' | 'right' = cx < W / 2 ? 'left' : 'right';
  const halo = z.behind === 'photo' ? true : luminance(parseHex(z.behind)) < HALO_BELOW_LUMINANCE;
  const group = mascot.build ? mascot.build({ side, halo }) : mascot.svg;
  const k = Math.min(a.w, a.h) / MASCOT_BOX;
  const tx = a.x + (a.w - MASCOT_BOX * k) / 2;
  const ty = a.y + (a.h - MASCOT_BOX * k) / 2;
  const id = 'mascot-clip';
  let svg = `<clipPath id="${id}"><rect x="${a.x}" y="${a.y}" width="${a.w}" height="${a.h}"/></clipPath><g clip-path="url(#${id})"><g transform="translate(${rr(tx)} ${rr(ty)}) scale(${rr(k * 1000) / 1000})">${group}</g></g>`;
  const placed: Placed[] = [{ name: 'mascot', kind: 'mascot', box: a, lines: [{ x: tx, y: ty, w: MASCOT_BOX * k, h: MASCOT_BOX * k }], size: 0, truncated: false }];
  if (z.bubble && bubbleText.trim()) {
    const c = new Canvas({
      format: 'square',
      dir: sc.dir,
      colors: { primary: '#000000', secondary: '#000000', accent: '#000000' },
      brandName: '',
      text: { headline: '', subline: '', cta: '', bubble: bubbleText },
      photoUri: null,
      logo: null,
      mascot,
    });
    svg += c.bubble(z.bubble.box, z.bubble.tail);
    for (const p of c.placements) {
      if (p.name === 'bubble') placed.push({ name: 'bubble', kind: 'bubble', box: p.box, lines: p.lines, size: p.size, weight: 700, ink: '#111111', bgs: ['#ffffff'], text: p.text, truncated: p.truncated });
    }
  }
  return { svg, placed, dropped: false };
}
