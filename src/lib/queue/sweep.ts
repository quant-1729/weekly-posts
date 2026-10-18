// The hourly queue sweep (PRD v3 S-2, S-3, S-5, S-6; changes C-24, C-26, C-27): finds the items whose slot has
// come and sends each one, one item per channel at a time.
//
// For every brand that has something due (skipping brands that paused the queue or their emails):
//  - an item whose offer has ended is `expired` and never sent (S-5);
//  - an item whose post is no longer approved is `skipped` (nothing goes out without approval);
//  - if several items of one channel are due (downtime), only the NEWEST is sent and the older ones become
//    `missed` (S-2: the queue does not pile up); an item never handled that is older than
//    MISSED_AFTER_MINUTES is `missed` too, and the owner sees "Skip, post now, or move";
//  - `publish` items go to the publisher; a retryable failure puts the item back for the next sweep, a final
//    failure makes it `failed`, emails the owner "here it is to share yourself" and reports the connection;
//  - `deliver` items are emailed to the owner with the picture, the caption and a no-login ready link.
//
// Idempotent: an item is CLAIMED by one UPDATE (scheduled -> publishing ... where status = 'scheduled'); only
// the sweep whose UPDATE returns the row sends it. A second run in the same hour finds nothing to claim.

import { getDb } from '@/lib/db';
import { sendEmail as realSendEmail } from '@/lib/email';
import { localDateIn } from '@/lib/occasions/dates';
import { emitQueueItem } from '@/lib/realtime';
import { activeProviders, ITEM_COLUMNS, postWithSlides, toItem, type ItemRow } from './data';
import { failureReason, loadDeliveryPost, sendDeliveryEmail } from './deliver';
import { getPublisher, defaultReportConnectionProblem, type ReportConnectionProblem } from './publisher';
import { hasEnded } from './slots';
import { MAX_PUBLISH_ATTEMPTS, MISSED_AFTER_MINUTES, PUBLISH_PROVIDER, type PublishQueueItem, type PublishResult, type QueueChannel, type QueueItem, type QueueMode, type QueueStatus } from './types';

/** An item stuck in `publishing` this long means a run died half way. */
export const STALE_PUBLISHING_MINUTES = 15;

export interface SweepDeps {
  publish?: PublishQueueItem;
  sendEmail?: typeof realSendEmail;
  reportConnectionProblem?: ReportConnectionProblem;
}

export type ItemOutcome = 'published' | 'delivered' | 'retry' | 'failed' | 'missed' | 'expired' | 'skipped' | 'lost';

export interface SweepItemResult {
  itemId: string;
  brandId: string;
  channel: QueueChannel;
  outcome: ItemOutcome;
}

export interface SweepSummary {
  at: string;
  /** Brands with something due. */
  brands: number;
  /** Brands left alone because the queue (or their emails) is paused. */
  pausedBrands: number;
  published: number;
  delivered: number;
  retried: number;
  failed: number;
  missed: number;
  expired: number;
  skipped: number;
  /** Brands whose sweep threw (the rest still ran). */
  errors: number;
  items: SweepItemResult[];
}

interface BrandCtx {
  brandId: string;
  name: string;
  timezone: string;
  pausedUntil: string | null;
  unsubscribed: boolean;
  /** The queue's pause switch. */
  paused: boolean;
  deliverEmail: boolean;
}

interface BrandRow {
  brand_id: string;
  name: string;
  timezone: string | null;
  paused_until: string | null;
  unsub: boolean;
  paused: boolean;
  deliver_email: boolean;
}

const BRAND_SELECT = `select b.id::text as brand_id, coalesce(nullif(trim(m.business_name), ''), b.name) as name, m.timezone, m.email_paused_until::text as paused_until,
       m.email_unsubscribed_at is not null as unsub, coalesce(s.paused, false) as paused, coalesce(s.deliver_email, true) as deliver_email
  from public.brands b
  left join public.brand_memory m on m.brand_id = b.id
  left join public.queue_settings s on s.brand_id = b.id`;

function toCtx(r: BrandRow): BrandCtx {
  let zone = r.timezone || 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
  } catch {
    zone = 'UTC';
  }
  return { brandId: r.brand_id, name: r.name, timezone: zone, pausedUntil: r.paused_until, unsubscribed: r.unsub, paused: r.paused, deliverEmail: r.deliver_email };
}

