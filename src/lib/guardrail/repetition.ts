// Repetition check (Req 13): no phrase of 6+ words from the previous 4 weeks, and none
// shared with another post of the same batch. Fact text (addresses, prices, hours) may
// repeat. See docs/guardrail.md, v2 addendum.

export const SHINGLE_WORDS = 6;
export const HISTORY_DAYS = 28;

export interface HistoryCaption {
  caption: string;
  /** ISO date (YYYY-MM-DD) of the batch the caption belongs to. Used when `weekStart` is passed to findRepeats. */
  weekStart?: string;
}

interface Word {
  /** Lower case, NFC. */
  key: string;
  /** Position in the original text. */
  start: number;
  end: number;
}

// Marks stay inside words: Devanagari vowel signs and virama are \p{M}. A hyphen or
// apostrophe between letters keeps one word ("first-time", "don't"), as a reader counts it.
const WORD = new RegExp("[\\p{L}\\p{M}\\p{N}]+(?:[-‐‑'’][\\p{L}\\p{M}\\p{N}]+)*", 'gu');

function words(text: string): Word[] {
  const t = text.normalize('NFC');
  const out: Word[] = [];
  for (const m of t.matchAll(WORD)) {
    out.push({ key: m[0].toLowerCase(), start: m.index!, end: m.index! + m[0].length });
  }
  return out;
}

/** Each fact value as a word sequence, longest first. */
function factWordSets(factValues: string[]): string[][] {
  return factValues
    .map((v) => words(v).map((w) => w.key))
    .filter((w) => w.length > 0)
    .sort((a, b) => b.length - a.length);
}

function withoutFacts(ws: Word[], facts: string[][]): Word[] {
  if (facts.length === 0) return ws;
  const drop = new Array<boolean>(ws.length).fill(false);
  for (let i = 0; i < ws.length; i++) {
    for (const f of facts) {
      if (i + f.length > ws.length) continue;
      let ok = true;
      for (let k = 0; k < f.length; k++) {
        if (ws[i + k].key !== f[k]) {
          ok = false;
          break;
        }
      }
      if (ok) {
        for (let k = 0; k < f.length; k++) drop[i + k] = true;
        break;
      }
    }
  }
  return ws.filter((_, i) => !drop[i]);
}

function shingles(ws: Word[]): Set<string> {
  const set = new Set<string>();
  for (let i = 0; i + SHINGLE_WORDS <= ws.length; i++) set.add(ws.slice(i, i + SHINGLE_WORDS).map((w) => w.key).join(' '));
  return set;
}

function daysBetween(a: string, b: string): number {
  return (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000;
}

/**
 * The phrases of `candidate` (6+ words, in the candidate's own words) that also appear in
 * a history caption or in another post of the batch. Fact values are removed from both
 * sides first. History older than 28 days before `weekStart` is ignored when both are given.
 */
export function findRepeats(args: {
  candidate: string;
  history: HistoryCaption[];
  batchOthers: string[];
  facts: Array<{ value: string }>;
  weekStart?: string;
}): string[] {
  const facts = factWordSets(args.facts.map((f) => f.value));
  const known = new Set<string>();
  const sources = [
    ...args.history
      .filter((h) => !args.weekStart || !h.weekStart || daysBetween(h.weekStart, args.weekStart) <= HISTORY_DAYS)
      .map((h) => h.caption),
    ...args.batchOthers,
  ];
  for (const s of sources) for (const sh of shingles(withoutFacts(words(s), facts))) known.add(sh);
  if (known.size === 0) return [];

  const all = words(args.candidate);
  const kept = withoutFacts(all, facts);
  const covered = new Array<boolean>(kept.length).fill(false);
  for (let i = 0; i + SHINGLE_WORDS <= kept.length; i++) {
    if (known.has(kept.slice(i, i + SHINGLE_WORDS).map((w) => w.key).join(' '))) {
      for (let k = 0; k < SHINGLE_WORDS; k++) covered[i + k] = true;
    }
  }

  const text = args.candidate.normalize('NFC');
  const phrases: string[] = [];
  for (let i = 0; i < kept.length; ) {
    if (!covered[i]) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < kept.length && covered[j + 1]) j++;
    // In the candidate's own words; a fact removed from the middle stays in the quoted text.
    phrases.push(text.slice(kept[i].start, kept[j].end));
    i = j + 1;
  }
  return [...new Set(phrases)];
}
