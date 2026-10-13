// AI layer of the v2 guardrail: one call checks every post of a weekly batch
// (docs/guardrail.md, v2 addendum). The prompt and schema belong to the orchestrator.

import { generateJson } from '@/lib/ai/client';
import { buildV2FactCheckPrompt, type V2CheckPost } from '@/lib/ai/prompts/v2-fact-check';
import type { WeeklyFact } from '@/lib/ai/prompts/v2-weekly';
import { v2FactCheckJsonSchema, v2FactCheckSchema, type V2FactCheck } from '@/lib/ai/schemas-v2';
import { failedCallUsd, recordUsage } from '@/lib/usage';
import { assertUnderWeeklyCap } from '@/lib/usage/caps';

/** Default time limits of the AI check: per attempt, and in all with retries. */
export const AI_CHECK_TIMEOUT_MS = 25_000;
export const AI_CHECK_BUDGET_MS = 40_000;

export type AiStatement = V2FactCheck['facts'][number];

export interface AiCheckResult {
  statements: AiStatement[];
  usd: number;
}

/**
 * Lists every checkable statement in `posts` with whether the facts support it.
 * Throws on a failed or invalid call: the caller adds the "facts not checked" flag.
 * Pass `usage` to record the call as a `fact_check` usage event with its cost; it is then also
 * counted against the weekly fact-check limit (count only: the batch or rewrite that runs this
 * check was already allowed, so the check is never blocked by money).
 */
export async function checkPostsAi(args: {
  facts: WeeklyFact[];
  confirmed: string[];
  posts: V2CheckPost[];
  usage?: { brandId: string; userId: string | null };
  /** Time limit for one attempt, in ms. Default 25 000. */
  aiTimeoutMs?: number;
  /** Time limit for the whole call with retries, in ms. Default 40 000. */
  aiBudgetMs?: number;
  /** Called with the cost of the AI call (USD) once it has answered. */
  onUsd?: (usd: number) => void;
  /** The day used for the weekly count limit (default: now). */
  now?: Date;
  /** Fixture mode only (tests and offline dev): the response to return instead of calling the model. */
  fixture?: V2FactCheck | (() => V2FactCheck);
}): Promise<AiCheckResult> {
  if (args.usage) await assertUnderWeeklyCap(args.usage.brandId, 'fact_check', { now: args.now });
  const prompt = buildV2FactCheckPrompt({ facts: args.facts, confirmed: args.confirmed, posts: args.posts });
  let result;
  try {
    result = await generateJson({
      system: prompt.system,
      user: prompt.user,
      zodSchema: v2FactCheckSchema,
      jsonSchema: v2FactCheckJsonSchema,
      temperature: 0,
      timeoutMs: args.aiTimeoutMs ?? AI_CHECK_TIMEOUT_MS,
      budgetMs: args.aiBudgetMs ?? AI_CHECK_BUDGET_MS,
      fixture: args.fixture,
      logContext: args.usage ? { brandId: args.usage.brandId } : undefined,
    });
  } catch (e) {
    // An answer that did not validate still cost money (h-2).
    const lost = failedCallUsd(e);
    if (lost > 0) {
      args.onUsd?.(lost);
      if (args.usage) await recordUsage(args.usage.brandId, args.usage.userId, 'fact_check', lost);
    }
    throw e;
  }
  const { data, stats } = result;
  const usd = stats?.usd ?? 0;
  args.onUsd?.(usd);
  if (args.usage) await recordUsage(args.usage.brandId, args.usage.userId, 'fact_check', usd);
  return { statements: data.facts, usd };
}
