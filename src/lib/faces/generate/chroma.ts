// Chroma-key cut-out for AI images made on a flat pure-green (#00FF00) background (F-5). Pure JS on sharp's raw pixels:
// no network, no model. The figure keeps its colours: edge pixels are un-mixed from the green, any green tint left
// at the edge is removed (despill), the alpha edge is soft, and the result is trimmed to the figure.

import sharp from 'sharp';
import { FaceGenError } from './errors';

/** A cut-out pose is never smaller than this on a side (the pose store refuses smaller images). */
export const CUTOUT_MIN_PX = 256;
/** Never larger than this on a side (the pose store accepts up to 4096). */
export const CUTOUT_MAX_PX = 2048;

const PAD = 8;
/** Green dominance as a share of the key's: at or below LOW a pixel is figure, at or above HIGH it is background. */
const LOW = 0.3;
const HIGH = 0.7;
/** From this share a pixel is cleaned of green tint even when it is opaque (a thin halo at the edge). */
const DESPILL_FROM = 0.04;

const dominance = (r: number, g: number, b: number) => g - Math.max(r, b);

/** The background colour: the median of the green-ish pixels on the image border. Throws when the border is not mostly green. */
function estimateKey(data: Uint8Array, w: number, h: number): { r: number; g: number; b: number; d: number } {
  const rs: number[] = [];
  const gs: number[] = [];
  const bs: number[] = [];
  let total = 0;
  const take = (x: number, y: number) => {
    const i = (y * w + x) * 4;
    total++;
    if (dominance(data[i], data[i + 1], data[i + 2]) > 60) {
      rs.push(data[i]);
      gs.push(data[i + 1]);
      bs.push(data[i + 2]);
    }
  };
  for (let x = 0; x < w; x++) {
    take(x, 0);
    take(x, h - 1);
  }
  for (let y = 1; y < h - 1; y++) {
    take(0, y);
    take(w - 1, y);
  }
  if (rs.length < total * 0.3) throw new FaceGenError('cutout_failed', 'the image is not on a green background');
  const med = (a: number[]) => a.sort((p, q) => p - q)[a.length >> 1];
  const key = { r: med(rs), g: med(gs), b: med(bs), d: 0 };
  key.d = dominance(key.r, key.g, key.b);
  return key;
}

/**
 * Removes the green background and trims. Returns a transparent PNG at least CUTOUT_MIN_PX on each side (padded with
 * transparent pixels if the figure is smaller) and at most CUTOUT_MAX_PX (scaled down if larger).
 * Throws FaceGenError('cutout_failed') when the image is not on green or nothing is left.
 */
export async function chromaKey(png: Buffer): Promise<Buffer> {
  let raw: { data: Buffer; info: { width: number; height: number } };
  try {
    raw = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  } catch {
    throw new FaceGenError('cutout_failed', 'not an image');
  }
  const { data, info } = raw;
  const w = info.width;
  const h = info.height;
  const key = estimateKey(data, w, h);

  const out = Buffer.alloc(w * h * 4);
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  for (let p = 0; p < w * h; p++) {
    const i = p * 4;
    let r = data[i];
    let g = data[i + 1];
    let b = data[i + 2];
    const t = Math.max(0, dominance(r, g, b)) / key.d;
    let a = t <= LOW ? 1 : t >= HIGH ? 0 : (HIGH - t) / (HIGH - LOW);
    a = a * a * (3 - 2 * a); // smoothstep: a soft edge without a hard step
    if (a <= 0) continue; // fully transparent, stays 0,0,0,0
    if (a < 1) {
      // The pixel is a mix of figure and green: take the green out of the mix.
      r = (r - (1 - a) * key.r) / a;
      g = (g - (1 - a) * key.g) / a;
      b = (b - (1 - a) * key.b) / a;
    }
    if (t > DESPILL_FROM) g = Math.min(g, Math.max(r, b));
    out[i] = Math.max(0, Math.min(255, Math.round(r)));
    out[i + 1] = Math.max(0, Math.min(255, Math.round(g)));
    out[i + 2] = Math.max(0, Math.min(255, Math.round(b)));
    out[i + 3] = Math.round(a * 255);
    if (out[i + 3] > 10) {
      const x = p % w;
      const y = (p / w) | 0;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) throw new FaceGenError('cutout_failed', 'nothing left after removing the background');

  const left = Math.max(0, minX - PAD);
  const top = Math.max(0, minY - PAD);
  const width = Math.min(w, maxX + PAD + 1) - left;
  const height = Math.min(h, maxY + PAD + 1) - top;
  return fitSize(await sharp(out, { raw: { width: w, height: h, channels: 4 } }).extract({ left, top, width, height }).png().toBuffer());
}

/** Scales a PNG down to CUTOUT_MAX_PX, then pads it with transparent pixels (centred) up to CUTOUT_MIN_PX. */
export async function fitSize(png: Buffer): Promise<Buffer> {
  let img = png;
  let { width = 0, height = 0 } = await sharp(img).metadata();
  if (width > CUTOUT_MAX_PX || height > CUTOUT_MAX_PX) {
    img = await sharp(img).resize({ width: CUTOUT_MAX_PX, height: CUTOUT_MAX_PX, fit: 'inside' }).png().toBuffer();
    ({ width = 0, height = 0 } = await sharp(img).metadata());
  }
  if (width >= CUTOUT_MIN_PX && height >= CUTOUT_MIN_PX) return img;
  const padW = Math.max(0, CUTOUT_MIN_PX - width);
  const padH = Math.max(0, CUTOUT_MIN_PX - height);
  return sharp(img)
    .extend({
      left: Math.floor(padW / 2),
      right: Math.ceil(padW / 2),
      top: Math.floor(padH / 2),
      bottom: Math.ceil(padH / 2),
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();
}
