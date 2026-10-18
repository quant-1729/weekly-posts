// Server side of the studio: the same shaper with font files read from assets/fonts, image sources resolved from
// our own storage (never fetched from the network), and resvg for the PNG. Server-only.

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import { verifyRendered } from '@/lib/qr/decode';
import { getStorage, isBucket, type Storage } from '@/lib/storage';
import { StudioShaper, type HarfBuzz } from './shaper';
import { buildScene } from './scene';
import type { QrLayer, StudioDoc } from './types';
import { toSvgString } from './vnode';

let shaperP: Promise<StudioShaper> | null = null;
const fontBytes = new Map<string, Uint8Array | null>();

function fontsDir(): string {
  return path.join(/*turbopackIgnore: true*/ process.cwd(), 'assets', 'fonts');
}

function readFont(file: string): Uint8Array | null {
  if (fontBytes.has(file)) return fontBytes.get(file)!;
  if (!/^[A-Za-z0-9_-]+\.ttf$/.test(file)) return null;
  const p = path.join(fontsDir(), file);
  const bytes = existsSync(p) ? new Uint8Array(readFileSync(p)) : null;
  fontBytes.set(file, bytes);
  return bytes;
}

export function getServerShaper(): Promise<StudioShaper> {
  shaperP ??= (async () => {
    const hb = (await import('harfbuzzjs')) as unknown as HarfBuzz;
    return new StudioShaper(hb, readFont);
  })();
  return shaperP;
}

const FILE_ROUTE = /^\/api\/files\/([a-z-]+)\/(.+)$/;
const MAX_DATA_URI = 3_000_000;

/**
 * Turns every image source of the document into a data: URI. Only our own files of this brand (/api/files/{bucket}/{brandId}/...)
 * and data: URIs made in the browser are accepted; anything else draws nothing.
 */
export async function resolveImages(doc: StudioDoc, brandId: string, storage: Storage = getStorage()): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const l of doc.layers) {
    if (l.kind !== 'image' || out.has(l.src)) continue;
    if (l.src.startsWith('data:image/')) {
      if (l.src.length <= MAX_DATA_URI && /^data:image\/(png|jpeg|webp);base64,/.test(l.src)) out.set(l.src, l.src);
      continue;
    }
    const m = FILE_ROUTE.exec(l.src.split('?')[0]);
    if (!m || !isBucket(m[1])) continue;
    const rel = decodeURIComponent(m[2]);
    if (!rel.startsWith(`${brandId}/`) || rel.includes('..')) continue;
    const file = await storage.get(m[1], rel).catch(() => null);
    if (!file) continue;
    out.set(l.src, `data:${file.contentType || 'image/png'};base64,${Buffer.from(file.bytes).toString('base64')}`);
  }
  return out;
}

export interface StudioRender {
  png: Buffer;
  svg: string;
  /** Problems that stop the post: a QR code that does not read back exactly. */
  problems: string[];
  /** The picture shows a realistic AI person (it carries the "AI" tag): the post's caption gets the AI disclosure line. */
  aiFace: boolean;
}

const BLANK = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

export async function renderStudioDoc(doc: StudioDoc, args: { brandId: string; qrData?: string | null; storage?: Storage; verifyQr?: boolean }): Promise<StudioRender> {
  const shaper = await getServerShaper();
  const images = await resolveImages(doc, args.brandId, args.storage);
  const svg = toSvgString(buildScene(doc, shaper, { idPrefix: 'x', image: (src) => images.get(src) ?? BLANK, qrData: args.qrData ?? null }));
  const png = Buffer.from(new Resvg(svg, { font: { loadSystemFonts: false }, fitTo: { mode: 'original' } }).render().asPng());
  const problems: string[] = [];
  if (args.verifyQr !== false) {
    for (const q of doc.layers.filter((l): l is QrLayer => l.kind === 'qr' && !l.hidden)) {
      const expected = q.source === 'brief' && args.qrData ? args.qrData : q.data;
      const pad = 8;
      const region = {
        left: Math.max(0, Math.floor(q.x) - pad),
        top: Math.max(0, Math.floor(q.y) - pad),
        width: Math.min(doc.width - Math.max(0, Math.floor(q.x) - pad), Math.ceil(q.w) + pad * 2),
        height: Math.min(doc.height - Math.max(0, Math.floor(q.y) - pad), Math.ceil(q.h) + pad * 2),
      };
      const ok = q.rot === 0 && region.width > 0 && region.height > 0 ? (await verifyRendered(png, expected, region)).ok : (await verifyRendered(png, expected)).ok;
      if (!ok) problems.push(`The QR code does not scan (${q.name}). Make it bigger, keep it straight and give it a light plate.`);
    }
  }
  return { png, svg, problems, aiFace: doc.layers.some((l) => l.kind === 'image' && l.ai === true && !l.hidden) };
}
