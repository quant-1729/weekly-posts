import sharp from 'sharp';
import { contrast } from '@/lib/render/color';
import type { DesignDetail } from '@/lib/design/engine';
import { LARGE_TEXT_PX } from '@/lib/design/colors';

export function expectClean(r: DesignDetail, label = '') {
  const rep = r.report;
  const problems: string[] = [];
  if (rep.overflow.length) problems.push(`overflow ${rep.overflow.join(', ')}`);
  if (rep.contrast.length) problems.push(`contrast ${JSON.stringify(rep.contrast)}`);
  if (rep.safeZone.length) problems.push(`safe zone ${rep.safeZone.join(', ')}`);
  if (rep.qr && !rep.qr.ok) problems.push(`qr ${rep.qr.decoded}`);
  return { label: `${label} ${r.themeId}/${r.layoutId}`, problems };
}

const hex = (r: number, g: number, b: number) => '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');

/**
 * Independent contrast check on the rendered picture: for each text line, the most common colour in
 * its box that is not the ink is taken as the background. Returns the lowest ratio found (large text
 * is held to 3:1 by the caller via `size`).
 */
export async function pixelContrastIssues(r: DesignDetail): Promise<{ name: string; ratio: number; need: number }[]> {
  const { data, info } = await sharp(r.png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const out: { name: string; ratio: number; need: number }[] = [];
  for (const p of r.placements) {
    if (p.kind !== 'text' || !p.ink || !p.lines.length) continue;
    const ink = p.ink;
    const inkRgb = [parseInt(ink.slice(1, 3), 16), parseInt(ink.slice(3, 5), 16), parseInt(ink.slice(5, 7), 16)];
    for (const l of p.lines) {
      const x0 = Math.max(0, Math.floor(l.x));
      const y0 = Math.max(0, Math.floor(l.y));
      const x1 = Math.min(info.width, Math.ceil(l.x + l.w));
      const y1 = Math.min(info.height, Math.ceil(l.y + l.h));
      const hist = new Map<number, number>();
      for (let y = y0; y < y1; y += 2) {
        for (let x = x0; x < x1; x += 2) {
          const i = (y * info.width + x) * 3;
          const d = Math.abs(data[i] - inkRgb[0]) + Math.abs(data[i + 1] - inkRgb[1]) + Math.abs(data[i + 2] - inkRgb[2]);
          if (d < 90) continue; // ink or its antialiasing
          const key = ((data[i] >> 3) << 10) | ((data[i + 1] >> 3) << 5) | (data[i + 2] >> 3);
          hist.set(key, (hist.get(key) ?? 0) + 1);
        }
      }
      if (!hist.size) continue;
      let best = 0;
      let bestN = -1;
      for (const [k, n] of hist) {
        if (n > bestN) {
          best = k;
          bestN = n;
        }
      }
      const bg = hex(((best >> 10) & 31) << 3 | 4, ((best >> 5) & 31) << 3 | 4, (best & 31) << 3 | 4);
      const ratio = contrast(ink, bg);
      const large = p.size >= LARGE_TEXT_PX && (p.weight ?? 400) >= 700;
      const need = large ? 2.9 : 4.3; // a little slack for the colour quantisation
      if (ratio < need) out.push({ name: p.name, ratio, need });
    }
  }
  return out;
}
