// The starting designs ("options"): five different compositions made from the owner's details, the brand's colours
// and fonts, and the photo. Every word comes from the details; templates only decide where things go and how they look.
// Pure: runs in the browser (instant options while editing) and on the server (a plan's days).

import { contrast, hslOf, inkOn, mix } from './color';
import { FONT_PAIRS, fontOf } from './fonts';
import { CONTACT_ICON } from './icons';
import { CURATED, brandPalettes, legibleOn, photoPalettes, type StudioPalette } from './palette';
import { chipWidth, layoutText, textHeight } from './scene';
import type { StudioShaper } from './shaper';
import {
  STORY_SAFE,
  STUDIO_SIZE,
  newId,
  solid,
  type BadgeLayer,
  type ChipLayer,
  type ImageLayer,
  type Layer,
  type Paint,
  type QrLayer,
  type ShapeLayer,
  type StudioDoc,
  type StudioFace,
  type StudioFormat,
  type StudioInput,
  type TextLayer,
} from './types';

export const TEMPLATE_IDS = ['burst', 'hero', 'arch', 'card', 'pop'] as const;
export type TemplateId = (typeof TEMPLATE_IDS)[number];
export const TEMPLATE_LABEL: Record<TemplateId, string> = { burst: 'Big offer', hero: 'Photo hero', arch: 'Elegant arch', card: 'Clean card', pop: 'Playful pop' };

export interface Look {
  palette: StudioPalette;
  fonts: { display: string; displayWeight: number; body: string; id: string };
}

interface Ctx {
  W: number;
  H: number;
  format: StudioFormat;
  P: StudioPalette;
  F: Look['fonts'];
  in: StudioInput;
  sh: StudioShaper;
  /** Top and bottom of the area words may use. */
  top: number;
  bottom: number;
  m: number;
}

const DEVA = /[ऀ-ॿ]/;

// ---------------------------------------------------------------------------------------------
// Layer helpers
// ---------------------------------------------------------------------------------------------

function text(c: Ctx, p: Partial<TextLayer> & Pick<TextLayer, 'text' | 'x' | 'y' | 'w'>): TextLayer {
  const l: TextLayer = {
    id: newId(),
    kind: 'text',
    name: p.name ?? 'Text',
    h: 100,
    rot: 0,
    opacity: 1,
    font: c.F.body,
    weight: 500,
    size: 36,
    lineHeight: 1.2,
    tracking: 0,
    align: 'left',
    fill: solid(c.P.ink),
    ...p,
  } as TextLayer;
  if (!l.autoFit) l.h = textHeight(l, c.sh);
  return l;
}

function badge(c: Ctx, p: Partial<BadgeLayer> & Pick<BadgeLayer, 'text' | 'x' | 'y' | 'w' | 'h'>): BadgeLayer {
  // Script faces read badly in a sticker: use the body face, heavy.
  const script = fontOf(c.F.display).group === 'Handwritten';
  return { id: newId(), kind: 'badge', name: 'Offer badge', role: 'offer', rot: 0, opacity: 1, shape: 'burst', fill: solid(c.P.accent), font: script ? c.F.body : c.F.display, weight: script ? 800 : c.F.displayWeight, color: c.P.onAccent, ...p } as BadgeLayer;
}

function shape(p: Partial<ShapeLayer> & Pick<ShapeLayer, 'shape' | 'x' | 'y' | 'w' | 'h' | 'fill'>): ShapeLayer {
  return { id: newId(), kind: 'shape', name: 'Shape', role: 'decor', rot: 0, opacity: 1, ...p } as ShapeLayer;
}

function photo(c: Ctx, p: Partial<ImageLayer> & Pick<ImageLayer, 'x' | 'y' | 'w' | 'h'>, cutout = false): ImageLayer | null {
  const ph = c.in.photo;
  if (!ph) return null;
  const cut = cutout && ph.cutout ? ph.cutout : null;
  return {
    id: newId(),
    kind: 'image',
    name: cut ? 'Photo (cut-out)' : 'Photo',
    role: 'photo',
    rot: 0,
    opacity: 1,
    src: cut ? cut.src : ph.src,
    natW: cut ? cut.w : ph.w,
    natH: cut ? cut.h : ph.h,
    fit: cut ? 'contain' : 'cover',
    fx: ph.focus?.x ?? 0.5,
    fy: ph.focus?.y ?? 0.5,
    zoom: 1,
    mask: cut ? 'none' : 'rounded',
    radius: 0,
    asset: cut ? 'cutout' : 'photo',
    photoId: ph.id,
    ...p,
  } as ImageLayer;
}

/** "20% OFF" -> "20%\nOFF" for a badge (number big, the rest small). */
export function offerBadgeText(offer: string): string {
  const o = offer.trim();
  const m = /^([^\s]*\d[^\s]*)\s+(.+)$/.exec(o);
  if (m) return `${m[1]}\n${m[2]}`;
  const words = o.split(/\s+/);
  if (words.length >= 3) return `${words.slice(0, Math.ceil(words.length / 2)).join(' ')}\n${words.slice(Math.ceil(words.length / 2)).join(' ')}`;
  return o;
}

