// Deterministic layer of the v2 guardrail (docs/guardrail.md, sections 2-3 and the v2
// addendum): free, instant, and never cleared by the AI layer.
//
// It reuses checks.ts for numbers, contact details and risky phrases, with the
// sources being the brand's fact values and labels (plus texts the owner confirmed),
// both sides after number-word normalisation. On top of that it adds:
//   - exact positions in the field, so a flag can be underlined and removed;
//   - phone numbers of any country (checks.ts only knows Indian mobiles), compared
//     with the facts, and number issues inside a contact span dropped;
//   - currency mismatches (£4.50 vs $4.50);
//   - words to avoid (Req 13);
//   - channel limits, returned separately for the pipeline's retry logic.

import { checkChannelOutput, visibleLength } from '@/lib/ai/checks';
import { V2_CHANNEL_SPECS, type WeeklyFact } from '@/lib/ai/prompts/v2-weekly';
import { extractAmounts, findCurrencyMismatches } from './currency';
import { findNumberSpans, normalizeNumberWords, toAsciiDigits, withNumberDigits } from './number-words';
import { FLAG_FIELDS, type FlagField, type FlagKind, type FormatIssue, type GuardrailPost, type RegulatedKind } from './types';

export interface DetIssue {
  field: FlagField;
  code: 'unsupported_number' | 'unsupported_phrase' | 'contact_detail' | 'currency_mismatch' | 'avoid';
  kind: FlagKind;
  /** Exact text of the field at [start, end), or the detail when it could not be located. */
  text: string;
  start: number;
  end: number;
  highlight: boolean;
  regulated: boolean;
}

export interface DeterministicResult {
  issues: DetIssue[];
  formatIssues: FormatIssue[];
}

type SourceFact = Pick<WeeklyFact, 'label' | 'value' | 'neverUse'>;

/** Fact text the deterministic layer treats as truth: facts marked NEVER USE are not truth for a regulated brand. */
export function sourceLines(facts: SourceFact[], regulated: RegulatedKind, confirmed: string[] = []): string[] {
  return [
    ...facts.filter((f) => !(regulated !== 'none' && f.neverUse)).map((f) => (f.label ? `${f.label} ${f.value}` : f.value)),
    ...confirmed,
  ];
}

// ---------------------------------------------------------------------------
// Contact details
// ---------------------------------------------------------------------------

interface ContactSpan {
  start: number;
  end: number;
  type: 'phone' | 'url' | 'email';
  text: string;
}

const URL_RE = /(?:https?:\/\/|www\.)[^\s<>"'`]+/gi;
const EMAIL_RE = new RegExp('[\\p{L}\\p{N}._%+-]+@[\\p{L}\\p{N}.-]+\\.\\p{L}{2,}', 'gu');
const DOMAIN_RE = new RegExp('(?<![@\\w.])[a-z0-9-]+(?:\\.[a-z0-9-]+)*\\.(?:com|in|co|net|org|shop|store|uk|ae|au|ca|za|sg|io|app|me)\\b(?:/[^\\s<>"\')]*)?', 'gi');
const PHONE_RE = new RegExp('(?<![\\p{L}\\p{N}+])\\+?\\(?\\d[\\d \\t().\\-]*\\d(?![\\p{N}])', 'gu');
const TRAILING = /[.,;:!?)\]]+$/;

