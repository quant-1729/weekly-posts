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

/** The photo cover-cropped to its frame as a data URI. */
export async function photoUri(buf: Buffer, frame: Box): Promise<string | null> {
  try {
    const jpg = await sharp(buf, { failOn: 'none' }).rotate().resize(Math.round(frame.w), Math.round(frame.h), { fit: 'cover', position: 'centre' }).jpeg({ quality: 88 }).toBuffer();
    return `data:image/jpeg;base64,${jpg.toString('base64')}`;
  } catch {
    return null;
  }
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
