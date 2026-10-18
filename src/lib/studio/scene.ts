// Studio document -> SVG element tree. Shared by the live editor (browser) and the stored picture (server), so the
// two are the same drawing. Text is shaped into paths by StudioShaper; nothing here reads files or the network.

import QRCode from 'qrcode';
import { contrast, hexToRgb, inkOn, mix } from './color';
import { BADGE_INNER, badgePath, blob, burst, ellipse, maskPath, ribbon, ring, roundRect, squiggle, star, triangle, wave, arch, rng } from './geometry';
import { ICONS } from './icons';
import type { StudioShaper } from './shaper';
import type { BadgeLayer, ChipLayer, IconLayer, ImageLayer, Layer, Paint, QrLayer, Shadow, ShapeLayer, StudioDoc, TextLayer, CharacterLayer } from './types';
import { h, type VNode } from './vnode';

export interface SceneOptions {
  /** Prefix for ids inside this SVG (several SVGs share one page in the browser). */
  idPrefix?: string;
  /** Maps an image src to the href to draw (the server swaps in data: URIs). */
  image?: (src: string) => string;
  /** Layers to leave out (the editor hides a text layer while it is being typed into). */
  skip?: ReadonlySet<string>;
  /** Draw a light checker under transparent areas (never on export). */
  showHidden?: boolean;
  /** Replaces the QR data of brief QR layers (each channel's post has its own short link). */
  qrData?: string | null;
}

const r = (n: number) => Math.round(n * 100) / 100;

// ---------------------------------------------------------------------------------------------
// Text layout (also used by the editor to size boxes)
// ---------------------------------------------------------------------------------------------

export interface TextLayout {
  size: number;
  lines: { text: string; width: number }[];
  lineH: number;
  blockH: number;
  /** Widest line. */
  width: number;
  cap: number;
}

const shown = (l: { text: string; upper?: boolean }) => (l.upper ? l.text.toLocaleUpperCase() : l.text);

export function layoutText(l: Pick<TextLayer, 'text' | 'upper' | 'font' | 'weight' | 'size' | 'lineHeight' | 'tracking' | 'w' | 'h' | 'autoFit'>, shaper: StudioShaper): TextLayout {
  const text = shown(l);
  const max = Math.max(4, l.w);
  const run = (size: number): TextLayout => {
    const lines = shaper.wrap(text, l.font, l.weight, size, l.tracking, max).map((t) => ({ text: t, width: shaper.measure(t, l.font, l.weight, size, l.tracking) }));
    const lineH = size * l.lineHeight;
    return { size, lines, lineH, blockH: lines.length * lineH, width: Math.max(0, ...lines.map((x) => x.width)), cap: shaper.capHeight(l.font, l.weight) };
  };
  let out = run(l.size);
  if (!l.autoFit) return out;
  let size = l.size;
  const minSize = Math.max(8, l.size * 0.2);
  // Shrink until the block fits the box and no single word is wider than the box.
  while (size > minSize && (out.blockH > l.h + 0.5 || out.width > max + 0.5)) {
    size = Math.max(minSize, size * 0.94);
    out = run(size);
  }
  return out;
}

/** The height a text box needs for its words (non-fitting boxes grow and shrink with the words). */
export const textHeight = (l: TextLayer, shaper: StudioShaper): number => Math.max(l.size * l.lineHeight * 0.6, layoutText({ ...l, autoFit: false }, shaper).blockH);

/** Width of a contact chip for its words. */
export function chipWidth(l: Pick<ChipLayer, 'text' | 'font' | 'weight' | 'size' | 'h' | 'style'>, shaper: StudioShaper): number {
  const disc = l.h * 0.74;
  const pad = l.style === 'plain' ? 0 : l.h * 0.16;
  const gap = l.h * 0.22;
  const tw = shaper.measure(l.text, l.font, l.weight, l.size);
  return Math.ceil(pad + disc + gap + tw + (l.style === 'plain' ? 4 : l.h * 0.42));
}

// ---------------------------------------------------------------------------------------------
// Paint and effects
// ---------------------------------------------------------------------------------------------

