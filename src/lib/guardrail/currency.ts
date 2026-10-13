// Amounts and their currencies (docs/guardrail.md, v2 addendum): a post amount that
// equals a fact amount in a DIFFERENT currency is a flag. £4.50 vs $4.50 is wrong
// even though the digits match.

import { findNumberSpans } from './number-words';

export type CurrencyCode = 'GBP' | 'USD' | 'EUR' | 'INR' | 'AED' | 'SGD' | 'CAD' | 'AUD' | 'ZAR' | '$';

export interface Amount {
  start: number;
  end: number;
  /** Original text including the symbol or code, e.g. "S$36", "199 درهم", "four pounds fifty". */
  text: string;
  amount: number;
  /** Null when no currency is written next to the number. */
  currency: CurrencyCode | null;
}

/** Symbols and codes written before the number. Longest first. `space`: one space may sit between. */
const PREFIXES: Array<{ token: string; code: CurrencyCode; space: boolean; alpha: boolean }> = [
  { token: 'US$', code: 'USD', space: false, alpha: true },
  { token: 'CA$', code: 'CAD', space: false, alpha: true },
  { token: 'AU$', code: 'AUD', space: false, alpha: true },
  { token: 'S$', code: 'SGD', space: false, alpha: true },
  { token: 'C$', code: 'CAD', space: false, alpha: true },
  { token: 'A$', code: 'AUD', space: false, alpha: true },
  { token: 'AED', code: 'AED', space: true, alpha: true },
  { token: 'ZAR', code: 'ZAR', space: true, alpha: true },
  { token: 'USD', code: 'USD', space: true, alpha: true },
  { token: 'GBP', code: 'GBP', space: true, alpha: true },
  { token: 'EUR', code: 'EUR', space: true, alpha: true },
  { token: 'INR', code: 'INR', space: true, alpha: true },
  { token: 'CAD', code: 'CAD', space: true, alpha: true },
  { token: 'AUD', code: 'AUD', space: true, alpha: true },
  { token: 'SGD', code: 'SGD', space: true, alpha: true },
  { token: 'Rs.', code: 'INR', space: true, alpha: true },
  { token: 'Rs', code: 'INR', space: true, alpha: true },
  { token: 'د.إ', code: 'AED', space: true, alpha: false },
  { token: '₹', code: 'INR', space: true, alpha: false },
  { token: '£', code: 'GBP', space: true, alpha: false },
  { token: '€', code: 'EUR', space: true, alpha: false },
  { token: '$', code: '$', space: true, alpha: false },
  { token: 'R', code: 'ZAR', space: false, alpha: true },
];
const LETTER_OR_DIGIT = new RegExp('[\\p{L}\\p{M}\\p{N}]', 'u');

function prefixAt(text: string, numStart: number): { start: number; code: CurrencyCode } | null {
  const before = text.slice(0, numStart);
  for (const p of PREFIXES) {
    let b = before;
    if (p.space && b.endsWith(' ')) b = b.slice(0, -1);
    if (!b.toLowerCase().endsWith(p.token.toLowerCase())) continue;
    // Exact case for codes and R: "r50" or "Care 50" is not money.
    if (p.alpha && !b.endsWith(p.token)) continue;
    const start = b.length - p.token.length;
    if (p.alpha && start > 0 && LETTER_OR_DIGIT.test(b[start - 1])) continue;
    return { start, code: p.code };
  }
  return null;
}

