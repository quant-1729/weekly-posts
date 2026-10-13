// Character sheet export (R15c): 8 poses as transparent SVG + PNG (800x800)
// and a 4x2 sheet PNG with the pose names. Text is drawn with the render
// module's HarfBuzz path (never resvg <text>), so Devanagari names are correct.

import { Resvg } from '@resvg/resvg-js';
import type { MascotSpec } from '@/lib/ai/schemas';
import { initShaping, measureText, textToSvg } from '@/lib/render';
import { s } from '@/lib/i18n/strings';
import type { Storage } from '@/lib/storage';
import { posePngPath, poseSvgPath, sheetPngPath } from './paths';
import { MASCOT_POSES, drawMascot, drawMascotDocument, type MascotPose } from './rig';

export const POSE_PNG_SIZE = 800;

export interface SheetFiles {
  /** Paths inside the `mascots` bucket, e.g. `{brand}/{mascot}/pose-wave.png`. */
  poses: { pose: MascotPose; svg: string; png: string }[];
  sheet: string;
}

/** One pose as a transparent PNG (resvg with `background` unset keeps the alpha channel). */
export function renderPosePng(spec: MascotSpec, pose: MascotPose, size = POSE_PNG_SIZE): Buffer {
  const svg = drawMascotDocument(spec, pose);
  return Buffer.from(new Resvg(svg, { fitTo: { mode: 'width', value: size }, font: { loadSystemFonts: false } }).render().asPng());
}

const CELL_W = 420;
const CELL_H = 470;
const PAD = 30;
const HEAD_H = 132;
const SHEET_BG = '#FBF6EC';
const LABEL_INK = '#5A4A3A';

function centered(text: string, weight: 400 | 500 | 700 | 800, size: number, cx: number, baseline: number, fill: string): string {
  const w = measureText(text, weight, size);
  return textToSvg(text, weight, cx - w / 2, baseline, size, fill);
}

/** The 4x2 sheet as an SVG document (name and pose names drawn with shaped glyph paths). */
export async function buildSheetSvg(spec: MascotSpec, names: { name: string; name_local?: string }): Promise<{ svg: string; width: number; height: number }> {
  await initShaping();
  const cols = 4;
  const rows = 2;
  const width = PAD * 2 + cols * CELL_W;
  const height = PAD * 2 + HEAD_H + rows * CELL_H;
  let body = `<rect width="${width}" height="${height}" fill="${SHEET_BG}"/>`;
  const title = names.name_local ? `${names.name}  ·  ${names.name_local}` : names.name;
  body += centered(title, 800, 54, width / 2, PAD + 62, '#2B1A12');
  body += centered(s.mascot.sheetSubtitle, 500, 24, width / 2, PAD + 116, LABEL_INK);
  MASCOT_POSES.forEach((pose, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = PAD + col * CELL_W;
    const y = PAD + HEAD_H + row * CELL_H;
    body += `<rect x="${x + 8}" y="${y + 8}" width="${CELL_W - 16}" height="${CELL_H - 16}" rx="28" fill="#FFFFFF" fill-opacity="0.75"/>`;
    body += `<g transform="translate(${x + 10} ${y + 10})">${drawMascot(spec, pose)}</g>`;
    body += centered(s.mascot.poseNames[pose], 700, 30, x + CELL_W / 2, y + CELL_H - 28, LABEL_INK);
  });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${body}</svg>`;
  return { svg, width, height };
}

export async function renderSheetPng(spec: MascotSpec, names: { name: string; name_local?: string }): Promise<Buffer> {
  const { svg, width } = await buildSheetSvg(spec, names);
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
  spec: MascotSpec;
  names: { name: string; name_local?: string };
  storage: Storage;
}): Promise<SheetFiles> {
  const { brandId, mascotId, spec, names, storage } = args;
  const poses: SheetFiles['poses'] = [];
  for (const pose of MASCOT_POSES) {
    const svgPath = poseSvgPath(brandId, mascotId, pose);
    const pngPath = posePngPath(brandId, mascotId, pose);
    await storage.put('mascots', svgPath, Buffer.from(drawMascotDocument(spec, pose)), 'image/svg+xml');
    await storage.put('mascots', pngPath, renderPosePng(spec, pose), 'image/png');
    poses.push({ pose, svg: svgPath, png: pngPath });
  }
  const sheet = sheetPngPath(brandId, mascotId);
  await storage.put('mascots', sheet, await renderSheetPng(spec, names), 'image/png');
  return { poses, sheet };
}
