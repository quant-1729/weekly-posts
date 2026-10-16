// The weekly research job (R-7), called by Cloud Scheduler on Mondays 06:00 UTC through /api/cron/research.
//
// Takes the brands that have weekly research on and have finished setup, skips the ones that already have a weekly
// run (running, done or capped) in their local week, and runs the rest a few at a time inside a time budget. A brand
// left over is "deferred": the same call tomorrow-style retries (or the owner's "Research now") picks it up, and
// runResearch itself never runs a brand's weekly research twice in a week, so a repeated or late call is harmless.
// One brand failing never stops the others, and nothing here starts a post.

import { getDb } from "@/lib/db";
import { weekStartFor } from "@/lib/occasions/dates";
import type { ResearchDeps } from "./deps";
import { runResearch } from "./run";
import type { ResearchRun } from "./types";

/** Stop starting new brands after this long (the route's maxDuration is 300 s; a run takes about a minute). */
export const RESEARCH_SWEEP_BUDGET_MS = 200_000;
/** Most brands one call starts. */
export const RESEARCH_SWEEP_LIMIT = 12;
/** Runs at the same time. */
export const RESEARCH_SWEEP_CONCURRENCY = 3;

export interface ResearchSweepItem {
  brandId: string;
  outcome: "done" | "failed" | "capped" | "off" | "error";
  /** A cleaned reason for a failed or capped run (never owner text). */
  detail?: string;
  ms: number;
}

export interface ResearchSweepSummary {
  at: string;
  /** Brands with weekly research on and setup finished. */
  eligible: number;
  /** Eligible brands that already have a weekly run this week. */
  alreadyRan: number;
  started: number;
  done: number;
  failed: number;
  capped: number;
  /** Brands that needed a run but were not started (batch limit or time budget); a later call takes them. */
  deferred: number;
  items: ResearchSweepItem[];
}

export interface ResearchSweepOptions {
  now?: Date;
  budgetMs?: number;
  limit?: number;
  concurrency?: number;
  /** Tests pass their own dependencies (fixtures) so no model or network is touched. */
  deps?: Partial<ResearchDeps>;
  /** Tests may swap the run itself. */
  run?: typeof runResearch;
}

interface Candidate {
  brand_id: string;
  timezone: string;
}

export async function runResearchSweep(opts: ResearchSweepOptions = {}): Promise<ResearchSweepSummary> {
  const started = Date.now();
  const now = opts.now ?? new Date();
  const budget = opts.budgetMs ?? RESEARCH_SWEEP_BUDGET_MS;
  const limit = opts.limit ?? RESEARCH_SWEEP_LIMIT;
  const run = opts.run ?? runResearch;

  const candidates = await getDb().withService((tx) =>
    tx.query<Candidate>(
      `select m.brand_id::text as brand_id, m.timezone
         from public.brand_memory m
        where m.research_on and m.setup_completed_at is not null
        order by m.brand_id`,
    ),
  );

  // Brands with no weekly run yet in their own local week.
  const due: string[] = [];
  let alreadyRan = 0;
  for (const c of candidates) {
    let weekStart: string;
    try {
      weekStart = weekStartFor(now, c.timezone || "UTC");
    } catch {
      console.warn(`[research] brand ${c.brand_id} has an unknown time zone; skipped`);
      continue;
    }
    const [row] = await getDb().withService((tx) =>
      tx.query<{ n: number }>(
        `select count(*)::int as n from public.research_runs
          where brand_id = $1 and trigger = 'weekly' and status in ('running', 'done', 'capped')
            and started_at >= ($2::date)::timestamp at time zone $3::text`,
        [c.brand_id, weekStart, c.timezone || "UTC"],
      ),
    );
    if ((row?.n ?? 0) > 0) alreadyRan++;
    else due.push(c.brand_id);
  }

  const batch = due.slice(0, limit);
  let deferred = due.length - batch.length;
  const items: ResearchSweepItem[] = [];
  let next = 0;
  const worker = async () => {
    while (next < batch.length) {
      if (Date.now() - started >= budget) return;
      const brandId = batch[next++];
      const t = Date.now();
      try {
        const r: ResearchRun | null = await run({ brandId, service: true, trigger: "weekly", now }, opts.deps);
        items.push(
          r === null
            ? { brandId, outcome: "off", ms: Date.now() - t }
            : { brandId, outcome: r.status === "done" ? "done" : r.status === "capped" ? "capped" : "failed", detail: r.error ?? undefined, ms: Date.now() - t },
        );
      } catch (e) {
        items.push({ brandId, outcome: "error", detail: e instanceof Error ? e.name : "error", ms: Date.now() - t });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(opts.concurrency ?? RESEARCH_SWEEP_CONCURRENCY, batch.length || 1)) }, worker));
  deferred += batch.length - items.length;

  const count = (o: ResearchSweepItem["outcome"]) => items.filter((i) => i.outcome === o).length;
  const summary: ResearchSweepSummary = {
    at: now.toISOString(),
    eligible: candidates.length,
    alreadyRan,
    started: items.length,
    done: count("done"),
    failed: count("failed") + count("error"),
    capped: count("capped"),
    deferred,
    items,
  };
  console.info(`[research] sweep ${JSON.stringify({ ...summary, items: undefined })}`);
  return summary;
}