class Defs {
  items: VNode[] = [];
  private n = 0;
  private scope = 'bg';
  constructor(private prefix: string) {}
  /** Ids are numbered inside the layer being drawn, so changing one layer never renames another layer's clip or filter (a renamed filter makes the browser redraw its picture). */
  enter(layerId: string) {
    this.scope = layerId.replace(/[^A-Za-z0-9_]/g, '') || 'x';
    this.n = 0;
  }
  id(kind: string) {
    return `${this.prefix}${kind}-${this.scope}-${++this.n}`;
  }
  add(v: VNode) {
    this.items.push(v);
  }
}

function stops(p: Extract<Paint, { stops: unknown }>): VNode[] {
  return p.stops.map((s) => h('stop', { offset: r(s.at), stopColor: s.color, stopOpacity: s.alpha ?? 1 }));
}

/** A fill value for a paint over a box (gradients become defs in user space of that box). */
function paint(p: Paint, defs: Defs, box: { x: number; y: number; w: number; h: number }): string {
  if (p.kind === 'solid') return p.color;
  const id = defs.id('g');
  if (p.kind === 'linear') {
    const a = ((p.angle - 90) * Math.PI) / 180;
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    const len = (Math.abs(box.w * Math.cos(a)) + Math.abs(box.h * Math.sin(a))) / 2;
    defs.add(
      h('linearGradient', { id, gradientUnits: 'userSpaceOnUse', x1: r(cx - Math.cos(a) * len), y1: r(cy - Math.sin(a) * len), x2: r(cx + Math.cos(a) * len), y2: r(cy + Math.sin(a) * len) }, stops(p)),
    );
  } else {
    defs.add(h('radialGradient', { id, gradientUnits: 'userSpaceOnUse', cx: r(box.x + box.w * p.cx), cy: r(box.y + box.h * p.cy), r: r(Math.max(box.w, box.h) * p.r) }, stops(p)));
  }
  return `url(#${id})`;
}

export const paintColor = (p: Paint): string => (p.kind === 'solid' ? p.color : p.stops[0].color);

function shadowFilter(s: Shadow, defs: Defs, extra: VNode[] = []): string {
  const id = defs.id('f');
  defs.add(
    h('filter', { id, x: '-50%', y: '-50%', width: '200%', height: '200%', colorInterpolationFilters: 'sRGB' }, [
      ...extra,
      h('feDropShadow', { dx: r(s.dx), dy: r(s.dy), stdDeviation: r(s.blur / 2), floodColor: s.color, floodOpacity: r(s.alpha) }),
    ]),
  );
  return `url(#${id})`;
}

// ---------------------------------------------------------------------------------------------
// Layers
// ---------------------------------------------------------------------------------------------

function textNode(l: TextLayer, shaper: StudioShaper, defs: Defs): VNode[] {
  const lay = layoutText(l, shaper);
  const out: VNode[] = [];
  const top = l.valign === 'middle' ? (l.h - lay.blockH) / 2 : l.valign === 'bottom' ? l.h - lay.blockH : 0;
  const xOf = (w: number) => (l.align === 'center' ? (l.w - w) / 2 : l.align === 'right' ? l.w - w : 0);
  if (l.bg) {
    const fill = l.bg.color;
    const op = l.bg.alpha ?? 1;
    if (l.bg.mode === 'box') {
      const w = lay.width + l.bg.padX * 2;
      const x = l.align === 'center' ? (l.w - lay.width) / 2 - l.bg.padX : l.align === 'right' ? l.w - lay.width - l.bg.padX : -l.bg.padX;
      out.push(h('path', { d: roundRect(w, lay.blockH + l.bg.padY * 2, l.bg.radius, x, top - l.bg.padY), fill, fillOpacity: op }));
    } else {
      lay.lines.forEach((ln, i) => {
        if (!ln.text) return;
        out.push(h('path', { d: roundRect(ln.width + l.bg!.padX * 2, lay.lineH + l.bg!.padY * 2 - 2, l.bg!.radius, xOf(ln.width) - l.bg!.padX, top + i * lay.lineH - l.bg!.padY + 1), fill, fillOpacity: op }));
      });
    }
  }
  const box = { x: 0, y: top, w: l.w, h: Math.max(1, lay.blockH) };
  const fill = paint(l.fill, defs, box);
  let d = '';
  lay.lines.forEach((ln, i) => {
    if (!ln.text) return;
    const x = xOf(ln.width);
    const base = top + i * lay.lineH + lay.lineH / 2 + (lay.cap * lay.size) / 2;
    const p = shaper.line(ln.text, l.font, l.weight, lay.size, l.tracking, x, base).d;
    d += p;
  });
  if (!d) return out;
  const attrs: VNode['a'] = { d, fill };
  if (l.stroke && l.stroke.width > 0) Object.assign(attrs, { stroke: l.stroke.color, strokeWidth: r(l.stroke.width), strokeLinejoin: 'round', paintOrder: 'stroke' });
  if (l.shadow && l.shadow.alpha > 0) attrs.filter = shadowFilter(l.shadow, defs);
  if (l.italic) attrs.transform = `translate(${r(l.h * 0.09)} 0) skewX(-10)`;
  out.push(h('path', attrs));
  return out;
}

