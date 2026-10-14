// Size rules for QR codes on a post (PRD v3 B-4: minimum 2.5 cm / 300 px). Pure.
// Phase 2's renderer asks fitsSlot() before placing a QR; a slot that cannot hold a readable
// code is a template bug, not something to shrink silently.

import { qrMatrix, totalModules, QUIET_ZONE_MODULES, type QrEcc } from "./encode";

/** Minimum width of the whole QR square (quiet zone included) on a 1080 px wide post. */
export const MIN_QR_PX_AT_1080 = 300;
/** Below this many pixels per module phone cameras struggle after social-app recompression. */
export const MIN_MODULE_PX = 4;

/** Minimum QR square in pixels for a canvas of this width (scaled from 300 px at 1080 px). */
export function minQrPx(canvasWidth: number): number {
  return Math.ceil((MIN_QR_PX_AT_1080 * canvasWidth) / 1080);
}

export interface SlotFit {
  fits: boolean;
  /** Pixels per module: a whole number, so edges stay sharp. 0 when it cannot fit at all. */
  modulePx: number;
  /** The QR square actually drawn (quiet zone included). */
  qrPx: number;
  minPx: number;
  modules: number;
  reason?: "too_small" | "module_too_small";
}

/**
 * Can this text's QR code be drawn in a slot of `slot` pixels on a canvas `canvasWidth` wide?
 * The code is drawn as large as a whole number of pixels per module allows. A slot that is
 * too small gives fits false and says why.
 */
export function fitsSlot(args: {
  text: string;
  slot: { width: number; height: number };
  canvasWidth: number;
  ecc?: QrEcc;
  quietZone?: number;
}): SlotFit {
  const { size } = qrMatrix(args.text, args.ecc ?? "M");
  const modules = totalModules(size, args.quietZone ?? QUIET_ZONE_MODULES);
  const minPx = minQrPx(args.canvasWidth);
  const room = Math.floor(Math.min(args.slot.width, args.slot.height));
  const modulePx = Math.floor(room / modules);
  const qrPx = modulePx * modules;
  if (modulePx < MIN_MODULE_PX) return { fits: false, modulePx, qrPx, minPx, modules, reason: "module_too_small" };
  if (qrPx < minPx) return { fits: false, modulePx, qrPx, minPx, modules, reason: "too_small" };
  return { fits: true, modulePx, qrPx, minPx, modules };
}

/** The smallest square slot (pixels) that holds this text's QR code at the minimum size. */
export function minSlotPx(text: string, canvasWidth: number, ecc: QrEcc = "M"): number {
  const modules = totalModules(qrMatrix(text, ecc).size);
  const perModule = Math.max(MIN_MODULE_PX, Math.ceil(minQrPx(canvasWidth) / modules));
  return perModule * modules;
}
