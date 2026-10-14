// Text logo (C-19, PRD v3 §6 "No logo"): the business name set in the kit's headline font, with a
// short accent rule. Used inside designs when there is no logo image, and exported for the Brand
// page (textLogoSvg / textLogoPng).

import { Resvg } from '@resvg/resvg-js';
import { fitText, initShaping, type Box } from '@/lib/render';
import { baselineOffset } from '@/lib/render/layout';
import { shapeText, shapedToSvg, type Dir, type FaceId } from '@/lib/render/shape';
import { chooseFill, chooseInk } from './colors';
import { rr } from './core';
import type { BrandKit } from './types';

export interface TextLogoDraw {
  svg: string;
  lines: Box[];
  size: number;
  truncated: boolean;
  /** Width of the widest line. */
  width: number;
}

/**
 * Draw `name` inside `box`, left aligned (right aligned for rtl), in 1 or 2 lines, shrinking from
 * `max` to `min` px. An accent rule sits under the name when there is room. `ink` and `accent` are
 * already checked against the surface by the caller.
 */
export function drawTextLogo(
  name: string,
  box: Box,
  o: { face: FaceId; ink: string; accent: string | null; max: number; min: number; lines: number; dir: Dir; align?: 'left' | 'center' },
): TextLogoDraw | null {
  const text = name.trim();
  if (!text) return null;
  const weight = 800 as const;
  const lh = 1.2;
  const rule = o.accent ? 12 : 0;
  const fit = fitText(text, { weight, boxW: box.w, boxH: Math.max(0, box.h - rule), maxSize: o.max, minSize: o.min, maxLines: o.lines, lineHeight: lh, dir: o.dir, face: o.face });
  if (!fit.lines.length) return null;
  const rtl = o.dir === 'rtl';
  const widest = Math.max(...fit.lines.map((l) => l.width));
  const totalH = fit.height + rule;
  const y0 = box.y + (box.h - totalH) / 2;
  const base = baselineOffset(weight, fit.size, fit.lineHeightPx);
  let svg = '';
  const lines: Box[] = [];
  const xFor = (w: number) => (o.align === 'center' ? box.x + (box.w - w) / 2 : rtl ? box.x + box.w - w : box.x);
  fit.lines.forEach((l, i) => {
    const x = xFor(l.width);
    const y = y0 + i * fit.lineHeightPx;
    lines.push({ x, y, w: l.width, h: fit.lineHeightPx });
    svg += shapedToSvg(shapeText(l.text, weight, o.dir, o.face), x, y + base, fit.size, o.ink);
  });
  if (o.accent) {
    const rx = xFor(Math.min(widest, 56));
    svg += `<rect x="${rr(rx)}" y="${rr(y0 + fit.height + 2)}" width="${rr(Math.min(widest, 56))}" height="6" rx="3" fill="${o.accent}"/>`;
  }
  return { svg, lines, size: fit.size, truncated: fit.truncated, width: widest };
}

export interface TextLogoOptions {
  width?: number;
  height?: number;
  /** Colour behind the logo, to pick readable ink. Default: transparent (ink chosen against white). */
  background?: string;
  dir?: Dir;
}

/** A standalone SVG text logo for the business name in the kit's headline font and brand colours. */
export async function textLogoSvg(name: string, kit: BrandKit, opts: TextLogoOptions = {}): Promise<string> {
  await initShaping();
  const width = opts.width ?? 640;
  const height = opts.height ?? 240;
  const bg = opts.background ?? '#ffffff';
  const k = kit.colors;
  const { ink } = chooseInk([bg], [k.primary, k.secondary, k.accent]);
  const accent = chooseFill([bg], [k.accent, k.secondary, k.primary], 1.8);
  const draw = drawTextLogo(name, { x: 24, y: 16, w: width - 48, h: height - 32 }, {
    face: kit.fonts.headline,
    ink,
    accent,
    max: Math.round(height * 0.34),
    min: 20,
    lines: 2,
    dir: opts.dir ?? 'ltr',
    align: 'center',
  });
  const back = opts.background ? `<rect width="${width}" height="${height}" fill="${opts.background}"/>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${back}${draw?.svg ?? ''}</svg>`;
}

/** The same logo as a PNG (transparent unless a background colour is given). */
export async function textLogoPng(name: string, kit: BrandKit, opts: TextLogoOptions = {}): Promise<Buffer> {
  const svg = await textLogoSvg(name, kit, opts);
  return Buffer.from(new Resvg(svg, { font: { loadSystemFonts: false }, fitTo: { mode: 'original' } }).render().asPng());
}
