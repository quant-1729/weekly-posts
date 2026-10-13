// Deterministic checks on generated outputs. Run after every generate and
// switch-language call, and by the prompt dry run (T-4). Owned by the orchestrator.
// These are a fast first line; the full facts guardrail is T-12.

import { CHANNELS, type Channel, type ChannelOutput, type ContentLanguage } from './schemas';
import { CHANNEL_SPECS, IMAGE_TEXT_LIMITS } from './prompts/shared';

export interface CheckIssue {
  channel: Channel;
  field: string;
  code:
    | 'too_long'
    | 'hashtag_count'
    | 'wrong_script'
    | 'contact_detail'
    | 'unsupported_number'
    | 'unsupported_phrase'
    | 'empty';
  detail: string;
}

const DEVANAGARI = /[ऀ-ॿ]/g;

// Count user-visible characters (grapheme clusters), so Devanagari conjuncts
// count as one, the way a reader sees them.
const segmenter = new Intl.Segmenter('hi', { granularity: 'grapheme' });
export function visibleLength(s: string): number {
  return [...segmenter.segment(s)].length;
}

// Latin words that may stay in English letters inside Hindi: WhatsApp and units.
const ALLOWED_LATIN = new Set(['whatsapp', 'kg', 'g', 'gm', 'km', 'ml', 'l', 'am', 'pm']);

function scriptIssue(text: string, lang: ContentLanguage, sourcesLower: string): string | null {
  const dev = (text.match(DEVANAGARI) ?? []).length;
  // In Hindi, brand and product names the owner wrote in English letters are allowed too.
  const words = text.match(/[A-Za-z]+/g) ?? [];
  const lat = words
    .filter((w) => {
      const lw = w.toLowerCase();
      if (ALLOWED_LATIN.has(lw)) return false;
      return !(lang === 'hi' && new RegExp(`\\b${lw}\\b`).test(sourcesLower));
    })
    .join('').length;
  if (dev + lat === 0) return null;
  if (lang === 'hi') {
    // Latin is allowed for brand/product names, so require a clear majority.
    return dev / (dev + lat) >= 0.6 ? null : `only ${Math.round((100 * dev) / (dev + lat))}% Devanagari`;
  }
  return dev === 0 ? null : `${dev} Devanagari characters in ${lang}`;
}

const CONTACT = [
  /(?:\+?91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}\b/, // Indian mobile
  /https?:\/\//i,
  /\bwww\./i,
  /\b[a-z0-9-]+\.(?:com|in|co|net|org|shop|store)\b/i,
  /@[a-z0-9.-]+\.[a-z]{2,}/i, // email
];

// Phrases the model must not add on its own (R8 rule 4, regulated rules).
// Allowed only when the same phrase is in the owner sources.
const RISKY_PHRASES = [
  'limited time', 'limited stock', 'hurry', 'last few days', 'last day', 'today only', 'only today',
  'best in', 'no. 1', 'no.1', 'number 1', 'number one', 'lowest price', 'cheapest', 'guarantee',
  '100%', 'free delivery', 'free home delivery', 'cure', 'permanent solution', 'pain-free', 'pain free',
  'no side effect', 'assured', 'top ranker', 'selection pakka', 'sabse sasta', 'sabse best',
  'jaldi karein', 'jaldi karo', 'sirf aaj',
  // alcohol (Req 12): heavy drinking. Minors are checked by the AI layer for alcohol brands only.
  'drink more', 'drink up', 'no hangover',
  'गारंटी', 'सबसे सस्ता', 'सबसे बेहतर', 'सीमित समय', 'जल्दी करें', 'सिर्फ़ आज', 'सिर्फ आज', 'फ्री डिलीवरी', 'फ़्री डिलीवरी',
  'मुफ्त डिलीवरी', 'मुफ़्त डिलीवरी', 'इलाज', 'पक्का रिज़ल्ट', 'पक्का रिजल्ट',
];

// Digits written in either Latin or Devanagari form, normalised to Latin.
function numbersIn(s: string): string[] {
  const latin = s.replace(/[०-९]/g, (d) => String(d.charCodeAt(0) - 0x0966));
  return (latin.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((n) => n.replace(/,/g, '').replace(/\.0+$/, ''));
}

export function checkChannelOutput(
  channel: Channel,
  out: ChannelOutput,
  lang: ContentLanguage,
  sources: string,
): CheckIssue[] {
  const issues: CheckIssue[] = [];
  const spec = CHANNEL_SPECS[channel];
  const add = (field: string, code: CheckIssue['code'], detail: string) =>
    issues.push({ channel, field, code, detail });

  if (!out.caption.trim()) add('caption', 'empty', 'caption is empty');
  if (!out.cta.trim()) add('cta', 'empty', 'cta is empty');
  if (visibleLength(out.caption) > spec.captionMaxChars)
    add('caption', 'too_long', `${visibleLength(out.caption)} > ${spec.captionMaxChars}`);
  if (visibleLength(out.cta) > 60) add('cta', 'too_long', `${visibleLength(out.cta)} > 60`);

  const [minTags, maxTags] = spec.hashtags;
  if (out.hashtags.length < minTags || out.hashtags.length > maxTags)
    add('hashtags', 'hashtag_count', `${out.hashtags.length}, expected ${minTags}-${maxTags}`);

  if (spec.imageText) {
    if (!out.image_text.headline.trim()) add('image_text.headline', 'empty', 'headline is empty');
    for (const k of ['headline', 'subline', 'bubble'] as const) {
      const len = visibleLength(out.image_text[k]);
      if (len > IMAGE_TEXT_LIMITS[k]) add(`image_text.${k}`, 'too_long', `${len} > ${IMAGE_TEXT_LIMITS[k]}`);
    }
  }

  const visible: Array<[string, string]> = [
    ['caption', out.caption],
    ['cta', out.cta],
    ['image_text.headline', out.image_text.headline],
    ['image_text.subline', out.image_text.subline],
    ['image_text.bubble', out.image_text.bubble],
  ];

  const sourceNumbers = new Set(numbersIn(sources));
  const sourcesLower = sources.toLowerCase();

  for (const [field, text] of visible) {
    const s = scriptIssue(text, lang, sourcesLower);
    if (s) add(field, 'wrong_script', s);
  }
  for (const [field, text] of [...visible, ['hashtags', out.hashtags.join(' ')] as [string, string]]) {
    for (const re of CONTACT) {
      const m = text.match(re);
      if (m) add(field, 'contact_detail', m[0]);
    }
    for (const n of numbersIn(text)) {
      if (!sourceNumbers.has(n)) add(field, 'unsupported_number', n);
    }
    const lower = text.toLowerCase();
    for (const p of RISKY_PHRASES) {
      if (lower.includes(p) && !sourcesLower.includes(p)) add(field, 'unsupported_phrase', p);
    }
  }
  return issues;
}

export function checkAllOutputs(
  outputs: Record<Channel, ChannelOutput>,
  lang: ContentLanguage,
  sources: string,
): CheckIssue[] {
  return CHANNELS.flatMap((c) => checkChannelOutput(c, outputs[c], lang, sources));
}
