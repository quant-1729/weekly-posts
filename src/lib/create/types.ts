// Shared types of the "Create a post" pipeline (PRD v3 §5.3 G-4 to G-7, §5.4 C-1 to C-3; change C-16).
// Pure types: safe to import in the browser.

import type { WeeklyFact } from '@/lib/ai/prompts/v2-weekly';
import type { ContactPoint } from '@/lib/contacts/types';
import type { DesignContent, DesignFormat, DesignOption } from '@/lib/design/types';
import type { Flag, RegulatedKind } from '@/lib/guardrail/types';

/** The brand, as the pipeline needs it (loaded once by `loadCreateBrand`). */
export interface CreateBrand {
  id: string;
  name: string;
  /** What the business sells (brand_memory.category). */
  sells: string;
  country: string | null;
  timezone: string;
  /** The brand's post language (BCP 47). */
  language: string;
  /** Voice description, else tone. */
  voice: string;
  wordsToAvoid: string[];
  regulated: RegulatedKind;
  contacts: ContactPoint[];
  hasLogo: boolean;
  logoPath: string | null;
  /** brand_memory.mascot_in_posts. */
  mascotOn: boolean;
  /** The brand's active facts (f1, f2, ...), the base of `factsForBrief`. */
  facts: WeeklyFact[];
}

/** The words of a post, validated in code. */
export interface PostCopyResult {
  headline: string;
  subline: string;
  ctaText: string;
  /** One caption per channel of the brief. */
  captions: Record<string, string>;
  hashtags: string[];
  bubble: string;
  pose: string;
  /** What code had to repair (for logs and tests; not shown to the owner). */
  fixes: string[];
}

/** The words that go on the picture (shared by every channel post of a brief). */
export interface DesignWords {
  headline: string;
  subline: string;
  ctaText: string;
  bubble: string;
}

export type BlockerCode = 'overflow' | 'qr_mismatch' | 'render_failed';

/** A design problem that stops approval: text that does not fit, or a QR that does not read back exactly. */
export interface DesignBlocker {
  format: DesignFormat;
  code: BlockerCode;
  detail: string;
}

/** What `posts.design` holds: enough to draw the post again exactly the same way. */
export interface StoredDesign {
  v: 1;
  content: DesignContent;
  scheme: DesignOption['scheme'];
  option: DesignOption;
  /** The options the owner was shown. */
  options: DesignOption[];
  formats: DesignFormat[];
  /** Per format: what did not fit, for the review step. */
  dropped: Partial<Record<DesignFormat, string[]>>;
  blockers: DesignBlocker[];
  /** For a carousel slide. */
  slide?: { index: number; total: number };
  /** For the post a carousel belongs to. */
  carousel?: { id: string; slides: number };
  /** The language and photo the picture was drawn with. */
  language: string;
  photoId: string | null;
}

export interface CreatePost {
  id: string;
  brandId: string;
  briefId: string;
  channel: string;
  postCode: string;
  status: string;
  caption: string;
  cta: string;
  hashtags: string[];
  imageText: { headline: string; subline: string; bubble: string; pose: string };
  photoId: string | null;
  mascotId: string | null;
  flags: Flag[];
  themeId: string | null;
  layoutId: string | null;
  design: StoredDesign | null;
  carouselId: string | null;
  slideIndex: number | null;
  approvedAt: string | null;
  createdAt: string;
  editedAt: string | null;
  /** Which version of the brief the words were written for (see `briefFingerprint`); null for a row without one. */
  fingerprint: string | null;
}
