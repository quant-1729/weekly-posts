import sharp from "sharp";
import { getStorage, type Storage } from "@/lib/storage";
import { logoStoragePath } from "./logo-url";
import { paletteFromPrimary, rgbToHex, rgbToHsl, tint, type Palette } from "./colors";

/** Logo rules (R2): png/jpg/webp only (no SVG), max 2 MB, saved as a PNG of at most 512 px. */
export const LOGO_MAX_BYTES = 2 * 1024 * 1024;
export const LOGO_MAX_PX = 512;
const ALLOWED_FORMATS = new Set(["png", "jpeg", "webp"]);

export type LogoErrorCode = "empty" | "too_large" | "unsupported_type" | "invalid_image";

export class LogoError extends Error {
  constructor(public readonly code: LogoErrorCode) {
    super(code);
    this.name = "LogoError";
  }
}

export interface NormalizedLogo {
  png: Buffer;
  width: number;
  height: number;
  /** Palette from the logo's main colours, or null when the logo has no usable colour (all white or transparent). */
  palette: Palette | null;
}

function looksLikeText(bytes: Uint8Array): boolean {
  const head = Buffer.from(bytes.subarray(0, 512)).toString("utf8").trimStart().toLowerCase();
  return head.startsWith("<svg") || head.startsWith("<?xml") || head.startsWith("<!doctype") || head.startsWith("<html");
}

/**
 * Checks and normalises an uploaded logo. The format is read from the file
 * itself, not from its name or declared type, so a renamed SVG is still rejected.
 */
export async function normalizeLogo(bytes: Uint8Array, declaredType?: string): Promise<NormalizedLogo> {
  if (bytes.byteLength === 0) throw new LogoError("empty");
  if (bytes.byteLength > LOGO_MAX_BYTES) throw new LogoError("too_large");
  if (declaredType && /svg/i.test(declaredType)) throw new LogoError("unsupported_type");
  if (looksLikeText(bytes)) throw new LogoError("unsupported_type");

  const input = Buffer.from(bytes);
  try {
    const meta = await sharp(input, { limitInputPixels: 40_000_000 }).metadata();
    if (!meta.format || !ALLOWED_FORMATS.has(meta.format)) throw new LogoError("unsupported_type");

    const { data, info } = await sharp(input, { limitInputPixels: 40_000_000 })
      .rotate() // honour EXIF orientation from phone cameras
      .resize({ width: LOGO_MAX_PX, height: LOGO_MAX_PX, fit: "inside", withoutEnlargement: true })
      .png()
      .toBuffer({ resolveWithObject: true });
    return { png: data, width: info.width, height: info.height, palette: await paletteFromImage(data) };
  } catch (e) {
    if (e instanceof LogoError) throw e;
    throw new LogoError("invalid_image");
  }
}

/** Suggests {primary, secondary, accent} from the most prominent, colourful pixels. */
export async function paletteFromImage(image: Buffer): Promise<Palette | null> {
  const { data, info } = await sharp(image)
    .resize(64, 64, { fit: "inside" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  // 4 bits per channel buckets; weight favours saturated colours over greys.
  const bins = new Map<number, { r: number; g: number; b: number; n: number; weight: number }>();
  for (let i = 0; i < info.width * info.height; i++) {
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2], a = data[i * 4 + 3];
    if (a < 128) continue;
    const [, s, l] = rgbToHsl(r, g, b);
    if (l > 0.92) continue; // background white
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const bin = bins.get(key) ?? { r: 0, g: 0, b: 0, n: 0, weight: 0 };
    bin.r += r; bin.g += g; bin.b += b; bin.n += 1; bin.weight += 0.15 + s;
    bins.set(key, bin);
  }
  const ranked = [...bins.values()]
    .map((b) => ({ rgb: [b.r / b.n, b.g / b.n, b.b / b.n] as [number, number, number], weight: b.weight }))
    .sort((x, y) => y.weight - x.weight);
  if (ranked.length === 0) return null;

  const primaryRgb = ranked[0].rgb;
  const primary = rgbToHex(...primaryRgb);
  const far = ranked.find((c) => {
    const d = Math.hypot(c.rgb[0] - primaryRgb[0], c.rgb[1] - primaryRgb[1], c.rgb[2] - primaryRgb[2]);
    return d > 90 && c.weight > ranked[0].weight * 0.05;
  });
  const accent = far ? rgbToHex(...far.rgb) : paletteFromPrimary(primary).accent;
  return { primary, secondary: tint(primary, 0.92), accent };
}

export async function saveLogoFile(brandId: string, png: Uint8Array, storage: Storage = getStorage()): Promise<string> {
  await storage.put("brand-assets", `${brandId}/logo.png`, png, "image/png");
  return logoStoragePath(brandId);
}

export async function removeLogoFile(brandId: string, storage: Storage = getStorage()): Promise<void> {
  await storage.remove("brand-assets", `${brandId}/logo.png`);
}
