// Small contact icons drawn by code (a coloured disc with a simple glyph). Plain paths in a 24 x 24
// box, stroked or filled; no icon font and no external artwork.

import type { BlockKey } from '@/lib/briefs/types';
import { rr } from './core';

const S = (d: string) => `<path d="${d}" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`;

/** Glyphs in a 24 x 24 box. "stroke" glyphs use the ink as stroke; "fill" glyphs use it as fill. */
const GLYPH: Record<BlockKey, { mode: 'stroke' | 'fill'; svg: string }> = {
  logo: { mode: 'fill', svg: '<circle cx="12" cy="12" r="4"/>' },
  phone: { mode: 'stroke', svg: S('M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A15 15 0 0 1 3 6a2 2 0 0 1 2-2z') },
  whatsapp: {
    mode: 'stroke',
    svg: S('M4 20l1.3-4.2A8 8 0 1 1 8.2 18.7z') + S('M9 9c0 3 3 6 6 6l1-2-2-1-1 .8c-1-.5-1.8-1.3-2.3-2.3l.8-1-1-2z'),
  },
  website: {
    mode: 'stroke',
    svg: '<circle cx="12" cy="12" r="9" fill="none" stroke-width="2"/>' + S('M3 12h18') + S('M12 3c3 3 3 15 0 18c-3-3-3-15 0-18z'),
  },
  email: { mode: 'stroke', svg: '<rect x="3" y="5" width="18" height="14" rx="2" fill="none" stroke-width="2"/>' + S('M4 7l8 6l8-6') },
  address: { mode: 'stroke', svg: S('M12 21s-6.5-5.7-6.5-11a6.5 6.5 0 0 1 13 0c0 5.3-6.5 11-6.5 11z') + '<circle cx="12" cy="10" r="2.4" fill="none" stroke-width="2"/>' },
  hours: { mode: 'stroke', svg: '<circle cx="12" cy="12" r="9" fill="none" stroke-width="2"/>' + S('M12 7v5.5l3.5 2') },
  dates: { mode: 'stroke', svg: '<rect x="3.5" y="5" width="17" height="15" rx="2" fill="none" stroke-width="2"/>' + S('M3.5 10h17M8 3v4M16 3v4') },
  instagram: {
    mode: 'stroke',
    svg: '<rect x="3.5" y="3.5" width="17" height="17" rx="5" fill="none" stroke-width="2"/><circle cx="12" cy="12" r="4" fill="none" stroke-width="2"/><circle cx="17" cy="7" r="1.2" fill="@INK@" stroke="none"/>',
  },
  youtube: { mode: 'fill', svg: '<path d="M21.6 7.2a2.6 2.6 0 0 0-1.8-1.8C18.2 5 12 5 12 5s-6.2 0-7.8.4a2.6 2.6 0 0 0-1.8 1.8C2 8.8 2 12 2 12s0 3.2.4 4.8a2.6 2.6 0 0 0 1.8 1.8C5.8 19 12 19 12 19s6.2 0 7.8-.4a2.6 2.6 0 0 0 1.8-1.8c.4-1.6.4-4.8.4-4.8s0-3.2-.4-4.8zM10 15V9l5.2 3z" fill-rule="evenodd"/>' },
  facebook: { mode: 'fill', svg: '<path d="M13.5 21v-8h2.7l.4-3.2h-3.1V7.8c0-.9.3-1.5 1.6-1.5h1.7V3.4A22 22 0 0 0 14.4 3c-2.4 0-4 1.5-4 4.1v2.7H7.8V13h2.6v8z"/>' },
};

/** A disc of `fill` with the glyph for `kind` in `ink`, centred at (cx, cy) with diameter d. */
export function contactIcon(kind: BlockKey, cx: number, cy: number, d: number, fill: string, ink: string): string {
  const g = GLYPH[kind] ?? GLYPH.logo;
  const glyphSize = d * 0.62;
  const k = glyphSize / 24;
  const attrs = g.mode === 'stroke' ? `stroke="${ink}" fill="none"` : `fill="${ink}"`;
  return (
    `<circle cx="${rr(cx)}" cy="${rr(cy)}" r="${rr(d / 2)}" fill="${fill}"/>` +
    `<g transform="translate(${rr(cx - glyphSize / 2)} ${rr(cy - glyphSize / 2)}) scale(${rr(k * 1000) / 1000})" ${attrs}>${g.svg.replace(/@INK@/g, ink)}</g>`
  );
}
