// Output schemas for the v3 prompts (orchestrator-owned): brief from the owner's words (C-08),
// post copy from a brief (C-16), style reading for "keep my look" (C-17).

import { z } from 'zod';
import { CTA_KINDS, POST_TYPES, BLOCK_KEYS } from '@/lib/briefs/types';
import { USP_KINDS } from '@/lib/usps/types';
import { FONT_CHOICES, THEME_IDS } from '@/lib/design/types';

// ---------------------------------------------------------------------------------------------
// Brief from text or voice (B-7)
// ---------------------------------------------------------------------------------------------

/** Every field a new USP can carry, flat (see USP_DETAILS in src/lib/usps/types.ts). All optional. */
const NEW_USP_TEXT_FIELDS = ['currency', 'on', 'validFrom', 'validTo', 'item', 'unit', 'claim', 'evidence', 'platform', 'promise', 'area', 'conditions', 'length', 'terms', 'credential', 'what'] as const;
const NEW_USP_NUMBER_FIELDS = ['percent', 'amountOff', 'price', 'rating', 'count', 'years'] as const;
const newUspFieldsSchema = z.object({
  ...Object.fromEntries(NEW_USP_TEXT_FIELDS.map((k) => [k, z.string().optional()])),
  // Numbers may also arrive as text ("4.50", "10%"); the brief code cleans them (src/lib/briefs/from-text.ts).
  ...Object.fromEntries(NEW_USP_NUMBER_FIELDS.map((k) => [k, z.union([z.number(), z.string()]).optional()])),
  upTo: z.boolean().optional(),
} as Record<string, z.ZodTypeAny>);
const newUspFieldsJsonSchema = {
  type: 'object',
  properties: {
    ...Object.fromEntries(NEW_USP_TEXT_FIELDS.map((k) => [k, { type: 'string' }])),
    ...Object.fromEntries(NEW_USP_NUMBER_FIELDS.map((k) => [k, { type: 'number' }])),
    upTo: { type: 'boolean' },
  },
};

export const briefFromTextSchema = z.object({
  post_type: z.enum(POST_TYPES),
  /** Ids from the USP list given in the prompt; "" when none fits. */
  primary_usp_id: z.string(),
  secondary_usp_ids: z.array(z.string()).max(2),
  /** A USP the owner stated in their words that is not in the list yet (0 or 1 item). Never invented. */
  new_usp: z
    .array(z.object({
      kind: z.enum(USP_KINDS),
      title: z.string().max(60),
      /** The owner's exact words this came from. */
      quote: z.string().max(200),
      /**
       * Per-kind fields, only those the owner stated (numbers exactly as said). Named explicitly: Gemini's
       * structured output can't fill an open-ended object. Keys match the USP form (src/lib/usps/form.ts).
       */
      fields: newUspFieldsSchema,
    }))
    .max(1),
  /** "" when the owner's words don't point to one. */
  cta: z.union([z.enum(CTA_KINDS), z.literal('')]),
  blocks: z.array(z.enum(BLOCK_KEYS)),
  /** YYYY-MM-DD, only when the owner stated a date or a clear relative day ("this Sunday"); else "". */
  starts_on: z.string(),
  ends_on: z.string(),
  /** BCP 47 language the owner wants the post in, or "" for the brand default. */
  language: z.string(),
  /** Short questions for anything the owner should still decide (max 3). */
  questions: z.array(z.string().max(120)).max(3),
});
export type BriefFromText = z.infer<typeof briefFromTextSchema>;

export const briefFromTextJsonSchema = {
  type: 'object',
  properties: {
    post_type: { type: 'string', enum: [...POST_TYPES] },
    primary_usp_id: { type: 'string' },
    secondary_usp_ids: { type: 'array', items: { type: 'string' }, maxItems: 2 },
    new_usp: {
      type: 'array',
      maxItems: 1,
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: [...USP_KINDS] },
          title: { type: 'string' },
          quote: { type: 'string' },
          fields: newUspFieldsJsonSchema,
        },
        required: ['kind', 'title', 'quote', 'fields'],
      },
    },
    cta: { type: 'string', enum: [...CTA_KINDS, ''] },
    blocks: { type: 'array', items: { type: 'string', enum: [...BLOCK_KEYS] } },
    starts_on: { type: 'string' },
    ends_on: { type: 'string' },
    language: { type: 'string' },
    questions: { type: 'array', items: { type: 'string' }, maxItems: 3 },
  },
  required: ['post_type', 'primary_usp_id', 'secondary_usp_ids', 'new_usp', 'cta', 'blocks', 'starts_on', 'ends_on', 'language', 'questions'],
} as const;

// ---------------------------------------------------------------------------------------------
// Post copy from a brief (C-16)
// ---------------------------------------------------------------------------------------------

