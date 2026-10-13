// v2 output contracts (docs/6-prd-v2.md). Owned by the orchestrator.
// Each zod schema has a matching JSON schema sent to Gemini; keep them in step.

import { z } from 'zod';

export const V2_FACT_KINDS = ['product', 'price', 'offer', 'hours', 'address', 'phone', 'email', 'differentiator', 'claim'] as const;
export type V2FactKind = (typeof V2_FACT_KINDS)[number];

// ---------------------------------------------------------------------------
// Website facts (Req 3)
// ---------------------------------------------------------------------------

export const websiteFactsSchema = z.object({
  business_summary: z.string(),
  facts: z.array(
    z.object({
      kind: z.enum(V2_FACT_KINDS),
      label: z.string(),
      value: z.string().min(1),
      quote: z.string(),
      page_url: z.string(),
      outcome_promise: z.boolean(),
    }),
  ),
});
export type WebsiteFacts = z.infer<typeof websiteFactsSchema>;

export const websiteFactsJsonSchema = {
  type: 'object',
  properties: {
    business_summary: { type: 'string' },
    facts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: [...V2_FACT_KINDS] },
          label: { type: 'string' },
          value: { type: 'string' },
          quote: { type: 'string' },
          page_url: { type: 'string' },
          outcome_promise: { type: 'boolean' },
        },
        required: ['kind', 'label', 'value', 'quote', 'page_url', 'outcome_promise'],
      },
    },
  },
  required: ['business_summary', 'facts'],
} as const;

// ---------------------------------------------------------------------------
// Voice (Req 2, 5)
// ---------------------------------------------------------------------------

export const voiceSchema = z.object({
  voice_description: z.string(),
  example_phrases: z.array(z.string()),
  avoid_suggestions: z.array(z.string()),
  emoji_use: z.enum(['none', 'light', 'heavy']),
  typical_length: z.enum(['short', 'medium', 'long']),
});
export type Voice = z.infer<typeof voiceSchema>;

export const voiceJsonSchema = {
  type: 'object',
  properties: {
    voice_description: { type: 'string' },
    example_phrases: { type: 'array', items: { type: 'string' } },
    avoid_suggestions: { type: 'array', items: { type: 'string' } },
    emoji_use: { type: 'string', enum: ['none', 'light', 'heavy'] },
    typical_length: { type: 'string', enum: ['short', 'medium', 'long'] },
  },
  required: ['voice_description', 'example_phrases', 'avoid_suggestions', 'emoji_use', 'typical_length'],
} as const;

// ---------------------------------------------------------------------------
// Screenshot text (Req 4)
// ---------------------------------------------------------------------------

export const screenshotSchema = z.object({ is_post: z.boolean(), text: z.string() });
export type Screenshot = z.infer<typeof screenshotSchema>;

export const screenshotJsonSchema = {
  type: 'object',
  properties: { is_post: { type: 'boolean' }, text: { type: 'string' } },
  required: ['is_post', 'text'],
} as const;

// ---------------------------------------------------------------------------
// Weekly batch (Req 7, 8) and rewrite (Req 15)
// ---------------------------------------------------------------------------

const V2_CHANNELS = ['instagram', 'facebook', 'linkedin', 'gbp'] as const;

// bubble/pose are only filled when the brand's mascot is on (V-25); optional so older fixtures still parse.
const imageTextV2 = z.object({ headline: z.string(), subline: z.string(), bubble: z.string().optional(), pose: z.string().optional() });

export const weeklyPostSchema = z.object({
  suggested_day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  channel: z.enum(V2_CHANNELS),
  caption: z.string().min(1),
  hashtags: z.array(z.string()),
  cta: z.string(),
  link: z.boolean(),
  image_text: imageTextV2,
  photo_id: z.string(),
  occasion_key: z.string(),
  fact_ids: z.array(z.string()),
  topic: z.string(),
});
export type WeeklyPost = z.infer<typeof weeklyPostSchema>;

export const weeklyBatchSchema = z.object({ posts: z.array(weeklyPostSchema).min(3).max(5) });
export type WeeklyBatch = z.infer<typeof weeklyBatchSchema>;

const imageTextV2Json = {
  type: 'object',
  properties: { headline: { type: 'string' }, subline: { type: 'string' }, bubble: { type: 'string' }, pose: { type: 'string' } },
  required: ['headline', 'subline'],
} as const;