/** Contact chips laid out in rows inside maxW; returns the layers and the height used. */
function chips(c: Ctx, x: number, y: number, maxW: number, look: { style: ChipLayer['style']; bg: string; color: string; accent: string; align?: 'left' | 'center' }, size = 30): { layers: ChipLayer[]; height: number } {
  const list = c.in.content.contacts.slice(0, 3);
  const hh = Math.round(size * 1.9);
  const gap = 16;
  const out: ChipLayer[] = [];
  const rows: ChipLayer[][] = [[]];
  let cx = 0;
  for (const ct of list) {
    const l: ChipLayer = {
      id: newId(),
      kind: 'chip',
      name: ct.kind[0].toUpperCase() + ct.kind.slice(1),
      role: 'contact',
      contact: ct.kind,
      icon: CONTACT_ICON[ct.kind] ?? 'link',
      text: ct.text,
      font: c.F.body,
      weight: 600,
      size,
      color: look.color,
      accent: look.accent,
      bg: look.bg,
      style: look.style,
      x: 0,
      y: 0,
      w: 100,
      h: hh,
      rot: 0,
      opacity: 1,
    };
    l.w = Math.min(maxW, chipWidth(l, c.sh));
    if (cx > 0 && cx + l.w > maxW) {
      rows.push([]);
      cx = 0;
    }
    rows[rows.length - 1].push(l);
    cx += l.w + gap;
  }
  let yy = y;
  for (const row of rows) {
    if (row.length === 0) continue;
    const total = row.reduce((a, l) => a + l.w, 0) + gap * (row.length - 1);
    let xx = look.align === 'center' ? x + (maxW - total) / 2 : x;
    for (const l of row) {
      l.x = xx;
      l.y = yy;
      xx += l.w + gap;
      out.push(l);
    }
    yy += hh + 12;
  }
  return { layers: out, height: out.length ? yy - y - 12 : 0 };
}

function qr(c: Ctx, x: number, y: number, size: number, fg = '#111111', bg = '#FFFFFF'): QrLayer | null {
  const q = c.in.content.qr;
  if (!q) return null;
  return { id: newId(), kind: 'qr', name: 'QR code', role: 'qr', source: 'brief', data: q.data, fg, bg, plate: true, radius: 18, x, y, w: size, h: size, rot: 0, opacity: 1 };
}

export function qrLabel(c: Ctx, x: number, y: number, w: number, color: string, align: TextLayer['align'] = 'center'): TextLayer | null {
  const q = c.in.content.qr;
  if (!q || !q.label) return null;
  return text(c, { name: 'QR label', role: 'qrLabel', text: q.label, x, y, w, size: 24, weight: 600, align, fill: solid(color) });
}

/** The logo picture, or the brand name as words. */
function brandMark(c: Ctx, x: number, y: number, maxW: number, maxH: number, color: string, align: TextLayer['align'] = 'left'): Layer {
  const logo = c.in.brand.logo;
  if (logo) {
    const s = Math.min(maxW / logo.w, maxH / logo.h);
    const w = logo.w * s;
    const ax = align === 'center' ? x + (maxW - w) / 2 : align === 'right' ? x + maxW - w : x;
    return { id: newId(), kind: 'image', name: 'Logo', role: 'logo', asset: 'logo', src: logo.src, natW: logo.w, natH: logo.h, fit: 'contain', fx: 0.5, fy: 0.5, zoom: 1, mask: 'none', radius: 0, x: ax, y, w, h: logo.h * s, rot: 0, opacity: 1 };
  }
  return text(c, { name: 'Brand name', role: 'brand', text: c.in.content.brandName, x, y, w: maxW, size: Math.min(40, maxH * 0.7), weight: 800, font: c.F.body, tracking: 60, upper: true, align, fill: solid(color) });
}

// ---------------------------------------------------------------------------------------------
// The brand's face or mascot: one layer, placed where there is room
// ---------------------------------------------------------------------------------------------

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const overlap = (a: Rect, b: Rect) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
const inflate = (r: Rect, g: number): Rect => ({ x: r.x - g, y: r.y - g, w: r.w + g * 2, h: r.h + g * 2 });

/** The box a layer covers on the poster (a turned layer's box is widened to hold it). */
function boundsOf(l: { x: number; y: number; w: number; h: number; rot: number }): Rect {
  if (!l.rot) return { x: l.x, y: l.y, w: l.w, h: l.h };
  const a = (l.rot * Math.PI) / 180;
  const w = Math.abs(l.w * Math.cos(a)) + Math.abs(l.h * Math.sin(a));
  const h = Math.abs(l.w * Math.sin(a)) + Math.abs(l.h * Math.cos(a));
  return { x: l.x + l.w / 2 - w / 2, y: l.y + l.h / 2 - h / 2, w, h };
}

/** Where the words of a text layer really are (not the whole box they may sit in). */
function inkOf(c: Ctx, l: TextLayer): Rect {
  const lay = layoutText(l, c.sh);
  const padX = l.bg?.padX ?? 0;
  const padY = l.bg?.padY ?? 0;
  const top = l.y + (l.valign === 'middle' ? (l.h - lay.blockH) / 2 : l.valign === 'bottom' ? l.h - lay.blockH : 0);
  const left = l.align === 'center' ? l.x + (l.w - lay.width) / 2 : l.align === 'right' ? l.x + l.w - lay.width : l.x;
  return { x: left - padX, y: top - padY, w: lay.width + padX * 2, h: lay.blockH + padY * 2 };
}

interface MascotSource {
  /** Width over height of the picture. */
  ar: number;
  make(x: number, y: number, w: number, h: number, flipX: boolean): Layer;
}

/** The brand's pose-image face (a picture layer) or the kit's drawn character; null when the brand has neither on this post. */
function mascotSource(c: Ctx): MascotSource | null {
  const f = c.in.brand.face;
  if (f) {
    const pose = f.poses[f.pose] ?? f.poses.wave ?? Object.values(f.poses)[0];
    if (pose) return { ar: pose.w / pose.h, make: (x, y, w, h, flipX) => faceLayer(f, pose, { x, y, w, h }, flipX) };
  }
  const ch = c.in.brand.character;
  if (ch) {
    return {
      ar: ch.vw / ch.vh,
      make: (x, y, w, h, flipX) => ({ id: newId(), kind: 'character', name: 'Mascot', role: 'character', svg: ch.svg, vw: ch.vw, vh: ch.vh, x, y, w, h, rot: 0, opacity: 1, flipX, shadow: { color: '#000000', alpha: 0.18, blur: 24, dx: 0, dy: 10 } }),
    };
  }
  return null;
}

