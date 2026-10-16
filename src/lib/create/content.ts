// What a post says, built by code from the brief and the brand profile (PRD v3 §4, B-2 to B-4; change C-16).
//
//   contentFromBrief   the design engine's DesignContent: USP lines, offer line, CTA, contact blocks, QR, bubble
//   factsForBrief      what the fact check treats as true for this brief
//   channelFormats     which picture sizes a channel needs
//
// Nothing here calls an AI. The AI only supplies the headline, subline, CTA wording, captions and the
// mascot line (see ./copy.ts); every figure, date, contact and QR comes from the brief or the profile.

import type { WeeklyFact } from '@/lib/ai/prompts/v2-weekly';
import type { FormatFamily } from '@/lib/briefs/completeness';
import { blockLines, CHANNEL_FORMATS, datesText, type ChannelKey } from '@/lib/briefs/editor-state';
import type { Brief, CtaKind, UspSnapshot } from '@/lib/briefs/types';
import { carouselFormat, type DesignBlock, type DesignContent, type DesignFormat } from '@/lib/design/types';
import { redactPaymentIds } from '@/lib/payments/redact';
import { qrContentFor } from '@/lib/qr';
import { NEEDS_CONFIRMATION } from '@/lib/usps/types';
import type { CreateBrand, DesignWords } from './types';

/** The CTA wording used when the AI's is missing or too long (English; the AI writes it in the post language otherwise). */
export const CTA_DEFAULT_TEXT: Record<CtaKind, string> = {
  call: 'Call now',
  whatsapp: 'WhatsApp us',
  visit: 'Visit us',
  book: 'Book now',
  order: 'Order now',
  website: 'Visit our website',
  scan: 'Scan to visit',
};

/** Labels printed under a QR code. */
export const QR_LABEL = { visit: 'Scan to visit', pay: 'Scan to pay' } as const;

// ---------------------------------------------------------------------------------------------
// Formats
// ---------------------------------------------------------------------------------------------

const FAMILY_FORMAT: Record<FormatFamily, DesignFormat> = {
  square: 'square',
  portrait: 'portrait',
  story: 'vertical',
  thumbnail: 'thumbnail',
  banner: 'banner',
  link: 'landscape',
};

/** The picture sizes one channel needs (G-5), the main one first. */
export function channelFormats(channel: string): DesignFormat[] {
  const families: readonly FormatFamily[] = CHANNEL_FORMATS[channel as ChannelKey] ?? ['square'];
  return [...new Set(families.map((f) => FAMILY_FORMAT[f]))];
}

/** Every size the brief's channels need, without repeats, in channel order. */
export function briefFormats(channels: readonly string[]): DesignFormat[] {
  const out: DesignFormat[] = [];
  for (const c of channels) for (const f of channelFormats(c)) if (!out.includes(f)) out.push(f);
  return out.length > 0 ? out : ['square'];
}

/** The size the design step shows: the main size of the first channel. */
export function primaryFormat(channels: readonly string[]): DesignFormat {
  return channelFormats(channels[0] ?? 'instagram')[0];
}

// A carousel the owner asked for (content format "carousel"): each channel's slides are one picture each, in `carouselFormat`.

/** True when the brief is a carousel the owner asked for (not C-20's automatic split of too many points). */
export const isCarouselBrief = (brief: Pick<Brief, 'contentFormat'>): boolean => brief.contentFormat === 'carousel';

/** The sizes a channel's pictures are in: its slide size for a carousel, else the sizes the channel needs. */
export const postFormats = (channel: string, carousel: boolean): DesignFormat[] => (carousel ? [carouselFormat(channel)] : channelFormats(channel));

/** The size the design step shows: the first channel's slide size for a carousel, else its main size. */
export const designFormat = (brief: Pick<Brief, 'channels' | 'contentFormat'>): DesignFormat =>
  isCarouselBrief(brief) ? carouselFormat(brief.channels[0] ?? 'instagram') : primaryFormat(brief.channels);

/** Every size a design of this brief may be drawn in (for checking an option). */
export function designFormats(brief: Pick<Brief, 'channels' | 'contentFormat'>): DesignFormat[] {
  const all = briefFormats(brief.channels);
  if (!isCarouselBrief(brief)) return all;
  return [...new Set([...brief.channels.map(carouselFormat), ...all])];
}

// ---------------------------------------------------------------------------------------------
// Readers for the (untyped) details of a frozen USP
// ---------------------------------------------------------------------------------------------

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

function money(m: unknown, language: string): string {
  const o = obj(m);
  const amount = num(o.amount);
  const currency = str(o.currency);
  if (amount === null) return '';
  try {
    return new Intl.NumberFormat(language || 'en', { style: 'currency', currency: currency || 'USD', minimumFractionDigits: Number.isInteger(amount) ? 0 : 2 }).format(amount);
  } catch {
    return `${currency} ${amount}`.trim();
  }
}

