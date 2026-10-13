// Text shaping for image rendering (R6, D5).
// Shapes text with HarfBuzz (harfbuzzjs) using the bundled Noto fonts and
// returns glyph outlines as SVG path data plus exact advance widths. The SVG is
// later rasterised by resvg; no <text> element is ever used.
//
// Font choice is per run: Latin uses Noto Sans, Devanagari uses Noto Sans
// Devanagari, Arabic script uses Noto Sans Arabic. Spaces, punctuation and ASCII
// digits take the font of the neighbouring letters (so Hindi keeps v1's look), and
// a character the chosen font lacks is shaped in the first bundled font that has it.
//
// Direction: a minimal bidi pass (see analyse). Arabic runs are shaped with
// HarfBuzz direction rtl and script Arab; the paragraph direction decides how runs
// are ordered on the line.

import type * as HB from 'harfbuzzjs';
import { readFileSync } from 'node:fs';
import path from 'node:path';

export type Weight = 400 | 500 | 700 | 800;
export const WEIGHTS: readonly Weight[] = [400, 500, 700, 800];

const WEIGHT_FILE: Record<Weight, string> = {
  400: '400Regular',
  500: '500Medium',
  700: '700Bold',
  800: '800ExtraBold',
};

type Family = 'deva' | 'sans' | 'arab';
export type Dir = 'ltr' | 'rtl';

interface LoadedFont {
  font: HB.Font;
  upem: number;
  ascender: number; // em
  descender: number; // em, positive number
  paths: Map<number, string>;
  has(cp: number): boolean;
  path(gid: number): string;
}

const fontCache = new Map<string, LoadedFont>();

// harfbuzzjs is ESM with top-level await, so it is loaded with a dynamic import
// (this also keeps tsx scripts, which compile .ts files to CJS, working).
let hb: typeof HB | null = null;
let hbLoading: Promise<void> | null = null;

/** Load HarfBuzz (wasm) and all fonts. Await once before using any sync function here. */
export function initShaping(): Promise<void> {
  hbLoading ??= (async () => {
    hb = await import('harfbuzzjs');
    warmFonts();
  })();
  return hbLoading;
}

function hbReady(): typeof HB {
  if (!hb) throw new Error('Shaping is not initialised: await initShaping() first');
  return hb;
}

export function fontsDir(): string {
  return path.join(/*turbopackIgnore: true*/ process.cwd(), 'assets', 'fonts');
}

function fontFile(family: Family, weight: Weight): string {
  const base = family === 'deva' ? 'NotoSansDevanagari' : family === 'arab' ? 'NotoSansArabic' : 'NotoSans';
  return path.join(fontsDir(), `${base}_${WEIGHT_FILE[weight]}.ttf`);
}

function loadFont(family: Family, weight: Weight): LoadedFont {
  const key = `${family}-${weight}`;
  const hit = fontCache.get(key);
  if (hit) return hit;
  const data = readFileSync(fontFile(family, weight));
  const h = hbReady();
  const face = new h.Face(new h.Blob(data));
  const font = new h.Font(face);
  const upem = face.upem;
  const ext = font.hExtents();
  const paths = new Map<number, string>();
  const loaded: LoadedFont = {
    font,
    upem,
    ascender: ext.ascender / upem,
    descender: -ext.descender / upem,
    paths,
    has(cp) {
      const g = font.nominalGlyph(cp);
      return g !== undefined && g !== 0;
    },
    path(gid) {
      let d = paths.get(gid);
      if (d === undefined) {
        d = font.glyphToPath(gid);
        paths.set(gid, d);
      }
      return d;
    },
  };
  fontCache.set(key, loaded);
  return loaded;
}

/** Eagerly load and parse every font so the first render is as fast as later ones. */
function warmFonts(): void {
  for (const w of WEIGHTS) {
    loadFont('deva', w);
    loadFont('sans', w);
    loadFont('arab', w);
  }
}

/** Ascent and descent in em for line placement (Noto Sans Devanagari metrics). */
export function fontMetrics(weight: Weight): { ascender: number; descender: number } {
  const f = loadFont('deva', weight);
  return { ascender: f.ascender, descender: f.descender };
}

export interface PlacedGlyph {
  d: string; // outline in font units, y up
  x: number; // em
  y: number; // em (y up)
  upem: number;
}

export interface Shaped {
  /** Number of glyphs that came out as .notdef (a character no bundled font covers). */
  missing: number;
  widthEm: number;
  glyphs: PlacedGlyph[];
}

// ---- character classes ------------------------------------------------------------

type Cls = 'R' | 'L' | 'D' | 'N'; // right-to-left letter, left-to-right letter, digit, neutral/other