/** A pose image of the brand's face as a picture layer (transparent, whole, never cropped). */
export function faceLayer(face: Pick<StudioFace, 'name' | 'ai'>, pose: { src: string; w: number; h: number }, box: Rect, flipX = false): ImageLayer {
  return {
    id: newId(),
    kind: 'image',
    name: face.name.trim() || 'Brand face',
    role: 'character',
    asset: 'face',
    ...(face.ai ? { ai: true } : {}),
    src: pose.src,
    natW: pose.w,
    natH: pose.h,
    fit: 'contain',
    fx: 0.5,
    fy: 0.5,
    zoom: 1,
    mask: 'none',
    radius: 0,
    x: box.x,
    y: box.y,
    w: box.w,
    h: box.h,
    rot: 0,
    opacity: 1,
    flipX,
    shadow: { color: '#000000', alpha: 0.2, blur: 24, dx: 0, dy: 10 },
  };
}

/**
 * Puts the face (or mascot) on the poster: the biggest size, from 42% of the height down to about 15% of the width,
 * that fits somewhere without touching words, contacts, a sticker, the QR code or the logo (it may overlap a photo a little),
 * standing low and near a side, turned to face the poster. Null when there is no room at any size.
 */
function placeMascot(c: Ctx, layers: Layer[]): Layer | null {
  const src = mascotSource(c);
  if (!src) return null;
  const { W, H } = c;
  const hard: Rect[] = [];
  const soft: Rect[] = [];
  for (const l of layers) {
    if (l.hidden) continue;
    if (l.kind === 'text') {
      if (l.text.trim()) hard.push(inkOf(c, l));
    } else if (l.kind === 'chip' || l.kind === 'badge' || l.kind === 'qr') hard.push(boundsOf(l));
    else if (l.kind === 'icon') {
      if (l.role !== 'decor') hard.push(boundsOf(l));
    } else if (l.kind === 'image') (l.role === 'photo' ? soft : hard).push(boundsOf(l));
  }
  const vertical = c.format === 'vertical';
  const edge = c.m * 0.3;
  const area = { x0: edge, x1: W - edge, y0: vertical ? c.top : edge, y1: vertical ? c.bottom : H - edge };
  const ar = Math.min(2, Math.max(0.3, src.ar));
  const hMax = Math.min(H * 0.42, (W * 0.4) / ar, W * 0.5);
  const hMin = W * 0.15;
  const step = 18;
  const walls = hard.map((r) => inflate(r, 16));
  for (let fh = hMax; fh >= hMin; fh *= 0.94) {
    const fw = fh * ar;
    if (fw > area.x1 - area.x0 || fh > area.y1 - area.y0) continue;
    let best: { x: number; y: number; cost: number } | null = null;
    const ys: number[] = [];
    for (let y = area.y1 - fh; y >= area.y0; y -= step) ys.push(y);
    if (ys[ys.length - 1] !== area.y0) ys.push(area.y0);
    const xs: number[] = [];
    for (let x = area.x0; x <= area.x1 - fw; x += step) xs.push(x);
    xs.push(area.x1 - fw);
    for (const y of ys) {
      for (const x of xs) {
        const r = { x, y, w: fw, h: fh };
        if (walls.some((o) => overlap(r, o) > 0)) continue;
        const under = soft.reduce((a, o) => a + overlap(r, o), 0);
        if (under > 0.5 * fw * fh) continue;
        const cost = area.y1 - (y + fh) + Math.min(x - area.x0, area.x1 - (x + fw)) * 0.8 + (under / (fw * fh)) * 300;
        if (!best || cost < best.cost) best = { x, y, cost };
      }
    }
    if (best) return src.make(best.x, best.y, fw, fh, best.x + fw / 2 > W / 2);
  }
  return null;
}

const headlineOf = (c: Ctx) => c.in.content.headline.trim() || c.in.content.brandName;
const below = (l: { y: number; h: number }, gap: number) => l.y + l.h + gap;
const shadow = (alpha = 0.22, blur = 40, dy = 18) => ({ color: '#000000', alpha, blur, dx: 0, dy });

function ctaLayer(c: Ctx, x: number, y: number, w: number, bg: string, fg: string, align: TextLayer['align'] = 'left', size = 34): TextLayer | null {
  const t = c.in.content.cta.trim();
  if (!t) return null;
  const pad = size * 0.9;
  return text(c, { name: 'Button', role: 'cta', text: t, x: align === 'left' ? x + pad : x, y: y + size * 0.55, w: align === 'left' ? w - pad : w, size, weight: 700, font: c.F.body, align, fill: solid(fg), bg: { color: bg, padX: pad, padY: size * 0.55, radius: 200, mode: 'box' } });
}

/** Moves a CTA so its pill sits inside [y, ...] (the pill padding sits outside the text box). */
const ctaHeight = (l: TextLayer | null) => (l ? l.h + (l.bg?.padY ?? 0) * 2 : 0);

// ---------------------------------------------------------------------------------------------
// The five compositions
// ---------------------------------------------------------------------------------------------