function imageFilter(l: ImageLayer, defs: Defs): string | undefined {
  const parts: VNode[] = [];
  let last = 'SourceGraphic';
  const step = (n: VNode, result: string) => {
    parts.push({ ...n, a: { ...n.a, in: n.a?.in ?? last, result } });
    last = result;
  };
  const a = l.adjust;
  if (a) {
    if (a.blur) step(h('feGaussianBlur', { stdDeviation: r(a.blur) }), 'bl');
    if (a.saturation) step(h('feColorMatrix', { type: 'saturate', values: r(1 + a.saturation) }), 'sa');
    if (a.brightness || a.contrast) {
      const slope = 1 + a.contrast;
      const icpt = a.brightness * 0.5 + (1 - slope) / 2;
      step(h('feComponentTransfer', {}, ['R', 'G', 'B'].map((c) => h(`feFunc${c}`, { type: 'linear', slope: r(slope), intercept: r(icpt) }))), 'bc');
    }
    if (a.warmth) {
      const w = a.warmth * 0.12;
      step(h('feColorMatrix', { type: 'matrix', values: `${r(1 + w)} 0 0 0 0  0 1 0 0 0  0 0 ${r(1 - w)} 0 0  0 0 0 1 0` }), 'wm');
    }
  }
  if (l.tint && l.tint.mode === 'duotone' && l.tint.amount > 0) {
    const before = last;
    step(h('feColorMatrix', { type: 'matrix', values: '0.33 0.33 0.33 0 0  0.33 0.33 0.33 0 0  0.33 0.33 0.33 0 0  0 0 0 1 0' }), 'gr');
    const [tr, tg, tb] = hexToRgb(l.tint.color).map((v) => v / 255);
    const hi = hexToRgb(mix(l.tint.color, '#FFFFFF', 0.85)).map((v) => v / 255);
    step(h('feComponentTransfer', {}, [h('feFuncR', { type: 'table', tableValues: `${r(tr)} ${r(hi[0])}` }), h('feFuncG', { type: 'table', tableValues: `${r(tg)} ${r(hi[1])}` }), h('feFuncB', { type: 'table', tableValues: `${r(tb)} ${r(hi[2])}` })]), 'du');
    parts.push(h('feComposite', { in: 'du', in2: before, operator: 'arithmetic', k1: 0, k2: r(l.tint.amount), k3: r(1 - l.tint.amount), k4: 0, result: 'dt' }));
    last = 'dt';
  }
  if (l.outline && l.outline.width > 0) {
    const before = last;
    parts.push(h('feMorphology', { in: 'SourceAlpha', operator: 'dilate', radius: r(l.outline.width), result: 'dil' }));
    parts.push(h('feFlood', { floodColor: l.outline.color, result: 'col' }));
    parts.push(h('feComposite', { in: 'col', in2: 'dil', operator: 'in', result: 'ol' }));
    parts.push(h('feMerge', { result: 'om' }, [h('feMergeNode', { in: 'ol' }), h('feMergeNode', { in: before })]));
    last = 'om';
  }
  if (l.shadow && l.shadow.alpha > 0 && (l.mask === 'none' || l.asset === 'cutout')) {
    parts.push(h('feDropShadow', { in: last, dx: r(l.shadow.dx), dy: r(l.shadow.dy), stdDeviation: r(l.shadow.blur / 2), floodColor: l.shadow.color, floodOpacity: r(l.shadow.alpha), result: 'sh' }));
    last = 'sh';
  }
  if (parts.length === 0) return undefined;
  const id = defs.id('f');
  defs.add(h('filter', { id, x: '-30%', y: '-30%', width: '160%', height: '160%', colorInterpolationFilters: 'sRGB' }, parts));
  return `url(#${id})`;
}

