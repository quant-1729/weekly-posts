// What a research run costs, in one place (R-2). Prices are estimates for caps and approval checks; the run's
// recorded cost is the sum of the real token costs plus GROUNDED_REQUEST_USD per grounded request.

import { GROUNDED_REQUEST_USD } from "@/lib/ai/client";
import { MAX_QUERIES, RESEARCH_WEEKLY_CAP_USD } from "./types";

export { GROUNDED_REQUEST_USD, RESEARCH_WEEKLY_CAP_USD };

/** Tokens of one grounded call (reading the answer), on top of the grounding price. */
export const GROUNDED_TOKENS_USD = 0.004;
/** The planner call. */
export const PLAN_CALL_USD = 0.005;
/** The cards-and-ideas call. */
export const CARDS_CALL_USD = 0.02;
/** Summarising one competitor's website (home page + up to 2 pages). */
export const SITE_READ_USD = 0.01;

/** Cost of one grounded query, estimated. */
export const GROUNDED_QUERY_USD = GROUNDED_REQUEST_USD + GROUNDED_TOKENS_USD;

/** The most a run is estimated to cost: the planner, MAX_QUERIES grounded queries, `sites` website reads and the cards call. */
export function estimateRunUsd(o: { webQueries?: number; sites?: number } = {}): number {
  const web = Math.min(o.webQueries ?? MAX_QUERIES, MAX_QUERIES);
  return round(PLAN_CALL_USD + web * GROUNDED_QUERY_USD + (o.sites ?? 0) * SITE_READ_USD + CARDS_CALL_USD);
}

/** The least a run needs to be worth starting: the planner, one grounded query and the cards call. */
export const MIN_RUN_USD = round(PLAN_CALL_USD + GROUNDED_QUERY_USD + CARDS_CALL_USD);

export function round(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}
