// One research run (R-2 to R-5): plan, gather, merge and score, make cards and ideas, save.
//
//   1. budget check (nothing is called when the weekly research cap, the daily or weekly AI caps, or the manual
//      limit stop the run: status 'capped');
//   2. the planner proposes searches; code cleans them and trims them to what the budget allows;
//   3. gathering, in parallel with time limits: grounded web searches, competitor sites, competitor Instagram
//      (Business Discovery, only when switched on) and YouTube (only with a key). A source that fails is
//      counted and skipped, the run goes on;
//   4. findings are merged, scored (in code) and ranked; the cards call turns the best into trend cards;
//      code reviews every card and idea (cards.ts);
//   5. cards and ideas are saved; the run's cost is recorded as ONE usage event of kind 'research'.
//
// Everything outside (models, websites, Meta, YouTube, tokens) comes in through `deps`, so tests use fixtures.

import { AiError } from "@/lib/ai/client";
import { BrandAccessError, requireBrandMember } from "@/lib/brand/current";
import { failedCallUsd, recordUsage } from "@/lib/usage";
import { checkBudget, weeklyRunThisWeek } from "./budget";
import { makeCards } from "./cards";
import { discoverCompetitorInstagram } from "./competitor-instagram";
import { readCompetitorSite } from "./competitor-site";
import { loadRunContext } from "./context";
import { CARDS_CALL_USD, GROUNDED_QUERY_USD, PLAN_CALL_USD, SITE_READ_USD } from "./cost";
import { withDeps, type ResearchDeps } from "./deps";
import type { GatheredFinding } from "./findings";
import { brandKeywords, rankFindings } from "./merge";
import { planQueries } from "./planner";
import { kindForQuery, runGroundedQuery } from "./search";
import { createRun, finishRun, latestRun, saveCards } from "./store";
import { MAX_QUERIES, type PlannedQuery, type ResearchRun, type RunTrigger } from "./types";
import { researchWindow } from "./window";
import { regionCode, searchYoutube, youtubeKey } from "./youtube";

export interface RunArgs {
  brandId: string;
  /** The signed-in owner who pressed "Research now" (membership is checked). Omit for the scheduled run and pass `service: true`. */
  userId?: string;
  /** The scheduled run (Cloud Scheduler): the server has already authenticated the caller. */
  service?: boolean;
  trigger: RunTrigger;
  now?: Date;
}

/** Most time a run spends gathering, in ms (each call has its own, shorter limit too). */
export const GATHER_DEADLINE_MS = 120_000;
const WEB_CONCURRENCY = 3;

/** Runs `tasks` with at most `limit` at a time. Each task handles its own errors. */
async function pool(tasks: (() => Promise<void>)[], limit: number): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) {
      const i = next++;
      await tasks[i]();
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
}

/** Money spent and money set aside for calls in flight, against what the run may use. */
class Spend {
  usd = 0;
  private reserved = 0;
  constructor(readonly limit: number) {}
  /** Sets money aside for a call; false when it would not fit (the call is then not made). */
  reserve(estimate: number, keepFree: number): boolean {
    if (this.usd + this.reserved + estimate + keepFree > this.limit + 1e-9) return false;
    this.reserved += estimate;
    return true;
  }
  settle(estimate: number, actual: number): void {
    this.reserved = Math.max(0, this.reserved - estimate);
    this.usd += actual;
  }
}

const errorText = (e: unknown): string => {
  if (e instanceof AiError) return `ai_${e.code}`;
  if (e instanceof Error) return e.name === "Error" ? e.message.slice(0, 200) : e.name;
  return "error";
};

/**
 * Runs research for one brand and returns the run (status 'done', 'failed' or 'capped'). Returns null only for a
 * scheduled run of a brand that switched weekly research off. A scheduled run that already exists for this week
 * is returned as it is (a retried schedule does not run twice).
 */
