// "Post now" (PRD v3 §6 "Post approved after its slot passed"): the owner sends a post straight away instead of
// waiting for a slot. The item is put at the current time and then run through the same claim and send as the
// hourly sweep, so an Instagram post is published and a WhatsApp post is emailed within seconds.

import { queueFail, type QueueResult } from './errors';
import { markDueNow, scheduleApproved, type ScheduleArgs, type ScheduleOutcome } from './service';
import { reloadItem, runItemsNow, type ItemOutcome, type SweepDeps, type SweepItemResult } from './sweep';
import type { QueueItem } from './types';

/** An item already in the queue (scheduled, missed or failed): send it now. Refuses when the offer has ended. */
export async function postNowQueueItem(args: { userId: string; brandId: string; itemId: string; now?: Date; deps?: SweepDeps }): Promise<QueueResult<{ item: QueueItem; outcome: ItemOutcome }>> {
  const marked = await markDueNow(args);
  if (!marked.ok) return marked;
  const [result] = await runItemsNow({ brandId: args.brandId, itemIds: [args.itemId], now: args.now, deps: args.deps });
  const item = await reloadItem(args.brandId, args.itemId);
  if (!item) return queueFail('not_found');
  return { ok: true, item, outcome: result?.outcome ?? 'lost' };
}

/** Approved posts that are not queued yet (or a whole brief): queue them for now and send them. */
export async function postNowApproved(args: Omit<ScheduleArgs, 'at' | 'overrides'> & { deps?: SweepDeps }): Promise<QueueResult<{ outcome: ScheduleOutcome; results: SweepItemResult[] }>> {
  const { deps, ...rest } = args;
  const scheduled = await scheduleApproved({ ...rest, at: 'now' });
  if (!scheduled.ok) return scheduled;
  const results = await runItemsNow({ brandId: args.brandId, itemIds: scheduled.outcome.items.map((i) => i.id), now: args.now, deps });
  return { ok: true, outcome: scheduled.outcome, results };
}
