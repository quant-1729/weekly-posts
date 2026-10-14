// QR encoding (PRD v3 B-4.1, change C-10). Pure: no database, no network.
//
// Error correction is M. H is only for a QR with a logo laid over it, which we do not do.
// Quiet zone is at least 4 modules and the code is always dark on a light plate: some scanners
// cannot read light-on-dark.

import QRCode from "qrcode";
import sharp from "sharp";

export type QrEcc = "L" | "M" | "Q" | "H";

/** The standard minimum margin around a QR code, in modules. */
export const QUIET_ZONE_MODULES = 4;
export const DEFAULT_DARK = "#000000";
export const DEFAULT_LIGHT = "#FFFFFF";
/** Dark on light needs real contrast to scan; this is stricter than the 4.5:1 text rule. */
export const MIN_QR_CONTRAST = 7;

export class QrEncodeError extends Error {
  constructor(
    public readonly code: "too_long" | "empty" | "bad_colors" | "bad_quiet_zone",
    message: string,
  ) {
    super(message);
    this.name = "QrEncodeError";
  }
}

export interface QrEncodeOptions {
  /** Default "M". */
  ecc?: QrEcc;
  /** Modules of light margin on each side. At least 4 (default 4). */
  quietZone?: number;
  /** Default black. Must be darker than `light`. */
  dark?: string;
  /** Default white. */
  light?: string;
}

export interface QrMatrix {
  /** Modules per side, without the quiet zone. */
  size: number;
  /** modules[row][col], true = dark. */
  modules: boolean[][];
}

function parseHex(color: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(color.trim());
  if (!m) throw new QrEncodeError("bad_colors", `QR colours must be #RRGGBB, got "${color}"`);
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function luminance([r, g, b]: [number, number, number]): number {
  const f = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

export function contrastRatio(a: string, b: string): number {
  const la = luminance(parseHex(a));
  const lb = luminance(parseHex(b));
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Throws unless `dark` is darker than `light` with enough contrast. */
export function assertDarkOnLight(dark: string, light: string): void {
  const ld = luminance(parseHex(dark));
  const ll = luminance(parseHex(light));
  if (ld >= ll) throw new QrEncodeError("bad_colors", "A QR code must be dark on a light background");
  if (contrastRatio(dark, light) < MIN_QR_CONTRAST) {
    throw new QrEncodeError("bad_colors", `QR colours need a contrast of at least ${MIN_QR_CONTRAST}:1`);
  }
}

function settings(o: QrEncodeOptions) {
  const quietZone = o.quietZone ?? QUIET_ZONE_MODULES;
  if (!Number.isInteger(quietZone) || quietZone < QUIET_ZONE_MODULES) {
    throw new QrEncodeError("bad_quiet_zone", `The quiet zone must be at least ${QUIET_ZONE_MODULES} modules`);
  }
  const dark = o.dark ?? DEFAULT_DARK;
  const light = o.light ?? DEFAULT_LIGHT;
  assertDarkOnLight(dark, light);
  return { ecc: o.ecc ?? "M", quietZone, dark, light };
}

/** The module matrix for a text. Throws QrEncodeError when it is empty or too long for a QR code. */
export function qrMatrix(text: string, ecc: QrEcc = "M"): QrMatrix {
  if (text.length === 0) throw new QrEncodeError("empty", "Nothing to encode");
  let qr: ReturnType<typeof QRCode.create>;
  try {
    qr = QRCode.create(text, { errorCorrectionLevel: ecc });
  } catch {
    throw new QrEncodeError("too_long", "That is too long for a QR code");
  }
  const size = qr.modules.size;
  const modules: boolean[][] = [];
  for (let r = 0; r < size; r++) {
    const row: boolean[] = [];
    for (let c = 0; c < size; c++) row.push(qr.modules.get(r, c) === 1);
    modules.push(row);
  }
  return { size, modules };
}

/** Total modules per side including the quiet zone on both sides. */
export function totalModules(matrixSize: number, quietZone: number = QUIET_ZONE_MODULES): number {
  return matrixSize + 2 * quietZone;
}

/**
 * The QR code as an SVG string for the renderer. One <path> of unit squares (runs of dark modules
 * on a row become one rectangle) plus a light background rect. Plain attributes only: no CSS,
 * no <style>, no transforms, so resvg draws it exactly. `viewBox` is in modules; pass `sizePx`
 * to set width and height.
 */
export function qrSvg(text: string, o: QrEncodeOptions & { sizePx?: number } = {}): string {
  const { ecc, quietZone, dark, light } = settings(o);
  const { size, modules } = qrMatrix(text, ecc);
  const total = totalModules(size, quietZone);
  let d = "";
  for (let r = 0; r < size; r++) {
    let c = 0;
    while (c < size) {
      if (!modules[r][c]) {
        c++;
        continue;
      }
      const start = c;
      while (c < size && modules[r][c]) c++;
      d += `M${start + quietZone} ${r + quietZone}h${c - start}v1h-${c - start}z`;
    }
  }
  const dim = o.sizePx ? ` width="${o.sizePx}" height="${o.sizePx}"` : "";
  return (
    `<svg xmlns="http://www.w3.org/2000/svg"${dim} viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges">` +
    `<rect width="${total}" height="${total}" fill="${light}"/>` +
    `<path d="${d}" fill="${dark}"/></svg>`
  );
}

export interface QrPixels {
  data: Buffer; // RGBA
  width: number;
  height: number;
  /** Pixels per module. */
  scale: number;
}

/** The QR code as RGBA pixels, `scale` pixels per module (whole numbers, so edges are crisp). */
export function qrPixels(text: string, o: QrEncodeOptions & { scale?: number } = {}): QrPixels {
  const { ecc, quietZone, dark, light } = settings(o);
  const scale = o.scale ?? 8;
  if (!Number.isInteger(scale) || scale < 1) throw new RangeError("scale must be a whole number of pixels per module");
  const { size, modules } = qrMatrix(text, ecc);
  const total = totalModules(size, quietZone);
  const width = total * scale;
  const [dr, dg, db] = parseHex(dark);
  const [lr, lg, lb] = parseHex(light);
  const data = Buffer.alloc(width * width * 4);
  for (let y = 0; y < width; y++) {
    const my = Math.floor(y / scale) - quietZone;
    for (let x = 0; x < width; x++) {
      const mx = Math.floor(x / scale) - quietZone;
      const isDark = my >= 0 && my < size && mx >= 0 && mx < size && modules[my][mx];
      const i = (y * width + x) * 4;
      data[i] = isDark ? dr : lr;
      data[i + 1] = isDark ? dg : lg;
      data[i + 2] = isDark ? db : lb;
      data[i + 3] = 255;
    }
  }
  return { data, width, height: width, scale };
}

/** The QR code as a PNG. */
export async function qrPng(text: string, o: QrEncodeOptions & { scale?: number } = {}): Promise<Buffer> {
  const px = qrPixels(text, o);
  return sharp(px.data, { raw: { width: px.width, height: px.height, channels: 4 } })
    .png()
    .toBuffer();
}
