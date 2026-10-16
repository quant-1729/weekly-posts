// Image preparation for designs: logo, owner photo and the Imagen texture. All inputs are untrusted
// buffers; anything sharp cannot read is treated as absent.

import sharp from 'sharp';
import type { Box } from '@/lib/render';
import type { PreparedLogo } from './scene';

const PHOTO_MAX_SIDE = 2400;

export async function prepareLogo(buf: Buffer | null | undefined): Promise<PreparedLogo | null> {
  if (!buf || !buf.length) return null;
  try {
    const { data, info } = await sharp(buf, { failOn: 'none' }).resize(480, 480, { fit: 'inside', withoutEnlargement: true }).png().toBuffer({ resolveWithObject: true });
    return { uri: `data:image/png;base64,${data.toString('base64')}`, w: info.width, h: info.height };
  } catch {
    return null;
  }
}

/** A photo sharp can read, shrunk once to a sensible size; undefined when unreadable. */
export async function usablePhoto(buf: Buffer | null | undefined): Promise<Buffer | undefined> {
  if (!buf || !buf.length) return undefined;
  try {
    const meta = await sharp(buf, { failOn: 'none' }).metadata();
    if (!meta.width || !meta.height) return undefined;
    if (Math.max(meta.width, meta.height) <= PHOTO_MAX_SIDE) return buf;
    return await sharp(buf, { failOn: 'none' }).rotate().resize(PHOTO_MAX_SIDE, PHOTO_MAX_SIDE, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 92 }).toBuffer();
  } catch {
    return undefined;
  }
}

const subjectCache = new WeakMap<Buffer, Promise<{ x: number; y: number }>>();

/**
 * Where the photo's subject is, as a fraction of the picture (0-1 each way): the centre of the pixels that differ most
 * from the picture's average colour, taken on a 48 px copy (so camera grain does not count). Flat pictures give the centre.
 * Kept within 0.25-0.75 so a stray bright corner cannot drag the crop far.
 */
