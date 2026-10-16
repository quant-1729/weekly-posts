// Research is never a fact about the brand (docs/10 section 1, "Safety rules"). An idea's description becomes the
// owner's post description once saved, so code removes from it every price, currency amount, percentage, number,
// date, rating, statistic, contact detail and superlative or guarantee claim, and lists each removal as a flag
// ("from research, please check"). Applied to every idea whatever the model was told.

import { SUPERLATIVE_TERMS } from "@/lib/guardrail/usp-rules";
import { findContactSpans } from "@/lib/guardrail/deterministic";
import { findNumberSpans } from "@/lib/guardrail/number-words";

export const FLAG_PREFIX = "from research, please check";

export type RemovedKind = "price" | "percentage" | "date" | "rating" | "number" | "claim" | "contact" | "offer";

interface Span {
  start: number;
  end: number;
  kind: RemovedKind;
}

const MONTHS = "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";
const LEAD = "(?:(?:from|till|until|through|thru|by|on|before|after|between|since|to)\\s+)?";

const PATTERNS: { kind: RemovedKind; re: RegExp }[] = [
  // Whole offers first, so "buy one get one free" goes as one piece.
  { kind: "offer", re: /\b(?:buy\s+(?:one|1)\s+get\s+(?:one|1)(?:\s+free)?|bogo|(?:two|2)[\s-]+for[\s-]+(?:one|1|the\s+price\s+of\s+one))\b/giu },
  // Dates: "31 Oct", "31st October 2026", "Oct 31", "2026-10-31", "31/10/2026", with a leading "till" etc.
  { kind: "date", re: new RegExp(`${LEAD}\\b\\d{1,2}(?:st|nd|rd|th)?\\s+(?:of\\s+)?(?:${MONTHS})\\b\\.?(?:,?\\s+\\d{4})?`, "giu") },
  { kind: "date", re: new RegExp(`${LEAD}\\b(?:${MONTHS})\\b\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s+\\d{4})?`, "giu") },
  { kind: "date", re: new RegExp(`${LEAD}\\b\\d{4}-\\d{2}-\\d{2}\\b`, "giu") },
  { kind: "date", re: new RegExp(`${LEAD}\\b\\d{1,2}[/.-]\\d{1,2}(?:[/.-]\\d{2,4})?\\b`, "giu") },
  // Money: symbol + amount, amount + currency word, "Rs 500".
  { kind: "price", re: /(?:[$£€₹¥]|\b(?:rs|inr|usd|gbp|eur|aed)\.?)\s?\d[\d,]*(?:\.\d+)?(?:\s?(?:k|m|lakh|lakhs|crore|crores))?/giu },
  { kind: "price", re: /\b\d[\d,]*(?:\.\d+)?\s?(?:rupees?|dollars?|euros?|pounds?|cents?|pence|bucks|dirhams?)\b/giu },
  // Percentages, with "off" or "discount" when they follow.
  { kind: "percentage", re: /\b\d+(?:\.\d+)?\s?(?:%|percent|per\s?cent)(?:\s+(?:off|discount|cashback|more|less|higher|lower))?/giu },
  { kind: "percentage", re: /\b(?:half|full)[\s-]price\b/giu },
  // Ratings.
  { kind: "rating", re: /\b\d(?:\.\d)?\s?(?:\/\s?(?:5|10)|stars?|star[\s-]rated|out\s+of\s+(?:5|10))\b|\b\d(?:\.\d)?\s?★+|★{2,}/giu },
  // Superlatives and guarantees beyond the guardrail's own list.
  { kind: "claim", re: /\b(?:the\s+)?(?:finest|unbeatable|top[\s-]rated|award[\s-]winning|world[\s-]class|number[\s-]one|#\s?1|no\.?\s?1|most\s+(?:popular|trusted|loved|awarded)|best[\s-]selling|risk[\s-]free|money[\s-]back)\b(?:\s+in\s+(?:the\s+)?\p{L}+)?/giu },
];

/** The guardrail's superlative and guarantee terms (best, No.1, cheapest, guaranteed, ... in several languages), with "in town" style endings. */
function superlativeRegexes(): RegExp[] {
  return SUPERLATIVE_TERMS.map((t) => new RegExp(`(?<![\\p{L}\\p{M}\\p{N}])(?:the\\s+)?(?:${t.src})(?![\\p{L}\\p{M}\\p{N}])(?:\\s+in\\s+(?:the\\s+)?\\p{L}+)?`, "giu"));
}

function collect(text: string): Span[] {
  const spans: Span[] = [];
  const add = (start: number, end: number, kind: RemovedKind) => {
    if (end > start) spans.push({ start, end, kind });
  };
  for (const { kind, re } of PATTERNS) for (const m of text.matchAll(re)) add(m.index!, m.index! + m[0].length, kind);
  for (const re of superlativeRegexes()) for (const m of text.matchAll(re)) add(m.index!, m.index! + m[0].length, "claim");
  for (const c of findContactSpans(text)) add(c.start, c.end, "contact");
  // Any other number, digits or words ("three", "20", "٢٠"). A lone "one" is an article more than a number.
  for (const n of findNumberSpans(text)) {
    if (n.words && n.single && n.value === "1" && !n.currency) continue;
    add(n.start, n.end, n.currency ? "price" : "number");
  }
  // Longest first, then earliest; drop spans inside an earlier kept one.
  spans.sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start));
  const kept: Span[] = [];
  for (const s of spans) {
    const last = kept[kept.length - 1];
    if (last && s.start < last.end) {
      if (s.end > last.end) last.end = s.end; // overlapping: one wider span
      continue;
    }
    kept.push({ ...s });
  }
  return kept;
}

const KIND_WORDS: Record<RemovedKind, string> = {
  price: "a price",
  percentage: "a percentage or discount",
  date: "a date",
  rating: "a rating",
  number: "a number",
  claim: "a claim",
  contact: "a contact detail",
  offer: "an offer",
};

export interface StripResult {
  text: string;
  /** One flag per removal: "from research, please check: removed a price (£4)". */
  flags: string[];
  removed: { kind: RemovedKind; text: string }[];
}

/** Tidies what is left after removals: spaces, stray punctuation, dangling connectors. */
export function tidy(text: string): string {
  return text
    .replace(/\(\s*\)|\[\s*\]/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/([,;:])(?:\s*[,;:])+/g, "$1")
    .replace(/[,;:]+\s*([.!?])/g, "$1")
    .replace(/\s*[-–—/]\s*(?=[.,;!?]|$)/g, "")
    .replace(/\b(?:and|or|for|at|only|just|from|till|until|by|on)\s*(?=[.,;!?]|$)/gi, "")
    .replace(/^[\s,;:.\-–—]+/, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .trim();
}

/** Removes prices, numbers, dates, ratings, claims and contact details from a text; says what it removed. */
export function stripClaims(input: string): StripResult {
  const spans = collect(input);
  if (spans.length === 0) return { text: input.replace(/\s+/g, " ").trim(), flags: [], removed: [] };
  let out = "";
  let pos = 0;
  const removed: StripResult["removed"] = [];
  for (const s of spans) {
    out += input.slice(pos, s.start) + " ";
    removed.push({ kind: s.kind, text: input.slice(s.start, s.end).trim() });
    pos = s.end;
  }
  out += input.slice(pos);
  const flags = removed.map((r) => `${FLAG_PREFIX}: removed ${KIND_WORDS[r.kind]} (${r.text.slice(0, 40)})`);
  return { text: tidy(out), flags, removed };
}