export function findContactSpans(text: string): ContactSpan[] {
  const ascii = toAsciiDigits(text);
  const spans: ContactSpan[] = [];
  const push = (type: ContactSpan['type'], start: number, raw: string) => {
    const t = type === 'phone' ? raw : raw.replace(TRAILING, '');
    if (t.length > 0) spans.push({ type, start, end: start + t.length, text: text.slice(start, start + t.length) });
  };
  for (const m of text.matchAll(URL_RE)) push('url', m.index!, m[0]);
  for (const m of text.matchAll(EMAIL_RE)) push('email', m.index!, m[0]);
  for (const m of text.matchAll(DOMAIN_RE)) push('url', m.index!, m[0]);
  const nonPhone = spans.slice();
  for (const m of ascii.matchAll(PHONE_RE)) {
    const raw = m[0].replace(/[\s(.\-]+$/, '');
    const digits = raw.replace(/\D/g, '');
    if (digits.length < 8 || digits.length > 15) continue;
    if (/^(?:19|20)\d{2}\s?-\s?(?:19|20)\d{2}$/.test(raw) || /^\d{4}-\d{2}-\d{2}$/.test(raw) || /^\d{1,2}[-.]\d{1,2}[-.]\d{2,4}$/.test(raw)) continue;
    if (/^\d+\.\d{2}( \d+\.\d{2})+$/.test(raw)) continue; // a list of prices
    const start = m.index!;
    const end = start + raw.length;
    if (nonPhone.some((s) => start < s.end && s.start < end)) continue;
    spans.push({ type: 'phone', start, end, text: text.slice(start, end) });
  }
  // A domain inside a URL or email is the same span.
  return spans
    .sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start))
    .filter((s, i, all) => !all.slice(0, i).some((o) => s.start < o.end && o.start < s.end));
}

const stripLeadingZeros = (d: string) => d.replace(/^0+/, '');
function samePhone(a: string, b: string): boolean {
  const x = stripLeadingZeros(a);
  const y = stripLeadingZeros(b);
  if (x.length < 7 || y.length < 7) return x === y;
  return x === y || x.endsWith(y) || y.endsWith(x);
}
const normLink = (s: string) => s.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/[/.,;:!?]+$/, '');

