// The brief editor's state and the rules around it (PRD v3 B-1 to B-8): pure functions, safe in the
// browser and easy to test. The editor component holds an `EditorDraft`, shows the text of each
// block, and turns the draft into the input the brief service accepts.

import type { ContactKind, ContactPoint } from '@/lib/contacts/types';
import { fill, s } from '@/lib/i18n/strings';
import type { UspKind } from '@/lib/usps/types';
import { checkCompleteness, type FormatFamily, type MissingItem } from './completeness';
import type { BriefFromTextResult } from './from-text';
import type { BriefInput } from './service';
import { BLOCK_KEYS, type Blocks, type BlockKey, type Brief, type CtaKind, type PostType, type QrLinkTarget, type QrSpec } from './types';

/** Channels the brief can hold (the `post_channel` enum, migrations 0005 and 0017). */
export const EDITOR_CHANNELS = ['instagram', 'facebook', 'whatsapp', 'youtube', 'linkedin', 'gbp'] as const;
/** Every channel the UI has words for (see `s.create.channels.options`). */
export type ChannelKey = 'instagram' | 'facebook' | 'whatsapp' | 'youtube' | 'linkedin' | 'gbp';

/** The call to action a post type starts with (B-3). The owner can change it. */
export const DEFAULT_CTA: Record<PostType, CtaKind> = {
  offer: 'visit',
  new_product: 'order',
  event: 'book',
  announcement: 'visit',
  occasion: 'visit',
  testimonial: 'visit',
  hiring: 'call',
  brand: 'visit',
};

export type QrDraft =
  | { mode: 'none' }
  | { mode: 'link'; target: QrLinkTarget; url: string }
  | { mode: 'payment'; paymentId: string };

export interface EditorDraft {
  postType: PostType | null;
  primaryUspId: string | null;
  secondaryUspIds: string[];
  cta: CtaKind | null;
  /** True once the owner (or their description) chose the CTA, so a later post-type change doesn't replace it. */
  ctaChosen: boolean;
  blocks: Blocks;
  qr: QrDraft;
  photoId: string | null;
  language: string;
  startsOn: string;
  endsOn: string;
  /** An offer with no end date, chosen on purpose. Then `endsOn` is empty. */
  openEnded: boolean;
  channels: string[];
}

/** "No end date" only means something for an offer. */
const isOpen = (d: EditorDraft): boolean => d.openEnded && d.postType === 'offer';

export function draftFromBrief(brief: Brief): EditorDraft {
  const qr: QrDraft =
    brief.qr?.kind === 'link'
      ? { mode: 'link', target: brief.qr.target, url: brief.qr.url }
      : brief.qr?.kind === 'payment'
        ? { mode: 'payment', paymentId: brief.qr.paymentId }
        : { mode: 'none' };
  return {
    postType: brief.postType,
    primaryUspId: brief.primaryUspId,
    secondaryUspIds: brief.secondaryUspIds,
    cta: brief.cta,
    ctaChosen: brief.cta !== null,
    blocks: brief.blocks,
    qr,
    photoId: brief.photoId,
    language: brief.language ?? '',
    startsOn: brief.startsOn ?? '',
    endsOn: brief.endsOn ?? '',
    openEnded: brief.openEnded,
    channels: brief.channels,
  };
}

/** A new, empty draft: the brand's defaults and nothing chosen yet. */
export function emptyDraft(d: { blocks: Blocks; language: string; channels: string[] }): EditorDraft {
  return {
    postType: null,
    primaryUspId: null,
    secondaryUspIds: [],
    cta: null,
    ctaChosen: false,
    blocks: d.blocks,
    qr: { mode: 'none' },
    photoId: null,
    language: d.language,
    startsOn: '',
    endsOn: '',
    openEnded: false,
    channels: d.channels,
  };
}

/**
 * What the brief service receives. Null before a post type is chosen (nothing to save yet).
 * A link QR without a link yet is sent as "no QR" so a stale one is not kept.
 */
export function draftToInput(d: EditorDraft): BriefInput | null {
  if (!d.postType) return null;
  let qr: QrSpec | null = null;
  if (d.qr.mode === 'link' && d.qr.url.trim()) qr = { kind: 'link', target: d.qr.target, url: d.qr.url.trim() };
  if (d.qr.mode === 'payment' && d.qr.paymentId) qr = { kind: 'payment', paymentId: d.qr.paymentId };
  return {
    postType: d.postType,
    primaryUspId: d.primaryUspId,
    secondaryUspIds: d.primaryUspId ? d.secondaryUspIds : [],
    cta: d.cta,
    blocks: d.blocks,
    qr,
    photoId: d.photoId,
    language: d.language || null,
    startsOn: d.startsOn || null,
    endsOn: isOpen(d) ? null : d.endsOn || null,
    openEnded: isOpen(d),
    channels: d.channels,
  };
}

