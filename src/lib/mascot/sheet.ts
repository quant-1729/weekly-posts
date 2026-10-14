// Character sheet export (R15c, D9): Tween in the brand's colours, every post pose as a transparent SVG + PNG
// (800x800) and a sheet PNG with the pose names. Text is drawn with the render module's HarfBuzz path
// (never resvg <text>), so the name is shaped correctly in any script.

import { Resvg } from '@resvg/resvg-js';
import { initShaping, measureText, textToSvg } from '@/lib/render';
import { s } from '@/lib/i18n/strings';
import type { Storage } from '@/lib/storage';
import type { TweenColors } from './colors';
import { posePngPath, poseSvgPath, sheetPngPath } from './paths';
import { TWEEN_POST_POSES, rigPoseFor, type TweenPostPose } from './poses';
import { renderTween, tweenParts, TWEEN_VIEWBOX } from './tween';

export const POSE_PNG_SIZE = 800;

/** In the files and on the sheet, "point" shows Tween pointing to its right. */
const FILE_SIDE = 'left' as const;

export interface SheetFiles {
  /** Paths inside the `mascots` bucket, e.g. `{brand}/{mascot}/pose-wave.png`. */
  poses: { pose: TweenPostPose; svg: string; png: string }[];
  sheet: string;
}

/** One post pose as a standalone SVG on Tween's 550 x 550 canvas, transparent. */
export function poseSvg(colors: TweenColors, pose: TweenPostPose, size = POSE_PNG_SIZE): string {
  return renderTween({ pose: rigPoseFor(pose, FILE_SIDE), colors, size });
}

/** One pose as a transparent PNG (resvg with `background` unset keeps the alpha channel). */
export function renderPosePng(colors: TweenColors, pose: TweenPostPose, size = POSE_PNG_SIZE): Buffer {
  return Buffer.from(new Resvg(poseSvg(colors, pose, size), { fitTo: { mode: 'width', value: size }, font: { loadSystemFonts: false } }).render().asPng());
}

const CELL_W = 420;
const CELL_H = 470;
const PAD = 30;
const HEAD_H = 132;
const SHEET_BG = '#F8F9FF';
const LABEL_INK = '#35557A';
const TITLE_INK = '#0B1C30';
const ART = 400;

function centered(text: string, weight: 400 | 500 | 700 | 800, size: number, cx: number, baseline: number, fill: string): string {
  const w = measureText(text, weight, size);
  return textToSvg(text, weight, cx - w / 2, baseline, size, fill);
}

/** The sheet as an SVG document: the name, the seven poses with their names, and the scarf colour. */
export async function buildSheetSvg(colors: TweenColors, name: string): Promise<{ svg: string; width: number; height: number }> {
  await initShaping();
  const cols = 4;
  const rows = 2;
  const width = PAD * 2 + cols * CELL_W;
  const height = PAD * 2 + HEAD_H + rows * CELL_H;
  let body = `<rect width="${width}" height="${height}" fill="${SHEET_BG}"/>`;
  body += centered(name, 800, 54, width / 2, PAD + 62, TITLE_INK);
  body += centered(s.mascot.sheetSubtitle, 500, 24, width / 2, PAD + 116, LABEL_INK);
  const cell = (i: number) => ({ x: PAD + (i % cols) * CELL_W, y: PAD + HEAD_H + Math.floor(i / cols) * CELL_H });
  TWEEN_POST_POSES.forEach((pose, i) => {
    const { x, y } = cell(i);
    body += `<rect x="${x + 8}" y="${y + 8}" width="${CELL_W - 16}" height="${CELL_H - 16}" rx="28" fill="#FFFFFF" fill-opacity="0.85"/>`;
    // A nested svg on the same 550 x 550 canvas the pose files use.
    body += `<svg x="${x + 10}" y="${y + 6}" width="${ART}" height="${ART}" viewBox="${TWEEN_VIEWBOX}">${tweenParts({ pose: rigPoseFor(pose, FILE_SIDE), colors, id: `p${i}` })}</svg>`;
    body += centered(s.mascot.poseNames[pose], 700, 30, x + CELL_W / 2, y + CELL_H - 28, LABEL_INK);
  });
  // The eighth cell shows the scarf colour.
  const last = cell(TWEEN_POST_POSES.length);
  body += `<rect x="${last.x + 8}" y="${last.y + 8}" width="${CELL_W - 16}" height="${CELL_H - 16}" rx="28" fill="#FFFFFF" fill-opacity="0.85"/>`;
  body += `<rect x="${last.x + 110}" y="${last.y + 120}" width="200" height="140" rx="30" fill="${colors.scarf}"/>`;
  body += centered(colors.scarf.toUpperCase(), 700, 30, last.x + CELL_W / 2, last.y + CELL_H - 28, LABEL_INK);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${body}</svg>`;
  return { svg, width, height };
}

export async function renderSheetPng(colors: TweenColors, name: string): Promise<Buffer> {
  const { svg, width } = await buildSheetSvg(colors, name);
  return Buffer.from(new Resvg(svg, { fitTo: { mode: 'width', value: width }, font: { loadSystemFonts: false } }).render().asPng());
}

/**
 * Renders the whole sheet for one mascot and stores it in the `mascots` bucket
 * under `{brandId}/{mascotId}/`. Returns the bucket-relative paths. Overwrites
 * any earlier export for the same mascot.
 */
export async function exportCharacterSheet(args: {
  brandId: string;
  mascotId: string;
  colors: TweenColors;
  name: string;
  storage: Storage;
}): Promise<SheetFiles> {
  const { brandId, mascotId, colors, name, storage } = args;
  const poses: SheetFiles['poses'] = [];
  for (const pose of TWEEN_POST_POSES) {
    const svgPath = poseSvgPath(brandId, mascotId, pose);
    const pngPath = posePngPath(brandId, mascotId, pose);
    await storage.put('mascots', svgPath, Buffer.from(poseSvg(colors, pose)), 'image/svg+xml');
    await storage.put('mascots', pngPath, renderPosePng(colors, pose), 'image/png');
    poses.push({ pose, svg: svgPath, png: pngPath });
  }
  const sheet = sheetPngPath(brandId, mascotId);
  await storage.put('mascots', sheet, await renderSheetPng(colors, name), 'image/png');
  return { poses, sheet };
}