/** Where the picture sits inside its layer box (layer space). */
function imageFit(l: ImageLayer): { ix: number; iy: number; iw: number; ih: number } {
  const scaleCover = Math.max(l.w / l.natW, l.h / l.natH);
  const scaleContain = Math.min(l.w / l.natW, l.h / l.natH);
  const s = (l.fit === 'cover' ? scaleCover : scaleContain) * l.zoom;
  const iw = l.natW * s;
  const ih = l.natH * s;
  const clampX = (v: number) => (iw >= l.w ? Math.min(0, Math.max(l.w - iw, v)) : v);
  const clampY = (v: number) => (ih >= l.h ? Math.min(0, Math.max(l.h - ih, v)) : v);
  const ix = l.fit === 'contain' && l.zoom === 1 ? (l.w - iw) / 2 : clampX(l.w / 2 - l.fx * iw);
  const iy = l.fit === 'contain' && l.zoom === 1 ? (l.h - ih) / 2 : clampY(l.h / 2 - l.fy * ih);
  return { ix, iy, iw, ih };
}

// ---------------------------------------------------------------------------------------------
// The "AI" tag of a realistic AI person (Brand Face rule: always labelled). Drawn by code, never part of an image.
// ---------------------------------------------------------------------------------------------

export const AI_TAG_TEXT = 'AI';
const AI_TAG_FONT = 'poppins';
const AI_TAG_WEIGHT = 800;
const AI_TAG_TRACKING = 60;

export interface AiTagBox {
  x: number;
  y: number;
  w: number;
  h: number;
  size: number;
  padX: number;
}

/** The tag's box in the layer's own space: the bottom right corner of the part of the picture that shows. */
export function aiTagFor(l: ImageLayer, shaper: StudioShaper): AiTagBox {
  const { ix, iy, iw, ih } = imageFit(l);
  const x0 = Math.max(0, ix);
  const y0 = Math.max(0, iy);
  const x1 = Math.min(l.w, ix + iw);
  const y1 = Math.min(l.h, iy + ih);
  const side = Math.max(1, Math.min(x1 - x0, y1 - y0));
  const th = Math.min(72, Math.max(34, side * 0.12));
  const size = th * 0.56;
  const padX = th * 0.34;
  const w = shaper.measure(AI_TAG_TEXT, AI_TAG_FONT, AI_TAG_WEIGHT, size, AI_TAG_TRACKING) + padX * 2;
  const margin = th * 0.14;
  return { x: x1 - w - margin, y: y1 - th - margin, w, h: th, size, padX };
}

function aiTagNodes(l: ImageLayer, shaper: StudioShaper): VNode[] {
  const t = aiTagFor(l, shaper);
  const cap = shaper.capHeight(AI_TAG_FONT, AI_TAG_WEIGHT);
  const line = shaper.line(AI_TAG_TEXT, AI_TAG_FONT, AI_TAG_WEIGHT, t.size, AI_TAG_TRACKING, t.x + t.padX, t.y + t.h / 2 + (cap * t.size) / 2);
  return [
    h('path', { d: roundRect(t.w, t.h, t.h / 2, t.x, t.y), fill: '#111111', stroke: '#FFFFFF', strokeWidth: r(Math.max(1.5, t.h * 0.05)) }),
    h('path', { d: line.d, fill: '#FFFFFF' }),
  ];
}

/** The AI picture layers whose tag would fall off the poster (the tag must show; the owner moves the picture back). */
export function aiTagOutside(doc: StudioDoc, shaper: StudioShaper): ImageLayer[] {
  const out: ImageLayer[] = [];
  for (const l of doc.layers) {
    if (l.kind !== 'image' || !l.ai || l.hidden) continue;
    const t = aiTagFor(l, shaper);
    const a = ((l.rot || 0) * Math.PI) / 180;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    const cx = l.w / 2;
    const cy = l.h / 2;
    const off = [
      [t.x, t.y],
      [t.x + t.w, t.y],
      [t.x, t.y + t.h],
      [t.x + t.w, t.y + t.h],
    ].some(([px, py]) => {
      const dx = px - cx;
      const dy = py - cy;
      const wx = l.x + cx + dx * cos - dy * sin;
      const wy = l.y + cy + dx * sin + dy * cos;
      return wx < -1 || wy < -1 || wx > doc.width + 1 || wy > doc.height + 1;
    });
    if (off) out.push(l);
  }
  return out;
}