/** The same draft as a stable string, to know whether anything changed since the last save. */
export const draftKey = (d: EditorDraft): string => JSON.stringify(draftToInput(d));

export interface LibraryUsp {
  id: string;
  kind: UspKind;
  title: string;
  confirmed: boolean;
}

export interface EditorMissing {
  key: MissingItem['key'] | 'postType' | 'confirm' | 'qr';
  question: string;
}

/**
 * Everything that must be fixed before "Next": the type, the brief's own completeness rules
 * (B-8), a chosen claim that still needs the owner's confirmation, and a link QR without a link.
 */
export function missingForNext(d: EditorDraft, usps: readonly LibraryUsp[], needsConfirmation: ReadonlySet<UspKind>): EditorMissing[] {
  const out: EditorMissing[] = [];
  if (!d.postType) return [{ key: 'postType', question: s.create.check.pickType }];
  const byId = new Map(usps.map((u) => [u.id, u]));
  const chosen = [d.primaryUspId, ...d.secondaryUspIds].filter((x): x is string => !!x);
  const brief: Brief = {
    id: '',
    brandId: '',
    postType: d.postType,
    primaryUspId: d.primaryUspId,
    secondaryUspIds: d.secondaryUspIds,
    uspSnapshot: chosen.flatMap((id) => {
      const u = byId.get(id);
      return u ? [{ uspId: u.id, kind: u.kind, title: u.title, details: {}, confirmed: u.confirmed, role: id === d.primaryUspId ? ('primary' as const) : ('secondary' as const) }] : [];
    }),
    cta: d.cta,
    blocks: d.blocks,
    qr: null,
    photoId: d.photoId,
    language: d.language || null,
    startsOn: d.startsOn || null,
    endsOn: isOpen(d) ? null : d.endsOn || null,
    openEnded: isOpen(d),
    timezone: null,
    channels: d.channels,
    notes: null,
    status: 'draft',
  };
  out.push(...checkCompleteness(brief));
  for (const id of chosen) {
    const u = byId.get(id);
    if (u && needsConfirmation.has(u.kind) && !u.confirmed) out.push({ key: 'confirm', question: fill(s.create.check.confirmUsp, { title: u.title }) });
  }
  if (d.qr.mode === 'link' && !d.qr.url.trim()) out.push({ key: 'qr', question: s.create.qr.errors.empty });
  return out;
}

/** Format families a channel is drawn in (PRD G-5), for the "too many points" warning. */
export const CHANNEL_FORMATS: Record<ChannelKey, readonly FormatFamily[]> = {
  instagram: ['square', 'portrait'],
  facebook: ['square'],
  whatsapp: ['story'],
  youtube: ['thumbnail'],
  linkedin: ['square'],
  gbp: ['square'],
};

export function formatsForChannels(channels: readonly string[]): FormatFamily[] {
  const out: FormatFamily[] = [];
  for (const c of channels) for (const f of CHANNEL_FORMATS[c as ChannelKey] ?? []) if (!out.includes(f)) out.push(f);
  return out.length > 0 ? out : ['square'];
}

// ---------------------------------------------------------------------------------------------
// Contact and info blocks (B-4): the real text each one shows
// ---------------------------------------------------------------------------------------------

const BLOCK_CONTACT_KIND: Partial<Record<BlockKey, ContactKind>> = {
  phone: 'phone',
  whatsapp: 'whatsapp',
  website: 'website',
  email: 'email',
  address: 'address',
  hours: 'hours',
  instagram: 'instagram',
  youtube: 'youtube',
  facebook: 'facebook',
};

/** The contact a block shows: the default of its kind, else the first. */
export function contactFor(contacts: readonly ContactPoint[], kind: ContactKind): ContactPoint | null {
  const of = contacts.filter((c) => c.kind === kind);
  return of.find((c) => c.isDefault) ?? of[0] ?? null;
}

const shortDate = (iso: string): string => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, d)));
};

/** "From 15 Oct to 20 Oct", "Till 20 Oct", "From 15 Oct" or null when there are no dates. */
export function datesText(startsOn: string, endsOn: string): string | null {
  const t = s.create.blocks;
  if (startsOn && endsOn) return fill(t.datesFrom, { start: shortDate(startsOn), end: shortDate(endsOn) });
  if (endsOn) return fill(t.datesTill, { end: shortDate(endsOn) });
  if (startsOn) return fill(t.datesStarting, { start: shortDate(startsOn) });
  return null;
}

export interface BlockLine {
  key: BlockKey;
  label: string;
  /** What the post will show; null when the brand doesn't have it yet. */
  text: string | null;
  /** Where to add it when missing; null for dates (set below). */
  addHref: string | null;
}

