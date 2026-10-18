// Photo understanding by code (no AI needed): the photo's main colours, whether its background is plain (a product
// shot that can be cut out), where the subject sits, and a background cut-out by flood fill from the edges.
// Pure functions over RGBA pixels: the browser feeds them from a canvas, the server from sharp.

import { hslOf, rgbToHex, type RGB } from './color';

export interface PhotoAnalysis {
  /** Main colours, strongest first (up to 6). */
  colors: string[];
  /** Colour of the edges (the photo's background). */
  edge: string;
  /** The edges are one plain colour: a clean cut-out is likely. */
  plainBackground: boolean;
  /** Where the subject is (0..1). */
  focus: { x: number; y: number };
  /** Average brightness 0..1. */
  brightness: number;
  /** How busy the picture is 0..1 (edge density). */
  busy: number;
}

const dist2 = (a: RGB, b: RGB) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

function px(d: ArrayLike<number>, i: number): RGB {
  return [d[i * 4], d[i * 4 + 1], d[i * 4 + 2]];
}

/** Simple k-means on a sample of pixels. */
function kmeans(samples: RGB[], k: number): { c: RGB; n: number }[] {
  if (samples.length === 0) return [];
  let cs: RGB[] = [];
  for (let i = 0; i < k; i++) cs.push(samples[Math.floor((i + 0.5) * (samples.length / k))]);
  let counts = new Array(k).fill(0);
  for (let it = 0; it < 8; it++) {
    const sum = cs.map(() => [0, 0, 0]);
    counts = new Array(k).fill(0);
    for (const s of samples) {
      let best = 0;
      let bd = Infinity;
      for (let j = 0; j < cs.length; j++) {
        const d = dist2(s, cs[j]);
        if (d < bd) {
          bd = d;
          best = j;
        }
      }
      counts[best]++;
      sum[best][0] += s[0];
      sum[best][1] += s[1];
      sum[best][2] += s[2];
    }
    cs = cs.map((c, j) => (counts[j] ? ([sum[j][0] / counts[j], sum[j][1] / counts[j], sum[j][2] / counts[j]] as RGB) : c));
  }
  return cs.map((c, j) => ({ c, n: counts[j] })).filter((x) => x.n > 0);
}

export function analyzePixels(data: ArrayLike<number>, w: number, h: number): PhotoAnalysis {
  const n = w * h;
  const step = Math.max(1, Math.floor(n / 4000));
  const samples: RGB[] = [];
  let bright = 0;
  for (let i = 0; i < n; i += step) {
    if (data[i * 4 + 3] < 128) continue;
    const p = px(data, i);
    samples.push(p);
    bright += (p[0] * 0.299 + p[1] * 0.587 + p[2] * 0.114) / 255;
  }
  const clusters = kmeans(samples, 6).sort((a, b) => {
    // Weight by size and colourfulness, so a small bright subject still counts.
    const sa = a.n * (0.5 + hslOf(rgbToHex(a.c))[1]);
    const sb = b.n * (0.5 + hslOf(rgbToHex(b.c))[1]);
    return sb - sa;
  });
  const colors: string[] = [];
  for (const c of clusters) {
    const hx = rgbToHex(c.c);
    if (!colors.some((o) => dist2(c.c, hexRgb(o)) < 900)) colors.push(hx);
  }

  // Edges: the outer ring of pixels.
  const ring: RGB[] = [];
  const ringStep = Math.max(1, Math.floor((w + h) / 200));
  for (let x = 0; x < w; x += ringStep) ring.push(px(data, x), px(data, (h - 1) * w + x));
  for (let y = 0; y < h; y += ringStep) ring.push(px(data, y * w), px(data, y * w + w - 1));
  const avg: RGB = [0, 0, 0];
  for (const p of ring) {
    avg[0] += p[0] / ring.length;
    avg[1] += p[1] / ring.length;
    avg[2] += p[2] / ring.length;
  }
  const spread = Math.sqrt(ring.reduce((a, p) => a + dist2(p, avg), 0) / ring.length);
  const plainBackground = spread < 26;

  // Focus: centre of the pixels that differ most from the edge colour, plus local contrast.
  let fx = 0;
  let fy = 0;
  let wsum = 0;
  let edges = 0;
  const s2 = Math.max(1, Math.floor(Math.sqrt(n / 6000)));
  for (let y = s2; y < h - s2; y += s2) {
    for (let x = s2; x < w - s2; x += s2) {
      const i = y * w + x;
      const p = px(data, i);
      const right = px(data, i + s2);
      const down = px(data, i + s2 * w);
      const g = Math.sqrt(dist2(p, right)) + Math.sqrt(dist2(p, down));
      if (g > 60) edges++;
      const wgt = Math.sqrt(dist2(p, avg)) * 0.6 + g * 0.4;
      // Centre bias: subjects tend to sit near the middle.
      const cb = 1 - 0.5 * (Math.abs(x / w - 0.5) + Math.abs(y / h - 0.5));
      fx += x * wgt * cb;
      fy += y * wgt * cb;
      wsum += wgt * cb;
    }
  }
  const cells = Math.max(1, ((w - 2 * s2) / s2) * ((h - 2 * s2) / s2));
  return {
    colors: colors.slice(0, 6),
    edge: rgbToHex(avg),
    plainBackground,
    focus: wsum > 0 ? { x: clamp01(fx / wsum / w), y: clamp01(fy / wsum / h) } : { x: 0.5, y: 0.5 },
    brightness: samples.length ? bright / samples.length : 0.5,
    busy: Math.min(1, (edges / cells) * 3),
  };
}

