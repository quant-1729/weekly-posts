/**
 * Removes a plain white background from an uploaded logo, when that is safe (C-19).
 *
 * Safe means the border of the image is near-white and uniform. The background is then found by
 * flood-filling inward from the border pixels, so white that is enclosed by the artwork (the inside
 * of an "O", a white shape on the logo) is never touched. One or two pixels along the cut are
 * un-blended from white so the edge has no light halo. If the border is a photo, a gradient, a
 * colour or already transparent, nothing changes.
 */
import sharp from "sharp";

export type KeptReason = "unreadable" | "too_small" | "already_transparent" | "border_not_white" | "border_not_uniform" | "nothing_left";

export type BackgroundResult =
  | { outcome: "removed"; png: Buffer; removedShare: number }
  | { outcome: "kept"; reason: KeptReason };

export interface RemovalOptions {
  /** How far a pixel may be from the border colour (largest channel difference, 0-255) and still be background. Default 28. */
  tolerance?: number;
  /** The border colour must have every channel at least this high. Default 235. */
  whiteFloor?: number;
}

const BORDER_SHARE = 0.97; // share of border pixels that must be background (a logo may touch the edge in a few places)

export async function removeWhiteBackground(png: Buffer, opts: RemovalOptions = {}): Promise<BackgroundResult> {
  const tol = opts.tolerance ?? 28;
  const floor = opts.whiteFloor ?? 235;

  let data: Buffer;
  let w: number;
  let h: number;
  try {
    const raw = await sharp(png, { limitInputPixels: 40_000_000 }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    data = raw.data;
    w = raw.info.width;
    h = raw.info.height;
  } catch {
    return { outcome: "kept", reason: "unreadable" };
  }
  if (w < 3 || h < 3) return { outcome: "kept", reason: "too_small" };

  const at = (x: number, y: number) => (y * w + x) * 4;
  const border: number[] = []; // pixel indexes (y * w + x) of the outermost ring
  for (let x = 0; x < w; x++) border.push(x, (h - 1) * w + x);
  for (let y = 1; y < h - 1; y++) border.push(y * w, y * w + w - 1);

  let seeThrough = 0;
  for (const p of border) if (data[p * 4 + 3] < 200) seeThrough++;
  if (seeThrough / border.length > 0.05) return { outcome: "kept", reason: "already_transparent" };

  // The border colour: the middle value of each channel.
  const mid = (c: number) => {
    const v = border.map((p) => data[p * 4 + c]).sort((a, b) => a - b);
    return v[Math.floor(v.length / 2)];
  };
  const ref = [mid(0), mid(1), mid(2)];
  if (Math.min(...ref) < floor) return { outcome: "kept", reason: "border_not_white" };

  const isBg = (p: number) => {
    const i = p * 4;
    return Math.max(Math.abs(data[i] - ref[0]), Math.abs(data[i + 1] - ref[1]), Math.abs(data[i + 2] - ref[2])) <= tol && data[i + 3] >= 200;
  };
  const seeds = border.filter(isBg);
  if (seeds.length / border.length < BORDER_SHARE) return { outcome: "kept", reason: "border_not_uniform" };

  // Flood fill (4-connected) from the border through background-coloured pixels.
  const gone = new Uint8Array(w * h);
  const queue = new Int32Array(w * h);
  let head = 0;
  let tail = 0;
  for (const p of seeds) {
    if (!gone[p]) {
      gone[p] = 1;
      queue[tail++] = p;
    }
  }
  while (head < tail) {
    const p = queue[head++];
    const x = p % w;
    const y = (p - x) / w;
    const next = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1];
    for (const n of next) {
      if (n >= 0 && !gone[n] && isBg(n)) {
        gone[n] = 1;
        queue[tail++] = n;
      }
    }
  }
  const removedShare = tail / (w * h);
  if (removedShare > 0.98) return { outcome: "kept", reason: "nothing_left" };

  const out = Buffer.from(data);
  for (let p = 0; p < w * h; p++) if (gone[p]) out[at(p % w, Math.floor(p / w)) + 3] = 0;

  // Edge: un-blend pixels next to the cut from the background colour (one pixel deep, a second only where clearly a blend).
  const touchesGone = (p: number, set: Uint8Array) => {
    const x = p % w;
    const y = (p - x) / w;
    return (x > 0 && set[p - 1] === 1) || (x < w - 1 && set[p + 1] === 1) || (y > 0 && set[p - w] === 1) || (y < h - 1 && set[p + w] === 1);
  };
  const ring1: number[] = [];
  for (let p = 0; p < w * h; p++) if (!gone[p] && touchesGone(p, gone)) ring1.push(p);
  const first = new Uint8Array(w * h);
  for (const p of ring1) first[p] = 1;
  const ring2: number[] = [];
  for (let p = 0; p < w * h; p++) {
    if (gone[p] || first[p]) continue;
    if (touchesGone(p, first) && Math.min(data[p * 4], data[p * 4 + 1], data[p * 4 + 2]) >= 160) ring2.push(p);
  }
  for (const p of [...ring1, ...ring2]) {
    const i = p * 4;
    let a = 0;
    for (let c = 0; c < 3; c++) a = Math.max(a, Math.min(1, Math.max(0, (ref[c] - data[i + c]) / ref[c])));
    if (a < 0.03) {
      out[i + 3] = 0;
      continue;
    }
    for (let c = 0; c < 3; c++) out[i + c] = Math.max(0, Math.min(255, Math.round(ref[c] + (data[i + c] - ref[c]) / a)));
    out[i + 3] = Math.round(a * data[i + 3]);
  }

  const cleaned = await sharp(out, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
  return { outcome: "removed", png: cleaned, removedShare };
}