function imageNode(l: ImageLayer, defs: Defs, opts: SceneOptions): VNode[] {
  const href = opts.image ? opts.image(l.src) : l.src;
  const { ix, iy, iw, ih } = imageFit(l);
  const shape = maskPath(l.mask, l.w, l.h, l.radius, (l.id.charCodeAt(0) % 9) + 1);
  const clipId = defs.id('c');
  defs.add(h('clipPath', { id: clipId }, [h('path', { d: shape })]));
  const imgAttrs: VNode['a'] = { href, x: r(ix), y: r(iy), width: r(iw), height: r(ih), preserveAspectRatio: 'none' };
  if (l.flipX) imgAttrs.transform = `translate(${r(l.w)} 0) scale(-1 1)`;
  const filter = imageFilter(l, defs);
  const inner: VNode[] = [h('image', imgAttrs)];
  if (l.tint && l.tint.mode === 'wash' && l.tint.amount > 0) inner.push(h('path', { d: shape, fill: l.tint.color, fillOpacity: r(l.tint.amount) }, undefined, { s: { mixBlendMode: 'multiply' } }));
  const content: VNode = h('g', { filter }, inner);
  const clip = l.mask !== 'none' || l.fit === 'cover';
  let body: VNode = clip ? h('g', { clipPath: `url(#${clipId})` }, [content]) : content;
  if (l.fade) {
    const mid = defs.id('m');
    const gid = defs.id('g');
    const k = l.fade.size;
    let grad: VNode;
    if (l.fade.side === 'radial') grad = h('radialGradient', { id: gid, cx: 0.5, cy: 0.5, r: 0.5 }, [h('stop', { offset: r(1 - k), stopColor: '#fff' }), h('stop', { offset: 1, stopColor: '#000' })]);
    else {
      const dir = { bottom: [0, 0, 0, 1], top: [0, 1, 0, 0], left: [1, 0, 0, 0], right: [0, 0, 1, 0] }[l.fade.side];
      grad = h('linearGradient', { id: gid, x1: dir[0], y1: dir[1], x2: dir[2], y2: dir[3] }, [h('stop', { offset: r(1 - k), stopColor: '#fff' }), h('stop', { offset: 1, stopColor: '#000' })]);
    }
    defs.add(grad);
    defs.add(h('mask', { id: mid, maskUnits: 'userSpaceOnUse', x: 0, y: 0, width: r(l.w), height: r(l.h) }, [h('rect', { x: 0, y: 0, width: r(l.w), height: r(l.h), fill: `url(#${gid})` })]));
    body = h('g', { mask: `url(#${mid})` }, [body]);
  }
  const out: VNode[] = [];
  // Keys keep the picture's element in place when the shadow or border comes and goes (the browser then does not load it again).
  // A framed picture's shadow is drawn by its outline so it hugs the mask.
  if (l.shadow && l.shadow.alpha > 0 && l.mask !== 'none' && l.asset !== 'cutout') out.push(h('path', { d: shape, fill: '#FFFFFF', filter: shadowFilter(l.shadow, defs) }, undefined, { k: 'shadow' }));
  out.push({ ...body, k: 'body' });
  if (l.border && l.border.width > 0) out.push(h('path', { d: shape, fill: 'none', stroke: l.border.color, strokeWidth: r(l.border.width) }, undefined, { k: 'border' }));
  return out;
}

export function shapePath(l: Pick<ShapeLayer, 'shape' | 'w' | 'h' | 'radius' | 'seed' | 'points'>): string {
  const { w, h: hh } = l;
  switch (l.shape) {
    case 'rect':
      return roundRect(w, hh, l.radius ?? 0);
    case 'ellipse':
      return ellipse(w, hh);
    case 'blob':
      return blob(w, hh, l.seed ?? 1);
    case 'burst':
      return burst(w, hh, l.points ?? 16, 0.82);
    case 'arch':
      return arch(w, hh);
    case 'ribbon':
      return ribbon(w, hh);
    case 'wave':
      return wave(w, hh, l.seed ?? 1);
    case 'triangle':
      return triangle(w, hh);
    case 'star':
      return star(w, hh, l.points ?? 5);
    case 'ring':
      return ring(w, hh);
    default:
      return roundRect(w, hh, 0);
  }
}