function contactSupported(c: ContactSpan, sources: string, sourceSpans: ContactSpan[]): boolean {
  if (c.type === 'phone') {
    const d = toAsciiDigits(c.text).replace(/\D/g, '');
    return sourceSpans.some((s) => s.type === 'phone' && samePhone(d, toAsciiDigits(s.text).replace(/\D/g, '')));
  }
  const hay = sources.toLowerCase().replace(/https?:\/\//g, '').replace(/www\./g, '');
  return hay.includes(normLink(c.text));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const WORDCH = '[\\p{L}\\p{M}\\p{N}]';
const startsWord = (s: string) => new RegExp(`^${WORDCH}`, 'u').test(s);
const endsWord = (s: string) => new RegExp(`${WORDCH}$`, 'u').test(s);

function allMatches(text: string, re: RegExp): Array<{ start: number; end: number }> {
  return [...text.matchAll(re)].map((m) => ({ start: m.index!, end: m.index! + m[0].length }));
}

function phraseMatches(text: string, phrase: string): Array<{ start: number; end: number }> {
  const left = startsWord(phrase) ? `(?<!${WORDCH})` : '';
  const right = endsWord(phrase) ? `(?:s|d|es|ed)?(?!${WORDCH})` : '';
  return allMatches(text, new RegExp(`${left}${escapeRe(phrase)}${right}`, 'giu'));
}

const MONTH_DAY = /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b|\b(?:mon|tues?|wed(?:nes)?|thu(?:rs)?|fri|sat(?:ur)?|sun)(?:day)?s?\b|\bweekends?\b/i;

function numberKind(text: string, start: number, end: number, hasCurrency: boolean): FlagKind {
  if (hasCurrency) return 'price';
  const span = text.slice(start, end);
  const after = text.slice(end, end + 14);
  const before = text.slice(Math.max(0, start - 14), start);
  if (/%/.test(span) || /^\s*(?:off|discount)\b/i.test(after) || /\b(?:off|discount)\s*$/i.test(before)) return 'offer';
  if (/[ap]\.?m\.?\s*$/i.test(span) || /\d:\d\d/.test(span) || /^\s*(?:o'?clock|बजे|baje)/i.test(after)) return 'hours';
  if (MONTH_DAY.test(text.slice(Math.max(0, start - 14), end + 14))) return 'date';
  return 'quantity';
}

function phraseKind(p: string): FlagKind {
  if (/free|delivery|limited|डिलीवरी|मुफ्त|मुफ़्त|फ्री|फ़्री|सीमित/i.test(p)) return 'offer';
  if (/today|last day|aaj|आज/i.test(p)) return 'date';
  return 'claim';
}

function overlaps(a: { start: number; end: number }, b: { start: number; end: number }): boolean {
  return a.start < b.end && b.start < a.end;
}

// ---------------------------------------------------------------------------
// The check
// ---------------------------------------------------------------------------

export function checkPostDeterministic(args: {
  post: GuardrailPost;
  facts: SourceFact[];
  regulated: RegulatedKind;
  wordsToAvoid: string[];
  /** Texts the owner confirmed on this post: sources, like facts. */
  confirmed?: string[];
}): DeterministicResult {
  const { post, regulated } = args;
  const isRegulated = regulated !== 'none';
  const lines = sourceLines(args.facts, regulated, args.confirmed ?? []);
  const sourcesRaw = lines.join('\n');
  const sources = withNumberDigits(sourcesRaw);
  const sourceSpans = findContactSpans(sourcesRaw);
  const sourceAmounts = extractAmounts(sourcesRaw);

  const texts: Record<FlagField, string> = {
    caption: post.caption,
    cta: post.cta,
    'image_text.headline': post.image_text.headline,
    'image_text.subline': post.image_text.subline,
    'image_text.bubble': post.image_text.bubble ?? '',
  };

  // checks.ts on the number-word-normalised copy: numbers, contact details, risky phrases.
  const raw = checkChannelOutput(
    'facebook',
    {
      caption: normalizeNumberWords(texts.caption),
      cta: normalizeNumberWords(texts.cta),
      hashtags: [],
      image_text: { headline: normalizeNumberWords(texts['image_text.headline']), subline: normalizeNumberWords(texts['image_text.subline']), bubble: normalizeNumberWords(texts['image_text.bubble']) },
    },
    'en',
    sources,
  ).filter((i) => i.code === 'unsupported_number' || i.code === 'unsupported_phrase' || i.code === 'contact_detail');

  const issues: DetIssue[] = [];
  for (const field of FLAG_FIELDS) {
    const text = texts[field];
    if (!text) continue;
    const mine = raw.filter((i) => i.field === field);
    const badNumbers = new Set(mine.filter((i) => i.code === 'unsupported_number').map((i) => i.detail));
    const badPhrases = new Set(mine.filter((i) => i.code === 'unsupported_phrase').map((i) => i.detail));
    const fieldIssues: DetIssue[] = [];
    const add = (i: Omit<DetIssue, 'field' | 'highlight' | 'regulated'> & Partial<Pick<DetIssue, 'highlight' | 'regulated'>>) =>
      fieldIssues.push({ field, highlight: true, regulated: false, ...i });

    // Contact details: flagged only when they are not in the facts.
    const contacts = findContactSpans(text);
    for (const c of contacts) {
      if (!contactSupported(c, sourcesRaw, sourceSpans)) add({ code: 'contact_detail', kind: 'phone', text: c.text, start: c.start, end: c.end });
    }
    if (contacts.length === 0 && mine.some((i) => i.code === 'contact_detail')) {
      // checks.ts saw one that the span finder did not: keep it, without a position.
      const d = mine.find((i) => i.code === 'contact_detail')!.detail;
      const at = text.indexOf(d);
      add({ code: 'contact_detail', kind: 'phone', text: d, start: at, end: at < 0 ? -1 : at + d.length, highlight: at >= 0 });
    }

    // Numbers: those checks.ts found unsupported, located in the original, outside contact spans.
    const amounts = extractAmounts(text);
    for (const sp of findNumberSpans(text)) {
      if (contacts.some((c) => overlaps(c, sp))) continue;
      if (sp.words && sp.single && sp.value === '1' && !sp.currency) continue; // "one", "ek", "एक": an article more than a number
      if (!badNumbers.has(sp.value)) continue;
      const amt = amounts.find((a) => a.start <= sp.start && a.end >= sp.end);
      const start = amt ? amt.start : sp.start;
      let end = amt ? amt.end : sp.end;
      const suffix = /^ ?(?:[ap]\.?m\.?(?![\p{L}])|%)/iu.exec(text.slice(end));
      if (suffix) end += suffix[0].length;
      add({ code: 'unsupported_number', kind: numberKind(text, start, end, Boolean(amt?.currency)), text: text.slice(start, end), start, end });
    }

    // Currency: the amount is a fact amount, but in another currency.
    for (const a of findCurrencyMismatches(amounts.filter((x) => x.currency), sourceAmounts)) {
      if (contacts.some((c) => overlaps(c, a))) continue;
      add({ code: 'currency_mismatch', kind: 'price', text: a.text, start: a.start, end: a.end });
    }

    // Risky phrases checks.ts found unsupported.
    for (const p of badPhrases) {
      for (const m of phraseMatches(text, p)) {
        add({ code: 'unsupported_phrase', kind: phraseKind(p), text: text.slice(m.start, m.end), start: m.start, end: m.end, regulated: isRegulated });
      }
    }

    // Overlapping code flags are one flag: keep the longest.
    fieldIssues.sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start));
    const kept: DetIssue[] = [];
    for (const i of fieldIssues) if (i.start < 0 || !kept.some((k) => k.start >= 0 && overlaps(k, i))) kept.push(i);
    issues.push(...kept);

    // Words to avoid (Req 13): kept apart, they are a different reason.
    issues.push(...avoidIssues(field, text, args.wordsToAvoid));
  }

  return { issues, formatIssues: formatIssuesFor(post) };
}

// ---------------------------------------------------------------------------
// Words to avoid
// ---------------------------------------------------------------------------

/** Case-insensitive, whole-word, NFC-normalised match of each word or phrase to avoid. */
export function avoidIssues(field: FlagField, text: string, wordsToAvoid: string[]): DetIssue[] {
  if (!text) return [];
  const nfc = text.normalize('NFC');
  const out: DetIssue[] = [];
  const seen = new Set<string>();
  for (const w of wordsToAvoid) {
    const word = w.normalize('NFC').trim().replace(/\s+/g, ' ');
    if (!word) continue;
    const left = startsWord(word) ? `(?<!${WORDCH})` : '';
    const right = endsWord(word) ? `(?!${WORDCH})` : '';
    const re = new RegExp(`${left}${escapeRe(word).replace(/ /g, '\\s+')}${right}`, 'giu');
    for (const m of nfc.matchAll(re)) {
      const start = m.index!;
      const matched = m[0];
      const key = `${field}:${start}:${matched.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      // Positions are in the NFC text; if the stored text is not NFC, point to the text only when it is findable.
      const exact = nfc === text;
      const at = exact ? start : text.indexOf(matched);
      out.push({ field, code: 'avoid', kind: 'avoid', text: matched, start: at, end: at < 0 ? -1 : at + matched.length, highlight: at >= 0, regulated: false });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Channel limits
// ---------------------------------------------------------------------------

export function formatIssuesFor(post: GuardrailPost): FormatIssue[] {
  const spec = V2_CHANNEL_SPECS[post.channel];
  const out: FormatIssue[] = [];
  const len = visibleLength(post.caption);
  if (len > spec.captionMaxChars) out.push({ field: 'caption', code: 'too_long', detail: `${len} > ${spec.captionMaxChars}` });
  const [min, max] = spec.hashtags;
  if (post.hashtags.length < min || post.hashtags.length > max) {
    out.push({ field: 'hashtags', code: 'hashtag_count', detail: `${post.hashtags.length}, expected ${min}-${max}` });
  }
  return out;
}