/** The queue is paused by its switch, or by "pause for 2 weeks" (the emailed link) until that local date. */
export function isBrandPaused(b: BrandCtx, now: Date): boolean {
  if (b.paused) return true;
  return !!b.pausedUntil && localDateIn(now, b.timezone) < b.pausedUntil;
}

async function dueBrands(now: Date): Promise<BrandCtx[]> {
  const rows = await getDb().withService((tx) =>
    tx.query<BrandRow>(
      `${BRAND_SELECT}
        where b.id in (select brand_id from public.queue_items
                        where (status = 'scheduled' and slot_at <= $1::timestamptz)
                           or (status = 'publishing' and updated_at <= $1::timestamptz - make_interval(mins => $2)))
        order by b.id`,
      [now.toISOString(), STALE_PUBLISHING_MINUTES],
    ),
  );
  return rows.map(toCtx);
}

async function loadBrandCtx(brandId: string): Promise<BrandCtx | null> {
  const [row] = await getDb().withService((tx) => tx.query<BrandRow>(`${BRAND_SELECT} where b.id = $1`, [brandId]));
  return row ? toCtx(row) : null;
}

interface DueRow extends ItemRow {
  post_status: string;
  ends_on: string | null;
}

const empty = (now: Date): SweepSummary => ({ at: now.toISOString(), brands: 0, pausedBrands: 0, published: 0, delivered: 0, retried: 0, failed: 0, missed: 0, expired: 0, skipped: 0, errors: 0, items: [] });

function record(sum: SweepSummary, item: { id: string; brand_id: string; channel: string }, outcome: ItemOutcome): void {
  sum.items.push({ itemId: item.id, brandId: item.brand_id, channel: item.channel as QueueChannel, outcome });
  if (outcome === 'published') sum.published += 1;
  else if (outcome === 'delivered') sum.delivered += 1;
  else if (outcome === 'retry') sum.retried += 1;
  else if (outcome === 'failed') sum.failed += 1;
  else if (outcome === 'missed') sum.missed += 1;
  else if (outcome === 'expired') sum.expired += 1;
  else if (outcome === 'skipped') sum.skipped += 1;
}

/**
 * Live status (docs/14-firebase-plan.md): tells open Queue screens that an item changed. Only ever called after the database
 * work is committed, never inside a transaction. emitLive never throws and gives up after 1.5 s; the catch is for building
 * the payload, so a live problem can never change what the sweep does.
 */
async function emitRows(rows: ItemRow[]): Promise<void> {
  await Promise.all(
    rows.map(async (r) => {
      try {
        await emitQueueItem(r.brand_id, {
          id: r.id,
          postId: r.post_id,
          channel: r.channel as QueueChannel,
          status: r.status as QueueStatus,
          mode: r.mode as QueueMode,
          attempts: r.attempts,
          slotAt: new Date(r.slot_at).toISOString(),
        });
      } catch {
        // Nothing to do: the screen catches up on its next refresh.
      }
    }),
  );
}

/** Reads the item again and tells open screens how it ended up. */
async function emitCurrent(itemId: string): Promise<void> {
  try {
    const rows = await getDb().withService((tx) => tx.query<ItemRow>(`select ${ITEM_COLUMNS} from public.queue_items q where q.id = $1`, [itemId]));
    await emitRows(rows);
  } catch {
    // Same: never let this change an outcome.
  }
}

/** Sets a status on several items, only those still `scheduled` (so a claimed or moved item is never touched). Returns the rows changed. */
async function closeScheduled(ids: string[], status: 'missed' | 'expired' | 'skipped', now: Date, note: string | null): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await getDb().withService((tx) =>
    tx.query<ItemRow>(
      `update public.queue_items q set status = $2, done_at = case when $2 = 'missed' then null else $3::timestamptz end, last_error = coalesce($4, last_error), updated_at = now()
        where q.id = any($1::uuid[]) and q.status = 'scheduled' returning ${ITEM_COLUMNS}`,
      [ids, status, now.toISOString(), note],
    ),
  );
  await emitRows(rows);
  return rows.map((r) => r.id);
}

/** The claim: one UPDATE; only the caller that gets the row back may send the item. */
async function claim(itemId: string): Promise<ItemRow | null> {
  const [row] = await getDb().withService((tx) =>
    tx.query<ItemRow>(`update public.queue_items q set status = 'publishing', updated_at = now() where q.id = $1 and q.status = 'scheduled' returning ${ITEM_COLUMNS}`, [itemId]),
  );
  return row ?? null;
}

