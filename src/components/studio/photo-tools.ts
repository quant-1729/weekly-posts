"use client";

import { analyzePixels, cutoutPixels, opaqueBounds, type PhotoAnalysis } from "@/lib/studio/photo";

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("load"));
    img.src = src;
  });
}

function pixels(img: HTMLImageElement, max: number) {
  const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * k));
  const h = Math.max(1, Math.round(img.naturalHeight * k));
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, w, h);
  return { ctx, c, w, h, data: ctx.getImageData(0, 0, w, h) };
}

const loaded = new Set<string>();

/** Fetches and decodes a picture so the browser holds it before the poster shows it (no blank moment when it is swapped in). Never throws. */
export async function preloadImage(src: string): Promise<void> {
  if (loaded.has(src)) return;
  try {
    const img = new Image();
    img.src = src;
    await img.decode();
    loaded.add(src);
  } catch {
    /* the poster still shows it when it arrives */
  }
}

const cache = new Map<string, PhotoAnalysis>();

/** The photo's colours, focus point and whether its background is plain (by code, in the browser). */
export async function analyzeImage(src: string): Promise<PhotoAnalysis> {
  const hit = cache.get(src);
  if (hit) return hit;
  try {
    const img = await loadImage(src);
    const p = pixels(img, 160);
    const a = analyzePixels(p.data.data, p.w, p.h);
    cache.set(src, a);
    return a;
  } catch {
    return { colors: [], edge: "#FFFFFF", plainBackground: false, focus: { x: 0.5, y: 0.5 }, brightness: 0.5, busy: 0.5 };
  }
}

export type CutoutResult = { ok: true; src: string; w: number; h: number } | { ok: false; message: string };

/** Cuts a plain background away, trims the picture, and stores it as a PNG of this brand. */
export async function cutoutImage(src: string, brandId: string): Promise<CutoutResult> {
  let img: HTMLImageElement;
  try {
    img = await loadImage(src);
  } catch {
    return { ok: false, message: "Could not open that picture." };
  }
  const p = pixels(img, 1100);
  const cut = cutoutPixels(p.data.data, p.w, p.h);
  if (cut.removed < 0.04) return { ok: false, message: "The background is too busy to cut out cleanly. Try a frame or an edge fade instead, or use a photo on a plain background." };
  if (cut.removed > 0.96) return { ok: false, message: "That would remove almost the whole picture. Try a frame instead." };
  const b = opaqueBounds(cut.data, p.w, p.h) ?? { x: 0, y: 0, w: p.w, h: p.h };
  const out = document.createElement("canvas");
  out.width = b.w;
  out.height = b.h;
  const full = new ImageData(new Uint8ClampedArray(cut.data), p.w, p.h);
  const tmp = document.createElement("canvas");
  tmp.width = p.w;
  tmp.height = p.h;
  tmp.getContext("2d")!.putImageData(full, 0, 0);
  out.getContext("2d")!.drawImage(tmp, b.x, b.y, b.w, b.h, 0, 0, b.w, b.h);
  const blob = await new Promise<Blob | null>((r) => out.toBlob(r, "image/png"));
  if (!blob) return { ok: false, message: "Could not make the cut-out." };
  const fd = new FormData();
  fd.set("brand_id", brandId);
  fd.set("file", new File([blob], "cutout.png", { type: "image/png" }));
  try {
    const res = await fetch("/api/studio/assets", { method: "POST", body: fd });
    const json = await res.json();
    if (json.ok) return { ok: true, src: json.src, w: b.w, h: b.h };
    return { ok: false, message: json.message ?? "Could not save the cut-out." };
  } catch {
    return { ok: false, message: "Could not save the cut-out." };
  }
}
