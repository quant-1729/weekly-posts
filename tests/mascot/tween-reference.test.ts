// Acceptance test for the static Tween renderer (D9, M-2): every still pose the renderer supports is drawn with the
// default Tween colours at 1100 x 1100 through resvg and compared with the kit's own PNG render of the real rig
// (vendor/tween-mascot-kit/poses/png). Two measures, over the whole picture:
//   - silhouette IoU: pixels with alpha above 50% in both pictures / in either;
//   - mean colour difference over the union of both silhouettes (0 to 255, composited on white).
// A negative test shows the thresholds catch a visibly wrong arm angle (30 degrees out).
// A side-by-side sheet (reference | ours) of every pose is written to test-results/tween/compare.png to look at.

import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import sharp, { type OverlayOptions } from 'sharp';
import { describe, expect, it } from 'vitest';
import { initShaping, textToSvg } from '@/lib/render';
import { DEFAULT_TWEEN_COLORS } from '@/lib/mascot/colors';
import { TWEEN_POST_POSES, rigPoseFor } from '@/lib/mascot/poses';
import { renderTween, TWEEN_POSES, type PoseSpec, type TweenPose } from '@/lib/mascot/tween';

const REF_DIR = path.join(process.cwd(), 'vendor', 'tween-mascot-kit', 'poses', 'png');
const SIZE = 1100;

/** The poses that have a reference render and that we draw: all 18 in the kit. The walk references are the still frame (legs and arms at rest, leaning and looking toward travel). */
const POSES = TWEEN_POSES.filter((p) => existsSync(path.join(REF_DIR, `${p}.png`)));

// What a pose has to match: silhouette IoU at least 0.99 (the requirement is 0.95) and a mean colour difference
// of at most 1.5 out of 255. The renderer scores IoU 0.9988 or more and a difference of about 0.3 on every pose.
const MIN_IOU = 0.99;
const MAX_COLOR_DIFF = 1.5;

interface Raw {
  data: Buffer;
}

