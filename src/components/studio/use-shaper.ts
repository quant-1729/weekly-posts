"use client";

// Loads HarfBuzz (wasm) and the font files in the browser, once per page, and gives the studio a shaper that
// draws exactly what the server will store.

import { useEffect, useState } from "react";
import { StudioShaper, type HarfBuzz } from "@/lib/studio/shaper";
import { STUDIO_FONTS, fontFile, WEIGHT_NAME } from "@/lib/studio/fonts";

const bytes = new Map<string, Uint8Array>();
const pending = new Map<string, Promise<void>>();
let shaper: StudioShaper | null = null;
let hbPromise: Promise<StudioShaper> | null = null;
const listeners = new Set<() => void>();
let version = 0;
const HB_URL = "/vendor/harfbuzz/index.mjs";

function notify() {
  version++;
  for (const l of listeners) l();
}

export function loadShaper(): Promise<StudioShaper> {
  // harfbuzzjs is served as a static ES module (public/vendor/harfbuzz, copied from node_modules/harfbuzzjs/dist): its
  // Node-only branch imports "module", which the browser bundle cannot resolve.
  const url: string = HB_URL;
  hbPromise ??= (import(/* webpackIgnore: true */ /* turbopackIgnore: true */ /* @vite-ignore */ url) as Promise<unknown>).then((hb) => {
    shaper = new StudioShaper(hb as unknown as HarfBuzz, (f) => bytes.get(f) ?? null);
    return shaper;
  });
  return hbPromise;
}

export function loadFontFile(file: string): Promise<void> {
  if (bytes.has(file)) return Promise.resolve();
  let p = pending.get(file);
  if (!p) {
    p = fetch(`/api/fonts/${file}`)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
      .then((b) => {
        bytes.set(file, new Uint8Array(b));
        notify();
      })
      .catch(() => {
        pending.delete(file);
      });
    pending.set(file, p);
  }
  return p;
}

/** Loads what a list of (font, weight) pairs needs; resolves when all are in. */
export async function ensureFonts(list: { font: string; weight: number }[]): Promise<void> {
  const files = new Set<string>();
  for (const { font, weight } of list) for (const f of StudioShaper.filesFor(font, weight)) files.add(f);
  await Promise.all([...files].map(loadFontFile));
}

/** The shaper, plus a number that changes whenever another font file arrives (to redraw). */
export function useShaper(): { shaper: StudioShaper | null; fontsVersion: number } {
  const [, setTick] = useState(0);
  const [ready, setReady] = useState<StudioShaper | null>(shaper);
  useEffect(() => {
    const l = () => setTick((t) => t + 1);
    listeners.add(l);
    void loadShaper().then(setReady);
    return () => {
      listeners.delete(l);
    };
  }, []);
  return { shaper: ready, fontsVersion: version };
}

/** @font-face rules for every studio face (for the text box while typing and the font picker). */
export function studioFontCss(): string {
  const out: string[] = [];
  for (const f of STUDIO_FONTS) for (const w of f.weights) out.push(`@font-face{font-family:"st-${f.key}";src:url("/api/fonts/${f.base}_${WEIGHT_NAME[w]}.ttf");font-weight:${w};font-display:swap;}`);
  return out.join("\n");
}

export { fontFile };