function tBurst(c: Ctx): Layer[] {
  const { W, H, P, m } = c;
  const L: Layer[] = [];
  const vertical = c.format === 'vertical';
  const offer = c.in.content.offer.trim();
  L.push(shape({ name: 'Circle', shape: 'ellipse', x: W * 0.42, y: -H * 0.12, w: W * 0.85, h: W * 0.85, fill: solid(P.deco), opacity: 0.55 }));
  L.push(shape({ name: 'Dots', shape: 'dots', x: m * 0.5, y: H - W * 0.34, w: W * 0.3, h: W * 0.3, radius: 34, fill: solid(P.ink), opacity: 0.14 }));
  const mark = brandMark(c, m, c.top, W * 0.5, 70, P.ink);
  L.push(mark);
  const colW = vertical ? W - m * 2 : W * 0.56;
  const head = text(c, { name: 'Headline', role: 'headline', text: headlineOf(c), x: m, y: below(mark, vertical ? 60 : 44), w: colW, h: vertical ? 380 : H * 0.3, size: vertical ? 140 : 112, autoFit: true, font: c.F.display, weight: c.F.displayWeight, lineHeight: 1.02, fill: solid(P.ink), valign: 'top' });
  L.push(head);
  let y = below(head, 18);
  if (c.in.content.offerNote) {
    const note = text(c, { name: 'Offer details', role: 'date', text: c.in.content.offerNote, x: m, y, w: colW, size: 36, weight: 500, fill: solid(P.soft) });
    L.push(note);
    y = below(note, 30);
  }
  const cta = ctaLayer(c, m, y, colW, P.surface, P.surfaceInk);
  if (cta) {
    L.push(cta);
    y += ctaHeight(cta) + 30;
  }
  const bs = vertical ? W * 0.42 : W * 0.36;
  const badgeAt = vertical ? { x: W - bs - m * 0.3, y: y - 10 } : { x: W * 0.6, y: c.top + 30 };
  if (offer) L.push(badge(c, { text: offerBadgeText(offer), x: badgeAt.x, y: badgeAt.y, w: bs, h: bs, rot: -10, shadow: shadow(0.25, 30, 14), points: 18 }));
  // Bottom: contacts on the left, the photo bottom right.
  const ch = chips(c, m, 0, vertical ? W - m * 2 : W * 0.5, { style: 'pill', bg: P.surface, color: P.surfaceInk, accent: legibleOn(P.surface, P.primary, 2.2) });
  const chipsY = c.bottom - ch.height;
  ch.layers.forEach((l) => (l.y += chipsY));
  const ps = vertical ? Math.min(W * 0.74, chipsY - y - 60) : Math.min(W * 0.52, H - c.top - 300);
  const pr = photo(c, { x: W - ps - (vertical ? (W - ps) / 2 : m * 0.6), y: vertical ? chipsY - ps - 50 : H - ps - m * 0.7, w: ps, h: ps, mask: 'circle', border: { color: P.surface, width: 14 }, shadow: shadow(0.28, 50, 22) }, true);
  if (pr) {
    if (pr.asset === 'cutout') Object.assign(pr, { border: undefined, outline: { color: '#FFFFFF', width: 10 }, shadow: shadow(0.3, 30, 16) });
    L.splice(2, 0, pr);
  }
  if (!pr) {
    // No photo: the offer sticker takes the photo's place, big; with no offer either, a bold decoration does.
    const spot = { x: W - ps - (vertical ? (W - ps) / 2 : m * 0.6), y: vertical ? chipsY - ps - 50 : H - ps - m * 0.7 };
    const b = L.find((l): l is BadgeLayer => l.kind === 'badge');
    if (b) Object.assign(b, { x: spot.x, y: spot.y, w: ps, h: ps, rot: -8, points: 22 });
    else {
      L.splice(2, 0, shape({ name: 'Ring', shape: 'ring', x: spot.x, y: spot.y, w: ps, h: ps, fill: solid(P.accent), opacity: 0.9 }));
      L.push({ id: newId(), kind: 'icon', name: 'Sparkle', role: 'decor', icon: 'sparkle', color: P.accent, x: spot.x + ps * 0.28, y: spot.y + ps * 0.28, w: ps * 0.44, h: ps * 0.44, rot: 0, opacity: 1 });
    }
  }
  const q = qr(c, m, 0, vertical ? 220 : 180);
  if (q) {
    q.y = chipsY - q.h - 24;
    if (!vertical && pr && q.y < y) q.y = y;
    L.push(q);
  }
  L.push(...ch.layers);
  return L;
}