function shapeNode(l: ShapeLayer, defs: Defs): VNode[] {
  const fill = paint(l.fill, defs, { x: 0, y: 0, w: l.w, h: l.h });
  const style = l.blend && l.blend !== 'normal' ? { mixBlendMode: l.blend } : undefined;
  const filter = l.shadow && l.shadow.alpha > 0 ? shadowFilter(l.shadow, defs) : undefined;
  if (l.shape === 'dots' || l.shape === 'halftone') {
    const gap = Math.max(8, l.radius ?? 36);
    const out: VNode[] = [];
    const cols = Math.max(1, Math.floor(l.w / gap));
    const rows = Math.max(1, Math.floor(l.h / gap));
    let d = '';
    for (let i = 0; i < rows; i++)
      for (let j = 0; j < cols; j++) {
        const t = l.shape === 'halftone' ? 1 - (i + j) / (rows + cols) : 1;
        const rad = (gap * 0.18 + 0.0001) * (l.shape === 'halftone' ? 0.3 + t * 1.6 : 1);
        const cx = j * gap + gap / 2;
        const cy = i * gap + gap / 2;
        d += ellipse(rad * 2, rad * 2, cx - rad, cy - rad);
      }
    out.push(h('path', { d, fill, filter }, undefined, style ? { s: style } : undefined));
    return out;
  }
  if (l.shape === 'line' || l.shape === 'squiggle') {
    const sw = Math.max(1, l.stroke?.width ?? Math.min(l.h, 12));
    const d = l.shape === 'line' ? `M0 ${r(l.h / 2)}H${r(l.w)}` : squiggle(l.w, l.h, l.seed ?? 1);
    return [h('path', { d, fill: 'none', stroke: fill, strokeWidth: r(sw), strokeLinecap: 'round', strokeLinejoin: 'round', filter }, undefined, style ? { s: style } : undefined)];
  }
  const attrs: VNode['a'] = { d: shapePath(l), fill, fillRule: 'evenodd', filter };
  if (l.stroke && l.stroke.width > 0) Object.assign(attrs, { stroke: l.stroke.color, strokeWidth: r(l.stroke.width), strokeLinejoin: 'round' });
  return [h('path', attrs, undefined, style ? { s: style } : undefined)];
}

/** QR modules as one path, quiet zone included (4 modules: scanners need it). */
export function qrMatrix(data: string): { size: number; get(r: number, c: number): boolean } {
  const q = QRCode.create(data, { errorCorrectionLevel: 'M' });
  return { size: q.modules.size, get: (row, col) => !!q.modules.get(row, col) };
}

function qrNode(l: QrLayer, defs: Defs, opts: SceneOptions): VNode[] {
  const data = l.source === 'brief' && opts.qrData ? opts.qrData : l.data;
  let m: ReturnType<typeof qrMatrix>;
  try {
    m = qrMatrix(data);
  } catch {
    return [h('path', { d: roundRect(l.w, l.h, l.radius), fill: '#EEEEEE' })];
  }
  const side = Math.min(l.w, l.h);
  const n = m.size + 8;
  const cell = side / n;
  const ox = (l.w - side) / 2 + cell * 4;
  const oy = (l.h - side) / 2 + cell * 4;
  let d = '';
  for (let i = 0; i < m.size; i++)
    for (let j = 0; j < m.size; j++) if (m.get(i, j)) d += `M${r(ox + j * cell)} ${r(oy + i * cell)}h${r(cell + 0.02)}v${r(cell + 0.02)}h${r(-cell - 0.02)}z`;
  const out: VNode[] = [];
  out.push(h('path', { d: roundRect(side, side, l.plate ? l.radius : 0, (l.w - side) / 2, (l.h - side) / 2), fill: l.bg }));
  out.push(h('path', { d, fill: l.fg, shapeRendering: 'crispEdges' }));
  void defs;
  return out;
}

