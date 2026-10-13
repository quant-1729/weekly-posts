/**
 * Browser-side photo downscale: longest side 2048 px, JPEG quality 0.85, so phone photos
 * (often 5-10 MB) stay under Vercel's 4.5 MB request limit. Safe to import in the browser only
 * for `downscalePhoto`; `fitWithin` is pure.
 */

export const UPLOAD_MAX_SIDE = 2048;
export const UPLOAD_JPEG_QUALITY = 0.85;

/** Size that fits inside max x max, keeping the ratio. Never enlarges. */
export function fitWithin(width: number, height: number, max: number = UPLOAD_MAX_SIDE): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= max) return { width, height };
  const scale = max / longest;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

async function decode(file: File): Promise<{ source: CanvasImageSource; width: number; height: number; close: () => void }> {
  if (typeof createImageBitmap === "function") {
    try {
      // Respects the EXIF rotation on current browsers.
      const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
      return { source: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close() };
    } catch {
      // fall through to <img>
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => URL.revokeObjectURL(url) };
  } catch (e) {
    URL.revokeObjectURL(url);
    throw e;
  }
}

/** Returns a JPEG blob, or throws when the file is not a readable image. */
export async function downscalePhoto(file: File, maxSide: number = UPLOAD_MAX_SIDE): Promise<Blob> {
  const img = await decode(file);
  try {
    const { width, height } = fitWithin(img.width, img.height, maxSide);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas not available");
    ctx.fillStyle = "#ffffff"; // transparent PNGs become white, not black
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img.source, 0, 0, width, height);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not encode photo"))), "image/jpeg", UPLOAD_JPEG_QUALITY),
    );
  } finally {
    img.close();
  }
}