interface CharInfo {
  ch: string;
  cp: number;
  cls: Cls;
  /** Font family implied by the character itself (undefined = take it from the neighbours). */
  script?: Family;
  /** Zero-width or combining: never forces a run split. */
  ignorable: boolean;
  dir: Dir;
  family: Family;
}

const inRanges = (cp: number, ranges: readonly (readonly [number, number])[]) => ranges.some(([a, b]) => cp >= a && cp <= b);
const ARABIC_RANGES = [
  [0x0600, 0x06ff],
  [0x0750, 0x077f],
  [0x0870, 0x08ff],
  [0xfb50, 0xfdff],
  [0xfe70, 0xfeff],
] as const;
const DEVA_RANGES = [
  [0x0900, 0x097f],
  [0xa8e0, 0xa8ff],
] as const;
const MARK_RE = /^\p{M}$/u;
const LETTER_RE = /^\p{L}$/u;
const AFFIX = new Set(['%', '$', '€', '£', '¥', '₹', '₨', '+', '-', '#', '٪']);

function isArabicDigit(cp: number): boolean {
  return (cp >= 0x0660 && cp <= 0x0669) || (cp >= 0x06f0 && cp <= 0x06f9);
}

function classify(ch: string): Pick<CharInfo, 'cls' | 'script' | 'ignorable'> {
  const cp = ch.codePointAt(0)!;
  if (cp === 0x200f || cp === 0x061c) return { cls: 'R', ignorable: true };
  if (cp === 0x200e) return { cls: 'L', ignorable: true };
  if ((cp >= 0x200b && cp <= 0x200d) || (cp >= 0x202a && cp <= 0x202e) || (cp >= 0x2066 && cp <= 0x2069) || (cp >= 0xfe00 && cp <= 0xfe0f)) {
    return { cls: 'N', ignorable: true };
  }
  if (isArabicDigit(cp)) return { cls: 'D', script: 'arab', ignorable: false };
  if (cp >= 0x30 && cp <= 0x39) return { cls: 'D', ignorable: false };
  if (inRanges(cp, ARABIC_RANGES)) {
    if (cp === 0x060c) return { cls: 'N', script: 'arab', ignorable: false }; // Arabic comma
    const mark = MARK_RE.test(ch);
    const strong = mark || LETTER_RE.test(ch) || cp === 0x061b || cp === 0x061f || cp === 0x0640;
    return { cls: strong ? 'R' : 'N', script: 'arab', ignorable: mark };
  }
  if (cp >= 0x0590 && cp <= 0x05ff) return { cls: 'R', ignorable: false }; // Hebrew: direction only, no bundled font
  if (inRanges(cp, DEVA_RANGES)) return { cls: 'L', script: 'deva', ignorable: MARK_RE.test(ch) };
  if (MARK_RE.test(ch)) return { cls: 'N', ignorable: true };
  if (LETTER_RE.test(ch)) return { cls: 'L', script: 'sans', ignorable: false };
  return { cls: 'N', ignorable: false };
}

/** Paragraph direction: rtl when letters in Arabic script (or Hebrew) outnumber all other letters. */
export function detectDirection(text: string): Dir {
  let r = 0;
  let l = 0;
  for (const ch of text) {
    const c = classify(ch);
    if (c.ignorable || (c.cls !== 'R' && c.cls !== 'L')) continue;
    if (c.cls === 'R') r++;
    else l++;
  }
  return r > l ? 'rtl' : 'ltr';
}

const PHONE_SEP = new Set([' ', ' ', '-', '‐', '‑', '.', '(', ')']);
const PHONE_MIN_DIGITS = 7;

/** [start, end) ranges of phone-like sequences: optional +, then digits joined by spaces, dashes, dots or brackets. */
function phoneSpans(infos: CharInfo[]): [number, number][] {
  const n = infos.length;
  const out: [number, number][] = [];
  let i = 0;
  while (i < n) {
    const startsHere = infos[i].cls === 'D' || ((infos[i].ch === '+' || infos[i].ch === '(') && i + 1 < n && (infos[i + 1].cls === 'D' || infos[i + 1].ch === '('));
    if (!startsHere || (i > 0 && infos[i - 1].cls === 'D')) {
      i++;
      continue;
    }
    let j = i;
    let digits = 0;
    let last = i;
    while (j < n) {
      const c = infos[j];
      if (c.cls === 'D') {
        digits++;
        last = j;
      } else if (!(PHONE_SEP.has(c.ch) || (j === i && c.ch === '+'))) break;
      j++;
    }
    // Trailing separators are not part of the number, except a bracket that closes one opened inside it.
    let end = last + 1;
    let open = 0;
    for (let k = i; k < end; k++) open += infos[k].ch === '(' ? 1 : infos[k].ch === ')' ? -1 : 0;
    if (open > 0 && end < n && infos[end].ch === ')') end++;
    if (digits >= PHONE_MIN_DIGITS) out.push([i, end]);
    i = Math.max(end, i + 1);
  }
  return out;
}