function iconGlyph(icon: keyof typeof ICONS, x: number, y: number, size: number, color: string): VNode {
  const def = ICONS[icon];
  const k = size / 24;
  const kids: VNode[] = [def.mode === 'stroke' ? h('path', { d: def.d, fill: 'none', stroke: color, strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }) : h('path', { d: def.d, fill: color, fillRule: 'evenodd' })];
  for (const [cx, cy, rad] of def.dots ?? []) kids.push(h('circle', { cx, cy, r: rad, fill: color }));
  return h('g', { transform: `translate(${r(x)} ${r(y)}) scale(${r(k * 1000) / 1000})` }, kids);
}

function chipNode(l: ChipLayer, shaper: StudioShaper, defs: Defs): VNode[] {
  const out: VNode[] = [];
  const disc = l.h * 0.74;
  const pad = l.style === 'plain' ? 0 : l.h * 0.13;
  if (l.style !== 'plain') {
    const bg = l.bg ?? '#FFFFFF';
    out.push(h('path', { d: roundRect(l.w, l.h, l.h / 2), fill: l.style === 'outline' ? 'none' : bg, stroke: l.style === 'outline' ? bg : undefined, strokeWidth: l.style === 'outline' ? r(Math.max(2, l.h * 0.05)) : undefined }));
  }
  const cy = l.h / 2;
  out.push(h('circle', { cx: r(pad + disc / 2), cy: r(cy), r: r(disc / 2), fill: l.accent }));
  const gs = disc * 0.56;
  out.push(iconGlyph(l.icon, pad + disc / 2 - gs / 2, cy - gs / 2, gs, inkOn(l.accent)));
  const tx = pad + disc + l.h * 0.22;
  const cap = shaper.capHeight(l.font, l.weight);
  const line = shaper.line(l.text, l.font, l.weight, l.size, 0, tx, cy + (cap * l.size) / 2);
  if (line.d) out.push(h('path', { d: line.d, fill: l.color }));
  void defs;
  return out;
}

function badgeNode(l: BadgeLayer, shaper: StudioShaper, defs: Defs): VNode[] {
  const out: VNode[] = [];
  const d = badgePath(l.shape, l.w, l.h, l.points ?? 20);
  const attrs: VNode['a'] = { d, fill: paint(l.fill, defs, { x: 0, y: 0, w: l.w, h: l.h }), fillRule: 'evenodd' };
  if (l.stroke && l.stroke.width > 0) Object.assign(attrs, { stroke: l.stroke.color, strokeWidth: r(l.stroke.width), strokeLinejoin: 'round' });
  if (l.shadow && l.shadow.alpha > 0) attrs.filter = shadowFilter(l.shadow, defs);
  out.push(h('path', attrs));
  if (l.shape === 'stamp') out.push(h('path', { d: ellipse(l.w * 0.8, l.h * 0.8, l.w * 0.1, l.h * 0.1), fill: 'none', stroke: l.color, strokeOpacity: 0.55, strokeWidth: r(Math.max(2, l.w * 0.012)), strokeDasharray: `${r(l.w * 0.02)} ${r(l.w * 0.015)}` }));
  const inner = BADGE_INNER[l.shape] ?? BADGE_INNER.pill;
  const iw = l.w * inner.w;
  const ih = l.h * inner.h;
  const lines = l.text.split('\n').filter((x) => x.trim() !== '');
  if (lines.length === 0) return out;
  // First line is the big one ("20%"), later lines are smaller ("OFF").
  const weights = lines.map((_, i) => (i === 0 ? 1 : 0.5));
  const total = weights.reduce((a, b) => a + b, 0);
  let size = (ih / total) * 0.95;
  const widthAt = (s: number) => Math.max(...lines.map((t, i) => shaper.measure(t, l.font, l.weight, s * weights[i])));
  while (size > 6 && widthAt(size) > iw) size *= 0.95;
  const cap = shaper.capHeight(l.font, l.weight);
  const blockH = lines.reduce((a, _, i) => a + size * weights[i] * 1.0, 0);
  let y = l.h / 2 - blockH / 2;
  let path = '';
  lines.forEach((t, i) => {
    const s = size * weights[i];
    const w = shaper.measure(t, l.font, l.weight, s);
    const x = l.w / 2 - w / 2 + (inner.dx ?? 0) * l.w;
    path += shaper.line(t, l.font, l.weight, s, 0, x, y + s / 2 + (cap * s) / 2).d;
    y += s;
  });
  if (path) out.push(h('path', { d: path, fill: l.color }));
  return out;
}

