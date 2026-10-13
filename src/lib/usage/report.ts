// Cost report (Req 23, AC 23): what each brand's AI calls cost in each local week, and whether the
// week stayed under the cap. Read-only; makes no AI calls. Used by scripts/cost-report.mts and the
// dev-only page /dev/costs.

import { getDb } from "@/lib/db";
import { WEEKLY_USD_CAP } from "./caps";
import type { UsageKind } from "./index";

export interface WeekCostRow {
  brandId: string;
  brandName: string;
  /** Monday of the brand's local week, "YYYY-MM-DD". */
  weekStart: string;
  usd: number;
  /** Number of calls by kind. */
  calls: Partial<Record<UsageKind, number>>;
  totalCalls: number;
  underCap: boolean;
}

/**
 * One row per brand per local week with usage, newest week first. `fromWeekStart` and `brandId`
 * narrow the list. A brand with no memory row is counted in UTC.
 */
export async function costReport(opts: { brandId?: string; fromWeekStart?: string } = {}): Promise<WeekCostRow[]> {
  const rows = await getDb().withService((tx) =>
    tx.query<{ brand_id: string; name: string; week_start: string; kind: UsageKind; n: number; usd: string | number }>(
      `select u.brand_id::text as brand_id, b.name, w.week_start::text as week_start, u.kind::text as kind,
              count(*)::int as n, coalesce(sum(u.usd), 0) as usd
         from public.usage_events u
         join public.brands b on b.id = u.brand_id
         left join public.brand_memory m on m.brand_id = u.brand_id
        cross join lateral (
          select date_trunc('week', u.created_at at time zone coalesce(m.timezone, 'UTC'))::date as week_start
        ) w
        where ($1::uuid is null or u.brand_id = $1::uuid)
          and ($2::date is null or w.week_start >= $2::date)
        group by u.brand_id, b.name, w.week_start, u.kind`,
      [opts.brandId ?? null, opts.fromWeekStart ?? null],
    ),
  );
  const byKey = new Map<string, WeekCostRow>();
  for (const r of rows) {
    const key = `${r.brand_id}|${r.week_start}`;
    let row = byKey.get(key);
    if (!row) {
      row = { brandId: r.brand_id, brandName: r.name, weekStart: r.week_start, usd: 0, calls: {}, totalCalls: 0, underCap: true };
      byKey.set(key, row);
    }
    row.calls[r.kind] = r.n;
    row.totalCalls += r.n;
    row.usd += Number(r.usd) || 0;
  }
  const out = [...byKey.values()];
  for (const row of out) {
    row.underCap = row.usd < WEEKLY_USD_CAP;
    row.calls = Object.fromEntries(Object.entries(row.calls).sort(([x], [y]) => x.localeCompare(y)));
  }
  return out.sort((a, b) => b.weekStart.localeCompare(a.weekStart) || a.brandName.localeCompare(b.brandName));
}

/** Plain-text table of the report, for the script. */
export function formatCostReport(rows: WeekCostRow[]): string {
  if (rows.length === 0) return "No AI usage recorded yet.";
  const lines = [`Weekly AI cost per brand (cap $${WEEKLY_USD_CAP.toFixed(2)})`, ""];
  for (const r of rows) {
    const calls = Object.entries(r.calls)
      .map(([k, n]) => `${k}=${n}`)
      .join(" ");
    lines.push(`${r.weekStart}  ${r.brandName} (${r.brandId.slice(0, 8)})  $${r.usd.toFixed(4)}  ${r.underCap ? "under cap" : "OVER CAP"}  ${calls}`);
  }
  return lines.join("\n");
}
