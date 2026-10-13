import sharp from "sharp";
import {
  MODEL_PHOTO_PX,
  PHOTO_JPEG_QUALITY,
  PHOTO_MAX_BYTES,
  PHOTO_MAX_PX,
} from "./limits";
import { UploadError } from "./errors";

const ALLOWED_FORMATS = new Set(["jpeg", "png", "webp"]);
const ALLOWED_TYPES = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]);

export interface ProcessedImage {
  jpeg: Buffer;
  width: number;
  height: number;
}

/** HEIC/HEIF/AVIF files start with an ISO "ftyp" box; sharp's prebuilt binaries cannot decode HEIC. */
function looksLikeHeif(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 12) return false;
  const head = Buffer.from(bytes.subarray(4, 12)).toString("latin1");
  return /^ftyp(heic|heix|hevc|hevx|heim|heis|mif1|msf1|avif)/.test(head);
}

/**
 * Checks and normalises an uploaded photo or screenshot. The type is read from the file itself.
 * Output: auto-rotated from EXIF, all metadata (EXIF, GPS, ICC, XMP) removed, at most 2400 px,
 * JPEG quality 85. Throws UploadError (empty, too_large, bad_type, unreadable).
 */
export async function processUpload(bytes: Uint8Array, mimeType?: string): Promise<ProcessedImage> {
  if (bytes.byteLength === 0) throw new UploadError("empty");
  if (bytes.byteLength > PHOTO_MAX_BYTES) throw new UploadError("too_large");
  const declared = (mimeType ?? "").toLowerCase().trim();
  if (declared && !ALLOWED_TYPES.has(declared) && declared !== "application/octet-stream") throw new UploadError("bad_type");
  if (looksLikeHeif(bytes)) throw new UploadError("bad_type");

  const input = Buffer.from(bytes);
  let format: string | undefined;
  try {
    format = (await sharp(input, { limitInputPixels: 100_000_000 }).metadata()).format;
  } catch {
    throw new UploadError("unreadable");
  }
  if (!format || !ALLOWED_FORMATS.has(format)) throw new UploadError("bad_type");

  try {
    // sharp drops all metadata unless withMetadata() is called; rotate() applies EXIF orientation first.
    const { data, info } = await sharp(input, { limitInputPixels: 100_000_000 })
      .rotate()
      .resize({ width: PHOTO_MAX_PX, height: PHOTO_MAX_PX, fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#ffffff" }) // transparent PNGs become white, not black
      .jpeg({ quality: PHOTO_JPEG_QUALITY })
      .toBuffer({ resolveWithObject: true });
    return { jpeg: data, width: info.width, height: info.height };
  } catch {
    throw new UploadError("unreadable");
  }
}

/** A smaller copy for the model (cheaper, faster). */
export async function shrinkForModel(jpeg: Uint8Array, maxSide: number = MODEL_PHOTO_PX): Promise<Buffer> {
  return sharp(Buffer.from(jpeg))
    .resize({ width: maxSide, height: maxSide, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toBuffer();
}
