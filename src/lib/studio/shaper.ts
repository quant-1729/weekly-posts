// Text shaping for the studio, shared by the browser and the server. HarfBuzz (harfbuzzjs, wasm) shapes each run
// with the chosen face and the glyph outlines become one SVG path per line. The browser and the server use this
// same code with the same font files, so wrapping, sizes and glyphs match exactly. Devanagari and Arabic runs use
// the face when it has the script (Baloo 2, Yatra One), else the matching Noto family; a character a face lacks is
// drawn with Noto Sans.

import { ARAB_FALLBACK, DEVA_FALLBACK, LATIN_FALLBACK, fallbackFile, fontFile, fontOf } from './fonts';

/** The parts of harfbuzzjs we use (the module object, loaded by the caller). */
export interface HarfBuzz {
  Blob: new (data: ArrayBuffer | Uint8Array) => unknown;
  Face: new (blob: unknown, index?: number) => { upem: number };
  Font: new (face: unknown) => HbFont;
  Buffer: new () => HbBuffer;
  shape(font: HbFont, buffer: HbBuffer): void;
}
interface HbFont {
  hExtents(): { ascender: number; descender: number };
  glyphToPath(gid: number): string;
  nominalGlyph(cp: number): number | undefined;
  glyphExtents(gid: number): { yBearing: number; height: number } | null;
}
interface HbBuffer {
  addText(t: string): void;
  guessSegmentProperties(): void;
  setScript(s: string): void;
  setLanguage(l: string): void;
  setDirection(d: number): void;
  getGlyphInfos(): { codepoint: number; cluster: number }[];
  getGlyphPositions(): { xAdvance: number; xOffset: number; yOffset: number }[];
}

/** Gives the bytes of a font file that was loaded (null when it is not loaded yet). */
export type FontSource = (file: string) => Uint8Array | null;

interface Loaded {
  font: HbFont;
  upem: number;
  asc: number;
  desc: number;
  cap: number;
  paths: Map<number, string>;
  has(cp: number): boolean;
}

export interface ShapedLine {
  /** Width in px at the size it was shaped with. */
  width: number;
  /** One path for the whole line, origin at the left end of the baseline. */
  d: string;
}

