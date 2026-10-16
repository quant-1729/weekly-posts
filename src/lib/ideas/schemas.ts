// Output schemas for the Ideas model calls (zod to validate, JSON schema for Gemini's structured output).
// The prompts are in src/lib/ai/prompts/ideas.ts (orchestrator-owned). Everything the model returns is checked
// again in code (planner.ts, search.ts, cards.ts): the schema only guarantees the shape.

import { z } from "zod";
import { MAX_QUERIES } from "./types";

// ---------------------------------------------------------------------------------------------
// Planner
// ---------------------------------------------------------------------------------------------

export const planSchema = z.object({
  queries: z
    .array(z.object({ q: z.string(), source: z.enum(["web", "youtube"]), why: z.string() }))
    .max(MAX_QUERIES * 3),
});
export type PlanOutput = z.infer<typeof planSchema>;

export const planJsonSchema = {
  type: "object",
  properties: {
    queries: {
      type: "array",
      items: {
        type: "object",
        properties: { q: { type: "string" }, source: { type: "string", enum: ["web", "youtube"] }, why: { type: "string" } },
        required: ["q", "source", "why"],
      },
    },
  },
  required: ["queries"],
};

// ---------------------------------------------------------------------------------------------
// Grounded search answer (parsed from text: the call has no JSON mime type)
// ---------------------------------------------------------------------------------------------

export const searchAnswerSchema = z.object({
  findings: z
    .array(
      z.object({
        topic: z.string(),
        note: z.string(),
        source_indexes: z.array(z.number().int().min(0)).default([]),
      }),
    )
    .max(12),
  /** The date each source shows (YYYY-MM-DD), by grounding source index; "" when none is visible. */
  source_dates: z.array(z.object({ index: z.number().int().min(0), date: z.string() })).default([]),
});
export type SearchAnswer = z.infer<typeof searchAnswerSchema>;

// ---------------------------------------------------------------------------------------------
// Competitor website summary
// ---------------------------------------------------------------------------------------------

export const siteSummarySchema = z.object({
  findings: z.array(z.object({ topic: z.string(), note: z.string() })).max(6),
  /** A date the page itself shows (YYYY-MM-DD), or "". */
  page_date: z.string(),
});
export type SiteSummary = z.infer<typeof siteSummarySchema>;

export const siteSummaryJsonSchema = {
  type: "object",
  properties: {
    findings: { type: "array", items: { type: "object", properties: { topic: { type: "string" }, note: { type: "string" } }, required: ["topic", "note"] } },
    page_date: { type: "string" },
  },
  required: ["findings", "page_date"],
};

// ---------------------------------------------------------------------------------------------
// Cards and ideas. The envelope is loose on purpose: each card is checked on its own (cards.ts) so one
// bad card does not throw away the others.
// ---------------------------------------------------------------------------------------------

export const cardsEnvelopeSchema = z.object({ cards: z.array(z.unknown()).max(20) });
export type CardsEnvelope = z.infer<typeof cardsEnvelopeSchema>;

export const rawCardSchema = z.object({
  finding_ids: z.array(z.string()),
  title: z.string(),
  summary: z.string(),
  why_it_matters: z.string(),
  kind: z.string().optional(),
  confidence: z.string().optional(),
  ideas: z.array(
    z.object({
      post_type: z.string(),
      angle: z.string(),
      format: z.string().optional(),
      description: z.string(),
    }),
  ),
});
export type RawCard = z.infer<typeof rawCardSchema>;

export const cardsJsonSchema = {
  type: "object",
  properties: {
    cards: {
      type: "array",
      items: {
        type: "object",
        properties: {
          finding_ids: { type: "array", items: { type: "string" } },
          title: { type: "string" },
          summary: { type: "string" },
          why_it_matters: { type: "string" },
          kind: { type: "string", enum: ["trend", "competitor", "seasonal"] },
          confidence: { type: "string", enum: ["low", "medium", "high"] },
          ideas: {
            type: "array",
            items: {
              type: "object",
              properties: {
                post_type: { type: "string" },
                angle: { type: "string" },
                format: { type: "string", enum: ["single", "carousel", "story", "reel"] },
                description: { type: "string" },
              },
              required: ["post_type", "angle", "format", "description"],
            },
          },
        },
        required: ["finding_ids", "title", "summary", "why_it_matters", "kind", "confidence", "ideas"],
      },
    },
  },
  required: ["cards"],
};
