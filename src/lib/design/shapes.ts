// Panel and plate shapes drawn by code (no images): rounded rectangles and the bottom panel whose top
// edge can be straight, diagonal, wavy or arched.

import type { Box } from '@/lib/render';
import { rr, type Edge } from './core';

export function roundRect(b: Box, r: number, fill: string, extra = ''): string {
  return `<rect x="${rr(b.x)}" y="${rr(b.y)}" width="${rr(b.w)}" height="${rr(b.h)}" rx="${rr(r)}" fill="${fill}" ${extra}/>`;
}

/** How far a panel edge dips below its top line (the text zone starts below this). */
export function edgeRise(edge: Edge): number {
  return edge === 'straight' ? 0 : edge === 'diag' ? 90 : edge === 'wave' ? 64 : 120;
}

/** A panel from y = top to the bottom of the canvas, full width, with the chosen top edge. Rounded top corners when straight and r > 0. */
export function bottomPanel(W: number, H: number, top: number, edge: Edge, fill: string, r = 0, extra = ''): string {
  const rise = edgeRise(edge);
  let d: string;
  switch (edge) {
    case 'diag':
      d = `M0 ${top + rise} L${W} ${top} L${W} ${H} L0 ${H} Z`;
      break;
    case 'wave':
      d = `M0 ${top + rise} C${rr(W * 0.2)} ${top} ${rr(W * 0.4)} ${top} ${rr(W * 0.5)} ${top + rr(rise * 0.5)} S${rr(W * 0.8)} ${top + rise} ${W} ${top + rr(rise * 0.2)} L${W} ${H} L0 ${H} Z`;
      break;
    case 'arch':
      d = `M0 ${top + rise} Q${W / 2} ${top - rise} ${W} ${top + rise} L${W} ${H} L0 ${H} Z`;
      break;
    default:
      d = r > 0 ? `M0 ${top + r} Q0 ${top} ${r} ${top} L${W - r} ${top} Q${W} ${top} ${W} ${top + r} L${W} ${H} L0 ${H} Z` : `M0 ${top} L${W} ${top} L${W} ${H} L0 ${H} Z`;
  }
  return `<path d="${d}" fill="${fill}" ${extra}/>`;
}

/** A four-pointed star centred on (cx, cy). */
export function star4(cx: number, cy: number, r: number, fill: string, opacity = 1): string {
  const k = r * 0.28;
  const d = `M${rr(cx)} ${rr(cy - r)} L${rr(cx + k)} ${rr(cy - k)} L${rr(cx + r)} ${rr(cy)} L${rr(cx + k)} ${rr(cy + k)} L${rr(cx)} ${rr(cy + r)} L${rr(cx - k)} ${rr(cy + k)} L${rr(cx - r)} ${rr(cy)} L${rr(cx - k)} ${rr(cy - k)} Z`;
  return `<path d="${d}" fill="${fill}" fill-opacity="${opacity}"/>`;
}

export function diamond(cx: number, cy: number, r: number, fill: string, opacity = 1): string {
  return `<path d="M${rr(cx)} ${rr(cy - r)} L${rr(cx + r)} ${rr(cy)} L${rr(cx)} ${rr(cy + r)} L${rr(cx - r)} ${rr(cy)} Z" fill="${fill}" fill-opacity="${opacity}"/>`;
}

export function circle(cx: number, cy: number, r: number, fill: string, opacity = 1): string {
  return `<circle cx="${rr(cx)}" cy="${rr(cy)}" r="${rr(r)}" fill="${fill}" fill-opacity="${opacity}"/>`;
}

/** A leaf: a pointed oval of length `len` starting at (x, y) and pointing along `angle` degrees. */
export function leaf(x: number, y: number, len: number, angle: number, fill: string, opacity = 1): string {
  const w = len * 0.34;
  const d = `M0 0 C${rr(len * 0.25)} ${-w} ${rr(len * 0.75)} ${-w} ${rr(len)} 0 C${rr(len * 0.75)} ${w} ${rr(len * 0.25)} ${w} 0 0 Z`;
  return `<path transform="translate(${rr(x)} ${rr(y)}) rotate(${rr(angle)})" d="${d}" fill="${fill}" fill-opacity="${opacity}"/>`;
}

/** An organic blob around (cx, cy) with mean radius r; `seed` in [0,1) varies the outline. */
export function blob(cx: number, cy: number, r: number, seed: number, fill: string, opacity = 1): string {
  const n = 7;
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const k = 0.78 + 0.34 * Math.abs(Math.sin(seed * 9.1 + i * 1.7));
    pts.push([cx + Math.cos(a) * r * k, cy + Math.sin(a) * r * k]);
  }
  // Catmull-Rom to cubic Bezier through the points.
  let d = `M${rr(pts[0][0])} ${rr(pts[0][1])}`;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const p3 = pts[(i + 2) % n];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${rr(c1[0])} ${rr(c1[1])} ${rr(c2[0])} ${rr(c2[1])} ${rr(p2[0])} ${rr(p2[1])}`;
  }
  return `<path d="${d} Z" fill="${fill}" fill-opacity="${opacity}"/>`;
}

/**
 * A panel from the left edge of the canvas to x = wp, full height, with the right edge straight, diagonal,
 * wavy or bulging. Draw it inside a mirror group to put it on the right.
 */
export function sidePanel(wp: number, H: number, edge: Edge, fill: string, r = 0, extra = ''): string {
  let d: string;
  switch (edge) {
    case 'diag':
      d = `M0 0 L${rr(wp + 50)} 0 L${rr(wp - 50)} ${H} L0 ${H} Z`;
      break;
    case 'wave':
      d = `M0 0 L${wp} 0 C${rr(wp + 60)} ${rr(H * 0.25)} ${rr(wp - 60)} ${rr(H * 0.75)} ${wp} ${H} L0 ${H} Z`;
      break;
    case 'arch':
      d = `M0 0 L${wp} 0 Q${rr(wp + 140)} ${rr(H / 2)} ${wp} ${H} L0 ${H} Z`;
      break;
    default:
      d = r > 0 ? `M0 0 H${rr(wp - r)} Q${wp} 0 ${wp} ${rr(r)} V${rr(H - r)} Q${wp} ${H} ${rr(wp - r)} ${H} H0 Z` : `M0 0 H${wp} V${H} H0 Z`;
  }
  return `<path d="${d}" fill="${fill}" ${extra}/>`;
}