const SUFFIXES: Array<[RegExp, CurrencyCode]> = [
  [/^ ?(?:AED|aed)(?![\p{L}\p{N}])/u, 'AED'],
  [/^ ?(?:ZAR|zar)(?![\p{L}\p{N}])/u, 'ZAR'],
  [/^ ?(?:USD|usd)(?![\p{L}\p{N}])/u, 'USD'],
  [/^ ?(?:GBP|gbp)(?![\p{L}\p{N}])/u, 'GBP'],
  [/^ ?(?:EUR|eur)(?![\p{L}\p{N}])/u, 'EUR'],
  [/^ ?(?:INR|inr)(?![\p{L}\p{N}])/u, 'INR'],
  [/^ ?(?:CAD|cad)(?![\p{L}\p{N}])/u, 'CAD'],
  [/^ ?(?:AUD|aud)(?![\p{L}\p{N}])/u, 'AUD'],
  [/^ ?(?:SGD|sgd)(?![\p{L}\p{N}])/u, 'SGD'],
  [/^ ?Rs\.?(?![\p{L}\p{N}])/u, 'INR'],
  [/^ ?(?:د\.إ|درهم|دراهم)/u, 'AED'],
  [/^ ?₹/u, 'INR'],
  [/^ ?£/u, 'GBP'],
  [/^ ?€/u, 'EUR'],
  [/^ ?\$/u, '$'],
  [/^ ?(?:rupees?|rupaye|rupaiye|रुपये|रुपए|रुपया)(?![\p{L}\p{M}])/iu, 'INR'],
  [/^ ?(?:pounds?)(?![\p{L}])/iu, 'GBP'],
  [/^ ?(?:dollars?)(?![\p{L}])/iu, '$'],
  [/^ ?(?:euros?)(?![\p{L}])/iu, 'EUR'],
  [/^ ?(?:dirhams?)(?![\p{L}])/iu, 'AED'],
  [/^ ?(?:rand)(?![\p{L}])/iu, 'ZAR'],
];

function codeOf(symbolCode: string): CurrencyCode {
  switch (symbolCode) {
    case 'GBP':
    case 'EUR':
    case 'INR':
    case 'AED':
    case 'ZAR':
    case '$':
      return symbolCode;
    default:
      return '$';
  }
}

/** Every number in the text with the currency written next to it (symbol, code, or word), if any. */
export function extractAmounts(text: string): Amount[] {
  const out: Amount[] = [];
  for (const sp of findNumberSpans(text)) {
    const amount = Number(sp.value);
    if (!Number.isFinite(amount)) continue;
    if (sp.currency) {
      out.push({ start: sp.start, end: sp.end, text: sp.text, amount, currency: codeOf(sp.currency.code) });
      continue;
    }
    const pre = prefixAt(text, sp.start);
    if (pre) {
      out.push({ start: pre.start, end: sp.end, text: text.slice(pre.start, sp.end), amount, currency: pre.code });
      continue;
    }
    const after = text.slice(sp.end);
    let hit: { len: number; code: CurrencyCode } | null = null;
    for (const [re, code] of SUFFIXES) {
      const m = re.exec(after);
      if (m) {
        hit = { len: m[0].length, code };
        break;
      }
    }
    out.push({ start: sp.start, end: sp.end + (hit?.len ?? 0), text: text.slice(sp.start, sp.end + (hit?.len ?? 0)), amount, currency: hit?.code ?? null });
  }
  return out;
}

const DOLLARS = new Set<CurrencyCode>(['$', 'USD', 'CAD', 'AUD', 'SGD']);

/** A bare "$" fits any dollar; otherwise the currencies must be the same. */
export function currenciesCompatible(a: CurrencyCode, b: CurrencyCode): boolean {
  if (a === b) return true;
  if (a === '$' && DOLLARS.has(b)) return true;
  if (b === '$' && DOLLARS.has(a)) return true;
  return false;
}

/**
 * Post amounts (with a currency) that match a source amount only in another currency.
 * Source amounts without a currency are compatible with anything.
 */
export function findCurrencyMismatches(postAmounts: Amount[], sourceAmounts: Amount[]): Amount[] {
  const same = (a: number, b: number) => Math.abs(a - b) < 1e-9;
  return postAmounts.filter((p) => {
    if (!p.currency) return false;
    const pc = p.currency;
    const matches = sourceAmounts.filter((s) => same(s.amount, p.amount));
    if (matches.length === 0) return false;
    return !matches.some((s) => s.currency === null || currenciesCompatible(s.currency, pc));
  });
}
