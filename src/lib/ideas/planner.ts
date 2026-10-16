// The search planner (R-2): one model call turns the brand profile into a short list of searches. The model
// proposes, code decides: the list is cleaned, de-duplicated, capped (MAX_QUERIES), and regulated brands never
// search for treatments, cures, returns or legal outcomes, whatever the model said.

import { IDEAS_PLAN_SYSTEM, buildIdeasPlanUser, type IdeasBrandContext } from "@/lib/ai/prompts/ideas";
import { redactPaymentIds } from "@/lib/payments/redact";
import type { AiDeps } from "./deps";
import { oneLine } from "./findings";
import { planJsonSchema, planSchema, type PlanOutput } from "./schemas";
import { MAX_QUERIES, type PlannedQuery } from "./types";
import type { ResearchWindow } from "./window";

export const QUERY_MAX_WORDS = 12;
export const QUERY_MAX_CHARS = 120;
/** Per the planner prompt: "reddit" in at most 2 queries. Video queries are free but capped too. */
export const MAX_REDDIT_QUERIES = 2;
export const MAX_YOUTUBE_QUERIES = 2;

const REGULATED_FORBIDDEN =
  /\b(cure[sd]?|treatments?|remed(?:y|ies)|miracle|guarantee[ds]?|(?:investment|high|fast|quick) returns?|profits?|win(?:ning)? (?:a |your )?case|compensation claims?|weight\s*loss)\b/i;

export interface PlanCleanOptions {
  max: number;
  regulated: IdeasBrandContext["regulated"];
}

/** Cleans the planner's list. Pure, so tests can check every rule. */
export function cleanQueries(raw: PlanOutput["queries"], o: PlanCleanOptions): PlannedQuery[] {
  const strict = o.regulated === "health" || o.regulated === "finance" || o.regulated === "legal";
  const seen = new Set<string>();
  const out: PlannedQuery[] = [];
  let reddit = 0;
  let youtube = 0;
  for (const item of raw) {
    let q = item.q.replace(/\s+/g, " ").trim();
    if (!q) continue;
    const words = q.split(" ");
    if (words.length > QUERY_MAX_WORDS) q = words.slice(0, QUERY_MAX_WORDS).join(" ");
    if ([...q].length > QUERY_MAX_CHARS) continue;
    // A payment ID, a link or an email address is never a search.
    if (redactPaymentIds(q) !== q || /https?:\/\/|www\.|@/i.test(q)) continue;
    if (strict && REGULATED_FORBIDDEN.test(q)) continue;
    const key = q.toLowerCase();
    if (seen.has(key)) continue;
    if (/\breddit\b/i.test(q)) {
      if (reddit >= MAX_REDDIT_QUERIES) continue;
      reddit++;
    }
    if (item.source === "youtube") {
      if (youtube >= MAX_YOUTUBE_QUERIES) continue;
      youtube++;
    }
    seen.add(key);
    out.push({ q, source: item.source, why: oneLine(item.why, 80) });
    if (out.length >= o.max) break;
  }
  return out;
}

export interface PlanResult {
  queries: PlannedQuery[];
  usd: number;
}

export async function planQueries(
  brand: IdeasBrandContext,
  w: ResearchWindow,
  o: { maxQueries: number; brandId: string },
  ai: AiDeps,
): Promise<PlanResult> {
  const max = Math.max(1, Math.min(o.maxQueries, MAX_QUERIES));
  const { data, stats } = await ai.json({
    system: IDEAS_PLAN_SYSTEM,
    user: buildIdeasPlanUser(brand, { start: w.start, end: w.end, today: w.end, maxQueries: max }),
    zodSchema: planSchema,
    jsonSchema: planJsonSchema,
    temperature: 0.4,
    fixture: () => fixturePlan(brand, max),
    logContext: { brandId: o.brandId },
  });
  return { queries: cleanQueries(data.queries, { max, regulated: brand.regulated }), usd: stats?.usd ?? 0 };
}

/** Offline plan for AI_MODE=fixture without scripted dependencies. */
export function fixturePlan(brand: IdeasBrandContext, max: number): PlanOutput {
  const where = [brand.city, brand.country].filter(Boolean).join(" ") || "";
  const queries: PlanOutput["queries"] = [
    { q: `${brand.category || "small business"} trends ${where}`.trim(), source: "web", why: "what is trending" },
    { q: `upcoming festivals and events ${where}`.trim(), source: "web", why: "events in the next 30 days" },
  ];
  return { queries: queries.slice(0, max) };
}
