// Design engine contract (PRD v3 §5.3, changes C-13 to C-20). Orchestrator-owned: builders import
// these and implement against them; they don't redefine them. Mirrors 0016_v3_design.sql.

import { z } from 'zod';
import { POST_TYPES, type BlockKey, type CtaKind } from '@/lib/briefs/types';
import type { UspKind } from '@/lib/usps/types';
import type { CharacterId, CharacterRole } from '@/lib/characters/types';
import type { FacePlacement, FacePose } from '@/lib/faces/types';
import type { PostFilter } from './filter-presets';

// ---------------------------------------------------------------------------------------------
// Formats (G-5). Names are the `public.image_format` enum values.
// ---------------------------------------------------------------------------------------------

export const DESIGN_FORMATS = ['square', 'portrait', 'vertical', 'landscape', 'thumbnail', 'banner'] as const;
export type DesignFormat = (typeof DESIGN_FORMATS)[number];

export const FORMAT_SIZE: Record<DesignFormat, { width: number; height: number }> = {
  square: { width: 1080, height: 1080 }, // Instagram/Facebook feed, YouTube community
  portrait: { width: 1080, height: 1350 }, // Instagram feed 4:5
  vertical: { width: 1080, height: 1920 }, // Stories, Reels cover, WhatsApp/Messenger status
  landscape: { width: 1200, height: 630 }, // link preview, LinkedIn, Google Business Profile
  thumbnail: { width: 1280, height: 720 }, // YouTube thumbnail
  banner: { width: 1920, height: 600 }, // website banner
};

/** USP capacity per format (B-2); more than this → warning + carousel offer. */
export const FORMAT_USP_CAPACITY: Record<DesignFormat, { secondary: number }> = {
  square: { secondary: 2 },
  portrait: { secondary: 2 },
  vertical: { secondary: 2 },
  landscape: { secondary: 1 },
  thumbnail: { secondary: 1 },
  banner: { secondary: 1 },
};

// ---------------------------------------------------------------------------------------------
// Themes and fonts (G-1, G-3)
// ---------------------------------------------------------------------------------------------

/** "classic" wraps the v2 templates unchanged (risk mitigation in 9-changes-v3.md §14). */
export const THEME_IDS = ['classic', 'clean', 'bold_sale', 'premium', 'playful', 'festive', 'local', 'minimal_dark', 'fresh'] as const;
export type ThemeId = (typeof THEME_IDS)[number];

/**
 * Font roles the owner picks from. Each maps to shipped open-licence (OFL) font files, with the
 * matching Noto family as the fallback for non-Latin scripts (Devanagari, Arabic, ...).
 */
export const FONT_CHOICES = ['sans', 'serif', 'rounded', 'condensed', 'display'] as const;
export type FontChoice = (typeof FONT_CHOICES)[number];

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a #RRGGBB colour');

/** The brand kit (C-13). `brand_memory.kit` stores everything except colours and logo, which keep their own columns. */
export const brandKitSchema = z.object({
  colors: z.object({ primary: hex, secondary: hex, accent: hex, background: hex }),
  fonts: z.object({ headline: z.enum(FONT_CHOICES), body: z.enum(FONT_CHOICES) }),
  style: z.object({
    corners: z.enum(['rounded', 'sharp']),
    mode: z.enum(['light', 'dark']),
    energy: z.enum(['calm', 'bold']),
  }),
  themeId: z.enum(THEME_IDS),
  /** Use the business name as a text logo when there is no logo image (C-19). */
  textLogo: z.boolean(),
  mascot: z.boolean(),
  /** Where the kit came from (G-2): kept for "keep my look" vs "fresh look". */
  source: z.enum(['default', 'owner', 'website', 'instagram', 'youtube', 'mixed']),
});
export type BrandKit = z.infer<typeof brandKitSchema>;

/** The design an owner chose last time for a post type (G-7), offered first next time. */
export const typeDefaultSchema = z.object({
  themeId: z.enum(THEME_IDS),
  layoutId: z.string().min(1).max(60),
  scheme: z.enum(['primary', 'light', 'dark', 'accent']),
});
export type TypeDefault = z.infer<typeof typeDefaultSchema>;

/** What `brand_memory.kit` holds (colours and logo live in their own columns). */
export const storedKitSchema = brandKitSchema
  .omit({ colors: true })
  .partial()
  .extend({ typeDefaults: z.partialRecord(z.enum(POST_TYPES), typeDefaultSchema).optional() });
export type StoredKit = z.infer<typeof storedKitSchema>;

// ---------------------------------------------------------------------------------------------
// Engine input: everything a post shows comes from the brief, the profile or the AI copy that
// the guardrail checked. The engine never invents text.
// ---------------------------------------------------------------------------------------------

/** One contact/info line on the post, already formatted by code (e.g. "+91 98200 12345", "Mon-Sat 10:00-20:00"). */
export interface DesignBlock {
  kind: BlockKey;
  text: string;
}

export interface DesignContent {
  /** Main line (G-4 hierarchy: largest). AI copy grounded in the primary USP, or the USP title. */
  headline: string;
  /** Optional supporting line. */
  subline: string;
  /** The primary USP as a short display line (e.g. "20% off all alterations"), when it isn't the headline. */
  primary: { kind: UspKind; text: string } | null;
  /** 0-2 secondary USP lines (fewer than FORMAT_USP_CAPACITY may be shown; the rest are reported as dropped). */
  secondary: { kind: UspKind; text: string }[];
  /** Offer/date line built by code from USP details + brief dates (e.g. "Till Sun 20 Oct"). */
  offerLine: string | null;
  cta: { kind: CtaKind; text: string } | null;
  blocks: DesignBlock[];
  /** QR content from @/lib/qr `qrContentFor` (text to encode + label; payment address/payee for the printed line). */
  qr: { text: string; label: string; payment?: { address: string; payeeName: string } } | null;
  /** Mascot bubble line, if the mascot is on. */
  bubble: string;
}