export function blockLines(a: { contacts: readonly ContactPoint[]; hasLogo: boolean; startsOn: string; endsOn: string }): BlockLine[] {
  return BLOCK_KEYS.map((key) => {
    const label = s.create.blocks.labels[key];
    if (key === 'logo') return { key, label, text: a.hasLogo ? s.create.blocks.logoText : null, addHref: '/brand#look' };
    if (key === 'dates') return { key, label, text: datesText(a.startsOn, a.endsOn), addHref: null };
    const kind = BLOCK_CONTACT_KIND[key];
    const c = kind ? contactFor(a.contacts, kind) : null;
    return { key, label, text: c ? (c.display ?? c.value) : null, addHref: '/brand#contacts' };
  });
}

// ---------------------------------------------------------------------------------------------
// QR (B-4.1)
// ---------------------------------------------------------------------------------------------

/** The link a QR target starts with, from the contact set ('' when the brand has none). */
export function qrTargetUrl(target: QrLinkTarget, contacts: readonly ContactPoint[]): string {
  switch (target) {
    case 'website':
      return contactFor(contacts, 'website')?.value ?? '';
    case 'whatsapp': {
      const c = contactFor(contacts, 'whatsapp');
      if (!c) return '';
      const link = typeof c.details.link === 'string' ? c.details.link : '';
      return link || `https://wa.me/${c.value.replace(/^\+/, '')}`;
    }
    case 'map':
      return contactFor(contacts, 'map')?.value ?? '';
    case 'booking':
      return contactFor(contacts, 'booking')?.value ?? '';
    default:
      return '';
  }
}

// ---------------------------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------------------------

const dayNumber = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
};

/** "Ends in 5 days" / "Ends today" / "Ends tomorrow" / "This end date has passed" / "No end date". `today` is the date in the brand's time zone. */
export function endsInText(today: string, endsOn: string): string {
  const t = s.create.dates;
  if (!endsOn) return t.noEnd;
  const n = dayNumber(endsOn) - dayNumber(today);
  if (n < 0) return t.ended;
  if (n === 0) return t.endsToday;
  if (n === 1) return t.endsTomorrow;
  return fill(t.endsIn, { n });
}

/** The channels the editor starts with: those the brand has an account for, else Instagram. */
export function defaultChannels(contacts: readonly ContactPoint[]): string[] {
  const out: string[] = [];
  if (contacts.some((c) => c.kind === 'instagram')) out.push('instagram');
  if (contacts.some((c) => c.kind === 'facebook')) out.push('facebook');
  if (contacts.some((c) => c.kind === 'whatsapp')) out.push('whatsapp');
  return out.length > 0 ? out : ['instagram'];
}

// ---------------------------------------------------------------------------------------------
// "Describe your post" (B-7): put the checked answer into the draft
// ---------------------------------------------------------------------------------------------

/**
 * Applies what `briefFromText` returned to the draft. Only fields the answer carries are set; the
 * rest stay as the owner had them. A call to action the owner did not name starts from the post
 * type's default unless the owner already chose one. Returns a new draft.
 */
export function applyDescription(d: EditorDraft, r: Pick<BriefFromTextResult, 'brief'>): EditorDraft {
  const b = r.brief;
  const next: EditorDraft = { ...d, postType: b.postType };
  if (b.primaryUspId) {
    next.primaryUspId = b.primaryUspId;
    next.secondaryUspIds = (b.secondaryUspIds ?? []).filter((x) => x !== b.primaryUspId);
  }
  if (b.cta) {
    next.cta = b.cta;
    next.ctaChosen = true;
  } else if (!d.ctaChosen) next.cta = DEFAULT_CTA[b.postType];
  if (b.blocks) next.blocks = { ...d.blocks, ...b.blocks };
  if (b.startsOn || b.endsOn) {
    next.startsOn = b.startsOn ?? d.startsOn;
    next.endsOn = b.endsOn ?? d.endsOn;
    if (b.endsOn) next.openEnded = false; // an end date the owner named replaces "no end date"; the description never sets openEnded itself
    next.blocks = { ...next.blocks, dates: true };
  }
  if (b.language) next.language = b.language;
  return next;
}

/**
 * Uses a selling point the owner has just added: as the main point when there is none, else as an
 * extra point when there is room (at most 2), else it only joins the library. Returns a new draft.
 */
export function selectNewUsp(d: EditorDraft, uspId: string): EditorDraft {
  if (!d.primaryUspId) return { ...d, primaryUspId: uspId, secondaryUspIds: [] };
  if (d.secondaryUspIds.length < 2 && !d.secondaryUspIds.includes(uspId) && d.primaryUspId !== uspId) return { ...d, secondaryUspIds: [...d.secondaryUspIds, uspId] };
  return d;
}