export async function runResearch(args: RunArgs, overrides: Partial<ResearchDeps> = {}): Promise<ResearchRun | null> {
  const deps = withDeps(overrides);
  const now = args.now ?? new Date();
  if (args.userId) await requireBrandMember(args.userId, args.brandId);
  else if (!args.service) throw new BrandAccessError();

  const ctx = await loadRunContext(args.brandId);
  if (!ctx) throw new BrandAccessError();
  if (args.trigger === "weekly" && !ctx.researchOn) return null;

  const w = researchWindow(now, ctx.timezone);
  const budget = await checkBudget(args.brandId, args.trigger, now, ctx.timezone);
  const base = { brandId: args.brandId, trigger: args.trigger, windowStart: w.start, windowEnd: w.end, focus: ctx.brand.focus, now };
  if (!budget.ok) return createRun({ ...base, status: "capped", error: budget.reason });
  if (args.trigger === "weekly") {
    const existing = await weeklyRunThisWeek(args.brandId, budget.weekStart, ctx.timezone);
    if (existing) return (await latestRun(args.brandId)) ?? createRun({ ...base, status: "capped", error: "research_cap" });
  }

  const run = await createRun({ ...base, status: "running" });
  const spend = new Spend(budget.remainingUsd);
  let queries: PlannedQuery[] = [];
  let sourcesCount = 0;
  let modelCalled = false;
  let finished: ResearchRun;

  try {
    // How much the budget allows: the planner and the cards call first, then sites, then grounded queries.
    const siteCompetitors = ctx.competitors.filter((c) => c.website);
    const reserveFixed = PLAN_CALL_USD + CARDS_CALL_USD;
    const sitesAllowed = Math.max(0, Math.min(siteCompetitors.length, Math.floor((budget.remainingUsd - reserveFixed - 4 * GROUNDED_QUERY_USD) / SITE_READ_USD)));
    const webMax = Math.max(1, Math.min(MAX_QUERIES, Math.floor((budget.remainingUsd - reserveFixed - sitesAllowed * SITE_READ_USD) / GROUNDED_QUERY_USD)));

    modelCalled = true;
    spend.reserve(PLAN_CALL_USD, 0);
    let planUsd = 0;
    try {
      const plan = await planQueries(ctx.brand, w, { maxQueries: MAX_QUERIES, brandId: args.brandId }, deps.ai);
      planUsd = plan.usd;
      queries = plan.queries;
    } catch (e) {
      planUsd = failedCallUsd(e);
      throw e;
    } finally {
      spend.settle(PLAN_CALL_USD, planUsd);
    }
    const webQueries = queries.filter((q) => q.source === "web").slice(0, webMax);
    const ytQueries = queries.filter((q) => q.source === "youtube");
    queries = [...webQueries, ...ytQueries];

    // ---- Gather ---------------------------------------------------------------------------------
    const found: GatheredFinding[] = [];
    const failures: string[] = [];
    const skipped: string[] = [];
    const deadline = Date.now() + GATHER_DEADLINE_MS;
    const competitorNames = ctx.competitors.map((c) => c.name);
    const keepForCards = CARDS_CALL_USD;
    let attempts = 0; // calls actually tried, to tell "nothing found" from "everything failed"

    const webTasks = webQueries.map((q) => async () => {
      if (Date.now() > deadline || !spend.reserve(GROUNDED_QUERY_USD, keepForCards)) return void skipped.push("web_budget");
      let actual = 0;
      attempts++;
      try {
        const res = await runGroundedQuery(ctx.brand, q, w, { brandId: args.brandId, kind: kindForQuery(q, competitorNames) }, deps.ai);
        actual = res.usd;
        found.push(...res.findings);
      } catch (e) {
        actual = failedCallUsd(e);
        failures.push(`web:${errorText(e)}`);
      } finally {
        spend.settle(GROUNDED_QUERY_USD, actual);
      }
    });

    const siteTasks = siteCompetitors.slice(0, sitesAllowed).map((c) => async () => {
      if (Date.now() > deadline || !spend.reserve(SITE_READ_USD, keepForCards)) return void skipped.push("site_budget");
      let actual = 0;
      attempts++;
      try {
        const res = await readCompetitorSite(args.brandId, c, w, deps);
        actual = res.usd;
        found.push(...res.findings);
      } catch (e) {
        actual = failedCallUsd(e);
        failures.push(`site:${errorText(e)}`);
      } finally {
        spend.settle(SITE_READ_USD, actual);
      }
    });

    const igTasks = ctx.competitors
      .filter((c) => c.instagramHandle)
      .map((c) => async () => {
        if (Date.now() > deadline) return;
        try {
          const res = await discoverCompetitorInstagram(args.brandId, c, w, now, deps);
          if (res.finding) found.push(res.finding);
          if (res.skipped) skipped.push(`instagram:${res.skipped}`);
          else attempts++;
        } catch (e) {
          attempts++;
          failures.push(`instagram:${errorText(e)}`);
        }
      });

    const key = youtubeKey(deps.env);
    const ytTasks = ytQueries.map((q) => async () => {
      if (!key) return void skipped.push("youtube:no_key");
      if (Date.now() > deadline) return;
      attempts++;
      try {
        const f = await searchYoutube(q, { key, region: regionCode(ctx.countryCode), window: w, fetch: deps.fetch });
        if (f) found.push(f);
      } catch (e) {
        failures.push(`youtube:${errorText(e)}`);
      }
    });

    await Promise.all([pool(webTasks, WEB_CONCURRENCY), pool(siteTasks, 2), pool(igTasks, 2), pool(ytTasks, 2)]);
    if (failures.length > 0 || skipped.length > 0) console.info(`[ideas] run ${run.id} brand=${args.brandId} failures=${failures.join(",") || "-"} skipped=${[...new Set(skipped)].join(",") || "-"}`);

    // ---- Merge, score, cards -------------------------------------------------------------------
    sourcesCount = new Set(found.flatMap((f) => f.sources.map((s) => s.url))).size;
    const ranked = rankFindings(found, {
      window: w,
      keywords: brandKeywords({ sells: ctx.brand.sells, category: ctx.brand.category, city: ctx.brand.city, focus: ctx.brand.focus }),
    });
    let cardsUsd = 0;
    let cards: Awaited<ReturnType<typeof makeCards>>["cards"] = [];
    if (ranked.length > 0) {
      spend.reserve(CARDS_CALL_USD, 0);
      try {
        const made = await makeCards(ctx.brand, ranked, { window: w, brandId: args.brandId, wordsToAvoid: ctx.wordsToAvoid }, deps.ai);
        cardsUsd = made.usd;
        cards = made.cards;
      } catch (e) {
        cardsUsd = failedCallUsd(e);
        throw e;
      } finally {
        spend.settle(CARDS_CALL_USD, cardsUsd);
      }
    }
    await saveCards(args.brandId, run.id, cards, now);

    // Every source failed and nothing was found: the run failed, not "found nothing".
    const allFailed = found.length === 0 && attempts > 0 && failures.length >= attempts;
    finished = await finishRun({
      runId: run.id,
      brandId: args.brandId,
      status: allFailed ? "failed" : "done",
      costUsd: spend.usd,
      sourcesCount,
      queries,
      error: allFailed ? failures[0].slice(0, 200) : null,
      now,
    });
  } catch (e) {
    console.error(`[ideas] run ${run.id} failed for brand ${args.brandId}: ${errorText(e)}`);
    finished = await finishRun({ runId: run.id, brandId: args.brandId, status: "failed", costUsd: spend.usd, sourcesCount, queries, error: errorText(e), now });
  }

  if (modelCalled) {
    await recordUsage(args.brandId, args.userId ?? null, "research", spend.usd).catch((e) => console.error("[ideas] could not record usage:", errorText(e)));
  }
  return finished;
}