export function subjectCentre(buf: Buffer): Promise<{ x: number; y: number }> {
  let hit = subjectCache.get(buf);
  if (!hit) {
    hit = (async () => {
      try {
        const { data, info } = await sharp(buf, { failOn: 'none' }).rotate().resize(48, 48, { fit: 'inside' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
        const n = info.width * info.height;
        const mean = [0, 0, 0];
        for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) mean[c] += data[i * 3 + c] / n;
        const w = new Float64Array(n);
        let sum = 0;
        for (let i = 0; i < n; i++) {
          const d = Math.hypot(data[i * 3] - mean[0], data[i * 3 + 1] - mean[1], data[i * 3 + 2] - mean[2]);
          w[i] = d * d;
          sum += w[i];
        }
        if (sum < 1e-6) return { x: 0.5, y: 0.5 };
        let cx = 0;
        let cy = 0;
        for (let i = 0; i < n; i++) {
          cx += (w[i] / sum) * (((i % info.width) + 0.5) / info.width);
          cy += (w[i] / sum) * ((Math.floor(i / info.width) + 0.5) / info.height);
        }
        const clamp = (v: number) => Math.min(0.75, Math.max(0.25, v));
        return { x: clamp(cx), y: clamp(cy) };
      } catch {
        return { x: 0.5, y: 0.5 };
      }
    })();
    subjectCache.set(buf, hit);
  }
  return hit;
}

/**
 * The photo cover-cropped to its frame as a data URI. The crop is not simply centred: it puts the photo's subject at the
 * middle of `free` (the part of the frame no text or card covers; the whole frame when not given), as far as the crop allows.
 */
export async function photoUri(buf: Buffer, frame: Box, free?: Box): Promise<string | null> {
  try {
    const fw = Math.max(1, Math.round(frame.w));
    const fh = Math.max(1, Math.round(frame.h));
    const meta = await sharp(buf, { failOn: 'none' }).metadata();
    const swap = (meta.orientation ?? 1) >= 5;
    const iw = (swap ? meta.height : meta.width) ?? fw;
    const ih = (swap ? meta.width : meta.height) ?? fh;
    const k = Math.max(fw / iw, fh / ih);
    const sw = Math.max(fw, Math.round(iw * k));
    const sh = Math.max(fh, Math.round(ih * k));
    const subject = await subjectCentre(buf);
    const area = free ? { x: Math.max(frame.x, free.x), y: Math.max(frame.y, free.y), x1: Math.min(frame.x + frame.w, free.x + free.w), y1: Math.min(frame.y + frame.h, free.y + free.h) } : null;
    const tx = area && area.x1 > area.x ? ((area.x + area.x1) / 2 - frame.x) / frame.w : 0.5;
    const ty = area && area.y1 > area.y ? ((area.y + area.y1) / 2 - frame.y) / frame.h : 0.5;
    const left = Math.min(sw - fw, Math.max(0, Math.round(subject.x * sw - tx * fw)));
    const top = Math.min(sh - fh, Math.max(0, Math.round(subject.y * sh - ty * fh)));
    const jpg = await sharp(buf, { failOn: 'none' }).rotate().resize(sw, sh, { fit: 'fill' }).extract({ left, top, width: fw, height: fh }).jpeg({ quality: 88 }).toBuffer();
    return `data:image/jpeg;base64,${jpg.toString('base64')}`;
  } catch {
    return null;
  }
}

/** The photo enlarged to cover the whole canvas and blurred: the ground a framed photo sits on (drawn small, then stretched). */
export async function photoBlurUri(buf: Buffer, w: number, h: number): Promise<string | null> {
  try {
    const jpg = await sharp(buf, { failOn: 'none' }).rotate().resize(Math.round(w / 6), Math.round(h / 6), { fit: 'cover', position: 'centre' }).blur(7).jpeg({ quality: 85 }).toBuffer();
    return `data:image/jpeg;base64,${jpg.toString('base64')}`;
  } catch {
    return null;
  }
}

/** An SVG mask (and its gradient) that fades one edge of `frame` from opaque to transparent over `size` px. */
export function fadeMaskSvg(id: string, frame: Box, fade: { side: 'top' | 'bottom' | 'left' | 'right'; size: number }): string {
  const { x, y, w, h } = frame;
  const size = Math.max(1, Math.min(fade.size, fade.side === 'left' || fade.side === 'right' ? w : h));
  const g =
    fade.side === 'bottom' ? [x, y + h - size, x, y + h] : fade.side === 'top' ? [x, y + size, x, y] : fade.side === 'right' ? [x + w - size, y, x + w, y] : [x + size, y, x, y];
  const r = (n: number) => Math.round(n * 100) / 100;
  return (
    `<defs><linearGradient id="${id}g" gradientUnits="userSpaceOnUse" x1="${r(g[0])}" y1="${r(g[1])}" x2="${r(g[2])}" y2="${r(g[3])}">` +
    `<stop offset="0" stop-color="#fff"/><stop offset="0.5" stop-color="#8c8c8c"/><stop offset="1" stop-color="#000"/></linearGradient>` +
    `<mask id="${id}" maskUnits="userSpaceOnUse" x="${r(x)}" y="${r(y)}" width="${r(w)}" height="${r(h)}"><rect x="${r(x)}" y="${r(y)}" width="${r(w)}" height="${r(h)}" fill="url(#${id}g)"/></mask></defs>`
  );
}

export async function textureUri(buf: Buffer | null | undefined, w: number, h: number): Promise<string | null> {
  if (!buf || !buf.length) return null;
  try {
    const jpg = await sharp(buf, { failOn: 'none' }).resize(w, h, { fit: 'cover', position: 'centre' }).jpeg({ quality: 85 }).toBuffer();
    return `data:image/jpeg;base64,${jpg.toString('base64')}`;
  } catch {
    return null;
  }
}