/** Marks the post (and a carousel's slides) as posted. */
async function markPostPosted(brandId: string, postId: string, now: Date): Promise<void> {
  await getDb().withService(async (tx) => {
    const ids = await postWithSlides(tx, brandId, postId);
    await tx.query(`update public.posts set status = 'posted', posted_at = $3::timestamptz where brand_id = $1 and id = any($2::uuid[]) and status = 'approved'`, [brandId, ids, now.toISOString()]);
  });
}

async function finish(itemId: string, set: string, params: unknown[]): Promise<boolean> {
  const rows = await getDb().withService((tx) =>
    tx.query<{ id: string }>(`update public.queue_items set ${set}, updated_at = now() where id = $1 and status = 'publishing' returning id::text as id`, [itemId, ...params]),
  );
  return rows.length > 0;
}

const trimError = (m: string): string => m.replace(/\s+/g, ' ').trim().slice(0, 500);

interface Run {
  ctx: BrandCtx;
  now: Date;
  deps: Required<Pick<SweepDeps, 'publish' | 'sendEmail' | 'reportConnectionProblem'>>;
}

/** Sends "here it is" after a failed publish. Never throws; the item stays `failed` either way. */
async function fallbackEmail(run: Run, item: ItemRow, reason: string): Promise<void> {
  if (run.ctx.unsubscribed) return;
  try {
    const post = await loadDeliveryPost(run.ctx.brandId, item.post_id);
    if (!post) return;
    await sendDeliveryEmail({
      brand: { id: run.ctx.brandId, name: run.ctx.name },
      post,
      slotAt: new Date(item.slot_at).toISOString(),
      timezone: run.ctx.timezone,
      kind: 'fallback',
      reason,
      now: run.now,
      send: run.deps.sendEmail,
    });
  } catch (err) {
    console.error(`[queue] fallback email failed for item ${item.id}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function runPublish(run: Run, item: ItemRow): Promise<ItemOutcome> {
  let result: PublishResult;
  try {
    result = await run.deps.publish({ itemId: item.id, brandId: item.brand_id });
  } catch (err) {
    result = { ok: false, retryable: true, reason: 'unknown', message: err instanceof Error ? err.message : String(err) };
  }
  if (result.ok) {
    const done = await finish(item.id, `status = 'published', platform_post_id = $2, permalink = $3, done_at = $4::timestamptz, last_error = null`, [
      result.platformPostId.slice(0, 120),
      result.permalink ? result.permalink.slice(0, 500) : null,
      run.now.toISOString(),
    ]);
    if (done) await markPostPosted(item.brand_id, item.post_id, run.now);
    return done ? 'published' : 'lost';
  }
  const attempts = item.attempts + 1;
  const message = trimError(result.message || result.reason);
  if (result.retryable && attempts < MAX_PUBLISH_ATTEMPTS) {
    await finish(item.id, `status = 'scheduled', attempts = $2, last_error = $3`, [attempts, message]);
    return 'retry';
  }
  // Final: switch this item to delivery, tell the owner, and report the connection (once per problem).
  await finish(item.id, `status = 'failed', mode = 'deliver', attempts = $2, last_error = $3, done_at = null`, [attempts, message]);
  const provider = PUBLISH_PROVIDER[item.channel as QueueChannel];
  if (provider && (result.reason === 'token_expired' || result.reason === 'not_connected')) {
    try {
      await run.deps.reportConnectionProblem({ brandId: item.brand_id, provider, status: result.reason === 'token_expired' ? 'expired' : 'error', message });
    } catch (err) {
      console.error(`[queue] could not report the ${provider} connection problem: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  await fallbackEmail(run, item, failureReason(result.reason));
  return 'failed';
}

async function runDeliver(run: Run, item: ItemRow): Promise<ItemOutcome> {
  const silent = !run.ctx.deliverEmail || run.ctx.unsubscribed;
  if (!silent) {
    const post = await loadDeliveryPost(run.ctx.brandId, item.post_id);
    if (!post) {
      await finish(item.id, `status = 'skipped', last_error = 'post not found', done_at = $2::timestamptz`, [run.now.toISOString()]);
      return 'skipped';
    }
    const { sent, error } = await sendDeliveryEmail({
      brand: { id: run.ctx.brandId, name: run.ctx.name },
      post,
      slotAt: new Date(item.slot_at).toISOString(),
      timezone: run.ctx.timezone,
      kind: 'delivery',
      now: run.now,
      send: run.deps.sendEmail,
    });
    if (sent === 0) {
      const attempts = item.attempts + 1;
      const message = trimError(error ?? 'the email could not be sent');
      if (attempts < MAX_PUBLISH_ATTEMPTS) {
        await finish(item.id, `status = 'scheduled', attempts = $2, last_error = $3`, [attempts, message]);
        return 'retry';
      }
      await finish(item.id, `status = 'failed', attempts = $2, last_error = $3`, [attempts, message]);
      return 'failed';
    }
  }
  // With emails off the item is simply ready in the app ("Sent to you" under Ready to share) and nothing is sent.
  return (await finish(item.id, `status = 'delivered', done_at = $2::timestamptz, last_error = null`, [run.now.toISOString()])) ? 'delivered' : 'lost';
}

/**
 * The mode is decided again at send time: an item queued as "we'll email it to you" is published when its channel
 * has a provider and a working connection now (the owner connected after scheduling). The row is updated with the claim.
 */
async function upgradeMode(row: ItemRow, now: Date): Promise<ItemRow> {
  const provider = PUBLISH_PROVIDER[row.channel as QueueChannel];
  if (row.mode !== 'deliver' || !provider) return row;
  const [up] = await getDb().withService(async (tx) => {
    if (!(await activeProviders(tx, row.brand_id, now)).has(provider)) return [];
    return tx.query<ItemRow>(`update public.queue_items q set mode = 'publish', updated_at = now() where q.id = $1 and q.status = 'publishing' returning ${ITEM_COLUMNS}`, [row.id]);
  });
  return up ?? row;
}

/** Claims one item and runs it. */
async function processItem(run: Run, row: ItemRow): Promise<ItemOutcome> {
  const first = await claim(row.id);
  if (!first) return 'lost';
  await emitRows([first]); // "publishing" (the claim is committed)
  const claimed = await upgradeMode(first, run.now).catch(() => first);
  try {
    return claimed.mode === 'publish' ? await runPublish(run, claimed) : await runDeliver(run, claimed);
  } catch (err) {
    // Unexpected: give the item back so the next sweep tries again (it counts as an attempt).
    console.error(`[queue] item ${claimed.id} crashed: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
    const attempts = claimed.attempts + 1;
    await finish(claimed.id, attempts < MAX_PUBLISH_ATTEMPTS ? `status = 'scheduled', attempts = $2, last_error = $3` : `status = 'failed', attempts = $2, last_error = $3`, [
      attempts,
      trimError(err instanceof Error ? err.message : String(err)),
    ]).catch(() => false);
    return 'retry';
  } finally {
    await emitCurrent(first.id); // how it ended: published, delivered, back to scheduled, failed
  }
}

function runFor(ctx: BrandCtx, now: Date, deps: SweepDeps): Run {
  return {
    ctx,
    now,
    deps: {
      publish: deps.publish ?? getPublisher(),
      sendEmail: deps.sendEmail ?? realSendEmail,
      reportConnectionProblem: deps.reportConnectionProblem ?? defaultReportConnectionProblem,
    },
  };
}

async function sweepBrand(ctx: BrandCtx, now: Date, deps: SweepDeps, sum: SweepSummary): Promise<void> {
  const run = runFor(ctx, now, deps);

  // 1. A run that died half way left items in `publishing`: we cannot know whether the post went out, so they
  //    are not sent again; the owner gets the post to check and share.
  const stale = await getDb().withService((tx) =>
    tx.query<ItemRow>(
      `update public.queue_items q set status = 'failed', mode = 'deliver', last_error = 'interrupted', updated_at = now()
        where q.brand_id = $1 and q.status = 'publishing' and q.updated_at <= $2::timestamptz - make_interval(mins => $3) returning ${ITEM_COLUMNS}`,
      [ctx.brandId, now.toISOString(), STALE_PUBLISHING_MINUTES],
    ),
  );
  await emitRows(stale);
  for (const item of stale) {
    await fallbackEmail(run, item, failureReason('interrupted'));
    record(sum, item, 'failed');
  }

  // 2. What is due.
  const due = await getDb().withService((tx) =>
    tx.query<DueRow>(
      `select ${ITEM_COLUMNS}, p.status::text as post_status, b.ends_on::text as ends_on
         from public.queue_items q
         join public.posts p on p.id = q.post_id and p.brand_id = q.brand_id
         left join public.post_briefs b on b.id = p.brief_id and b.brand_id = p.brand_id
        where q.brand_id = $1 and q.status = 'scheduled' and q.slot_at <= $2::timestamptz
        order by q.slot_at, q.id`,
      [ctx.brandId, now.toISOString()],
    ),
  );

  const live: DueRow[] = [];
  const expired: DueRow[] = [];
  const unapproved: DueRow[] = [];
  for (const d of due) {
    if (hasEnded(d.ends_on, now, ctx.timezone)) expired.push(d);
    else if (d.post_status !== 'approved') unapproved.push(d);
    else live.push(d);
  }
  for (const id of await closeScheduled(expired.map((d) => d.id), 'expired', now, null)) record(sum, due.find((d) => d.id === id)!, 'expired');
  for (const id of await closeScheduled(unapproved.map((d) => d.id), 'skipped', now, 'no longer approved')) record(sum, due.find((d) => d.id === id)!, 'skipped');

  // 3. One item per channel: the newest due one, if it is fresh enough; every older one is missed.
  const byChannel = new Map<string, DueRow[]>();
  for (const d of live) byChannel.set(d.channel, [...(byChannel.get(d.channel) ?? []), d]);
  const toSend: DueRow[] = [];
  const toMiss: DueRow[] = [];
  for (const items of byChannel.values()) {
    const newest = items[items.length - 1];
    toMiss.push(...items.slice(0, -1));
    const ageMin = (now.getTime() - new Date(newest.slot_at).getTime()) / 60_000;
    // An item that was already tried keeps being retried until its attempts run out; a never-handled one goes stale.
    if (newest.attempts === 0 && ageMin > MISSED_AFTER_MINUTES) toMiss.push(newest);
    else toSend.push(newest);
  }
  for (const id of await closeScheduled(toMiss.map((d) => d.id), 'missed', now, null)) record(sum, due.find((d) => d.id === id)!, 'missed');

  for (const d of toSend) record(sum, d, await processItem(run, d));
}

/**
 * The sweep. `now` is the test clock. Never throws for one brand's problem: that brand is counted in `errors`
 * and the rest still run.
 */
export async function runQueueSweep(opts: { now?: Date; deps?: SweepDeps } = {}): Promise<SweepSummary> {
  const now = opts.now ?? new Date();
  const sum = empty(now);
  const brands = await dueBrands(now);
  sum.brands = brands.length;
  for (const ctx of brands) {
    if (isBrandPaused(ctx, now)) {
      sum.pausedBrands += 1;
      continue;
    }
    try {
      await sweepBrand(ctx, now, opts.deps ?? {}, sum);
    } catch (err) {
      sum.errors += 1;
      console.error(`[queue] sweep failed for brand ${ctx.brandId}: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
    }
  }
  console.info(`[queue] sweep ${JSON.stringify({ ...sum, items: undefined })}`);
  return sum;
}

/**
 * Sends given items right now (the owner pressed "Post now"): the same claim and send as the sweep, but without
 * the pause and one-per-channel rules, because the owner asked for exactly these. Items must already be `scheduled`.
 */
export async function runItemsNow(args: { brandId: string; itemIds: string[]; now?: Date; deps?: SweepDeps }): Promise<SweepItemResult[]> {
  const now = args.now ?? new Date();
  const ctx = await loadBrandCtx(args.brandId);
  if (!ctx || args.itemIds.length === 0) return [];
  const run = runFor(ctx, now, args.deps ?? {});
  const sum = empty(now);
  const rows = await getDb().withService((tx) =>
    tx.query<ItemRow>(`select ${ITEM_COLUMNS} from public.queue_items q where q.brand_id = $1 and q.id = any($2::uuid[]) and q.status = 'scheduled' order by q.slot_at, q.channel, q.id`, [args.brandId, args.itemIds]),
  );
  for (const r of rows) record(sum, r, await processItem(run, r));
  return sum.items;
}

/** The current state of an item after a run (for the screens). */
export async function reloadItem(brandId: string, itemId: string): Promise<QueueItem | null> {
  const [row] = await getDb().withService((tx) => tx.query<ItemRow>(`select ${ITEM_COLUMNS} from public.queue_items q where q.id = $1 and q.brand_id = $2`, [itemId, brandId]));
  return row ? toItem(row) : null;
}
