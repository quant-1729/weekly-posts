// Decorative motifs drawn by code (no AI, no images): circles, blobs, sparkles, borders, stripes,
// leaves. `under` is painted before panels and text; `over` (frames and borders, which live in the
// margin) after. Motifs use the palette's accent colours at low opacity so they never fight text.

import type { Box } from '@/lib/render';
import type { Palette } from './palette';
import { contrast, isDark, lum, mix, rng } from './colors';
import { blob, circle, diamond, leaf, star4 } from './shapes';
import { rr, type Cls, type DecoName } from './core';

export interface DecoGeom {
  W: number;
  H: number;
  cls: Cls;
  cb: Box;
  pal: Palette;
  seed: number;
  radius: number;
  /** Tone-on-tone colours that stay readable behind text (see toneTints); used by motifs that may sit under text. */
  tints: string[];
  /** Brand accent colours as they are; used by motifs that live in the margins. */
  raw: string[];
}

/** Opacity bound of the motifs that may sit behind text. */
export const UNDER_OPACITY = 0.4;

/**
 * Decoration colours for the page: each kit colour, shaded away from the ink's polarity until text
 * stays at 4.7:1 or better on it even at UNDER_OPACITY (lighter shades behind dark text, darker
 * behind light text), so a motif behind text never costs contrast. Falls back to a tint of the ink's opposite.
 */
export function toneTints(pal: Palette, inks: readonly string[]): { tints: string[]; raw: string[] } {
  const bg = pal.bg;
  const lightInk = inks.length ? lum(inks[0]) > lum(bg) : isDark(bg);
  const toward = lightInk ? '#000000' : '#ffffff';
  const okOn = (c: string) => inks.every((ink) => contrast(ink, mix(bg, c, UNDER_OPACITY)) >= 4.7);
  const raw = pal.accents.length ? pal.accents : [pal.dark];
  const tints: string[] = [];
  for (const c of raw) {
    let chosen: string | null = null;
    for (const t of [0, 0.15, 0.3, 0.45, 0.6, 0.8]) {
      const cand = mix(c, toward, t);
      if (contrast(cand, bg) >= 1.2 && okOn(cand)) {
        chosen = cand;
        break;
      }
    }
    if (chosen) tints.push(chosen);
  }
  if (!tints.length) tints.push(mix(bg, toward, 0.2), mix(bg, toward, 0.3));
  return { tints, raw };
}

const tintAt = (list: readonly string[], i: number) => list[i % list.length];

const minSide = (g: DecoGeom) => Math.min(g.W, g.H, 1100);

type Motif = (g: DecoGeom) => string;

