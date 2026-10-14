// Guardrail rules per USP kind (PRD v3 B-2, B-4.1, change C-12). Pure functions, no database, no AI.
//
// Input: the USPs frozen into the brief (with their `confirmed` flags), the post's rendered texts
// and, for QR rules, what the renderer drew. Output: `Flag`s in the same shape as the other
// layers, so the approval screen shows them the same way ("please check").
//
//   rating        shown without platform or review count -> flag; rating or count differs from the USP -> flag
//   "up to"       on the post while no discount USP has upTo set by the owner -> flag
//   discount      a % or amount off that is not the discount USP's -> flag; a discount past its validTo -> flag
//   superlatives  "best", "No.1", "cheapest", "guaranteed" ... (es/fr/de/pt/hi too) unless the USP that
//                 carries the word is confirmed; for a regulated brand the guarantee words stay flagged
//   payments      any UPI-like address in a post text -> flag (a payment ID is only ever printed next to its QR)
//   QR            a QR without its label (and payee line for a payment QR) -> flag; "scan" text without a QR -> flag
//   confirmation  a USP of a kind that needs the owner's confirmation (quality, reviews, experience) and is not confirmed -> flag
//
// Prompts are not touched. The AI fact check does not know about USPs; see the proposal in the task report.

import type { QrSpec, UspSnapshot } from '@/lib/briefs/types';
import { NEEDS_CONFIRMATION } from '@/lib/usps/types';
import { findPaymentIds } from '@/lib/payments/redact';
import { flagId } from './merge';
import { FLAG_FIELDS, fieldText, type Flag, type FlagField, type FlagKind, type RegulatedKind } from './types';

export interface UspRuleUsp extends Omit<UspSnapshot, 'confirmed'> {
  /** The owner confirmed this claim (snapshots carry it; missing counts as not confirmed). */
  confirmed?: boolean;
}

export interface UspRulePost {
  caption: string;
  cta: string;
  image_text: { headline: string; subline: string; bubble?: string };
}

/** What the renderer drew for the brief's QR, so the rules can check the label and the payee line. */
export interface UspRuleQr {
  kind: QrSpec['kind'];
  /** The label printed under the QR ("Scan to visit" / "Scan to pay"), or null when none was drawn. */
  label: string | null;
  /** Payment QR: the ID and payee name are printed next to it. */
  payeeShown?: boolean;
}

export interface UspRuleContext {
  usps: UspRuleUsp[];
  /** The brand's confirmed payment addresses. Even these may not appear in a text field. */
  activePaymentAddresses?: string[];
  qr?: UspRuleQr | null;
  /** YYYY-MM-DD in the brand's time zone. Default: today in `timezone`, else UTC. */
  today?: string;
  timezone?: string | null;
}

interface Hit {
  field: FlagField;
  kind: FlagKind;
  text: string;
  start: number;
  end: number;
  regulated: boolean;
}

const WB_L = '(?<![\\p{L}\\p{M}\\p{N}])';
const WB_R = '(?![\\p{L}\\p{M}\\p{N}])';
const word = (src: string) => new RegExp(`${WB_L}(?:${src})${WB_R}`, 'giu');

// ---------------------------------------------------------------------------
// Superlatives and guarantee words (en, es, fr, de, pt, hi)
// ---------------------------------------------------------------------------

interface SuperlativeTerm {
  /** Regex source (unicode, case-insensitive). */
  src: string;
  /** 'guarantee' words promise an outcome: a regulated brand keeps them flagged even when confirmed. */
  group: 'superlative' | 'guarantee';
}

/**
 * Common phrases where a superlative word is about the customer or a greeting, not a claim about
 * the business (seen live 2026-10-14: "we're here to help you look your best" was flagged).
 */
