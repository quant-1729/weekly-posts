// Output contracts for AI calls. Owned by the orchestrator (T-4).
// Each zod schema has a matching JSON schema sent to Gemini as
// `responseJsonSchema`; keep the two in step.

import { z } from 'zod';

export const CONTENT_LANGUAGES = ['hi', 'hinglish', 'en'] as const;
export type ContentLanguage = (typeof CONTENT_LANGUAGES)[number];

export const CHANNELS = ['ig_feed', 'status', 'facebook', 'gbp'] as const;
export type Channel = (typeof CHANNELS)[number];

export const FACT_KINDS = ['price', 'discount', 'offer', 'date', 'time', 'phone', 'quantity', 'claim'] as const;

// ---------------------------------------------------------------------------
// Generate: one input -> 4 channel outputs (R4, R5)
// ---------------------------------------------------------------------------

export const imageTextSchema = z.object({
  headline: z.string(),
  subline: z.string(),
  bubble: z.string(),
});

export const channelOutputSchema = z.object({
  caption: z.string(),
  cta: z.string(),
  hashtags: z.array(z.string()),
  image_text: imageTextSchema,
});
export type ChannelOutput = z.infer<typeof channelOutputSchema>;

export const factUsedSchema = z.object({
  text: z.string(),
  kind: z.enum(FACT_KINDS),
  source: z.enum(['input', 'brand_memory', 'week_goal']),
});

export const generateResultSchema = z.object({
  status: z.enum(['ok', 'needs_input']),
  // Set when status = needs_input: a short message to the owner in the brand
  // language asking them to resend or type (unclear voice note, unusable input).
  message_to_owner: z.string(),
  summary: z.string(), // one English line: what the post is about (for history and logs)
  outputs: z.object({
    ig_feed: channelOutputSchema,
    status: channelOutputSchema,
    facebook: channelOutputSchema,
    gbp: channelOutputSchema,
  }),
  facts_used: z.array(factUsedSchema),
});
export type GenerateResult = z.infer<typeof generateResultSchema>;

const imageTextJson = {
  type: 'object',
  properties: {
    headline: { type: 'string' },
    subline: { type: 'string' },
    bubble: { type: 'string' },
  },
  required: ['headline', 'subline', 'bubble'],
} as const;

const channelOutputJson = {
  type: 'object',
  properties: {
    caption: { type: 'string' },
    cta: { type: 'string' },
    hashtags: { type: 'array', items: { type: 'string' } },
    image_text: imageTextJson,
  },
  required: ['caption', 'cta', 'hashtags', 'image_text'],
} as const;

export const generateResultJsonSchema = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['ok', 'needs_input'] },
    message_to_owner: { type: 'string' },
    summary: { type: 'string' },
    outputs: {
      type: 'object',
      properties: {
        ig_feed: channelOutputJson,
        status: channelOutputJson,
        facebook: channelOutputJson,
        gbp: channelOutputJson,
      },
      required: ['ig_feed', 'status', 'facebook', 'gbp'],
    },
    facts_used: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          kind: { type: 'string', enum: [...FACT_KINDS] },
          source: { type: 'string', enum: ['input', 'brand_memory', 'week_goal'] },
        },
        required: ['text', 'kind', 'source'],
      },
    },
  },
  required: ['status', 'message_to_owner', 'summary', 'outputs', 'facts_used'],
} as const;

// ---------------------------------------------------------------------------
// Switch language: one channel output -> same output in another language (R5)
// ---------------------------------------------------------------------------

export const switchLanguageResultSchema = channelOutputSchema;
export type SwitchLanguageResult = ChannelOutput;
export const switchLanguageResultJsonSchema = channelOutputJson;

// ---------------------------------------------------------------------------
// Setup: owner answers / voice note -> brand memory fields (R2)
// ---------------------------------------------------------------------------

export const setupExtractSchema = z.object({
  business_name: z.string(),
  category: z.string(),
  city: z.string(),
  products: z.array(
    z.object({ name: z.string(), price: z.string(), unit: z.string(), note: z.string() }),
  ),
  audience: z.string(),
  notes: z.string(),
  unclear: z.array(z.string()),
});
export type SetupExtract = z.infer<typeof setupExtractSchema>;

export const setupExtractJsonSchema = {
  type: 'object',
  properties: {
    business_name: { type: 'string' },
    category: { type: 'string' },
    city: { type: 'string' },
    products: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          price: { type: 'string' },
          unit: { type: 'string' },
          note: { type: 'string' },
        },
        required: ['name', 'price', 'unit', 'note'],
      },
    },
    audience: { type: 'string' },
    notes: { type: 'string' },
    unclear: { type: 'array', items: { type: 'string' } },
  },
  required: ['business_name', 'category', 'city', 'products', 'audience', 'notes', 'unclear'],
} as const;

// ---------------------------------------------------------------------------
// Fact check: every checkable fact in the outputs, supported or not (R8)
// ---------------------------------------------------------------------------

export const FACT_FIELDS = ['caption', 'cta', 'image_text.headline', 'image_text.subline', 'image_text.bubble'] as const;
export type FactField = (typeof FACT_FIELDS)[number];

export const factCheckResultSchema = z.object({
  facts: z.array(
    z.object({
      channel: z.enum(CHANNELS),
      field: z.enum(FACT_FIELDS),
      text: z.string(),
      kind: z.enum(FACT_KINDS),
      supported: z.boolean(),
      source_quote: z.string(),
      regulated_claim: z.boolean(),
    }),
  ),
});
export type FactCheckResult = z.infer<typeof factCheckResultSchema>;

export const factCheckResultJsonSchema = {
  type: 'object',
  properties: {
    facts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          channel: { type: 'string', enum: [...CHANNELS] },
          field: { type: 'string', enum: [...FACT_FIELDS] },
          text: { type: 'string' },
          kind: { type: 'string', enum: [...FACT_KINDS] },
          supported: { type: 'boolean' },
          source_quote: { type: 'string' },
          regulated_claim: { type: 'boolean' },
        },
        required: ['channel', 'field', 'text', 'kind', 'supported', 'source_quote', 'regulated_claim'],
      },
    },
  },
  required: ['facts'],
} as const;

// ---------------------------------------------------------------------------
// Weekly plan (R3): 3-5 ideas, each on a day of the week
// ---------------------------------------------------------------------------

export const planResultSchema = z.object({
  ideas: z
    .array(
      z.object({
        title: z.string(),
        description: z.string(),
        photo_tip: z.string(),
        starter_text: z.string(),
        suggested_day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        occasion_key: z.string(),
      }),
    )
    .min(3)
    .max(5),
});
export type PlanResult = z.infer<typeof planResultSchema>;

export const planResultJsonSchema = {
  type: 'object',
  properties: {
    ideas: {
      type: 'array',
      minItems: 3,
      maxItems: 5,
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          description: { type: 'string' },
          photo_tip: { type: 'string' },
          starter_text: { type: 'string' },
          suggested_day: { type: 'string' },
          occasion_key: { type: 'string' },
        },
        required: ['title', 'description', 'photo_tip', 'starter_text', 'suggested_day', 'occasion_key'],
      },
    },
  },
  required: ['ideas'],
} as const;