const hasFigure = (title: string, figure: string) => title.replace(/,/g, '').includes(figure);

/** "20% off", "Up to £5 off" or "£4.50 / loaf" from the details, or null when the title already says it. */
function amountLine(u: UspSnapshot, language: string): string | null {
  const d = obj(u.details);
  if (u.kind === 'discount') {
    const upTo = d.upTo === true ? 'Up to ' : '';
    const percent = num(d.percent);
    if (percent !== null) return hasFigure(u.title, String(percent)) ? null : `${upTo}${percent}% off`;
    const off = money(d.amountOff, language);
    const amount = num(obj(d.amountOff).amount);
    if (off && amount !== null) return hasFigure(u.title, String(amount)) ? null : `${upTo}${off} off`;
  }
  if (u.kind === 'price') {
    const price = money(d.price, language);
    const amount = num(obj(d.price).amount);
    if (price && amount !== null && !hasFigure(u.title, String(amount))) {
      const unit = str(d.unit);
      return unit ? `${price} / ${unit}` : price;
    }
  }
  return null;
}

/** The dates the post shows: the brief's, else the primary discount's own validity. Open-ended means no end text. */
function postDates(brief: Brief): { startsOn: string; endsOn: string } {
  let startsOn = brief.startsOn ?? '';
  let endsOn = brief.openEnded ? '' : (brief.endsOn ?? '');
  if (!startsOn && !endsOn && !brief.openEnded) {
    const d = obj(brief.uspSnapshot.find((u) => u.role === 'primary' && u.kind === 'discount')?.details);
    startsOn = str(d.validFrom);
    endsOn = str(d.validTo);
  }
  return { startsOn, endsOn };
}

/** The offer/date line (B-2, G-4 hierarchy: after the main point). Dates appear unless the owner switched the dates block off. */
/** The dates text the post shows ("Till 20 Oct"), or null: none given, open-ended, or the owner switched the dates block off. */
export function datesLineFor(brief: Brief): string | null {
  if (brief.blocks.dates === false) return null;
  const { startsOn, endsOn } = postDates(brief);
  return datesText(startsOn, endsOn);
}

export function offerLineFor(brief: Brief, language: string): string | null {
  const parts: string[] = [];
  const primary = brief.uspSnapshot.find((u) => u.role === 'primary');
  const amount = primary ? amountLine(primary, language) : null;
  if (amount) parts.push(amount);
  if (brief.blocks.dates !== false) {
    const { startsOn, endsOn } = postDates(brief);
    const when = datesText(startsOn, endsOn);
    if (when) parts.push(when);
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}

/** The contact and info lines the brief shows, exactly as the post prints them. The logo and the dates are drawn elsewhere. */
export function shownBlocks(brief: Brief, brand: CreateBrand): DesignBlock[] {
  const { startsOn, endsOn } = postDates(brief);
  const out: DesignBlock[] = [];
  for (const line of blockLines({ contacts: brand.contacts, hasLogo: brand.hasLogo, startsOn, endsOn })) {
    if (line.key === 'logo' || line.key === 'dates') continue;
    if (brief.blocks[line.key] === true && line.text) out.push({ kind: line.key, text: line.text });
  }
  return out;
}

/** The logo is drawn unless the owner switched it off. */
export const showsLogo = (brief: Brief): boolean => brief.blocks.logo !== false;

// ---------------------------------------------------------------------------------------------
// Saying a fact once: repeated words across the lines of one picture
// ---------------------------------------------------------------------------------------------

const MONTHS: Record<string, string> = {
  january: 'jan', february: 'feb', march: 'mar', april: 'apr', june: 'jun', july: 'jul', august: 'aug',
  september: 'sep', sept: 'sep', october: 'oct', november: 'nov', december: 'dec',
};

/** Words that carry no fact of their own: articles and small words, and the words around a date or an offer. */
const STOP = new Set([
  'a', 'an', 'the', 'and', 'or', 'of', 'for', 'on', 'in', 'at', 'to', 'with', 'our', 'your', 'you', 'we', 'is', 'are', 'all', 'any', 'this', 'that', 'it',
  'till', 'until', 'by', 'through', 'thru', 'from', 'valid', 'ends', 'end', 'starts', 'start', 'only', 'now', 'available',
  'special', 'offer', 'offers', 'deal', 'deals', 'sale',
]);

/** The words of a line that count when comparing: lower case, no punctuation, "October" and "oct" alike, "31st" as 31, plural "s" dropped. */
export function significantWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/(\d)(?:st|nd|rd|th)\b/g, '$1')
    .split(/[^\p{L}\p{N}%]+/u)
    .filter(Boolean)
    .map((w) => MONTHS[w] ?? w)
    .filter((w) => !STOP.has(w))
    .map((w) => (w.length > 3 && w.endsWith('s') && !/\d/.test(w) ? w.slice(0, -1) : w));
}