const SUPERLATIVE_IDIOMS: RegExp[] = [
  /\b(?:look|looking|feel|feeling|be|being|do|doing|try|trying|give|giving|bring\s+out|brings\s+out|at|to)\s+(?:your|you're|their|our|his|her|my|its)\s+(?:very\s+)?best\b/giu,
  /\ball\s+the\s+(?:very\s+)?best\b/giu,
  /\bbest\s+(?:wishes|regards|of\s+luck)\b/giu,
  /\b(?:your|you're)\s+best\s+(?:self|selves|look|day)\b/giu,
];

function insideIdiom(text: string, start: number, end: number): boolean {
  for (const re of SUPERLATIVE_IDIOMS) {
    for (const m of text.matchAll(re)) {
      if (m.index! <= start && m.index! + m[0].length >= end) return true;
    }
  }
  return false;
}

export const SUPERLATIVE_TERMS: SuperlativeTerm[] = [
  // English
  { src: 'best', group: 'superlative' },
  { src: 'no\\.?\\s?1', group: 'superlative' },
  { src: 'number\\s+(?:one|1)', group: 'superlative' },
  { src: '#\\s?1', group: 'superlative' },
  { src: 'cheapest', group: 'superlative' },
  { src: 'lowest\\s+prices?', group: 'superlative' },
  { src: 'guaranteed', group: 'guarantee' },
  // Spanish
  { src: 'mejor(?:es)?', group: 'superlative' },
  { src: 'n(?:úmero|umero|\\.?º|º)\\s?(?:uno|1)', group: 'superlative' },
  { src: 'más\\s+barat[oa]s?|mas\\s+barat[oa]s?', group: 'superlative' },
  { src: 'precio\\s+más\\s+bajo|precio\\s+mas\\s+bajo', group: 'superlative' },
  { src: 'garantizad[oa]s?', group: 'guarantee' },
  // French
  { src: 'meilleure?s?', group: 'superlative' },
  { src: 'num[ée]ro\\s+(?:un|1)|n°\\s?1', group: 'superlative' },
  { src: '(?:le|la|les)\\s+moins\\s+chers?|moins\\s+cher', group: 'superlative' },
  { src: 'prix\\s+le\\s+plus\\s+bas', group: 'superlative' },
  { src: 'garanti(?:e|s|es)?', group: 'guarantee' },
  // German
  { src: 'best(?:e|er|es|en|em)', group: 'superlative' },
  { src: 'nummer\\s+(?:eins|1)', group: 'superlative' },
  { src: 'g(?:ü|ue)nstigste[rnsm]?|billigste[rnsm]?', group: 'superlative' },
  { src: '(?:niedrigster|tiefster)\\s+preis', group: 'superlative' },
  { src: 'garantiert', group: 'guarantee' },
  // Portuguese
  { src: 'melhor(?:es)?', group: 'superlative' },
  { src: 'n[úu]mero\\s+(?:um|1)', group: 'superlative' },
  { src: 'mais\\s+barat[oa]s?', group: 'superlative' },
  { src: 'menor\\s+pre[çc]o', group: 'superlative' },
  { src: 'garantid[oa]s?', group: 'guarantee' },
  // Hindi
  { src: 'सबसे\\s+(?:अच्छा|अच्छी|अच्छे|बेहतरीन|बढ़िया)', group: 'superlative' },
  { src: 'नंबर\\s+(?:1|वन|एक)', group: 'superlative' },
  { src: 'सबसे\\s+(?:सस्ता|सस्ती|सस्ते)', group: 'superlative' },
  { src: 'सबसे\\s+कम\\s+(?:कीमत|दाम|मूल्य)', group: 'superlative' },
  { src: 'गारंटी(?:ड|शुदा)?', group: 'guarantee' },
];

// ---------------------------------------------------------------------------
// Detail readers (the snapshot's details are untyped JSON)
// ---------------------------------------------------------------------------

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});