/** What a carousel slide is for (owner request 2026-10-16): decides the character's role on it. */
export const SLIDE_KINDS = ['cover', 'point', 'proof', 'cta'] as const;
export type SlideKind = (typeof SLIDE_KINDS)[number];

/** The format a channel's carousel slides are drawn in: portrait 4:5 for Instagram and Facebook, square for every other channel. */
export function carouselFormat(channel: string): DesignFormat {
  return channel === 'instagram' || channel === 'facebook' ? 'portrait' : 'square';
}

/** The words of one carousel slide (validated copy); `body` may be empty. */
export interface SlideText {
  kind: SlideKind;
  headline: string;
  body: string;
}

export interface DesignInput {
  format: DesignFormat;
  themeId: ThemeId;
  /** A layout variant of the theme for this format; default: the theme's first that fits the content. */
  layoutId?: string;
  kit: BrandKit;
  brandName: string;
  logo?: Buffer | null; // PNG
  photo?: Buffer | null; // owner photo (never AI)
  /** Imagen abstract background (C-18) when the theme uses one and no photo is placed there. */
  background?: Buffer | null;
  mascot?: import('@/lib/render').MascotInput | null;
  /**
   * CH-2: the brand's character as a part of the layout. With `role` set (and a source) the character is placed by the role
   * (a reserved zone, no header sticker, no separate speech bubble); without it, `mascot` is the old small header sticker.
   */
  character?: CharacterSource | null;
  role?: CharacterRole | null;
  /** The copy's pose: only a hint (the role decides the action). */
  poseHint?: string;
  /** A number from the brand id: two brands with the same inputs differ in side and action. */
  seed?: number;
  language: string; // BCP 47, for shaping and fonts
  dir?: 'ltr' | 'rtl' | 'auto';
  content: DesignContent;
  /**
   * Carousel slide: its place ("2/5" marker). With a `kind` (a carousel the owner asked for, owner request 2026-10-16) the slide
   * takes part in the brand's character like a post does, with a role by kind; without one (C-20's one-USP-per-slide split) it is
   * typographic.
   */
  slide?: { index: number; total: number; kind?: SlideKind } | null;
  /** The side the character stands on, fixed for a whole slide set (the first slide's choice); absent: the brand's habit. */
  charSide?: 'left' | 'right';
  /** Overrides the role's scale band (a carousel's cover uses the Lead band). */
  charBand?: 'lead' | 'support' | 'accent';
  /** Colour scheme within the kit (G-6 options). Stored with the post (`posts.design`) so a re-render matches. */
  scheme?: DesignOption['scheme'];
  /**
   * Colour filter for the post (UX-2), applied by code to the photo and the Imagen background only: never to text, logo, QR,
   * brand-colour shapes or the face. Absent, null or preset "none" leaves every pixel as it was.
   */
  filter?: PostFilter | null;
}

/**
 * What each format may carry (owner decision via orchestrator, 2026-10-14). Thumbnails are seen small and
 * never scanned, so they carry no QR and no contact lines; banners sit on the owner's own website, so no QR.
 */
export const FORMAT_RULES: Record<DesignFormat, { qr: boolean; maxContacts: number }> = {
  square: { qr: true, maxContacts: 3 },
  portrait: { qr: true, maxContacts: 3 },
  vertical: { qr: true, maxContacts: 3 },
  landscape: { qr: true, maxContacts: 2 },
  thumbnail: { qr: false, maxContacts: 0 },
  banner: { qr: false, maxContacts: 1 },
};

export interface DesignReport {
  /** Text that had to shrink below the theme's minimum or be cut: must be empty for an approved post. */
  overflow: string[];
  /** Content the layout had no room for (e.g. a third contact line): shown to the owner. */
  dropped: string[];
  /** Text/background pairs under 4.5:1 (3:1 for large text) after the engine's own fixes. */
  contrast: { element: string; ratio: number }[];
  /** Elements inside a format's unsafe zone (story UI, thumbnail timestamp corner). */
  safeZone: string[];
  /** Result of decoding the rendered QR (must equal content.qr.text; a payment QR mismatch blocks the post). */
  qr: { ok: boolean; decoded: string | null } | null;
}

export interface DesignResult {
  png: Buffer;
  svg: string;
  width: number;
  height: number;
  themeId: ThemeId;
  layoutId: string;
  report: DesignReport;
}

/** Where a layout's character comes from: the shared code rig (mascot faces) or approved pose images (the other face kinds). */
export type CharacterSource =
  | { kind: 'rig'; id: CharacterId }
  | { kind: 'image'; images: Partial<Record<FacePose, { uri: string; w: number; h: number }>>; aiTag: boolean; size?: FacePlacement['size'] };

/** A design option shown to the owner (G-6): same details, different layout/colour scheme. */
export interface DesignOption {
  themeId: ThemeId;
  layoutId: string;
  /** CH-2: how the brand's character takes part in this composition. Absent: the old header sticker (if the face is on); null: a typographic option with no character. */
  role?: CharacterRole | null;
  /** Colour scheme variant within the kit (e.g. primary background vs light background). */
  scheme: 'primary' | 'light' | 'dark' | 'accent';
}

/** Defaults for a brand with nothing set yet. */
export const DEFAULT_KIT: Omit<BrandKit, 'colors'> = {
  fonts: { headline: 'sans', body: 'sans' },
  style: { corners: 'rounded', mode: 'light', energy: 'calm' },
  themeId: 'clean',
  textLogo: true,
  mascot: false,
  source: 'default',
};