const clamp01 = (v: number) => Math.max(0.05, Math.min(0.95, v));
function hexRgb(hex: string): RGB {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Removes a plain background: flood fill from every edge pixel over colours close to the edge colour, then a soft
 * edge. Returns new RGBA data (the input is not changed) and how much of the picture was removed (0..1).
 */
export function cutoutPixels(data: Uint8ClampedArray | Uint8Array, w: number, h: number, tolerance = 42): { data: Uint8ClampedArray; removed: number } {
  const out = new Uint8ClampedArray(data);
  const n = w * h;
  const seen = new Uint8Array(n);
  const bgMask = new Uint8Array(n);
  const queue = new Int32Array(n);
  let qh = 0;
  let qt = 0;
  // Reference colours: samples along the edges (handles soft gradients in the background).
  const refs: RGB[] = [];
  const st = Math.max(1, Math.floor((w + h) / 60));
  for (let x = 0; x < w; x += st) refs.push(px(data, x), px(data, (h - 1) * w + x));
  for (let y = 0; y < h; y += st) refs.push(px(data, y * w), px(data, y * w + w - 1));
  const tol2 = tolerance * tolerance;
  const nearBg = (p: RGB) => refs.some((r) => dist2(p, r) < tol2);
  const push = (i: number) => {
    if (seen[i]) return;
    seen[i] = 1;
    if (data[i * 4 + 3] < 20 || nearBg(px(data, i))) {
      bgMask[i] = 1;
      queue[qt++] = i;
    }
  };
  for (let x = 0; x < w; x++) {
    push(x);
    push((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    push(y * w);
    push(y * w + w - 1);
  }
  while (qh < qt) {
    const i = queue[qh++];
    const x = i % w;
    const y = (i - x) / w;
    if (x > 0) push(i - 1);
    if (x < w - 1) push(i + 1);
    if (y > 0) push(i - w);
    if (y < h - 1) push(i + w);
  }
  let removed = 0;
  for (let i = 0; i < n; i++) {
    if (bgMask[i]) {
      out[i * 4 + 3] = 0;
      removed++;
    }
  }
  // Soften: pixels next to the background get partial alpha.
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (bgMask[i]) continue;
      const near = bgMask[i - 1] + bgMask[i + 1] + bgMask[i - w] + bgMask[i + w];
      if (near > 0) out[i * 4 + 3] = Math.round(out[i * 4 + 3] * (1 - near * 0.18));
    }
  }
  return { data: out, removed: removed / n };
}

/** The tightest box around the visible pixels (to trim a cut-out). */
export function opaqueBounds(data: ArrayLike<number>, w: number, h: number): { x: number; y: number; w: number; h: number } | null {
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (data[(y * w + x) * 4 + 3] > 24) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
  if (maxX < 0) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}
