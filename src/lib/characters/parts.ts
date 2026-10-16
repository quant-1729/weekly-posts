// SVG parts shared by the rig and the bodies: the tick, the abstract checklist rows and the done stamp.
// Never any words: the rows are bars.

import type { Palette, Pose } from './body';
import { f } from './util';

export function tick(x: number, y: number, s: number, col: string, w: number): string {
  return `<path d="M${f(x - 7 * s)},${f(y)} l${f(5 * s)},${f(6 * s)} l${f(11 * s)},${f(-13 * s)}" stroke="${col}" stroke-width="${w}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
}

/** The three-row checklist in the kit's coordinates (rows at y 136, 154, 172; x 84 to 156). Bars only. */
export function rowsSvg(p: Pose, P: Palette): string {
  let rows = '';
  [136, 154, 172].forEach((y, i) => {
    const done = p.rows[i];
    const next = !done && p.rows.indexOf(0) === i;
    if (next) rows += `<rect x="84" y="${y - 8}" width="72" height="16" rx="5" fill="${P.accentLight}" stroke="${P.accent}" stroke-width="1.4"/>`;
    rows += `<rect x="89" y="${y - 5}" width="10" height="10" rx="2" fill="#ffffff" stroke="${P.navy}" stroke-width="2"/>`;
    if (done) rows += tick(95, y, 0.55, P.accentDark, 2.8);
    const w = i === 2 && p.write != null ? Math.max(1, 44 * p.write) : [40, 32, 44][i];
    rows += `<rect x="105" y="${y - 2}" width="${f(w)}" height="4" rx="2" fill="${done ? P.line : P.navy}" opacity="${done ? 1 : 0.55}"/>`;
  });
  return rows;
}

/** The round "done" stamp that lands on the checklist (kit coordinates). */
export function stampSvg(P: Palette): string {
  return `<g transform="rotate(-12 146 192)"><circle cx="146" cy="192" r="13" fill="none" stroke="${P.accentDark}" stroke-width="2.6"/><circle cx="146" cy="192" r="9" fill="none" stroke="${P.accentDark}" stroke-width="1" opacity=".6"/>${tick(147, 192, 0.55, P.accentDark, 3)}</g>`;
}
