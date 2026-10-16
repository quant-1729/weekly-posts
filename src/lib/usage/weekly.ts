// Weekly accounting (Req 23, AC 23): what a brand's AI calls cost in its local week.
//
// A week is Monday 00:00 to the next Monday 00:00 in brand_memory.timezone (the same week the
// weekly email uses). Instants are worked out in Postgres, so daylight-saving changes are right.
// Image generation: PostMitra uses none (D5 / Req 9: images are SVG templates drawn by code), so
// the "image generation per week" limit in Req 23 is met trivially and has no counter.

import { getDb } from "@/lib/db";
import { addDaysIso, isValidIsoDate, weekdayOf } from "@/lib/occasions/dates";
import type { UsageKind } from "./index";

export type WeekCounts = Partial<Record<UsageKind, number>>;

/** The brand's IANA time zone; "UTC" when it has no memory row yet. */
export async function brandTimezone(brandId: string): Promise<string> {
  const [row] = await getDb().withService((tx) =>
    tx.query<{ timezone: string | null }>("select timezone from public.brand_memory where brand_id = $1", [brandId]),
  );
  return row?.timezone || "UTC";
}

function assertMonday(weekStart: string): void {
  if (!isValidIsoDate(weekStart) || weekdayOf(weekStart) !== 1) throw new Error(`Week start must be a Monday: ${weekStart}`);
}

/**
 * Sum of usage_events.usd for the brand's local week starting on `weekStart` (a Monday, "YYYY-MM-DD").
 * `timezone` skips the lookup when the caller already has it. Research runs are left out: they have their own
 * weekly budget (RESEARCH_WEEKLY_CAP_USD, owner decision 2026-10-15), so a research run never blocks post making. Brand Face creation is left out too: the owner approves its price
 * up front and it has its own per-face cap (FACE_CAP_USD).
 */
export async function weekCost(brandId: string, weekStart: string, timezone?: string): Promise<number> {
  assertMonday(weekStart);
  const tz = timezone ?? (await brandTimezone(brandId));
  const [row] = await getDb().withService((tx) =>
    tx.query<{ usd: string | number | null }>(
      `select coalesce(sum(usd), 0) as usd from public.usage_events
        where brand_id = $1
          and kind not in ('research'::public.usage_kind, 'face_create'::public.usage_kind)
          and created_at >= ($2::date)::timestamp at time zone $4::text
          and created_at <  ($3::date)::timestamp at time zone $4::text`,
      [brandId, weekStart, addDaysIso(weekStart, 7), tz],
    ),
  );
  return Number(row?.usd) || 0;
}

/** Number of AI calls by kind in the same week. Kinds with no calls are absent. */
export async function weekCounts(brandId: string, weekStart: string, timezone?: string): Promise<WeekCounts> {
  assertMonday(weekStart);
  const tz = timezone ?? (await brandTimezone(brandId));
  const rows = await getDb().withService((tx) =>
    tx.query<{ kind: UsageKind; n: number }>(
      `select kind::text as kind, count(*)::int as n from public.usage_events
        where brand_id = $1
          and created_at >= ($2::date)::timestamp at time zone $4::text
          and created_at <  ($3::date)::timestamp at time zone $4::text
        group by kind`,
      [brandId, weekStart, addDaysIso(weekStart, 7), tz],
    ),
  );
  const out: WeekCounts = {};
  for (const r of rows) out[r.kind] = r.n;
  return out;
}
