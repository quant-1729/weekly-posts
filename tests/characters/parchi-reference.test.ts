// CH-1: the TypeScript port of the Parchi rig draws the kit's own poses. For all 41 actions, Parchi with the kit's colours
// is compared with the kit's reference still (vendor/figital-mascots/parchi-poses/<action>.svg), including the kit's ground
// shadow and perch ledge (debug options of the rig). The reference z's are text and the reference sign has placeholder bars,
// so those two are compared more loosely.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import { describe, expect, it } from 'vitest';
import { BODIES } from '@/lib/characters/bodies';
import { drawRig } from '@/lib/characters/rig';
import { ACTIONS, wrapSvg } from './helpers';

const REF = path.join(process.cwd(), 'vendor', 'figital-mascots', 'parchi-poses');
const SIZE = 520;
const KIT_COLORS = { accent: '#2BB5B0', accentDark: '#1A8C88' };

function raster(svg: string): Buffer {
  return Buffer.from(new Resvg(svg, { fitTo: { mode: 'width', value: SIZE }, font: { loadSystemFonts: false } }).render().pixels);
}

function compare(a: Buffer, b: Buffer): { iou: number; diff: number } {
  let inter = 0;
  let union = 0;
  let diff = 0;
  const over = (d: Buffer, i: number, k: number) => (d[i * 4 + k] * d[i * 4 + 3] + 255 * (255 - d[i * 4 + 3])) / 255;
  for (let i = 0; i < SIZE * SIZE; i++) {
    const inA = a[i * 4 + 3] > 127;
    const inB = b[i * 4 + 3] > 127;
    if (inA && inB) inter++;
    if (inA || inB) {
      union++;
      for (let k = 0; k < 3; k++) diff += Math.abs(over(a, i, k) - over(b, i, k)) / 3;
    }
  }
  return { iou: inter / union, diff: diff / union };
}

describe('Parchi rig port vs the kit reference stills', () => {
  // Everything else matches the kit pixel for pixel (silhouette 1.0000, colour 0.00).
  const loose: Record<string, { iou: number; diff: number }> = { 'hold-sign': { iou: 0.999, diff: 4 }, sleep: { iou: 0.97, diff: 6 } };
  for (const action of ACTIONS) {
    it(`${action}`, () => {
      const ref = readFileSync(path.join(REF, `${action}.svg`), 'utf8');
      const ours = wrapSvg(drawRig(BODIES.parchi, action, KIT_COLORS, { shadow: true, ledge: true }).full);
      const { iou, diff } = compare(raster(ours), raster(ref));
      if (process.env.CH_DEBUG) console.log(action, iou.toFixed(4), diff.toFixed(2));
      const lim = loose[action] ?? { iou: 0.999, diff: 0.5 };
      expect(iou, `${action} silhouette`).toBeGreaterThanOrEqual(lim.iou);
      expect(diff, `${action} colour`).toBeLessThanOrEqual(lim.diff);
    });
  }
});
