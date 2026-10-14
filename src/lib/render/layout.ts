// Text fitting: wrap to a box using shaped widths, shrink in steps down to a
// minimum, then hard-truncate with an ellipsis. Text never leaves its box.

import { fontMetrics, measureText, type Dir, type FaceId, type Weight } from './shape';

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
  face?: FaceId; // Latin face used when measuring, default Noto Sans
  /** Even out the lines (minimum raggedness) and avoid a one-word last line when there are 3 or more words. Default false. */
  balance?: boolean;
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
function hardBreak(word: string, weight: Weight, size: number, boxW: number, dir: Dir | 'auto', face: FaceId): string[] {
  const out: string[] = [];
  let cur = '';
  for (const g of graphemes(word)) {
    if (cur && measureText(cur + g, weight, size, dir, face) > boxW) {
      out.push(cur);
      cur = g;
    } else {
      cur += g;
    }
  }
  if (cur) out.push(cur);
  return out;
}

function wrap(words: string[], weight: Weight, size: number, boxW: number, breakLongWords: boolean, dir: Dir | 'auto', face: FaceId): Line[] {
  const lines: Line[] = [];
  let cur = '';
  const push = () => {
    if (cur) lines.push({ text: cur, width: measureText(cur, weight, size, dir, face) });
    cur = '';
  };
  for (const word of words) {
    const pieces =
      breakLongWords && measureText(word, weight, size, dir, face) > boxW ? hardBreak(word, weight, size, boxW, dir, face) : [word];
    pieces.forEach((piece, i) => {
      if (i > 0) push(); // chunks of a broken word start new lines
      const candidate = cur ? cur + ' ' + piece : piece;
      if (cur && measureText(candidate, weight, size, dir, face) > boxW) {
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

function truncateToWidth(text: string, weight: Weight, size: number, boxW: number, dir: Dir | 'auto', face: FaceId): Line {
  const g = graphemes(text);
  while (g.length > 0 && measureText(g.join('').trimEnd() + ELLIPSIS, weight, size, dir, face) > boxW) g.pop();
  const t = g.join('').trimEnd() + ELLIPSIS;
  return { text: t, width: measureText(t, weight, size, dir, face) };
}

/**
 * Re-break words into the same number of lines so the lines come out about equally wide and the last
 * line is not a single word (when there are 3 or more words). The widest line never exceeds boxW. Breaks
 * only at spaces, so it is the same rule for right-to-left and Devanagari text; widths are measured shaped.
 */
export function balanceLines(words: string[], greedy: Line[], weight: Weight, size: number, boxW: number, dir: Dir | 'auto', face: FaceId): Line[] {
  const n = greedy.length;
  const m = words.length;
  if (n < 2 || m < n) return greedy;
  const memo = new Map<string, number>();
  const segW = (i: number, j: number) => {
    const k = i + ':' + j;
    let w = memo.get(k);
    if (w === undefined) {
      w = measureText(words.slice(i, j).join(' '), weight, size, dir, face);
      memo.set(k, w);
    }
    return w;
  };
  // Narrowest width at which greedy wrapping still gives n lines: the target every line aims for.
  let lo = Math.max(...words.map((w) => measureText(w, weight, size, dir, face)));
  let hi = boxW;
  for (let it = 0; it < 14 && hi - lo > 1; it++) {
    const mid = (lo + hi) / 2;
    if (wrap(words, weight, size, mid, false, dir, face).length <= n) hi = mid;
    else lo = mid;
  }
  const target = hi;
  const ORPHAN = 1e9;
  // dp[k][j]: cheapest way to set the first j words in k lines.
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(Infinity));
  const cut: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  dp[0][0] = 0;
  for (let k = 1; k <= n; k++) {
    for (let j = k; j <= m; j++) {
      for (let i = k - 1; i < j; i++) {
        if (dp[k - 1][i] === Infinity) continue;
        const w = segW(i, j);
        if (w > boxW) continue;
        let c = (target - w) * (target - w);
        if (k === n && j - i === 1 && m >= 3) c += ORPHAN;
        if (dp[k - 1][i] + c < dp[k][j]) {
          dp[k][j] = dp[k - 1][i] + c;
          cut[k][j] = i;
        }
      }
    }
  }
  if (dp[n][m] === Infinity) return greedy;
  const lines: Line[] = [];
  for (let k = n, j = m; k >= 1; k--) {
    const i = cut[k][j];
    lines.unshift({ text: words.slice(i, j).join(' '), width: segW(i, j) });
    j = i;
  }
  return lines;
}

export function fitText(raw: string, o: FitOptions): FitResult {
  const text = raw.replace(/\s+/g, ' ').trim();
  const lh = o.lineHeight ?? DEFAULT_LINE_HEIGHT;
  const step = o.step ?? 0.92;
  const dir = o.dir ?? 'auto';
  const face = o.face ?? 'sans';
  if (!text) return { size: o.maxSize, lineHeightPx: o.maxSize * lh, lines: [], height: 0, truncated: false };
  const words = text.split(' ');

  let size = o.maxSize;
  while (size >= o.minSize) {
    const lines = wrap(words, o.weight, size, o.boxW, false, dir, face);
    const widest = Math.max(...lines.map((l) => l.width));
    if (lines.length <= o.maxLines && lines.length * size * lh <= o.boxH && widest <= o.boxW) {
      const out = o.balance && lines.length > 1 ? balanceLines(words, lines, o.weight, size, o.boxW, dir, face) : lines;
      return { size, lineHeightPx: size * lh, lines: out, height: out.length * size * lh, truncated: false };
    }
    size = Math.floor(size * step);
  }

  // Minimum size: break over-long words, then truncate whatever still does not fit.
  size = o.minSize;
  const lineHeightPx = size * lh;
  const cap = Math.max(1, Math.min(o.maxLines, Math.floor(o.boxH / lineHeightPx)));
  let lines = wrap(words, o.weight, size, o.boxW, true, dir, face);
  let truncated = false;
  if (lines.length > cap) {
    truncated = true;
    const rest = lines.slice(cap - 1).map((l) => l.text).join(' ');
    lines = [...lines.slice(0, cap - 1), truncateToWidth(rest, o.weight, size, o.boxW, dir, face)];
  }
  return { size, lineHeightPx, lines, height: lines.length * lineHeightPx, truncated };
}

/** Baseline offset from the top of a line box, centring the font's ascent+descent in the line. */
export function baselineOffset(weight: Weight, size: number, lineHeightPx: number): number {
  const m = fontMetrics(weight);
  const content = (m.ascender + m.descender) * size;
  return (lineHeightPx - content) / 2 + m.ascender * size;
}