/** Share of `text`'s significant words that appear in the reference lines (0 when it has none). */
export function wordOverlap(text: string, references: readonly string[]): number {
  const mine = significantWords(text);
  if (mine.length === 0) return 0;
  const there = new Set(references.flatMap(significantWords));
  return mine.filter((w) => there.has(w)).length / mine.length;
}

/** The share of words that makes one line "mostly a repeat" of others. */
export const REPEAT_SHARE = 0.7;
export const repeatsLines = (text: string, references: readonly string[]): boolean => text.trim() !== '' && wordOverlap(text, references) >= REPEAT_SHARE;

const DATE_TAIL = /\d|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\b|\b(?:mon|tues?|wed(?:nes)?|thu(?:rs)?|fri|sat(?:ur)?|sun)(?:day)?\b|\b(?:today|tomorrow|weekend)\b/i;

/** "15% off suits till 31 October" becomes "15% off suits": a trailing "till/until/by <date>" is shown once, in the offer line. */
export function stripDatePhrase(text: string): string {
  const m = /[\s,;:\-–—]*\b(?:valid\s+)?(?:till|until|thru|through|by|ends?)\b\s+([^]*)$/i.exec(text);
  if (!m || m[1].length > 30 || !DATE_TAIL.test(m[1])) return text;
  const head = text.slice(0, m.index).trim();
  return head || text;
}

// ---------------------------------------------------------------------------------------------
// contentFromBrief
// ---------------------------------------------------------------------------------------------

/**
 * The design engine's content for a brief, all by code. `words` is the AI copy after validation.
 * - primary / secondary: the title lines of the frozen USPs (the primary only when the headline does not repeat it);
 * - offerLine: discount or price amount (when the title does not show it) and the dates; open-ended means no end text;
 * - cta: the brief's CTA kind with the copy's wording;
 * - blocks: the lines the brief switched on (the engine limits them per format with FORMAT_RULES);
 * - qr: `qrContentFor`. A payment QR whose ID is not active throws `QrContentError`, which blocks the post.
 *   A link QR needs `postCode` (its short link); the preview uses a placeholder.
 * - bubble: the copy's line, only when the mascot is on.
 */
export async function contentFromBrief(
  brief: Brief,
  brand: CreateBrand,
  words: DesignWords,
  opts: { postCode?: string; baseUrl?: string; mascot?: boolean } = {},
): Promise<DesignContent> {
  const language = brief.language ?? brand.language;
  const primaryUsp = brief.uspSnapshot.find((u) => u.role === 'primary') ?? null;
  const secondary = brief.uspSnapshot.filter((u) => u.role === 'secondary').slice(0, 2);

  let qr: DesignContent['qr'] = null;
  if (brief.qr) {
    const q = await qrContentFor(brief.qr, { brandId: brand.id, postCode: opts.postCode, baseUrl: opts.baseUrl });
    qr = { text: q.text, label: QR_LABEL[q.label], ...(q.payment ? { payment: q.payment } : {}) };
  }
  const mascot = opts.mascot ?? brand.face !== null;

  // Each fact is said once on a picture: the date is in the offer line, so it is cut from the USP lines; a main point the
  // headline already carries is not repeated; a subline that only repeats the headline, the main point or the dates is dropped.
  const offerLine = offerLineFor(brief, language);
  const hasDate = datesLineFor(brief) !== null;
  const display = (title: string) => (hasDate ? stripDatePhrase(title) : title);
  const primaryText = primaryUsp ? display(primaryUsp.title) : '';
  const headlineHasPrimary = primaryUsp !== null && wordOverlap(primaryText, [words.headline]) >= REPEAT_SHARE;
  const subline = repeatsLines(words.subline, [words.headline, primaryText, offerLine ?? '']) ? '' : words.subline;

  return {
    headline: words.headline,
    subline,
    primary: primaryUsp && !headlineHasPrimary ? { kind: primaryUsp.kind, text: primaryText } : null,
    secondary: secondary.map((u) => ({ kind: u.kind, text: display(u.title) })),
    offerLine,
    cta: brief.cta ? { kind: brief.cta, text: words.ctaText || CTA_DEFAULT_TEXT[brief.cta] } : null,
    blocks: shownBlocks(brief, brand),
    qr,
    bubble: mascot ? words.bubble : '',
  };
}

// ---------------------------------------------------------------------------------------------
// factsForBrief
// ---------------------------------------------------------------------------------------------