/**
 * Minimal bidi pass.
 * 1. Each character is right-to-left (Arabic/Hebrew letters), left-to-right (other letters
 *    and all digits) or neutral.
 * 2. A neutral sequence takes the direction of its neighbours when both sides agree, else the
 *    paragraph direction. Currency signs, %, + and - touching a digit stay with the number (W5),
 *    and separators between digits (. , : / and so on) stay inside it.
 *    Unlike UAX #9, a number counts as left-to-right for this, so "AED 150" and "iPhone 15 Pro"
 *    stay one left-to-right run, in the order they were typed. A phone-like sequence (7 or more
 *    digits joined by spaces, dashes, dots or brackets, with an optional leading +) is one
 *    left-to-right run too, so "+971 4 123 4567" is not reversed group by group.
 * 3. Characters are grouped into runs of equal direction and font. Runs are put in visual order
 *    with the UAX #9 reordering rule (L2) over levels 0/1/2, so digits and Latin names keep
 *    their own left-to-right order inside right-to-left text.
 * Not done: explicit embeddings and isolates, the full weak-type rules, line-level whitespace reset (L1).
 */
function analyse(text: string, para: Dir): CharInfo[] {
  const infos: CharInfo[] = Array.from(text, (ch) => {
    const c = classify(ch);
    return { ch, cp: ch.codePointAt(0)!, ...c, dir: para, family: 'sans' as Family };
  });
  const n = infos.length;
  const strong: (Dir | undefined)[] = infos.map((c) => (c.cls === 'R' ? 'rtl' : c.cls === 'L' || c.cls === 'D' ? 'ltr' : undefined));
  // Phone-like sequences (at least 7 digits with spaces, dashes, dots or brackets between) are one ltr run, as typed.
  for (const [a, b] of phoneSpans(infos)) for (let k = a; k < b; k++) strong[k] = 'ltr';
  // Affixes glued to a digit belong to the number.
  for (let i = 0; i < n; i++) {
    if (strong[i] || !AFFIX.has(infos[i].ch)) continue;
    if ((i > 0 && infos[i - 1].cls === 'D') || (i + 1 < n && infos[i + 1].cls === 'D')) strong[i] = 'ltr';
  }
  for (let i = 0; i < n; ) {
    if (strong[i]) {
      infos[i].dir = strong[i]!;
      i++;
      continue;
    }
    let j = i;
    while (j < n && !strong[j]) j++;
    const prev = i > 0 ? strong[i - 1] : undefined;
    const next = j < n ? strong[j] : undefined;
    const d = prev && prev === next ? prev : para;
    for (let k = i; k < j; k++) infos[k].dir = d;
    i = j;
  }
  // Fonts: own script, else the previous character's, else the next scripted character's.
  const lookahead: (Family | undefined)[] = new Array(n);
  let nextScript: Family | undefined;
  for (let i = n - 1; i >= 0; i--) {
    if (infos[i].script) nextScript = infos[i].script;
    lookahead[i] = nextScript;
  }
  let cur: Family | undefined;
  for (let i = 0; i < n; i++) {
    if (infos[i].script) cur = infos[i].script;
    infos[i].family = infos[i].script ?? cur ?? lookahead[i] ?? 'sans';
  }
  return infos;
}

const FALLBACK_ORDER: Family[] = ['sans', 'deva', 'arab'];

interface Run {
  family: Family;
  dir: Dir;
  text: string;
  level: number;
}