const MOTIFS: Record<DecoName, { layer: 'under' | 'over'; draw: Motif }> = {
  circles: {
    layer: 'under',
    draw: (g) => {
      const m = minSide(g);
      return circle(g.W * 0.92, g.H * 0.1, m * 0.24, tintAt(g.tints, 1), 0.3) + circle(g.W * 0.07, g.H * 0.95, m * 0.2, tintAt(g.tints, 1), 0.3);
    },
  },
  softCircle: {
    layer: 'under',
    draw: (g) => {
      const m = minSide(g);
      return circle(g.W * 0.95, g.H * 0.05, m * 0.36, tintAt(g.tints, 0), 0.14) + circle(g.W * 0.02, g.H * 0.98, m * 0.22, tintAt(g.tints, 1), 0.1);
    },
  },
  accentBar: {
    layer: 'under',
    draw: (g) => {
      const c = tintAt(g.raw, 0);
      return `<rect x="${g.cb.x}" y="${rr(Math.max(14, g.cb.y - 30))}" width="${g.cls === 'tall' ? 150 : 110}" height="10" rx="5" fill="${c}"/>`;
    },
  },
  blobs: {
    layer: 'under',
    draw: (g) => {
      const m = minSide(g);
      return (
        blob(g.W * 0.96, g.H * 0.04, m * 0.3, 0.2, tintAt(g.tints, 0), 0.38) +
        blob(g.W * 0.03, g.H * 0.97, m * 0.26, 0.6, tintAt(g.tints, 1), 0.34) +
        blob(g.W * 0.99, g.H * 0.62, m * 0.12, 0.9, tintAt(g.tints, 2), 0.28)
      );
    },
  },
  confetti: {
    layer: 'under',
    draw: (g) => {
      const r = rng(g.seed + 7);
      const n = Math.round((g.W * g.H) / 42000);
      const keep: Box = { x: g.cb.x - 8, y: g.cb.y - 8, w: g.cb.w + 16, h: g.cb.h + 16 };
      let out = '';
      for (let i = 0; i < n * 3 && out.split('<').length < n + 1; i++) {
        const x = r() * g.W;
        const y = r() * g.H;
        if (x > keep.x && x < keep.x + keep.w && y > keep.y && y < keep.y + keep.h) continue;
        const c = tintAt(g.raw, Math.floor(r() * 3));
        const s = 6 + r() * 9;
        const k = Math.floor(r() * 3);
        const rot = Math.round(r() * 180);
        if (k === 0) out += circle(x, y, s, c, 0.75);
        else if (k === 1) out += `<rect transform="rotate(${rot} ${rr(x)} ${rr(y)})" x="${rr(x - s)}" y="${rr(y - s / 2)}" width="${rr(s * 2)}" height="${rr(s)}" rx="2" fill="${c}" fill-opacity="0.75"/>`;
        else out += `<path transform="rotate(${rot} ${rr(x)} ${rr(y)})" d="M${rr(x)} ${rr(y - s)} L${rr(x + s)} ${rr(y + s)} L${rr(x - s)} ${rr(y + s)} Z" fill="${c}" fill-opacity="0.75"/>`;
      }
      return out;
    },
  },
  sparkles: {
    layer: 'over',
    draw: (g) => {
      const r = rng(g.seed + 3);
      const c0 = tintAt(g.raw, 0);
      const c1 = isDark(g.pal.bg) ? g.pal.light : tintAt(g.raw, 1);
      let out = '';
      const spark = (x: number, y: number, s: number, i: number) => {
        out += star4(x, y, s, i % 2 ? c1 : c0, 0.95) + star4(x + s * 1.15, y + s * 0.8, s * 0.42, i % 2 ? c0 : c1, 0.9) + circle(x - s * 0.9, y + s * 1.1, 4, c0, 0.85);
      };
      if (g.cls === 'tall') {
        // The story format has free bands above and below the safe area.
        for (let i = 0; i < 5; i++) {
          spark(80 + r() * (g.W - 160), 40 + r() * 170, 22 + r() * 18, i);
          spark(80 + r() * (g.W - 160), g.H - 50 - r() * 250, 22 + r() * 18, i + 1);
        }
        return out;
      }
      // Other formats: small stars in the margins, on the edge midpoints.
      const k = g.cls === 'strip' ? 0.9 : 1;
      out += star4(g.W / 2, 24, 13 * k, c1, 0.95) + star4(g.W / 2, g.H - 24, 13 * k, c1, 0.95);
      out += star4(24, g.H / 2, 13 * k, c1, 0.95) + star4(g.W - 24, g.H / 2, 13 * k, c1, 0.95);
      return out;
    },
  },
  festiveBorder: {
    layer: 'over',
    draw: (g) => {
      const c = tintAt(g.raw, 0);
      const c2 = isDark(g.pal.bg) ? g.pal.light : tintAt(g.raw, 1);
      const a = 18;
      const b = 30;
      const { W, H } = g;
      let out = `<rect x="${a}" y="${a}" width="${W - 2 * a}" height="${H - 2 * a}" rx="${rr(g.radius * 0.5)}" fill="none" stroke="${c}" stroke-width="3"/>`;
      out += `<rect x="${b}" y="${b}" width="${W - 2 * b}" height="${H - 2 * b}" rx="${rr(g.radius * 0.35)}" fill="none" stroke="${c}" stroke-width="1.5" stroke-opacity="0.7"/>`;
      for (const [x, y] of [
        [b, b],
        [W - b, b],
        [b, H - b],
        [W - b, H - b],
      ]) {
        out += star4(x, y, 24, c, 1) + circle(x, y, 5, c2, 1);
      }
      // A chain of small diamonds along the top and bottom edges.
      const step = 36;
      for (let x = 90; x < W - 90; x += step) {
        out += diamond(x, a + 0.5 * (b - a) + 0, 3.2, c2, 0.85) + diamond(x, H - a - 0.5 * (b - a), 3.2, c2, 0.85);
      }
      return out;
    },
  },
  localBorder: {
    layer: 'over',
    draw: (g) => {
      const t = 36;
      const { W, H } = g;
      const base = g.pal.solid;
      const c1 = tintAt(g.raw, 0);
      const c2 = isDark(base) ? g.pal.light : g.pal.dark;
      let out = `<path fill-rule="evenodd" fill="${base}" d="M0 0H${W}V${H}H0Z M${t} ${t}V${H - t}H${W - t}V${t}Z"/>`;
      out += `<rect x="${t + 6}" y="${t + 6}" width="${W - 2 * t - 12}" height="${H - 2 * t - 12}" fill="none" stroke="${c1}" stroke-width="2"/>`;
      // Diamonds and dots along each edge.
      const row = (len: number, fixed: number, horizontal: boolean) => {
        let s = '';
        for (let p = t + 8, i = 0; p < len - t - 8; p += t * 0.9, i++) {
          const x = horizontal ? p : fixed;
          const y = horizontal ? fixed : p;
          s += i % 2 === 0 ? diamond(x, y, t * 0.3, c1, 1) : circle(x, y, t * 0.12, c2, 0.9);
        }
        return s;
      };
      out += row(W, t / 2, true) + row(W, H - t / 2, true) + row(H, t / 2, false) + row(H, W - t / 2, false);
      for (const [x, y] of [
        [t / 2, t / 2],
        [W - t / 2, t / 2],
        [t / 2, H - t / 2],
        [W - t / 2, H - t / 2],
      ]) {
        out += star4(x, y, t * 0.42, c1, 1);
      }
      return out;
    },
  },
  diagStripes: {
    layer: 'under',
    draw: (g) => {
      const m = minSide(g);
      const a = m * 0.15;
      const c0 = tintAt(g.raw, 0);
      const c1 = tintAt(g.raw, 1);
      const { W, H } = g;
      return (
        `<path d="M${W} 0 L${W - a * 1.6} 0 L${W} ${a * 1.6} Z" fill="${c0}" fill-opacity="0.9"/>` +
        `<path d="M${W} ${a * 1.9} L${W - a * 0.4} ${a * 1.9 + a * 0.4} L${W} ${a * 1.9 + a * 0.8} Z" fill="${c1}" fill-opacity="0.9"/>` +
        `<path d="M0 ${H} L${a * 1.6} ${H} L0 ${H - a * 1.6} Z" fill="${c0}" fill-opacity="0.9"/>` +
        `<path d="M${a * 1.9} ${H} L${a * 1.9 + a * 0.8} ${H} L${a * 1.9 + a * 0.4} ${H - a * 0.4} Z" fill="${c1}" fill-opacity="0.9"/>`
      );
    },
  },
  thinFrame: {
    layer: 'over',
    draw: (g) => {
      const c = tintAt(g.raw, 0);
      const { W, H } = g;
      const a = 26;
      const b = 40;
      const L = 76;
      let out = `<rect x="${a}" y="${a}" width="${W - 2 * a}" height="${H - 2 * a}" fill="none" stroke="${c}" stroke-width="2"/>`;
      out += `<rect x="${b}" y="${b}" width="${W - 2 * b}" height="${H - 2 * b}" fill="none" stroke="${c}" stroke-width="1" stroke-opacity="0.55"/>`;
      const br = (x: number, y: number, sx: number, sy: number) => `<path d="M${x} ${y + sy * L} V${y} H${x + sx * L}" fill="none" stroke="${c}" stroke-width="5" stroke-linecap="square"/>`;
      out += br(a, a, 1, 1) + br(W - a, a, -1, 1) + br(a, H - a, 1, -1) + br(W - a, H - a, -1, -1);
      return out;
    },
  },
  darkGlow: {
    layer: 'under',
    draw: (g) => {
      const c = tintAt(g.tints, 0);
      const m = minSide(g);
      return (
        `<defs><radialGradient id="glow" gradientUnits="userSpaceOnUse" cx="${rr(g.W * 0.92)}" cy="${rr(g.H * 0.08)}" r="${rr(m * 0.75)}"><stop offset="0" stop-color="${c}" stop-opacity="0.34"/><stop offset="1" stop-color="${c}" stop-opacity="0"/></radialGradient></defs>` +
        `<rect width="${g.W}" height="${g.H}" fill="url(#glow)"/>`
      );
    },
  },
  leaves: {
    layer: 'under',
    draw: (g) => {
      const m = minSide(g);
      const c0 = tintAt(g.tints, 0);
      const c1 = tintAt(g.tints, 1);
      const L = m * 0.3;
      let out = '';
      const top: [number, number, number][] = [
        [g.W * 1.0, g.H * 0.0, 140],
        [g.W * 1.0, g.H * 0.0, 118],
        [g.W * 1.0, g.H * 0.0, 162],
        [g.W * 1.0, g.H * 0.0, 98],
      ];
      top.forEach(([x, y, a], i) => (out += leaf(x, y, L * (1 - i * 0.12), a, i % 2 ? c1 : c0, 0.4)));
      const bot: [number, number, number][] = [
        [0, g.H, -40],
        [0, g.H, -62],
        [0, g.H, -18],
      ];
      bot.forEach(([x, y, a], i) => (out += leaf(x, y, L * (0.9 - i * 0.12), a, i % 2 ? c0 : c1, 0.36)));
      return out;
    },
  },
  dotGrid: {
    layer: 'under',
    draw: (g) => {
      const c = tintAt(g.raw, 0);
      let out = '';
      const step = g.cls === 'tall' ? 38 : 30;
      const x0 = g.W - 24 - step * 5;
      const y0 = g.cls === 'tall' ? 60 : 22;
      for (let i = 0; i < 6; i++) for (let j = 0; j < 3; j++) out += circle(x0 + i * step, y0 + j * step, 4.5, c, 0.55);
      return out;
    },
  },
  rules: {
    layer: 'over',
    draw: (g) => {
      const c = tintAt(g.raw, 0);
      const y1 = Math.max(18, g.cb.y - 26);
      const y2 = Math.min(g.H - 18, g.cb.y + g.cb.h + 26);
      const x1 = g.cb.x;
      const x2 = g.cb.x + g.cb.w;
      const mid = g.W / 2;
      return (
        `<path d="M${x1} ${y1}H${mid - 26}M${mid + 26} ${y1}H${x2}M${x1} ${y2}H${mid - 26}M${mid + 26} ${y2}H${x2}" stroke="${c}" stroke-width="1.5" fill="none"/>` +
        diamond(mid, y1, 7, c, 1) +
        diamond(mid, y2, 7, c, 1)
      );
    },
  },
};

export function decorate(names: readonly DecoName[], g: DecoGeom): { under: string; over: string } {
  let under = '';
  let over = '';
  for (const n of names) {
    const m = MOTIFS[n];
    if (!m) continue;
    if (m.layer === 'under') under += m.draw(g);
    else over += m.draw(g);
  }
  return { under, over };
}

/** Motifs that may sit behind text on the page (the tonal ones; borders, stars and corner shapes stay in the margins). */
const TONAL: readonly DecoName[] = ['circles', 'softCircle', 'blobs', 'leaves', 'darkGlow'];

export function decoUnderlapsText(names: readonly DecoName[]): boolean {
  return names.some((n) => TONAL.includes(n));
}

/** The colours a tonal motif can paint behind text, so ink is chosen to read on all of them. */
export function decoSurfaces(pal: Palette, names: readonly DecoName[], tints: readonly string[]): string[] {
  if (!decoUnderlapsText(names)) return [];
  return tints.map((c) => mix(pal.bg, c, UNDER_OPACITY));
}