export const weeklyBatchJsonSchema = {
  type: 'object',
  properties: {
    posts: {
      type: 'array',
      minItems: 3,
      maxItems: 5,
      items: {
        type: 'object',
        properties: {
          suggested_day: { type: 'string' },
          channel: { type: 'string', enum: [...V2_CHANNELS] },
          caption: { type: 'string' },
          hashtags: { type: 'array', items: { type: 'string' } },
          cta: { type: 'string' },
          link: { type: 'boolean' },
          image_text: imageTextV2Json,
          photo_id: { type: 'string' },
          occasion_key: { type: 'string' },
          fact_ids: { type: 'array', items: { type: 'string' } },
          topic: { type: 'string' },
        },
        required: ['suggested_day', 'channel', 'caption', 'hashtags', 'cta', 'link', 'image_text', 'photo_id', 'occasion_key', 'fact_ids', 'topic'],
      },
    },
  },
  required: ['posts'],
} as const;

export const rewriteSchema = z.object({
  caption: z.string().min(1),
  hashtags: z.array(z.string()),
  cta: z.string(),
  image_text: imageTextV2,
  note: z.string(),
});
export type Rewrite = z.infer<typeof rewriteSchema>;

export const rewriteJsonSchema = {
  type: 'object',
  properties: {
    caption: { type: 'string' },
    hashtags: { type: 'array', items: { type: 'string' } },
    cta: { type: 'string' },
    image_text: imageTextV2Json,
    note: { type: 'string' },
  },
  required: ['caption', 'hashtags', 'cta', 'image_text', 'note'],
} as const;

export const photoDescribeSchema = z.object({ description: z.string(), has_people: z.boolean(), usable: z.boolean() });
export const photoDescribeJsonSchema = {
  type: 'object',
  properties: { description: { type: 'string' }, has_people: { type: 'boolean' }, usable: { type: 'boolean' } },
  required: ['description', 'has_people', 'usable'],
} as const;

// ---------------------------------------------------------------------------
// v2 fact check (Req 11, 12)
// ---------------------------------------------------------------------------

export const V2_CHECK_KINDS = ['price', 'offer', 'hours', 'date', 'phone', 'quantity', 'claim'] as const;
export const V2_CHECK_FIELDS = ['caption', 'cta', 'image_text.headline', 'image_text.subline', 'image_text.bubble'] as const;

export const v2FactCheckSchema = z.object({
  facts: z.array(
    z.object({
      post: z.number().int(),
      field: z.enum(V2_CHECK_FIELDS),
      text: z.string(),
      kind: z.enum(V2_CHECK_KINDS),
      supported: z.boolean(),
      fact_id: z.string(),
      outcome_promise: z.boolean(),
    }),
  ),
});
export type V2FactCheck = z.infer<typeof v2FactCheckSchema>;

export const v2FactCheckJsonSchema = {
  type: 'object',
  properties: {
    facts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          post: { type: 'integer' },
          field: { type: 'string', enum: [...V2_CHECK_FIELDS] },
          text: { type: 'string' },
          kind: { type: 'string', enum: [...V2_CHECK_KINDS] },
          supported: { type: 'boolean' },
          fact_id: { type: 'string' },
          outcome_promise: { type: 'boolean' },
        },
        required: ['post', 'field', 'text', 'kind', 'supported', 'fact_id', 'outcome_promise'],
      },
    },
  },
  required: ['facts'],
} as const;

// ---------------------------------------------------------------------------
// Review reply (Req 26, stretch)
// ---------------------------------------------------------------------------

export const reviewReplySchema = z.object({
  reply: z.string().min(1),
  sentiment: z.enum(['positive', 'mixed', 'negative']),
  needs_attention: z.boolean(),
  attention_reason: z.string(),
});
export type ReviewReply = z.infer<typeof reviewReplySchema>;

export const reviewReplyJsonSchema = {
  type: 'object',
  properties: {
    reply: { type: 'string' },
    sentiment: { type: 'string', enum: ['positive', 'mixed', 'negative'] },
    needs_attention: { type: 'boolean' },
    attention_reason: { type: 'string' },
  },
  required: ['reply', 'sentiment', 'needs_attention', 'attention_reason'],
} as const;