function tHero(c: Ctx): Layer[] {
  const { W, H, P, m } = c;
  const L: Layer[] = [];
  const vertical = c.format === 'vertical';
  const offer = c.in.content.offer.trim();
  const hasPhoto = !!c.in.photo;
  const ph = vertical ? H * 0.58 : H * 0.64;
  if (hasPhoto) {
    L.push(photo(c, { x: 0, y: 0, w: W, h: ph, mask: 'none', fade: { side: 'bottom', size: 0.42 } })!);
    L.push(shape({ name: 'Shade', shape: 'rect', x: 0, y: ph * 0.45, w: W, h: H - ph * 0.45, fill: { kind: 'linear', angle: 180, stops: [{ at: 0, color: P.bg, alpha: 0 }, { at: 0.55, color: P.bg, alpha: 0.85 }, { at: 1, color: P.bg, alpha: 1 }] } }));
  } else {
    L.push(shape({ name: 'Glow', shape: 'ellipse', x: -W * 0.3, y: -W * 0.35, w: W * 1.2, h: W * 1.2, fill: { kind: 'radial', cx: 0.5, cy: 0.5, r: 0.5, stops: [{ at: 0, color: P.primary, alpha: 0.85 }, { at: 1, color: P.primary, alpha: 0 }] } }));
    L.push(shape({ name: 'Halftone', shape: 'halftone', x: W * 0.45, y: c.top, w: W * 0.55, h: W * 0.5, radius: 40, fill: solid(P.ink), opacity: 0.12 }));
    if (offer) L.push(text(c, { name: 'Offer', role: 'offer', text: offer, x: m, y: c.top + 110, w: W - m * 2, h: vertical ? 560 : H * 0.36, size: 300, autoFit: true, font: c.F.display, weight: c.F.displayWeight, lineHeight: 0.95, fill: solid(legibleOn(P.bg, P.accent, 3)), valign: 'top' }));
  }
  const name = brandMark(c, m, c.top, W * 0.45, 64, P.ink);
  if (name.kind === 'text' && hasPhoto) Object.assign(name, { bg: { color: P.bg, alpha: 0.85, padX: 22, padY: 12, radius: 200, mode: 'box' }, x: m + 22, y: c.top + 12, size: 30 });
  L.push(name);
  if (offer && hasPhoto) L.push(badge(c, { shape: 'ribbon', text: offer, x: W - W * 0.46 - m * 0.5, y: c.top, w: W * 0.46, h: 110, rot: 0, shadow: shadow(0.25, 24, 10) }));
  // Words from the bottom up.
  const ch = chips(c, m, 0, W - m * 2 - (c.in.content.qr ? 210 : 0), { style: 'plain', bg: P.bg, color: P.ink, accent: legibleOn(P.bg, P.accent, 2.2) }, 30);
  let bottom = c.bottom - ch.height;
  ch.layers.forEach((l) => (l.y += bottom));
  const q = qr(c, W - m - 180, c.bottom - 180, 180);
  if (q) bottom = Math.min(bottom, q.y);
  bottom -= 34;
  const cta = ctaLayer(c, m, 0, W * 0.6, legibleOn(P.bg, P.accent, 1.5), inkOn(legibleOn(P.bg, P.accent, 1.5)));
  if (cta) {
    cta.y = bottom - ctaHeight(cta) + (cta.bg?.padY ?? 0);
    bottom -= ctaHeight(cta) + 28;
  }
  if (c.in.content.offerNote) {
    const note = text(c, { name: 'Offer details', role: 'date', text: c.in.content.offerNote, x: m, y: 0, w: W - m * 2, size: 38, weight: 500, fill: solid(P.soft) });
    note.y = bottom - note.h;
    bottom = note.y - 16;
    L.push(note);
  }
  const hh = vertical ? 420 : Math.min(H * 0.28, 300);
  L.push(text(c, { name: 'Headline', role: 'headline', text: headlineOf(c), x: m, y: bottom - hh, w: W - m * 2, h: hh, size: vertical ? 150 : 128, autoFit: true, font: c.F.display, weight: c.F.displayWeight, lineHeight: 1.0, fill: solid(P.ink), valign: 'bottom' }));
  if (cta) L.push(cta);
  if (q) L.push(q);
  L.push(...ch.layers);
  return L;
}

function tArch(c: Ctx): Layer[] {
  const { W, H, P, m } = c;
  const L: Layer[] = [];
  const vertical = c.format === 'vertical';
  const offer = c.in.content.offer.trim();
  const ax = vertical ? W * 0.15 : W * 0.5;
  const aw = vertical ? W * 0.7 : W * 0.44;
  const ay = vertical ? c.top + 90 : c.top - 10;
  const ah = vertical ? H * 0.25 : c.format === 'portrait' ? H * 0.6 : H * 0.62;
  L.push(shape({ name: 'Circle', shape: 'ellipse', x: ax - aw * 0.25, y: ay + ah * 0.45, w: aw * 0.75, h: aw * 0.75, fill: solid(P.deco), opacity: 0.9 }));
  L.push(shape({ name: 'Arch outline', shape: 'arch', x: ax + 22, y: ay - 22, w: aw, h: ah, fill: solid(P.bg), stroke: { color: P.primary, width: 4 } }));
  const pr = photo(c, { x: ax, y: ay, w: aw, h: ah, mask: 'arch', shadow: shadow(0.18, 40, 16) });
  if (pr) L.push(pr);
  else {
    L.push(shape({ name: 'Arch', shape: 'arch', x: ax, y: ay, w: aw, h: ah, fill: { kind: 'linear', angle: 160, stops: [{ at: 0, color: P.primary }, { at: 1, color: mix(P.primary, '#000000', 0.25) }] } }));
    if (offer) L.push(text(c, { name: 'Offer', role: 'offer', text: offerBadgeText(offer), x: ax + aw * 0.1, y: ay + ah * 0.3, w: aw * 0.8, h: ah * 0.55, size: 180, autoFit: true, align: 'center', valign: 'middle', font: c.F.display, weight: c.F.displayWeight, lineHeight: 0.95, fill: solid(P.onPrimary) }));
  }
  L.push(shape({ name: 'Squiggle', shape: 'squiggle', x: vertical ? W * 0.62 : W * 0.08, y: vertical ? ay - 70 : H - 150 - (c.in.content.contacts.length ? 90 : 0), w: 170, h: 40, fill: solid(P.accent), stroke: { color: P.accent, width: 7 }, seed: 2 }));
  const colX = vertical ? m : m;
  const colW = vertical ? W - m * 2 : W * 0.42;
  const align: TextLayer['align'] = vertical ? 'center' : 'left';
  let y = vertical ? below({ y: ay, h: ah }, 44) : c.top + 10;
  const mark = brandMark(c, colX, y, colW, 54, legibleOn(P.bg, P.primary, 3), align);
  if (mark.kind === 'text') Object.assign(mark, { size: 28, tracking: 240, weight: 700, h: textHeight({ ...(mark as TextLayer), size: 28, tracking: 240 }, c.sh) });
  L.push(mark);
  y = below(mark, 34);
  const head = text(c, { name: 'Headline', role: 'headline', text: headlineOf(c), x: colX, y, w: colW, h: vertical ? 210 : H * 0.3, size: vertical ? 100 : 92, autoFit: true, font: c.F.display, weight: c.F.displayWeight, lineHeight: 1.05, align, fill: solid(P.ink) });
  L.push(head);
  y = below(head, 26);
  if (offer && pr) {
    const o = text(c, { name: 'Offer', role: 'offer', text: offer, x: colX, y, w: colW, h: 120, size: 96, autoFit: true, font: c.F.display, weight: c.F.displayWeight, lineHeight: 1, align, fill: solid(legibleOn(P.bg, P.accent, 3)) });
    L.push(o);
    y = below(o, 18);
  }
  if (c.in.content.offerNote) {
    const n = text(c, { name: 'Offer details', role: 'date', text: c.in.content.offerNote, x: colX, y, w: colW, size: 32, weight: 500, align, fill: solid(P.soft) });
    L.push(n);
    y = below(n, 32);
  }
  const cta = ctaLayer(c, colX, y, colW, P.primary, P.onPrimary, align, 32);
  if (cta) L.push(cta);
  const ch = chips(c, m, 0, W - m * 2 - (c.in.content.qr && !vertical ? 0 : 0), { style: 'outline', bg: legibleOn(P.bg, P.primary, 2), color: P.ink, accent: P.primary, align: vertical ? 'center' : 'left' }, 28);
  const by = c.bottom - ch.height;
  ch.layers.forEach((l) => (l.y += by));
  L.push(...ch.layers);
  const q = qr(c, vertical ? W - m - 170 : colX, 0, 170);
  if (q) {
    q.y = by - q.h - 30;
    if (!vertical && cta) q.y = Math.max(q.y, cta.y + ctaHeight(cta) + 20);
    L.push(q);
  }
  return L;
}

