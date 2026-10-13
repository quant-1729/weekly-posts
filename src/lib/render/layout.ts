// Text fitting: wrap to a box using shaped widths, shrink in steps down to a
// minimum, then hard-truncate with an ellipsis. Text never leaves its box.

import { fontMetrics, measureText, type Dir, type Weight } from './shape';

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Line {
  text: string;
  width: number;
}

export interface FitOptions {
  weight: Weight;
  boxW: number;
  boxH: number;
  maxSize: number;
  minSize: number;
  maxLines: number;
  lineHeight?: number; // multiple of font size, default 1.32
  step?: number; // shrink factor per step, default 0.92
  dir?: Dir | 'auto'; // paragraph direction used when measuring, default 'auto'
}

export interface FitResult {
  size: number;
  lineHeightPx: number;
  lines: Line[];
  height: number;
  truncated: boolean;
}

export const DEFAULT_LINE_HEIGHT = 1.32;
const ELLIPSIS = '…';

let segmenter: Intl.Segmenter | null = null;
function graphemes(text: string): string[] {
  segmenter ??= new Intl.Segmenter('hi', { granularity: 'grapheme' });
  return Array.from(segmenter.segment(text), (s) => s.segment);
}

/** Cut a long word into chunks that each fit the width (cluster-safe). */
function hardBreak(word: string, weight: Weight, size: number, boxW: number, dir: Dir | 'auto'): string[] {
  const out: string[] = [];
  let cur = '';
  for (const g of graphemes(word)) {
    if (cur && measureText(cur + g, weight, size, dir) > boxW) {
      out.push(cur);
      cur = g;
    } else {
      cur += g;
    }
  }
  if (cur) out.push(cur);
  return out;
}

function wrap(words: string[], weight: Weight, size: number, boxW: number, breakLongWords: boolean, dir: Dir | 'auto'): Line[] {
  const lines: Line[] = [];
  let cur = '';
  const push = () => {
    if (cur) lines.push({ text: cur, width: measureText(cur, weight, size, dir) });
    cur = '';
  };
  for (const word of words) {
    const pieces =
      breakLongWords && measureText(word, weight, size, dir) > boxW ? hardBreak(word, weight, size, boxW, dir) : [word];
    pieces.forEach((piece, i) => {
      if (i > 0) push(); // chunks of a broken word start new lines
      const candidate = cur ? cur + ' ' + piece : piece;
      if (cur && measureText(candidate, weight, size, dir) > boxW) {
        push();
        cur = piece;
      } else {
        cur = candidate;
      }
    });
  }
  push();
  return lines;
}

function truncateToWidth(text: string, weight: Weight, size: number, boxW: number, dir: Dir | 'auto'): Line {
  const g = graphemes(text);
  while (g.length > 0 && measureText(g.join('').trimEnd() + ELLIPSIS, weight, size, dir) > boxW) g.pop();
  const t = g.join('').trimEnd() + ELLIPSIS;
  return { text: t, width: measureText(t, weight, size, dir) };
}

export function fitText(raw: string, o: FitOptions): FitResult {
  const text = raw.replace(/\s+/g, ' ').trim();
  const lh = o.lineHeight ?? DEFAULT_LINE_HEIGHT;
  const step = o.step ?? 0.92;
  const dir = o.dir ?? 'auto';
  if (!text) return { size: o.maxSize, lineHeightPx: o.maxSize * lh, lines: [], height: 0, truncated: false };
  const words = text.split(' ');

  let size = o.maxSize;
  while (size >= o.minSize) {
    const lines = wrap(words, o.weight, size, o.boxW, false, dir);
    const widest = Math.max(...lines.map((l) => l.width));
    if (lines.length <= o.maxLines && lines.length * size * lh <= o.boxH && widest <= o.boxW) {
      return { size, lineHeightPx: size * lh, lines, height: lines.length * size * lh, truncated: false };
    }
    size = Math.floor(size * step);
  }

  // Minimum size: break over-long words, then truncate whatever still does not fit.
  size = o.minSize;
  const lineHeightPx = size * lh;
  const cap = Math.max(1, Math.min(o.maxLines, Math.floor(o.boxH / lineHeightPx)));
  let lines = wrap(words, o.weight, size, o.boxW, true, dir);
  let truncated = false;
  if (lines.length > cap) {
    truncated = true;
    const rest = lines.slice(cap - 1).map((l) => l.text).join(' ');
    lines = [...lines.slice(0, cap - 1), truncateToWidth(rest, o.weight, size, o.boxW, dir)];
  }
  return { size, lineHeightPx, lines, height: lines.length * lineHeightPx, truncated };
}

/** Baseline offset from the top of a line box, centring the font's ascent+descent in the line. */
export function baselineOffset(weight: Weight, size: number, lineHeightPx: number): number {
  const m = fontMetrics(weight);
  const content = (m.ascender + m.descender) * size;
  return (lineHeightPx - content) / 2 + m.ascender * size;
}
