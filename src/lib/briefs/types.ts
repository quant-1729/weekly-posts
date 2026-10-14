// Post brief types (PRD v3 B-1 to B-8, changes C-06, C-10, C-11). Orchestrator-owned: builders
// import these. Mirrors `public.post_briefs`, `post_type`, `cta_kind` in 0014_v3_details.sql.

import { z } from 'zod';
import type { UspKind } from '@/lib/usps/types';

export const POST_TYPES = ['offer', 'new_product', 'event', 'announcement', 'occasion', 'testimonial', 'hiring', 'brand'] as const;
export type PostType = (typeof POST_TYPES)[number];

export const CTA_KINDS = ['call', 'whatsapp', 'visit', 'book', 'order', 'website', 'scan'] as const;
export type CtaKind = (typeof CTA_KINDS)[number];

/** Contact and info blocks the owner can show or hide per post (B-4). */
export const BLOCK_KEYS = ['logo', 'phone', 'whatsapp', 'website', 'email', 'address', 'hours', 'dates', 'instagram', 'youtube', 'facebook'] as const;
export type BlockKey = (typeof BLOCK_KEYS)[number];
export type Blocks = Partial<Record<BlockKey, boolean>>;

/** Where a link QR points (B-4.1). A payment QR points at a confirmed payment ID instead. */
export const QR_LINK_TARGETS = ['website', 'whatsapp', 'map', 'booking', 'custom'] as const;
export type QrLinkTarget = (typeof QR_LINK_TARGETS)[number];

export const qrSpecSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('link'),
    target: z.enum(QR_LINK_TARGETS),
    url: z.string().url().max(500),
    /** Our short link code; the QR encodes the short link so scans are counted. */
    shortCode: z.string().max(32).optional(),
  }),
  z.object({
    kind: z.literal('payment'),
    /** `public.payment_ids.id`; must be an active (email-confirmed) ID of the same brand. */
    paymentId: z.string().uuid(),
    /** Optional fixed amount, only when the owner sets it. */
    amount: z.number().positive().optional(),
  }),
]);
export type QrSpec = z.infer<typeof qrSpecSchema>;

/** One USP as frozen into a brief (so later library edits don't change made posts). */
export interface UspSnapshot {
  uspId: string;
  kind: UspKind;
  title: string;
  details: Record<string, unknown>;
  /** The owner confirmed this claim (needed for kinds in NEEDS_CONFIRMATION before a post may show it). */
  confirmed: boolean;
  role: 'primary' | 'secondary';
}

/** USP limits per format family (B-2): more than this → warning + carousel offer. */
export const USP_LIMITS = {
  square: { primary: 1, secondary: 2 },
  portrait: { primary: 1, secondary: 2 },
  story: { primary: 1, secondary: 2 },
  thumbnail: { primary: 1, secondary: 1 },
  banner: { primary: 1, secondary: 1 },
  link: { primary: 1, secondary: 1 },
} as const;

/** Fields a brief must have before design, per post type (B-8). */
export const REQUIRED_BY_TYPE: Record<PostType, ReadonlyArray<'primaryUsp' | 'dates' | 'cta'>> = {
  offer: ['primaryUsp', 'dates', 'cta'],
  new_product: ['primaryUsp', 'cta'],
  event: ['dates', 'cta'],
  announcement: ['dates'],
  occasion: [],
  testimonial: ['primaryUsp'],
  hiring: ['cta'],
  brand: [],
};

export interface Brief {
  id: string;
  brandId: string;
  postType: PostType;
  primaryUspId: string | null;
  secondaryUspIds: string[];
  uspSnapshot: UspSnapshot[];
  cta: CtaKind | null;
  blocks: Blocks;
  qr: QrSpec | null;
  photoId: string | null;
  language: string | null;
  startsOn: string | null; // YYYY-MM-DD in the brand's time zone
  endsOn: string | null;
  /** The owner chose "no end date" for this offer (then endsOn is null). PRD v3 §6. */
  openEnded: boolean;
  timezone: string | null;
  channels: string[];
  notes: string | null;
  status: 'draft' | 'ready';
}