function bidiRuns(text: string, weight: Weight, para: Dir): Run[] {
  const fonts: Record<Family, LoadedFont> = {
    deva: loadFont('deva', weight),
    sans: loadFont('sans', weight),
    arab: loadFont('arab', weight),
  };
  const runs: Run[] = [];
  for (const c of analyse(text, para)) {
    let family = c.family;
    if (!c.ignorable && !fonts[family].has(c.cp)) {
      const alt = FALLBACK_ORDER.find((f) => fonts[f].has(c.cp));
      if (alt) family = alt;
    }
    const level = para === 'rtl' ? (c.dir === 'rtl' ? 1 : 2) : c.dir === 'rtl' ? 1 : 0;
    // Brackets in rtl runs are not mirrored here: HarfBuzz applies Bidi_Mirroring itself when the buffer direction is rtl.
    const ch = c.ch;
    const last = runs[runs.length - 1];
    if (last && last.family === family && last.dir === c.dir) last.text += ch;
    else runs.push({ family, dir: c.dir, text: ch, level });
  }
  // L2: from the highest level down to the lowest odd level, reverse every sequence at that level or above.
  if (runs.length > 1) {
    const levels = runs.map((r) => r.level);
    const max = Math.max(...levels);
    const odd = levels.filter((l) => l % 2 === 1);
    const minOdd = odd.length ? Math.min(...odd) : max + 1;
    for (let lvl = max; lvl >= minOdd; lvl--) {
      for (let i = 0; i < runs.length; ) {
        if (runs[i].level < lvl) {
          i++;
          continue;
        }
        let j = i;
        while (j < runs.length && runs[j].level >= lvl) j++;
        const seg = runs.slice(i, j).reverse();
        runs.splice(i, j - i, ...seg);
        i = j;
      }
    }
  }
  return runs;
}

const shapeCache = new Map<string, Shaped>();
const SHAPE_CACHE_MAX = 4000;
const ARABIC_TEXT_RE = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;
const DEVA_TEXT_RE = /[ऀ-ॿ]/;

/**
 * Shape one line of text (no wrapping). Result is in em units, glyphs in visual left-to-right
 * order, and cached. `dir` is the paragraph direction; 'auto' detects it from the text.
 */
export function shapeText(raw: string, weight: Weight, dir: Dir | 'auto' = 'auto'): Shaped {
  const text = raw.replace(/[\r\n\t]+/g, ' ');
  const para: Dir = dir === 'auto' ? detectDirection(text) : dir;
  const key = `${weight}|${para}|${text}`;
  const hit = shapeCache.get(key);
  if (hit) return hit;

  const glyphs: PlacedGlyph[] = [];
  let pen = 0; // em
  let missing = 0;
  for (const run of bidiRuns(text, weight, para)) {
    const lf = loadFont(run.family, weight);
    const h = hbReady();
    const buf = new h.Buffer();
    buf.addText(run.text);
    buf.guessSegmentProperties();
    if (run.family === 'deva' && DEVA_TEXT_RE.test(run.text)) {
      buf.setScript('Deva');
      buf.setLanguage('hi');
    } else if (run.family === 'arab' && ARABIC_TEXT_RE.test(run.text)) {
      buf.setScript('Arab');
      buf.setLanguage('ar');
    }
    // HarfBuzz hb_direction_t: LTR = 4, RTL = 5. RTL buffers come back in visual (left-to-right) order.
    buf.setDirection((run.dir === 'rtl' ? 5 : 4) as Parameters<typeof buf.setDirection>[0]);
    h.shape(lf.font, buf);
    const infos = buf.getGlyphInfos();
    const pos = buf.getGlyphPositions();
    for (let i = 0; i < infos.length; i++) {
      const gid = infos[i].codepoint;
      if (gid === 0) missing++;
      const d = lf.path(gid);
      if (d) {
        glyphs.push({
          d,
          x: pen + pos[i].xOffset / lf.upem,
          y: pos[i].yOffset / lf.upem,
          upem: lf.upem,
        });
      }
      pen += pos[i].xAdvance / lf.upem;
    }
  }
  const shaped: Shaped = { missing, widthEm: pen, glyphs };
  if (shapeCache.size >= SHAPE_CACHE_MAX) shapeCache.clear();
  shapeCache.set(key, shaped);
  return shaped;
}

export function measureText(text: string, weight: Weight, size: number, dir: Dir | 'auto' = 'auto'): number {
  return shapeText(text, weight, dir).widthEm * size;
}

const num = (n: number) => Math.round(n * 100) / 100;

/** SVG for a shaped line. (x, baselineY) is the left end of the baseline. */
export function shapedToSvg(shaped: Shaped, x: number, baselineY: number, size: number, fill: string): string {
  let out = `<g fill="${fill}">`;
  for (const g of shaped.glyphs) {
    const s = size / g.upem;
    out += `<path transform="translate(${num(x + g.x * size)} ${num(baselineY - g.y * size)}) scale(${num(s * 1e4) / 1e4} ${-num(s * 1e4) / 1e4})" d="${g.d}"/>`;
  }
  return out + '</g>';
}

export function textToSvg(
  text: string,
  weight: Weight,
  x: number,
  baselineY: number,
  size: number,
  fill: string,
  dir: Dir | 'auto' = 'auto',
): string {
  return shapedToSvg(shapeText(text, weight, dir), x, baselineY, size, fill);
}