function iconNode(l: IconLayer, defs: Defs): VNode[] {
  const s = Math.min(l.w, l.h);
  const g = iconGlyph(l.icon, (l.w - s) / 2, (l.h - s) / 2, s, l.color);
  if (l.shadow && l.shadow.alpha > 0) g.a = { ...g.a, filter: shadowFilter(l.shadow, defs) };
  return [g];
}

function characterNode(l: CharacterLayer, defs: Defs): VNode[] {
  const s = Math.min(l.w / l.vw, l.h / l.vh);
  const ox = (l.w - l.vw * s) / 2;
  const oy = l.h - l.vh * s;
  const flip = l.flipX ? ` translate(${r(l.vw)} 0) scale(-1 1)` : '';
  const filter = l.shadow && l.shadow.alpha > 0 ? shadowFilter(l.shadow, defs) : undefined;
  return [h('g', { transform: `translate(${r(ox)} ${r(oy)}) scale(${r(s * 10000) / 10000})${flip}`, filter }, undefined, { raw: l.svg })];
}

export function layerNodes(l: Layer, shaper: StudioShaper, defs: Defs, opts: SceneOptions): VNode[] {
  switch (l.kind) {
    case 'text':
      return textNode(l, shaper, defs);
    case 'image':
      return imageNode(l, defs, opts);
    case 'shape':
      return shapeNode(l, defs);
    case 'qr':
      return qrNode(l, defs, opts);
    case 'chip':
      return chipNode(l, shaper, defs);
    case 'badge':
      return badgeNode(l, shaper, defs);
    case 'icon':
      return iconNode(l, defs);
    case 'character':
      return characterNode(l, defs);
  }
}

export function layerTransform(l: Pick<Layer, 'x' | 'y' | 'w' | 'h' | 'rot'>): string {
  if (!l.rot) return `translate(${r(l.x)} ${r(l.y)})`;
  return `translate(${r(l.x + l.w / 2)} ${r(l.y + l.h / 2)}) rotate(${r(l.rot)}) translate(${r(-l.w / 2)} ${r(-l.h / 2)})`;
}

/** The whole picture. */
export function buildScene(doc: StudioDoc, shaper: StudioShaper, opts: SceneOptions = {}): VNode {
  const defs = new Defs(opts.idPrefix ?? 's');
  const body: VNode[] = [];
  body.push(h('rect', { x: 0, y: 0, width: doc.width, height: doc.height, fill: paint(doc.background, defs, { x: 0, y: 0, w: doc.width, h: doc.height }) }));
  const tags: VNode[] = [];
  for (const l of doc.layers) {
    if (l.hidden || opts.skip?.has(l.id)) continue;
    let kids: VNode[];
    defs.enter(l.id);
    try {
      kids = layerNodes(l, shaper, defs, opts);
    } catch {
      kids = [];
    }
    body.push(h('g', { transform: layerTransform(l), opacity: l.opacity < 1 ? r(l.opacity) : undefined, 'data-layer': l.id } as VNode['a'], kids, { k: l.id }));
    // A realistic AI person always shows its tag: drawn last, whole (never faded, clipped or covered by another layer).
    if (l.kind === 'image' && l.ai) {
      try {
        tags.push(h('g', { transform: layerTransform(l), 'data-ai-tag': l.id } as VNode['a'], aiTagNodes(l, shaper), { k: `ai-${l.id}` }));
      } catch {
        /* the picture still draws */
      }
    }
  }
  body.push(...tags);
  return h('svg', { width: doc.width, height: doc.height, viewBox: `0 0 ${doc.width} ${doc.height}` }, [h('defs', {}, defs.items), ...body]);
}

/** Text the picture shows, by layer (for the fact check and the "words on the picture" list). */
export function docTexts(doc: StudioDoc): { id: string; role?: string; text: string }[] {
  const out: { id: string; role?: string; text: string }[] = [];
  for (const l of doc.layers) {
    if (l.hidden) continue;
    if (l.kind === 'text' || l.kind === 'badge' || l.kind === 'chip') if (l.text.trim()) out.push({ id: l.id, role: l.role, text: l.text });
  }
  return out;
}

/** Contrast of a text layer's colour against the canvas background (a quick check for the design hints). */
export function roughContrast(doc: StudioDoc, l: TextLayer): number {
  return contrast(paintColor(l.fill), paintColor(doc.background));
}

export { rng };