function tCard(c: Ctx): Layer[] {
  const { W, H, P, m } = c;
  const L: Layer[] = [];
  const vertical = c.format === 'vertical';
  const offer = c.in.content.offer.trim();
  L.push(shape({ name: 'Blob', shape: 'blob', x: -W * 0.2, y: -W * 0.15, w: W * 0.6, h: W * 0.55, seed: 4, fill: solid(P.deco), opacity: 0.7 }));
  L.push(shape({ name: 'Blob', shape: 'blob', x: W * 0.65, y: H - W * 0.4, w: W * 0.55, h: W * 0.5, seed: 9, fill: solid(P.primary), opacity: 0.18 }));
  const ch = chips(c, m, 0, W - m * 2, { style: 'pill', bg: P.surface, color: P.surfaceInk, accent: P.primary, align: 'center' }, 28);
  const by = c.bottom - ch.height;
  ch.layers.forEach((l) => (l.y += by));
  const cx = m * 0.8;
  const cw = W - cx * 2;
  const cy = c.top - (vertical ? 0 : 20);
  const chh = (ch.height ? by - 36 : c.bottom) - cy;
  L.push(shape({ name: 'Card', role: 'decor', shape: 'rect', x: cx, y: cy, w: cw, h: chh, radius: 44, fill: solid(P.surface), shadow: shadow(0.16, 60, 24) }));
  const pad = 32;
  const photoH = chh * (vertical ? 0.52 : 0.5);
  const pr = photo(c, { x: cx + pad, y: cy + pad, w: cw - pad * 2, h: photoH, mask: 'rounded', radius: 30 });
  let y = cy + pad;
  if (pr) {
    L.push(pr);
    y += photoH + 34;
  } else {
    L.push(shape({ name: 'Panel', shape: 'rect', x: cx + pad, y: cy + pad, w: cw - pad * 2, h: photoH * 0.8, radius: 30, fill: { kind: 'linear', angle: 135, stops: [{ at: 0, color: P.primary }, { at: 1, color: mix(P.primary, P.accent, 0.35) }] } }));
    if (offer) L.push(text(c, { name: 'Offer', role: 'offer', text: offer, x: cx + pad * 2, y: cy + pad * 2, w: cw - pad * 4, h: photoH * 0.8 - pad * 2, size: 220, autoFit: true, align: 'center', valign: 'middle', font: c.F.display, weight: c.F.displayWeight, lineHeight: 0.95, fill: solid(P.onPrimary) }));
    y += photoH * 0.8 + 34;
  }
  if (offer && pr) {
    const bs = vertical ? 300 : 250;
    L.push(badge(c, { shape: 'stamp', text: offerBadgeText(offer), x: cx + cw - bs * 0.85, y: cy + pad + photoH - bs * 0.7, w: bs, h: bs, rot: 12, shadow: shadow(0.2, 24, 10) }));
  }
  const inner = cw - pad * 3;
  const mark = brandMark(c, cx + pad * 1.5, y, inner, 50, legibleOn(P.surface, P.primary, 3), 'center');
  if (mark.kind === 'text') Object.assign(mark, { size: 26, tracking: 200, h: textHeight({ ...(mark as TextLayer), size: 26, tracking: 200 }, c.sh) });
  L.push(mark);
  y = below(mark, 18);
  const q = qr(c, cx + cw - pad - 150, cy + chh - pad - 150, 150, '#111111', '#FFFFFF');
  const textW = q ? inner - 170 : inner;
  const remaining = cy + chh - pad - y;
  const head = text(c, { name: 'Headline', role: 'headline', text: headlineOf(c), x: cx + pad * 1.5, y, w: inner, h: Math.max(90, remaining * 0.5), size: vertical ? 120 : 80, autoFit: true, font: c.F.display, weight: c.F.displayWeight, lineHeight: 1.05, align: 'center', fill: solid(P.surfaceInk) });
  L.push(head);
  y = below(head, 14);
  if (c.in.content.offerNote) {
    const n = text(c, { name: 'Offer details', role: 'date', text: c.in.content.offerNote, x: cx + pad * 1.5, y, w: inner, size: 30, weight: 500, align: 'center', fill: solid(mix(P.surfaceInk, P.surface, 0.3)) });
    L.push(n);
    y = below(n, 26);
  }
  const cta = ctaLayer(c, cx + pad * 1.5, y, q ? textW : inner, P.primary, P.onPrimary, 'center', 30);
  if (cta) L.push(cta);
  if (q) L.push(q);
  L.push(...ch.layers);
  return L;
}

