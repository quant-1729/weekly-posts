import { Resvg } from '@resvg/resvg-js';
import { CHARACTER_ACTIONS, CHARACTER_IDS, type CharacterAction, type CharacterColors, type CharacterId } from '@/lib/characters';

export const IDS = CHARACTER_IDS as readonly CharacterId[];
export const ACTIONS = CHARACTER_ACTIONS as readonly CharacterAction[];
export const COLORS: CharacterColors = { accent: '#2BB5B0', accentDark: '#1A8C88' };
export const OTHER: CharacterColors = { accent: '#E4572E', accentDark: '#A93A1A' };

/** The canvas the characters share: viewBox -10 0 260 260. */
export const CANVAS = { x: -10, y: 0, w: 260, h: 260 };

export function wrapSvg(markup: string, viewBox = '-10 0 260 260'): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">${markup}</svg>`;
}

export interface Alpha {
  /** Pixel box with alpha at least `min`, in canvas units; null when nothing is drawn. */
  box: { x0: number; y0: number; x1: number; y1: number } | null;
  data: Buffer;
  width: number;
  height: number;
}

/**
 * Renders markup on a canvas padded by `pad` units on each side (so drawing outside the canvas shows up) at `px` pixels per unit,
 * and returns the box of pixels at least `min` (0-255) opaque, in canvas units.
 */
export function alphaBox(markup: string, opts: { pad?: number; px?: number; min?: number } = {}): Alpha {
  const pad = opts.pad ?? 60;
  const px = opts.px ?? 2;
  const min = opts.min ?? 40;
  const vb = `${CANVAS.x - pad} ${CANVAS.y - pad} ${CANVAS.w + 2 * pad} ${CANVAS.h + 2 * pad}`;
  const width = (CANVAS.w + 2 * pad) * px;
  const r = new Resvg(wrapSvg(markup, vb), { fitTo: { mode: 'width', value: width }, font: { loadSystemFonts: false } }).render();
  const data = Buffer.from(r.pixels);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let y = 0; y < r.height; y++) {
    for (let x = 0; x < r.width; x++) {
      if (data[(y * r.width + x) * 4 + 3] >= min) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  const u = (v: number, o: number) => v / px + o - pad;
  return {
    box: x1 < 0 ? null : { x0: u(x0, CANVAS.x), y0: u(y0, CANVAS.y), x1: u(x1 + 1, CANVAS.x), y1: u(y1 + 1, CANVAS.y) },
    data,
    width: r.width,
    height: r.height,
  };
}