export const POST_COPY_CHANNELS = ['instagram', 'facebook', 'whatsapp', 'youtube', 'linkedin', 'gbp'] as const;
export type PostCopyChannel = (typeof POST_COPY_CHANNELS)[number];

export const postCopySchema = z.object({
  /** Up to 7 words; grounded in the primary USP. */
  headline: z.string().max(80),
  /** Optional, up to 14 words. */
  subline: z.string().max(120),
  /** Up to 25 characters, matching the brief's CTA kind. */
  cta_text: z.string().max(40),
  /** One caption per requested channel. */
  captions: z.array(z.object({ channel: z.enum(POST_COPY_CHANNELS), text: z.string().max(2200) })),
  hashtags: z.array(z.string().max(40)).max(8),
  /** Mascot speech bubble (max 30 characters), only when a mascot is given; else "". */
  bubble: z.string().max(60),
  /** Mascot pose from the given list, only when a mascot is given; else "". */
  pose: z.string(),
  /** Carousel only (CAROUSEL given): one entry per slide, in order; [] otherwise. */
  slides: z
    .array(z.object({ kind: z.enum(['cover', 'point', 'proof', 'cta']), headline: z.string().max(80), body: z.string().max(200) }))
    .max(10)
    .default([]),
});
export type PostCopy = z.input<typeof postCopySchema>;

export const postCopyJsonSchema = {
  type: 'object',
  properties: {
    headline: { type: 'string' },
    subline: { type: 'string' },
    cta_text: { type: 'string' },
    captions: {
      type: 'array',
      items: {
        type: 'object',
        properties: { channel: { type: 'string', enum: [...POST_COPY_CHANNELS] }, text: { type: 'string' } },
        required: ['channel', 'text'],
      },
    },
    hashtags: { type: 'array', items: { type: 'string' }, maxItems: 8 },
    bubble: { type: 'string' },
    pose: { type: 'string' },
    slides: {
      type: 'array',
      maxItems: 10,
      items: {
        type: 'object',
        properties: { kind: { type: 'string', enum: ['cover', 'point', 'proof', 'cta'] }, headline: { type: 'string' }, body: { type: 'string' } },
        required: ['kind', 'headline', 'body'],
      },
    },
  },
  required: ['headline', 'subline', 'cta_text', 'captions', 'hashtags', 'bubble', 'pose', 'slides'],
} as const;

// ---------------------------------------------------------------------------------------------
// Style reading for "keep my look" (G-2)
// ---------------------------------------------------------------------------------------------

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const styleReadSchema = z.object({
  /** Up to 5 colours that the brand's own graphics use most (not colours of products or people in photos). */
  colors: z.array(z.object({ hex: hexColor, share: z.number().min(0).max(1) })).max(5),
  mode: z.enum(['light', 'dark']),
  energy: z.enum(['calm', 'bold']),
  corners: z.enum(['rounded', 'sharp']),
  /** How much text the posts usually carry. */
  text_density: z.enum(['low', 'medium', 'high']),
  /** Where text usually sits. */
  text_position: z.enum(['top', 'middle', 'bottom', 'mixed']),
  /** Share of images that are photos rather than graphics/typography. */
  photo_share: z.number().min(0).max(1),
  headline_font: z.enum(FONT_CHOICES),
  body_font: z.enum(FONT_CHOICES),
  theme: z.enum(THEME_IDS),
  /** 0-1: how consistent the samples are; low means "no clear look yet". */
  confidence: z.number().min(0).max(1),
  /** One plain sentence describing the look, for the owner (no people, no product judgements). */
  summary: z.string().max(200),
});
export type StyleRead = z.infer<typeof styleReadSchema>;

export const styleReadJsonSchema = {
  type: 'object',
  properties: {
    colors: {
      type: 'array',
      maxItems: 5,
      items: { type: 'object', properties: { hex: { type: 'string' }, share: { type: 'number' } }, required: ['hex', 'share'] },
    },
    mode: { type: 'string', enum: ['light', 'dark'] },
    energy: { type: 'string', enum: ['calm', 'bold'] },
    corners: { type: 'string', enum: ['rounded', 'sharp'] },
    text_density: { type: 'string', enum: ['low', 'medium', 'high'] },
    text_position: { type: 'string', enum: ['top', 'middle', 'bottom', 'mixed'] },
    photo_share: { type: 'number' },
    headline_font: { type: 'string', enum: [...FONT_CHOICES] },
    body_font: { type: 'string', enum: [...FONT_CHOICES] },
    theme: { type: 'string', enum: [...THEME_IDS] },
    confidence: { type: 'number' },
    summary: { type: 'string' },
  },
  required: ['colors', 'mode', 'energy', 'corners', 'text_density', 'text_position', 'photo_share', 'headline_font', 'body_font', 'theme', 'confidence', 'summary'],
} as const;
