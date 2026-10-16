// Cut-out of real photos (owner_photo, F-6) by the matting service in services/cutout/ (rembg with the BiRefNet portrait
// model). The service is reached over HTTP at CUTOUT_URL: POST the image bytes, get a PNG with alpha. Nothing runs
// in this process, so a missing service is a clear error, not a hang.

import sharp from 'sharp';
import { fitSize } from './chroma';
import { FaceGenError } from './errors';

/** Largest photo sent to the service. */
export const MATTING_MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
/** Largest PNG accepted back. */
export const MATTING_MAX_RESPONSE_BYTES = 16 * 1024 * 1024;
export const MATTING_TIMEOUT_MS = 60_000;

export interface MattingOptions {
  /** Defaults to process.env.CUTOUT_URL. */
  url?: string;
  /** Shared secret sent as a bearer token; defaults to process.env.CUTOUT_TOKEN (the service checks it when it has one). */
  token?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

/** Whether the matting service is configured. */
export function mattingConfigured(): boolean {
  return !!process.env.CUTOUT_URL?.trim();
}

/**
 * Sends a photo to the matting service and returns the transparent PNG, trimmed to the person and sized like a pose.
 * Throws FaceGenError: cutout_not_configured (no CUTOUT_URL), cutout_failed (too big, timed out, service error, no alpha).
 */
export async function mattingCutout(image: Buffer, opts: MattingOptions = {}): Promise<Buffer> {
  const url = (opts.url ?? process.env.CUTOUT_URL ?? '').trim();
  if (!url) throw new FaceGenError('cutout_not_configured');
  if (image.length === 0 || image.length > MATTING_MAX_UPLOAD_BYTES) throw new FaceGenError('cutout_failed', 'the photo is too large');
  const timeoutMs = opts.timeoutMs ?? MATTING_TIMEOUT_MS;
  const token = opts.token ?? process.env.CUTOUT_TOKEN?.trim();
  const doFetch = opts.fetchImpl ?? fetch;

  let res: Response;
  let bytes: Buffer;
  try {
    res = await doFetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream', accept: 'image/png', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: new Uint8Array(image),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new FaceGenError('cutout_failed', `the cut-out service answered ${res.status}`);
    const declared = Number(res.headers.get('content-length') ?? 0);
    if (declared > MATTING_MAX_RESPONSE_BYTES) throw new FaceGenError('cutout_failed', 'the cut-out answer is too large');
    bytes = Buffer.from(await res.arrayBuffer());
  } catch (e) {
    if (e instanceof FaceGenError) throw e;
    const timedOut = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
    throw new FaceGenError('cutout_failed', timedOut ? 'the cut-out service timed out' : 'the cut-out service could not be reached');
  }
  if (bytes.length === 0 || bytes.length > MATTING_MAX_RESPONSE_BYTES) throw new FaceGenError('cutout_failed', 'the cut-out answer is not usable');

  try {
    const meta = await sharp(bytes).metadata();
    if (meta.format !== 'png' || !meta.hasAlpha) throw new Error('no alpha');
    // Trim to the person like the chroma path does, then size like a pose.
    const trimmed = await sharp(bytes).trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 10 }).png().toBuffer();
    return await fitSize(trimmed);
  } catch {
    throw new FaceGenError('cutout_failed', 'the cut-out answer is not a transparent PNG');
  }
}
