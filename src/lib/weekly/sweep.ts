// The hourly cron sweep (Req 7): find the brands whose local time has come and generate their
// week, one brand at a time, within a time budget. Brands left over are picked up by the next sweep.

import { generateWeek, type GenerateDeps, type GenerateResult } from './generate';
import { dueBrands, type DueBrand } from './schedule';

/** Stop starting new brands after this long (the route's maxDuration is 300 s). */
export const SWEEP_BUDGET_MS = 240_000;

export interface SweepItem {
  brandId: string;
  weekStart: string;
  reason: DueBrand['reason'];
  outcome: GenerateResult['status'] | 'error';
  detail?: string;
  ms: number;
}

export interface SweepSummary {
  at: string;
  due: number;
  processed: number;
  ready: number;
  failed: number;
  skipped: number;
  /** Due brands not started because the time budget ran out; the next sweep takes them. */
  deferred: number;
  items: SweepItem[];
}

export async function runWeeklySweep(opts: { now?: Date; budgetMs?: number; deps?: GenerateDeps } = {}): Promise<SweepSummary> {
  const started = Date.now();
  const now = opts.now ?? new Date();
  const budget = opts.budgetMs ?? SWEEP_BUDGET_MS;
  const due = await dueBrands(now);
  const items: SweepItem[] = [];
  let deferred = 0;
  for (const d of due) {
    if (Date.now() - started >= budget) {
      deferred += 1;
      continue;
    }
    const t = Date.now();
    try {
      const r = await generateWeek({ brandId: d.brandId, weekStart: d.weekStart, trigger: 'cron' }, { ...opts.deps, now });
      items.push({
        brandId: d.brandId,
        weekStart: d.weekStart,
        reason: d.reason,
        outcome: r.status,
        detail: r.status === 'failed' ? r.error : r.status === 'skipped' ? r.reason : undefined,
        ms: Date.now() - t,
      });
    } catch (e) {
      items.push({ brandId: d.brandId, weekStart: d.weekStart, reason: d.reason, outcome: 'error', detail: e instanceof Error ? e.message : String(e), ms: Date.now() - t });
    }
  }
  const count = (o: SweepItem['outcome']) => items.filter((i) => i.outcome === o).length;
  const summary: SweepSummary = {
    at: now.toISOString(),
    due: due.length,
    processed: items.length,
    ready: count('ready'),
    failed: count('failed') + count('error'),
    skipped: count('skipped'),
    deferred,
    items,
  };
  console.info(`[weekly] sweep ${JSON.stringify({ ...summary, items: undefined })}`);
  return summary;
}
