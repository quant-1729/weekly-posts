// Shared types for the v2 guardrail (Req 11-13). See docs/guardrail.md (v1 design + v2 addendum).

import type { V2Channel } from '@/lib/ai/prompts/v2-weekly';

// image_text.bubble is the mascot's speech bubble (V-25); empty for brands without a mascot.
export const FLAG_FIELDS = ['caption', 'cta', 'image_text.headline', 'image_text.subline', 'image_text.bubble'] as const;
export type FlagField = (typeof FLAG_FIELDS)[number];

export const FLAG_KINDS = [
  'price',
  'offer',
  'hours',
  'date',
  'phone',
  'quantity',
  'claim',
  'avoid',
  'repeat',
  'regulated_reminder',
] as const;
export type FlagKind = (typeof FLAG_KINDS)[number];

/** brand_memory.regulated values. */
export type RegulatedKind = 'none' | 'health' | 'finance' | 'alcohol' | 'legal' | 'other';

/** One entry of posts.fact_flags (docs/guardrail.md section 4). */
export interface Flag {
  id: string;
  text: string;
  kind: FlagKind;
  field: FlagField;
  layer: 'code' | 'ai' | 'both';
  regulated: boolean;
  /** False when `text` is not an exact substring of the field: the UI cannot underline it. */
  highlight: boolean;
  status: 'open' | 'confirmed' | 'removed';
  decided_at: string | null;
  /**
   * Carousel only: the flag is about this slide (0-based) of the post. `field` is then `image_text.headline` for the slide's
   * headline and `image_text.subline` for its body, and `text` is a piece of that slide's text.
   */
  slide?: number;
}

/** The copy the guardrail looks at. `bubble` is the mascot's speech bubble, when the post has one. */
export interface GuardrailPost {
  channel: V2Channel;
  caption: string;
  cta: string;
  hashtags: string[];
  image_text: { headline: string; subline: string; bubble?: string };
}

/** Channel-limit problems. Not facts: the pipeline's retry logic uses them, the owner never sees them. */
export interface FormatIssue {
  field: 'caption' | 'hashtags';
  code: 'too_long' | 'hashtag_count';
  detail: string;
}

export const REGULATED_REMINDER_TEXT = 'Check your local advertising rules before posting.';
export const AI_UNCHECKED_TEXT = 'Facts not checked; please review before sharing';

export function fieldText(post: { caption: string; cta: string; image_text: { headline: string; subline: string; bubble?: string } }, field: FlagField): string {
  switch (field) {
    case 'caption':
      return post.caption;
    case 'cta':
      return post.cta;
    case 'image_text.headline':
      return post.image_text.headline;
    case 'image_text.subline':
      return post.image_text.subline;
    case 'image_text.bubble':
      return post.image_text.bubble ?? '';
  }
}