function tPop(c: Ctx): Layer[] {
  const { W, H, P, m } = c;
  const L: Layer[] = [];
  const vertical = c.format === 'vertical';
  const offer = c.in.content.offer.trim();
  L.push(shape({ name: 'Halftone', shape: 'halftone', x: 0, y: 0, w: W * 0.45, h: W * 0.45, radius: 38, fill: solid(P.ink), opacity: 0.1 }));
  const mark = brandMark(c, m, c.top, W - m * 2, 60, P.ink, 'center');
  L.push(mark);
  const head = text(c, { name: 'Headline', role: 'headline', text: headlineOf(c), x: m, y: below(mark, 24), w: W - m * 2, h: vertical ? 360 : H * 0.16, size: vertical ? 140 : 96, autoFit: true, font: c.F.display, weight: c.F.displayWeight, lineHeight: 1.08, align: 'center', fill: solid(P.ink), shadow: { color: mix(P.bg, '#000000', 0.5), alpha: 0.25, blur: 0, dx: 0, dy: 6 } });
  L.push(head);
  const ch = chips(c, m, 0, W - m * 2, { style: 'pill', bg: P.surface, color: P.surfaceInk, accent: P.primary, align: 'center' }, 28);
  const by = c.bottom - ch.height;
  ch.layers.forEach((l) => (l.y += by));
  const y = below(head, 20);
  let note: TextLayer | null = null;
  if (c.in.content.offerNote) {
    note = text(c, { name: 'Offer details', role: 'date', text: c.in.content.offerNote, x: m, y: 0, w: W - m * 2, size: 32, weight: 600, align: 'center', fill: solid(P.ink) });
  }
  const cta = ctaLayer(c, m, 0, W - m * 2, P.primary, P.onPrimary, 'center', 30);
  let bottom = by - 30;
  if (cta) {
    cta.y = bottom - ctaHeight(cta) + (cta.bg?.padY ?? 0);
    bottom -= ctaHeight(cta) + 20;
  }
  if (note) {
    note.y = bottom - note.h;
    bottom = note.y - 20;
  }
  const area = bottom - y;
  const ps = Math.min(W * 0.66, area * 1.02);
  const px = (W - ps) / 2;
  L.push(shape({ name: 'Blob', shape: 'blob', x: px - ps * 0.12, y: y + (area - ps) / 2 - ps * 0.06, w: ps * 1.24, h: ps * 1.12, seed: 5, fill: solid(P.primary) }));
  L.push(shape({ name: 'Blob', shape: 'blob', x: px + ps * 0.55, y: y + (area - ps) / 2 - ps * 0.12, w: ps * 0.6, h: ps * 0.55, seed: 11, fill: solid(P.deco), opacity: 0.9 }));
  const pr = photo(c, { x: px, y: y + (area - ps) / 2, w: ps, h: ps, mask: 'blob', border: { color: '#FFFFFF', width: 12 }, shadow: shadow(0.22, 36, 16) }, true);
  if (pr) {
    if (pr.asset === 'cutout') Object.assign(pr, { border: undefined, outline: { color: '#FFFFFF', width: 12 }, shadow: shadow(0.3, 30, 14) });
    L.push(pr);
  }
  L.push({ id: newId(), kind: 'icon', name: 'Sparkle', role: 'decor', icon: 'sparkle', color: legibleOn(P.bg, P.accent, 1.3), x: W - m - 90, y: y + 10, w: 90, h: 90, rot: 0, opacity: 1 });
  L.push({ id: newId(), kind: 'icon', name: 'Sparkle', role: 'decor', icon: 'sparkle', color: '#FFFFFF', x: m + 10, y: y + area * 0.62, w: 60, h: 60, rot: 0, opacity: 0.9 });
  if (offer) {
    const bs = !pr ? Math.min(W * 0.6, ps * 0.95) : vertical ? 330 : Math.min(280, ps * 0.5);
    L.push(badge(c, { shape: 'burst', text: offerBadgeText(offer), x: pr ? Math.min(W - bs - 10, px + ps * 0.82) : (W - bs) / 2, y: pr ? y + (area - ps) / 2 + ps * 0.08 : y + (area - bs) / 2, w: bs, h: bs, rot: -12, fill: solid(legibleOn(P.primary, P.accent, 1.4)), color: inkOn(legibleOn(P.primary, P.accent, 1.4)), shadow: shadow(0.25, 24, 12), points: 14 }));
  }
  if (note) L.push(note);
  if (cta) L.push(cta);
  const q = qr(c, W - m - 150, by - 170, 150);
  if (q && cta) {
    q.y = Math.min(q.y, (cta.y ?? 0) - 30 - 150);
  }
  if (q) L.push(q);
  L.push(...ch.layers);
  return L;
}