type Script = 'latin' | 'deva' | 'arab';
const DEVA = /[ऀ-ॿ꣠-ꣿ]/;
const ARAB = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;
const NEUTRAL = /[\s0-9.,:;!?'"()\-–—+%&/@#*₹$€£¥‌‍]/;

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Moves and scales an absolute glyph path (font units, y up) to px (y down). */
function placePath(d: string, ox: number, oy: number, s: number): string {
  let out = '';
  let i = 0;
  const re = /([MLQCZmlqcz])|(-?\d*\.?\d+(?:e[-+]?\d+)?)/g;
  let m: RegExpExecArray | null;
  let pair: number[] = [];
  while ((m = re.exec(d))) {
    if (m[1]) {
      out += m[1];
      pair = [];
      i = 0;
      continue;
    }
    pair.push(parseFloat(m[2]));
    if (pair.length === 2) {
      out += `${i > 0 ? ' ' : ''}${r2(ox + pair[0] * s)} ${r2(oy - pair[1] * s)}`;
      pair = [];
      i++;
    }
  }
  return out;
}

export class StudioShaper {
  private cache = new Map<string, Loaded | null>();
  private lineCache = new Map<string, { em: number; parts: { file: string; gid: number; x: number; y: number }[] }>();

  constructor(
    private hb: HarfBuzz,
    private source: FontSource,
  ) {}

  /** The files a face needs at a weight (the face itself and the fallbacks). */
  static filesFor(fontKey: string, weight: number): string[] {
    const f = fontOf(fontKey);
    return [fontFile(f, weight), fallbackFile(LATIN_FALLBACK, weight), fallbackFile(DEVA_FALLBACK, weight), fallbackFile(ARAB_FALLBACK, weight)];
  }

  private load(file: string): Loaded | null {
    if (this.cache.has(file)) {
      const hit = this.cache.get(file)!;
      if (hit) return hit;
    }
    const bytes = this.source(file);
    if (!bytes) return null;
    const h = this.hb;
    const face = new h.Face(new h.Blob(bytes));
    const font = new h.Font(face);
    const upem = face.upem;
    const ext = font.hExtents();
    const hGid = font.nominalGlyph(0x48);
    const hx = hGid ? font.glyphExtents(hGid) : null;
    const loaded: Loaded = {
      font,
      upem,
      asc: ext.ascender / upem,
      desc: -ext.descender / upem,
      cap: hx ? hx.yBearing / upem : 0.7,
      paths: new Map(),
      has(cp) {
        const g = font.nominalGlyph(cp);
        return g !== undefined && g !== 0;
      },
    };
    this.cache.set(file, loaded);
    return loaded;
  }

  /** True when every file a face needs is loaded. */
  ready(fontKey: string, weight: number): boolean {
    return StudioShaper.filesFor(fontKey, weight).every((f) => this.source(f) !== null);
  }

  /** Cap height of the face in em (for centring words on a line). */
  capHeight(fontKey: string, weight: number): number {
    return this.load(fontFile(fontOf(fontKey), weight))?.cap ?? 0.7;
  }

  private runs(text: string, fontKey: string, weight: number): { text: string; file: string; script: Script }[] {
    const face = fontOf(fontKey);
    const main = fontFile(face, weight);
    const mainFont = this.load(main);
    const latinFb = fallbackFile(LATIN_FALLBACK, weight);
    const out: { text: string; file: string; script: Script }[] = [];
    let prev: Script = 'latin';
    for (const ch of text) {
      let script: Script = DEVA.test(ch) ? 'deva' : ARAB.test(ch) ? 'arab' : NEUTRAL.test(ch) ? prev : 'latin';
      let file: string;
      if (script === 'deva') file = face.deva ? main : fallbackFile(DEVA_FALLBACK, weight);
      else if (script === 'arab') file = fallbackFile(ARAB_FALLBACK, weight);
      else file = main;
      const cp = ch.codePointAt(0)!;
      if (file === main && mainFont && !mainFont.has(cp) && !/[‌‍]/.test(ch)) {
        file = script === 'deva' ? fallbackFile(DEVA_FALLBACK, weight) : latinFb;
        if (script !== 'deva') script = 'latin';
      }
      const last = out[out.length - 1];
      if (last && last.file === file) last.text += ch;
      else out.push({ text: ch, file, script });
      if (!NEUTRAL.test(ch)) prev = script;
    }
    return out;
  }

  private shapeEm(text: string, fontKey: string, weight: number, tracking: number) {
    const key = `${fontKey}|${weight}|${tracking}|${text}`;
    const hit = this.lineCache.get(key);
    if (hit) return hit;
    const parts: { file: string; gid: number; x: number; y: number }[] = [];
    let pen = 0;
    const track = tracking / 1000;
    const h = this.hb;
    for (const run of this.runs(text, fontKey, weight)) {
      const lf = this.load(run.file);
      if (!lf) continue;
      const buf = new h.Buffer();
      buf.addText(run.text);
      buf.guessSegmentProperties();
      if (run.script === 'deva') {
        buf.setScript('Deva');
        buf.setLanguage('hi');
      } else if (run.script === 'arab') {
        buf.setScript('Arab');
        buf.setLanguage('ar');
      }
      buf.setDirection(run.script === 'arab' ? 5 : 4);
      h.shape(lf.font, buf);
      const infos = buf.getGlyphInfos();
      const pos = buf.getGlyphPositions();
      for (let i = 0; i < infos.length; i++) {
        parts.push({ file: run.file, gid: infos[i].codepoint, x: pen + pos[i].xOffset / lf.upem, y: pos[i].yOffset / lf.upem });
        pen += pos[i].xAdvance / lf.upem + track;
      }
    }
    if (parts.length) pen -= track;
    const res = { em: Math.max(0, pen), parts };
    if (this.lineCache.size > 3000) this.lineCache.clear();
    this.lineCache.set(key, res);
    return res;
  }

  /** Width of one line in px. */
  measure(text: string, fontKey: string, weight: number, size: number, tracking = 0): number {
    return this.shapeEm(text, fontKey, weight, tracking).em * size;
  }

  /** One line as a path (origin: the left end of the baseline). */
  line(text: string, fontKey: string, weight: number, size: number, tracking: number, x: number, baseline: number): ShapedLine {
    const sh = this.shapeEm(text, fontKey, weight, tracking);
    let d = '';
    for (const p of sh.parts) {
      const lf = this.load(p.file);
      if (!lf) continue;
      let gp = lf.paths.get(p.gid);
      if (gp === undefined) {
        gp = lf.font.glyphToPath(p.gid);
        lf.paths.set(p.gid, gp);
      }
      if (!gp) continue;
      d += placePath(gp, x + p.x * size, baseline - p.y * size, size / lf.upem);
    }
    return { width: sh.em * size, d };
  }

  /** Breaks text into lines no wider than `max` px (explicit line breaks are kept; a too-long word gets its own line). */
  wrap(text: string, fontKey: string, weight: number, size: number, tracking: number, max: number): string[] {
    const out: string[] = [];
    for (const para of text.split('\n')) {
      const words = para.split(/(\s+)/).filter((w) => w.length > 0);
      let cur = '';
      for (const w of words) {
        const next = cur + w;
        if (cur.trim() === '' || this.measure(next.trimEnd(), fontKey, weight, size, tracking) <= max) cur = next;
        else {
          out.push(cur.trimEnd());
          cur = /^\s+$/.test(w) ? '' : w;
        }
      }
      out.push(cur.trimEnd());
    }
    return out;
  }
}
