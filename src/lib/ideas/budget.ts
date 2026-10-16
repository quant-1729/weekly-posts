// Caps for research runs (R-2). A run is checked BEFORE any model call:
//  - the brand's research spend this week (usage kind 'research') plus the cheapest useful run must fit under
//    RESEARCH_WEEKLY_CAP_USD;
//  - today's AI calls cap (DailyCapError) still applies; the week's post-making spend cap (WEEKLY_USD_CAP) does not (research has its own budget);
//  - "Research now" is limited to MANUAL_RUNS_PER_WEEK a week.
// A run that does not fit is saved with status 'capped' and makes no model call.

import { getDb } from "@/lib/db";
import { addDaysIso, weekStartFor } from "@/lib/occasions/dates";
import { DailyCapError, assertUnderDailyCap } from "@/lib/usage";
import { MIN_RUN_USD } from "./cost";
import { MANUAL_RUNS_PER_WEEK, RESEARCH_WEEKLY_CAP_USD, type RunTrigger } from "./types";

export type CapReason = "research_cap" | "weekly_cap" | "daily_cap" | "manual_limit";

export type Budget = { ok: true; weekStart: string; remainingUsd: number } | { ok: false; reason: CapReason; weekStart: string };

const micro = (usd: number) => Math.round(usd * 1_000_000);

function weekBounds(weekStart: string, tz: string) {
  return [weekStart, addDaysIso(weekStart, 7), tz] as const;
}

/** What the brand's research runs cost in its local week (usage kind 'research'). */
export async function researchSpentThisWeek(brandId: string, weekStart: string, tz: string): Promise<number> {
  const [row] = await getDb().withService((tx) =>
    tx.query<{ usd: string | number | null }>(
      `select coalesce(sum(usd), 0) as usd from public.usage_events
        where brand_id = $1 and kind = 'research'::public.usage_kind
          and created_at >= ($2::date)::timestamp at time zone $4::text
          and created_at <  ($3::date)::timestamp at time zone $4::text`,
      [brandId, ...weekBounds(weekStart, tz)],
    ),
  );
  return Number(row?.usd) || 0;
}

/** "Research now" runs started this week (capped attempts do not count). */
export async function manualRunsThisWeek(brandId: string, weekStart: string, tz: string): Promise<number> {
  const [row] = await getDb().withService((tx) =>
    tx.query<{ n: number }>(
      `select count(*)::int as n from public.research_runs
        where brand_id = $1 and trigger = 'manual' and status <> 'capped'
          and started_at >= ($2::date)::timestamp at time zone $4::text
          and started_at <  ($3::date)::timestamp at time zone $4::text`,
      [brandId, ...weekBounds(weekStart, tz)],
    ),
  );
  return row?.n ?? 0;
}

/** The scheduled run of this week, if one was already started (so a retried schedule does not run twice). */
export async function weeklyRunThisWeek(brandId: string, weekStart: string, tz: string): Promise<string | null> {
  const [row] = await getDb().withService((tx) =>
    tx.query<{ id: string }>(
      `select id::text as id from public.research_runs
        where brand_id = $1 and trigger = 'weekly' and status in ('running', 'done')
          and started_at >= ($2::date)::timestamp at time zone $4::text
          and started_at <  ($3::date)::timestamp at time zone $4::text
        order by started_at desc limit 1`,
      [brandId, ...weekBounds(weekStart, tz)],
    ),
  );
  return row?.id ?? null;
}

export async function checkBudget(brandId: string, trigger: RunTrigger, now: Date, tz: string): Promise<Budget> {
  const weekStart = weekStartFor(now, tz);
  try {
    await assertUnderDailyCap(brandId, now);
  } catch (e) {
    if (e instanceof DailyCapError) return { ok: false, reason: "daily_cap", weekStart };
    throw e;
  }
  if (trigger === "manual" && (await manualRunsThisWeek(brandId, weekStart, tz)) >= MANUAL_RUNS_PER_WEEK) {
    return { ok: false, reason: "manual_limit", weekStart };
  }
  // Research has its own weekly budget; post making's weekly cap (weekCost leaves research out) is separate.
  const researchLeft = RESEARCH_WEEKLY_CAP_USD - (await researchSpentThisWeek(brandId, weekStart, tz));
  if (micro(researchLeft) < micro(MIN_RUN_USD)) return { ok: false, reason: "research_cap", weekStart };
  return { ok: true, weekStart, remainingUsd: researchLeft };
}