const FACT_KIND: Record<UspSnapshot['kind'], string> = {
  discount: 'offer',
  price: 'price',
  quality: 'claim',
  reviews: 'claim',
  delivery: 'differentiator',
  guarantee: 'claim',
  experience: 'claim',
  free_extra: 'offer',
  custom: 'claim',
};

/** A USP as plain words with every figure the guardrail may meet in a post (title, then the details). */
export function uspReadable(u: Pick<UspSnapshot, 'kind' | 'title' | 'details'>, language = 'en'): string {
  const d = obj(u.details);
  const bits: string[] = [];
  switch (u.kind) {
    case 'discount': {
      const percent = num(d.percent);
      if (percent !== null) bits.push(`${d.upTo === true ? 'up to ' : ''}${percent}% off`);
      const off = money(d.amountOff, language);
      if (off) bits.push(`${d.upTo === true ? 'up to ' : ''}${off} off`);
      if (str(d.on)) bits.push(`on ${str(d.on)}`);
      if (str(d.validFrom)) bits.push(`from ${str(d.validFrom)}`);
      if (str(d.validTo)) bits.push(`until ${str(d.validTo)}`);
      break;
    }
    case 'price': {
      const price = money(d.price, language);
      if (str(d.item)) bits.push(str(d.item));
      if (price) bits.push(`${price}${str(d.unit) ? ` per ${str(d.unit)}` : ''}`);
      break;
    }
    case 'quality':
      bits.push(str(d.claim), str(d.evidence));
      break;
    case 'reviews': {
      const rating = num(d.rating);
      const count = num(d.count);
      if (rating !== null) bits.push(`${rating} out of 5`);
      if (str(d.platform)) bits.push(`on ${str(d.platform)}`);
      if (count !== null) bits.push(`${count} reviews`);
      break;
    }
    case 'delivery':
      bits.push(str(d.promise), str(d.area), str(d.conditions));
      break;
    case 'guarantee':
      bits.push(str(d.length), str(d.terms));
      break;
    case 'experience': {
      const years = num(d.years);
      if (years !== null) bits.push(`${years} years`);
      bits.push(str(d.credential));
      break;
    }
    case 'free_extra':
      bits.push(str(d.what), str(d.conditions));
      break;
    default:
      break;
  }
  const detail = bits.filter(Boolean).join(', ');
  return detail && !u.title.includes(detail) ? `${u.title}. ${detail}` : u.title;
}

const CONTACT_FACT: Record<string, { kind: string; label: string }> = {
  phone: { kind: 'phone', label: 'Phone' },
  whatsapp: { kind: 'phone', label: 'WhatsApp' },
  email: { kind: 'email', label: 'Email' },
  address: { kind: 'address', label: 'Address' },
  hours: { kind: 'hours', label: 'Opening hours' },
  website: { kind: 'other', label: 'Website' },
  instagram: { kind: 'other', label: 'Instagram' },
  youtube: { kind: 'other', label: 'YouTube' },
  facebook: { kind: 'other', label: 'Facebook' },
};

/**
 * What the fact check treats as true for this brief: the brand's active facts, every USP of the brief
 * (a claim the owner confirmed says so), the contact lines exactly as the post shows them, and the dates.
 * Ids continue after the brand's facts (f1, f2, ...), so the same list can go to the guardrail.
 */
export function factsForBrief(brief: Brief, brand: CreateBrand): WeeklyFact[] {
  const language = brief.language ?? brand.language;
  const out: WeeklyFact[] = [...brand.facts];
  const add = (kind: string, label: string, value: string) => {
    if (value.trim()) out.push({ id: `f${out.length + 1}`, kind, label, value: value.trim(), neverUse: false });
  };
  for (const u of brief.uspSnapshot) {
    const confirmed = u.confirmed && NEEDS_CONFIRMATION.has(u.kind) ? ' (confirmed by the owner)' : '';
    add(FACT_KIND[u.kind], u.role === 'primary' ? 'Main selling point' : 'Selling point', `${uspReadable(u, language)}${confirmed}`);
  }
  for (const b of shownBlocks(brief, brand)) {
    const f = CONTACT_FACT[b.kind];
    if (f) add(f.kind, f.label, b.text);
  }
  // The owner's own description of this post is a source of facts too (payment IDs never reach the check).
  if (brief.notes) add('other', "Owner's description of this post", redactPaymentIds(brief.notes));
  const { startsOn, endsOn } = postDates(brief);
  const when = datesText(startsOn, endsOn);
  if (when) add('offer', 'Offer dates', [when, startsOn && `starts ${startsOn}`, endsOn && `ends ${endsOn}`].filter(Boolean).join(', '));
  return out;
}
