// Reading a QR code back from pixels. Used after rendering: a payment QR must decode to exactly
// the confirmed payment string, or the post is blocked (change C-10).

import jsQR from "jsqr";
import sharp from "sharp";

export interface DecodeRegion {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Decodes the first QR code found in RGBA pixels, or null. */
export function decodeQrRgba(data: Uint8ClampedArray | Uint8Array | Buffer, width: number, height: number): string | null {
  const clamped = data instanceof Uint8ClampedArray ? data : new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength);
  const found = jsQR(clamped, width, height, { inversionAttempts: "attemptBoth" });
  return found ? found.data : null;
}

/** Decodes a PNG (or any image sharp reads). `region` limits the search to the QR slot. */
export async function decodeQrPng(png: Buffer, region?: DecodeRegion): Promise<string | null> {
  let img = sharp(png);
  if (region) img = img.extract(region);
  // Flatten onto white so a transparent area is never read as black.
  const { data, info } = await img.flatten({ background: "#ffffff" }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return decodeQrRgba(data, info.width, info.height);
}

export interface VerifyResult {
  ok: boolean;
  /** What the picture decoded to, or null when no QR code could be read. */
  decoded: string | null;
}

/**
 * ok is true only when the rendered picture holds a QR code whose text equals `expected` exactly
 * (no trimming, no case folding).
 */
export async function verifyRendered(png: Buffer, expected: string, region?: DecodeRegion): Promise<VerifyResult> {
  const decoded = await decodeQrPng(png, region);
  return { ok: decoded !== null && decoded === expected, decoded };
}
