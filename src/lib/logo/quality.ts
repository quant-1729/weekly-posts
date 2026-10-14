import sharp from "sharp";

/** Under this many pixels on the short side a logo looks blurry on a post. */
export const LOGO_MIN_SHORT_SIDE = 300;

export function isLowResolution(width: number, height: number): boolean {
  return Math.min(width, height) < LOGO_MIN_SHORT_SIDE;
}

/** Pixel size of an image as the owner sees it (EXIF rotation applied). Null when it cannot be read. */
export async function imageSize(bytes: Uint8Array): Promise<{ width: number; height: number } | null> {
  try {
    const m = await sharp(Buffer.from(bytes), { limitInputPixels: 40_000_000 }).metadata();
    if (!m.width || !m.height) return null;
    const turned = (m.orientation ?? 1) >= 5;
    return turned ? { width: m.height, height: m.width } : { width: m.width, height: m.height };
  } catch {
    return null;
  }
}