/** Every string inside a USP (title and details), for "does this USP carry the word". */
function uspText(u: UspRuleUsp): string {
  const parts: string[] = [u.title];
  const walk = (v: unknown) => {
    if (typeof v === 'string') parts.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(u.details);
  return parts.join(' \n ');
}

function todayIn(args: { today?: string; timezone?: string | null }, now: Date): string {
  if (args.today) return args.today;
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: args.timezone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

/** "1,200", "1.200", "1 200" -> 1200 (thousands separators); null if not a plain integer. */
function parseCount(raw: string): number | null {
  const digits = raw.replace(/[,.\s]/g, '');
  return /^\d+$/.test(digits) ? Number(digits) : null;
}
const parseDecimal = (raw: string): number => Number(raw.replace(',', '.'));

// ---------------------------------------------------------------------------
// Text matching
// ---------------------------------------------------------------------------

const STAR_WORDS = 'stars?|estrellas?|[ée]toiles?|sterne?|estrelas?|स्टार|सितारे';
const RATING_RE = new RegExp(
  `(?<![\\d.,])(\\d(?:[.,]\\d)?)\\s*(?:\\/\\s*5|out of 5|von 5|sur 5|de 5)|(?<![\\d.,])(\\d(?:[.,]\\d)?)\\s*-?\\s*(?:${STAR_WORDS}|[★⭐])|\\brated\\s+(\\d(?:[.,]\\d)?)|[★⭐]{3,5}`,
  'giu',
);
const COUNT_RE = /(?<![\d.,])(\d{1,3}(?:[,.\s]\d{3})+|\d+)\s*(\+)?\s*(?:reviews?|ratings?|rese[ñn]as|opiniones|avis|bewertungen|avalia[çc][õo]es|रिव्यू)/giu;
const OFF_WORDS = 'off|discount|save|saving|savings|sale|descuento|dto|remise|r[ée]duction|rabatt|ersparnis|desconto|छूट|ऑफ';
const UP_NUM = '[^\\s\\d]{0,3}\\d+(?:[.,]\\d+)?\\s?%?';
const UP_TO_RE = new RegExp(
  `${WB_L}(?:up\\s+to|hasta(?:\\s+un)?|jusqu['’]à|bis\\s+zu|at[ée](?:\\s+um)?)\\s+${UP_NUM}|\\d+\\s?%\\s*तक(?:\\s+की)?|\\d+\\s*तक\\s+की`,
  'giu',
);
const PCT_RE = /(\d+(?:[.,]\d+)?)\s*%/g;
const MONEY_RE = /(?:[£$€₹¥]\s?(\d+(?:[.,]\d+)?)|(\d+(?:[.,]\d+)?)\s?(?:rs\.?|inr|usd|gbp|eur|rupees?)(?![\p{L}])|(?<![\p{L}])(?:rs\.?|inr|usd|gbp|eur)\s?(\d+(?:[.,]\d+)?))/giu;
const SCAN_TEXT_RE = new RegExp(`${WB_L}(?:scan\\s+(?:to\\s+(?:pay|visit)|the\\s+(?:qr|code)|me|our\\s+(?:qr|code))|escanea|scannez|scannen|escaneie|स्कैन)${WB_R}`, 'giu');

function near(text: string, start: number, end: number, re: RegExp): boolean {
  const from = Math.max(0, start - 24);
  const ctx = text.slice(from, Math.min(text.length, end + 24));
  return re.test(ctx);
}
const OFF_NEAR = new RegExp(`${WB_L}(?:${OFF_WORDS})${WB_R}`, 'iu');

// ---------------------------------------------------------------------------
// The rules
// ---------------------------------------------------------------------------

export function checkUspRules(args: UspRuleContext & { post: UspRulePost; regulated?: RegulatedKind; now?: Date }): Flag[] {
  const now = args.now ?? new Date();
  const today = todayIn(args, now);
  const regulated = (args.regulated ?? 'none') !== 'none';
  const usps = args.usps;
  const hits: Hit[] = [];

  const texts = FLAG_FIELDS.map((field) => ({ field, text: fieldText(args.post, field) }));
  const all = texts.map((t) => t.text).join('\n');
  const push = (field: FlagField, kind: FlagKind, text: string, start: number, end: number, reg = false) => hits.push({ field, kind, text, start, end, regulated: reg });
  const eachMatch = (re: RegExp, fn: (field: FlagField, text: string, m: RegExpMatchArray) => void) => {
    for (const { field, text } of texts) for (const m of text.matchAll(re)) fn(field, text, m);
  };

  // --- Superlatives and guarantee words -------------------------------------------------
  for (const term of SUPERLATIVE_TERMS) {
    const re = word(term.src);
    const carriedByConfirmed = usps.some((u) => u.confirmed === true && new RegExp(re.source, 'iu').test(uspText(u)));
    const stays = term.group === 'guarantee' && regulated; // outcome promises stay blocked for regulated brands
    if (carriedByConfirmed && !stays) continue;
    eachMatch(re, (field, t, m) => {
      // Everyday phrases about the customer ("look your best", "all the best") are not claims about the business.
      if (term.group === 'superlative' && insideIdiom(t, m.index!, m.index! + m[0].length)) return;
      push(field, 'claim', m[0], m.index!, m.index! + m[0].length, stays);
    });
  }

  // --- Ratings and review counts ---------------------------------------------------------
  const reviews = usps.filter((u) => u.kind === 'reviews').map((u) => ({ rating: num(u.details.rating), count: num(u.details.count), platform: str(u.details.platform).trim() }));
  eachMatch(RATING_RE, (field, _t, m) => {
    const raw = m[1] ?? m[2] ?? m[3];
    const value = raw === undefined ? null : parseDecimal(raw);
    const start = m.index!;
    const end = start + m[0].length;
    if (reviews.length === 0) return push(field, 'claim', m[0], start, end); // a rating nobody gave us
    if (value !== null && !reviews.some((r) => r.rating !== null && Math.abs(r.rating - value) < 0.05)) return push(field, 'claim', m[0], start, end);
    const lower = all.toLowerCase();
    const numbers = new Set([...all.matchAll(/\d[\d,.\s]*\d|\d/g)].map((x) => x[0].replace(/[,.\s]/g, '')));
    // The count is shown as a number ("(1,200)") or as "1000+ reviews" (at most the real count).
    const plus = [...all.matchAll(COUNT_RE)].filter((c) => c[2] === '+').map((c) => parseCount(c[1]));
    const complete = reviews.some(
      (r) =>
        r.platform !== '' &&
        lower.includes(r.platform.toLowerCase()) &&
        r.count !== null &&
        (numbers.has(String(r.count)) || plus.some((n) => n !== null && n <= r.count!)),
    );
    if (!complete) push(field, 'claim', m[0], start, end); // platform or count missing
  });
  eachMatch(COUNT_RE, (field, _t, m) => {
    const n = parseCount(m[1]);
    if (n === null) return;
    const plus = m[2] === '+';
    const ok = reviews.some((r) => r.count !== null && (plus ? n <= r.count : n === r.count));
    if (!ok) push(field, 'claim', m[0], m.index!, m.index! + m[0].length);
  });

  // --- "up to" -----------------------------------------------------------------------------
  const discounts = usps.filter((u) => u.kind === 'discount');
  const ownerSaysUpTo = discounts.some((u) => u.details.upTo === true);
  if (!ownerSaysUpTo) eachMatch(UP_TO_RE, (field, _t, m) => push(field, 'offer', m[0], m.index!, m.index! + m[0].length));

  // --- Discount figures --------------------------------------------------------------------
  const okPercents = new Set<number>();
  const okAmounts = new Set<number>();
  for (const u of discounts) {
    const p = num(u.details.percent);
    if (p !== null) okPercents.add(p);
    const a = num(obj(u.details.amountOff).amount);
    if (a !== null) okAmounts.add(a);
  }
  // A percent that is part of another USP's own words ("100% organic") is not a discount figure.
  const otherUspText = usps.filter((u) => u.kind !== 'discount').map(uspText).join('\n');
  eachMatch(PCT_RE, (field, text, m) => {
    const start = m.index!;
    const end = start + m[0].length;
    if (!near(text, start, end, OFF_NEAR)) return;
    const v = parseDecimal(m[1]);
    if (okPercents.has(v)) return;
    if (new RegExp(`${WB_L}${m[1].replace('.', '\\.')}\\s*%`, 'u').test(otherUspText)) return;
    push(field, 'offer', m[0], start, end);
  });
  eachMatch(MONEY_RE, (field, text, m) => {
    const start = m.index!;
    const end = start + m[0].length;
    if (!near(text, start, end, OFF_NEAR)) return;
    const v = parseDecimal(m[1] ?? m[2] ?? m[3]);
    if (okAmounts.has(v)) return;
    // A price the owner gave ("£4.50 off the usual £6") is a price USP's figure, not a discount.
    const prices = usps.filter((u) => u.kind === 'price').map((u) => num(obj(u.details.price).amount));
    if (prices.includes(v)) return;
    push(field, 'offer', m[0], start, end);
  });

  // --- A discount past its end date ----------------------------------------------------------
  const where = (needle: string): { field: FlagField; start: number; end: number } | null => {
    for (const { field, text } of texts) {
      const i = text.toLowerCase().indexOf(needle.toLowerCase());
      if (i >= 0 && needle.trim() !== '') return { field, start: i, end: i + needle.length };
    }
    return null;
  };
  for (const u of discounts) {
    const validTo = str(u.details.validTo);
    if (/^\d{4}-\d{2}-\d{2}$/.test(validTo) && validTo < today) {
      const w = where(u.title);
      if (w) push(w.field, 'offer', u.title, w.start, w.end);
      else push('caption', 'offer', `${u.title} (ended ${validTo})`, -1, -1);
    }
  }

  // --- A USP the owner has not confirmed -------------------------------------------------------
  for (const u of usps) {
    if (!NEEDS_CONFIRMATION.has(u.kind) || u.confirmed === true) continue;
    const w = where(u.title);
    if (w) push(w.field, 'claim', u.title, w.start, w.end);
    else push('caption', 'claim', `${u.title} (not confirmed)`, -1, -1);
  }

  // --- Payment IDs: only ever next to the QR, never in text ------------------------------------
  for (const { field, text } of texts) {
    for (const id of findPaymentIds(text)) {
      const i = text.indexOf(id);
      push(field, 'claim', id, i, i >= 0 ? i + id.length : -1);
    }
  }
  // (The active addresses are allowed on the QR only: they are flagged in text like any other.)
  for (const known of args.activePaymentAddresses ?? []) {
    for (const { field, text } of texts) {
      const i = text.toLowerCase().indexOf(known.toLowerCase());
      if (i >= 0 && known.trim() !== '') push(field, 'claim', text.slice(i, i + known.length), i, i + known.length);
    }
  }

  // --- QR label and payee line -------------------------------------------------------------------
  const qr = args.qr ?? null;
  if (qr) {
    const label = (qr.label ?? '').trim();
    const matches = label !== '' && (qr.kind === 'payment' ? /pay|pagar|payer|zahlen|bezahlen|भुगतान/i.test(label) : !/pay|pagar|payer|zahlen|bezahlen|भुगतान/i.test(label));
    if (!matches) push('caption', 'claim', qr.kind === 'payment' ? 'Payment QR code without a "Scan to pay" label' : 'QR code without a "Scan to visit" label', -1, -1);
    if (qr.kind === 'payment' && qr.payeeShown !== true) push('caption', 'claim', 'Payment QR code without the payee name and ID printed next to it', -1, -1);
  } else {
    eachMatch(SCAN_TEXT_RE, (field, _t, m) => push(field, 'claim', m[0], m.index!, m.index! + m[0].length));
  }

  return toFlags(hits, args.post);
}

/** Hits to flags: one per field+kind+text, overlapping spans in a field collapsed (first wins). */
function toFlags(hits: Hit[], post: UspRulePost): Flag[] {
  const out: Flag[] = [];
  const kept: Hit[] = [];
  for (const h of hits) {
    const dup = kept.some((k) => k.field === h.field && (k.text === h.text || (h.start >= 0 && k.start >= 0 && h.start < k.end && k.start < h.end)));
    if (dup) continue;
    kept.push(h);
    const fieldValue = fieldText(post, h.field);
    out.push({
      id: flagId(h.field, h.kind, h.text),
      text: h.text,
      kind: h.kind,
      field: h.field,
      layer: 'code',
      regulated: h.regulated,
      highlight: h.start >= 0 && fieldValue.includes(h.text),
      status: 'open',
      decided_at: null,
    });
  }
  return out;
}