const BUILDERS: Record<TemplateId, (c: Ctx) => Layer[]> = { burst: tBurst, hero: tHero, arch: tArch, card: tCard, pop: tPop };

// ---------------------------------------------------------------------------------------------
// Looks and options
// ---------------------------------------------------------------------------------------------

/** Which palette and fonts each composition starts with. */
function defaultLooks(input: StudioInput): Record<TemplateId, Look> {
  const brand = brandPalettes(input.brand.colors);
  const fromPhoto = input.photo?.colors?.length ? photoPalettes(input.photo.colors, input.brand.colors.accent) : [];
  const deva = DEVA.test(`${input.content.headline} ${input.content.offer}`);
  const pair = (id: string) => {
    const p = FONT_PAIRS.find((x) => x.id === (deva ? 'desi' : id)) ?? FONT_PAIRS[0];
    return { id: p.id, display: p.display, displayWeight: p.displayWeight, body: p.body };
  };
  const byId = (id: string) => brand.find((p) => p.id === id) ?? CURATED[0];
  return {
    burst: { palette: byId('brand'), fonts: pair('loud') },
    hero: { palette: fromPhoto[0] ?? byId('dark'), fonts: pair('poster') },
    arch: { palette: fromPhoto[1] ?? byId('light'), fonts: pair('classy') },
    card: { palette: CURATED.find((p) => p.id === 'mint')!, fonts: pair('modern') },
    pop: { palette: byId('accent'), fonts: pair('sweet') },
  };
}

/** Every palette the "Colours" panel offers for this input. */
export function palettesFor(input: StudioInput): StudioPalette[] {
  const fromPhoto = input.photo?.colors?.length ? photoPalettes(input.photo.colors, input.brand.colors.accent) : [];
  return [...brandPalettes(input.brand.colors), ...fromPhoto, ...CURATED];
}

export function lookFor(input: StudioInput, template: TemplateId, paletteId?: string, fontsId?: string): Look {
  const base = defaultLooks(input)[template];
  const palette = paletteId ? (palettesFor(input).find((p) => p.id === paletteId) ?? base.palette) : base.palette;
  const p = fontsId ? FONT_PAIRS.find((x) => x.id === fontsId) : null;
  return { palette, fonts: p ? { id: p.id, display: p.display, displayWeight: p.displayWeight, body: p.body } : base.fonts };
}

function bgPaint(template: TemplateId, P: StudioPalette): Paint {
  switch (template) {
    case 'burst':
      return { kind: 'radial', cx: 0.8, cy: 0.15, r: 1.1, stops: [{ at: 0, color: P.bg2 }, { at: 1, color: P.bg }] };
    case 'card':
      return { kind: 'linear', angle: 160, stops: [{ at: 0, color: P.bg }, { at: 1, color: P.bg2 }] };
    case 'pop':
      return { kind: 'radial', cx: 0.5, cy: 0.45, r: 0.9, stops: [{ at: 0, color: P.bg2 }, { at: 1, color: P.bg }] };
    default:
      return solid(P.bg);
  }
}

export function buildTemplate(template: TemplateId, input: StudioInput, shaper: StudioShaper, look?: Look): StudioDoc {
  const { width: W, height: H } = STUDIO_SIZE[input.format];
  const lk = look ?? lookFor(input, template);
  const vertical = input.format === 'vertical';
  const m = 70;
  const c: Ctx = { W, H, format: input.format, P: lk.palette, F: lk.fonts, in: input, sh: shaper, m, top: vertical ? STORY_SAFE.top : m, bottom: vertical ? STORY_SAFE.bottom : H - m };
  const layers = BUILDERS[template](c).filter(Boolean);
  // The brand's face or mascot goes where there is room, in every design (never over words, contacts, QR or logo).
  const mascot = placeMascot(c, layers);
  if (mascot) layers.push(mascot);
  return { v: 1, format: input.format, width: W, height: H, background: bgPaint(template, lk.palette), layers, meta: { template, palette: lk.palette.id, fonts: lk.fonts.id } };
}

export interface StudioOption {
  id: string;
  label: string;
  doc: StudioDoc;
}

/** The five starting designs. `shuffle` > 0 gives other colours and fonts for the same compositions. */
export function buildOptions(input: StudioInput, shaper: StudioShaper, shuffle = 0): StudioOption[] {
  const palettes = palettesFor(input);
  return TEMPLATE_IDS.map((t, i) => {
    let look: Look | undefined;
    if (shuffle > 0) {
      const p = palettes[(i * 3 + shuffle * 2) % palettes.length];
      const f = FONT_PAIRS[(i + shuffle * 3) % FONT_PAIRS.length];
      const deva = DEVA.test(input.content.headline);
      look = { palette: p, fonts: deva ? lookFor(input, t).fonts : { id: f.id, display: f.display, displayWeight: f.displayWeight, body: f.body } };
    }
    return { id: `${t}-${shuffle}`, label: TEMPLATE_LABEL[t], doc: buildTemplate(t, input, shaper, look) };
  });
}

/** Every font the options use (to load before drawing). */
export function fontsInDoc(doc: StudioDoc): { font: string; weight: number }[] {
  const out = new Map<string, { font: string; weight: number }>();
  for (const l of doc.layers) {
    if (l.kind === 'text' || l.kind === 'chip' || l.kind === 'badge') out.set(`${l.font}|${l.weight}`, { font: l.font, weight: l.weight });
    // The "AI" tag of a realistic AI person is lettered in Poppins ExtraBold.
    if (l.kind === 'image' && l.ai && !l.hidden) out.set('poppins|800', { font: 'poppins', weight: 800 });
  }
  return [...out.values()];
}

export const _test = { offerBadgeText, contrast, hslOf, fontOf };