async function referenceRaw(pose: TweenPose): Promise<Raw> {
  const { data, info } = await sharp(path.join(REF_DIR, `${pose}.png`)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (info.width !== SIZE || info.height !== SIZE) throw new Error(`reference ${pose} is ${info.width}x${info.height}`);
  return { data };
}

function ours(pose: TweenPose, tweak?: Partial<PoseSpec>): Raw {
  const r = new Resvg(renderTween({ pose, colors: DEFAULT_TWEEN_COLORS, tweak }), { fitTo: { mode: 'width', value: SIZE }, font: { loadSystemFonts: false } }).render();
  return { data: Buffer.from(r.pixels) };
}

function compare(a: Raw, b: Raw): { iou: number; colorDiff: number } {
  let inter = 0;
  let union = 0;
  let diff = 0;
  const over = (d: Buffer, i: number, k: number) => (d[i * 4 + k] * d[i * 4 + 3] + 255 * (255 - d[i * 4 + 3])) / 255;
  for (let i = 0; i < SIZE * SIZE; i++) {
    const inA = a.data[i * 4 + 3] > 127;
    const inB = b.data[i * 4 + 3] > 127;
    if (inA && inB) inter++;
    if (inA || inB) {
      union++;
      for (let k = 0; k < 3; k++) diff += Math.abs(over(a.data, i, k) - over(b.data, i, k)) / 3;
    }
  }
  return { iou: inter / union, colorDiff: diff / union };
}

const results: Array<{ pose: TweenPose; iou: number; colorDiff: number }> = [];

describe('the renderer against the kit reference poses', () => {
  it('covers the 7 post poses, their left and right variants and idle', () => {
    for (const p of ['wave', 'talk', 'think', 'celebrate', 'present', 'idle', 'point-left', 'point-right', 'walk-left', 'walk-right'] as const) expect(POSES, p).toContain(p);
    for (const p of TWEEN_POST_POSES) expect(POSES, p).toContain(rigPoseFor(p, 'left'));
    expect(POSES).toHaveLength(18); // every pose in the kit
  });

  it.each(POSES)('%s: silhouette and colours match the reference render', async (pose) => {
    const m = compare(await referenceRaw(pose), ours(pose));
    results.push({ pose, ...m });
    expect(m.iou).toBeGreaterThanOrEqual(MIN_IOU);
    expect(m.iou).toBeGreaterThanOrEqual(0.95); // the requirement itself
    expect(m.colorDiff).toBeLessThanOrEqual(MAX_COLOR_DIFF);
  });

  // One arm angle changed by 30 degrees: the thresholds must fail it.
  const WRONG: Array<[TweenPose, Partial<PoseSpec>]> = [
    ['wave', { uar: -120 }],
    ['talk', { uar: -34 }],
    ['think', { far: -88 }],
    ['celebrate', { ual: 120 }],
    ['present', { far: -8 }],
    ['point-right', { uar: -60 }],
    ['point-left', { ual: 60 }],
    ['idle', { ual: 54 }],
    ['walk-left', { ual: 54 }],
    ['walk-right', { uar: -54 }],
  ];
  it.each(WRONG)('%s with one arm 30 degrees out is rejected', async (pose, tweak) => {
    expect(POSES).toContain(pose);
    const m = compare(await referenceRaw(pose), ours(pose, tweak));
    console.log(`negative ${pose} ${JSON.stringify(tweak)}: IoU ${m.iou.toFixed(4)}, colour difference ${m.colorDiff.toFixed(2)}`);
    expect(m.iou < MIN_IOU || m.colorDiff > MAX_COLOR_DIFF).toBe(true);
    expect(m.iou).toBeLessThan(0.98);
    expect(m.colorDiff).toBeGreaterThan(3);
  });

  it('writes the side-by-side sheet (reference | ours) and prints the numbers', async () => {
    await initShaping();
    const cell = 330;
    const labelH = 44;
    const gap = 16;
    const perRow = 3;
    const pairW = cell * 2 + 8;
    const rows = Math.ceil(POSES.length / perRow);
    const width = perRow * (pairW + gap) + gap;
    const height = rows * (cell + labelH + gap) + gap;
    const parts: OverlayOptions[] = [];
    let labels = '';
    for (const [i, pose] of POSES.entries()) {
      const x = gap + (i % perRow) * (pairW + gap);
      const y = gap + Math.floor(i / perRow) * (cell + labelH + gap);
      const ref = await sharp(path.join(REF_DIR, `${pose}.png`)).resize(cell, cell).png().toBuffer();
      const mine = await sharp(Buffer.from(ours(pose).data), { raw: { width: SIZE, height: SIZE, channels: 4 } }).resize(cell, cell).png().toBuffer();
      parts.push({ input: ref, left: x, top: y + labelH }, { input: mine, left: x + cell + 8, top: y + labelH });
      const r = results.find((q) => q.pose === pose);
      const text = `${pose}   reference | ours${r ? `   IoU ${r.iou.toFixed(4)}` : ''}`;
      labels += textToSvg(text, 700, x, y + 30, 24, '#35557A');
    }
    const labelSvg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${labels}</svg>`);
    const png = await sharp({ create: { width, height, channels: 4, background: '#F8F9FF' } })
      .composite([...parts, { input: await sharp(labelSvg).png().toBuffer(), left: 0, top: 0 }])
      .png()
      .toBuffer();
    const dir = path.join(process.cwd(), 'test-results', 'tween');
    mkdirSync(dir, { recursive: true });
    await sharp(png).toFile(path.join(dir, 'compare.png'));
    expect(existsSync(path.join(dir, 'compare.png'))).toBe(true);

    console.log(
      ['pose          IoU     colour diff', ...results.map((r) => `${r.pose.padEnd(12)}  ${r.iou.toFixed(4)}  ${r.colorDiff.toFixed(2)}`)].join('\n'),
    );
  });
});
