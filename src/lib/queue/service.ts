// The queue (PRD v3 S-1, S-2, S-5; change C-24): approved channel posts go into the next free slots, and the owner
// can move, post now, skip or unschedule them.
//
// Rules in short:
//  - slots come from the owner's weekdays x each channel's time, in the BRAND's time zone;
//  - at most `postsPerWeek` slot days per ISO week across the whole queue;
//  - one post per slot per channel;
//  - a post never goes after its brief's end date; when no slot fits before it, the answer is
//    "no slot before the offer ends" so the screen can offer "post now";
//  - a carousel is queued once, as its first slide's post (the main post of the channel);
//  - mode 'publish' when the channel has a provider and a working connection, else 'deliver'.
//
// Writes run as the service role AFTER `requireBrandMember`, one at a time per brand (advisory lock).

import { requireBrandMember } from '@/lib/brand/current';
import { getDb, type Tx } from '@/lib/db';
import { activeProviders, brandZone, ITEM_COLUMNS, lockBrandQueue, modeFor, occupiedSlots, postWithSlides, toItem, type ItemRow } from './data';
import { queueFail, type QueueResult } from './errors';
import { readQueueSettings } from './settings';
import { findSlot, freeSlotsFor, hasEnded, type SlotContext } from './slots';
import { QUEUE_CHANNELS, type QueueChannel, type QueueItem, type QueueMode } from './types';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isChannel = (c: string): c is QueueChannel => (QUEUE_CHANNELS as readonly string[]).includes(c);

/** Statuses an owner may still act on (move, post now, unschedule, skip). */
export const ACTIONABLE: readonly string[] = ['scheduled', 'missed', 'failed'];
/** Statuses that count as "already in the queue" when scheduling. */
const LIVE: readonly string[] = ['scheduled', 'publishing', 'published', 'delivered'];
/** Statuses a post can be put into the queue again from. */
const RESCHEDULABLE: readonly string[] = ['missed', 'failed', 'expired', 'skipped'];

export interface Placement {
  postId: string;
  briefId: string;
  channel: QueueChannel;
  /** ISO timestamp (UTC). */
  slotAt: string;
  mode: QueueMode;
}

export type NoSlotReason = 'ends_before_slot' | 'no_slot' | 'ended';

export interface ScheduleOutcome {
  /** The slots chosen (with `dryRun` / `proposeSlots`, not saved). */
  placed: Placement[];
  /** Posts that have no slot before their offer ends ("no slot before the offer ends": offer "post now"). */
  noSlot: { postId: string; briefId: string; channel: QueueChannel; reason: NoSlotReason }[];
  /** Posts left alone. */
  skipped: { postId: string; reason: 'not_found' | 'not_approved' | 'already_queued' | 'not_queueable' }[];
  /** The saved queue rows, in the order placed (empty for a proposal). */
  items: QueueItem[];
}

export interface ScheduleArgs {
  userId: string;
  brandId: string;
  /** Specific posts, or every approved post of one brief. */
  postIds?: string[];
  briefId?: string;
  now?: Date;
  /** The owner picked another time for these posts (must be one of the free slots offered). */
  overrides?: Record<string, string>;
  /** Put the posts at `now` instead of the next free slot ("post now"). */
  at?: 'now';
}

interface PostRow {
  id: string;
  brief_id: string;
  channel: string;
  status: string;
  ends_on: string | null;
  brief_created: Date | string;
  created_at: Date | string;
}

interface Group {
  briefId: string;
  endsOn: string | null;
  posts: { id: string; channel: QueueChannel }[];
}

async function loadCandidates(tx: Tx, args: ScheduleArgs): Promise<{ rows: PostRow[]; unknown: string[] }> {
  const ids = (args.postIds ?? []).filter((id) => UUID_RE.test(id));
  const unknown = (args.postIds ?? []).filter((id) => !UUID_RE.test(id));
  if (!args.briefId && ids.length === 0) return { rows: [], unknown };
  const rows = await tx.query<PostRow>(
    `select p.id::text as id, p.brief_id::text as brief_id, p.channel::text as channel, p.status::text as status,
            b.ends_on::text as ends_on, b.created_at as brief_created, p.created_at
       from public.posts p
       join public.post_briefs b on b.id = p.brief_id and b.brand_id = p.brand_id
      where p.brand_id = $1 and p.carousel_id is null
        and (($2::uuid is not null and p.brief_id = $2::uuid) or p.id = any($3::uuid[]))
      order by b.created_at, p.brief_id, p.created_at, p.id`,
    [args.brandId, args.briefId && UUID_RE.test(args.briefId) ? args.briefId : null, ids],
  );
  return { rows, unknown };
}

/**
 * Chooses slots for the approved posts and (unless `dryRun`) saves them. Shared by `scheduleApproved` and
 * `proposeSlots` so what the Schedule step shows is exactly what Confirm saves.
 */
async function plan(tx: Tx, args: ScheduleArgs, write: boolean): Promise<QueueResult<{ outcome: ScheduleOutcome }>> {
  const { brandId } = args;
  const now = args.now ?? new Date();
  await lockBrandQueue(tx, brandId);
  const [timezone, settings, providers] = await Promise.all([brandZone(tx, brandId), readQueueSettings(tx, brandId), activeProviders(tx, brandId, now)]);
  const occupied = await occupiedSlots(tx, brandId, now);
  const { rows, unknown } = await loadCandidates(tx, args);

  const outcome: ScheduleOutcome = { placed: [], noSlot: [], skipped: unknown.map((id) => ({ postId: id, reason: 'not_found' as const })), items: [] };
  const wanted = new Set(args.postIds ?? []);
  for (const id of wanted) if (UUID_RE.test(id) && !rows.some((r) => r.id === id)) outcome.skipped.push({ postId: id, reason: 'not_found' });

  const existing = rows.length
    ? await tx.query<{ post_id: string; status: string }>('select post_id::text as post_id, status from public.queue_items where brand_id = $1 and post_id = any($2::uuid[])', [
        brandId,
        rows.map((r) => r.id),
      ])
    : [];
  const itemStatus = new Map(existing.map((e) => [e.post_id, e.status]));

  const groups: Group[] = [];
  for (const r of rows) {
    if (!isChannel(r.channel)) {
      outcome.skipped.push({ postId: r.id, reason: 'not_queueable' });
      continue;
    }
    if (r.status !== 'approved') {
      outcome.skipped.push({ postId: r.id, reason: 'not_approved' });
      continue;
    }
    const st = itemStatus.get(r.id);
    if (st && (LIVE.includes(st) || !RESCHEDULABLE.includes(st))) {
      outcome.skipped.push({ postId: r.id, reason: 'already_queued' });
      continue;
    }
    let g = groups.find((x) => x.briefId === r.brief_id);
    if (!g) {
      g = { briefId: r.brief_id, endsOn: r.ends_on, posts: [] };
      groups.push(g);
    }
    g.posts.push({ id: r.id, channel: r.channel });
  }

  const ctxFor = (endsOn: string | null): SlotContext => ({ now, timezone, settings, occupied, endsOn });
  const place = (g: Group, post: { id: string; channel: QueueChannel }, at: Date) => {
    outcome.placed.push({ postId: post.id, briefId: g.briefId, channel: post.channel, slotAt: at.toISOString(), mode: modeFor(post.channel, providers) });
    occupied.push({ channel: post.channel, slotAt: at });
  };

  // The owner's own picks first: each has to be one of the free slots we offer.
  const overrides = args.overrides ?? {};
  for (const g of groups) {
    for (const post of [...g.posts]) {
      const picked = overrides[post.id];
      if (picked === undefined) continue;
      const at = new Date(picked);
      const offered = freeSlotsFor(ctxFor(g.endsOn), post.channel, 60);
      if (Number.isNaN(at.getTime()) || !offered.some((d) => d.getTime() === at.getTime())) return queueFail('invalid_slot');
      place(g, post, at);
      g.posts = g.posts.filter((p) => p.id !== post.id);
    }
  }

  for (const g of groups) {
    if (g.posts.length === 0) continue;
    if (args.at === 'now') {
      if (hasEnded(g.endsOn, now, timezone)) {
        for (const p of g.posts) outcome.noSlot.push({ postId: p.id, briefId: g.briefId, channel: p.channel, reason: 'ended' });
        continue;
      }
      for (const p of g.posts) place(g, p, now);
      continue;
    }
    const found = findSlot(ctxFor(g.endsOn), g.posts.map((p) => p.channel));
    if (!found.ok) {
      const reason: NoSlotReason = hasEnded(g.endsOn, now, timezone) ? 'ended' : found.reason;
      for (const p of g.posts) outcome.noSlot.push({ postId: p.id, briefId: g.briefId, channel: p.channel, reason });
      continue;
    }
    for (const p of g.posts) place(g, p, found.slots[p.channel]!);
  }

  if (write) {
    for (const pl of outcome.placed) {
      const [saved] = await tx.query<ItemRow>(
        `insert into public.queue_items as q (brand_id, post_id, channel, slot_at, status, mode)
         values ($1, $2, $3::public.post_channel, $4::timestamptz, 'scheduled', $5)
         on conflict (post_id) do update set slot_at = excluded.slot_at, status = 'scheduled', mode = excluded.mode, attempts = 0,
           last_error = null, platform_post_id = null, permalink = null, done_at = null, updated_at = now()
           where q.status in ('missed', 'failed', 'expired', 'skipped')
         returning ${ITEM_COLUMNS}`,
        [brandId, pl.postId, pl.channel, pl.slotAt, pl.mode],
      );
      if (saved) outcome.items.push(toItem(saved));
    }
  }
  return { ok: true, outcome };
}

/**
 * Puts the approved posts into the next free slots and saves them. Posts that are not approved, or already in the queue,
 * are left alone and listed in `skipped`. A post with no slot before its offer ends is listed in `noSlot`.
 * With `at: 'now'` the posts are queued for right now (the sweep, or `postNowApproved`, then sends them).
 * Returns `{ ok: false, code: 'invalid_slot' }` when an override is not one of the free slots.
 */
export async function scheduleApproved(args: ScheduleArgs): Promise<QueueResult<{ outcome: ScheduleOutcome }>> {
  await requireBrandMember(args.userId, args.brandId);
  return getDb().withService((tx) => plan(tx, args, true));
}

/** The slots `scheduleApproved` would choose, without saving anything (the Schedule step's proposal). */
export async function proposeSlots(args: Omit<ScheduleArgs, 'at'>): Promise<QueueResult<{ outcome: ScheduleOutcome }>> {
  await requireBrandMember(args.userId, args.brandId);
  return getDb().withService((tx) => plan(tx, args, false));
}

// ---------------------------------------------------------------------------------------------
// Free slots for "Pick another time"
// ---------------------------------------------------------------------------------------------

/**
 * The next free slots for a channel. For a post already in the queue, its own slot is not counted as taken,
 * so the owner can also pick the one it has. `n` is capped at 60.
 */
export async function listFreeSlots(args: { userId: string; brandId: string; channel: QueueChannel; endsOn?: string | null; exceptItemId?: string; n?: number; now?: Date }): Promise<string[]> {
  await requireBrandMember(args.userId, args.brandId);
  const now = args.now ?? new Date();
  return getDb().withService(async (tx) => {
    const [timezone, settings] = await Promise.all([brandZone(tx, args.brandId), readQueueSettings(tx, args.brandId)]);
    const occupied = await occupiedSlots(tx, args.brandId, now, args.exceptItemId && UUID_RE.test(args.exceptItemId) ? args.exceptItemId : undefined);
    return freeSlotsFor({ now, timezone, settings, occupied, endsOn: args.endsOn ?? null }, args.channel, Math.min(60, args.n ?? 8)).map((d) => d.toISOString());
  });
}

/** Free slots for a post (queued or not): its channel and its brief's end date come from the database, not from the caller. */
export async function listFreeSlotsForPost(args: { userId: string; brandId: string; postId: string; n?: number; now?: Date }): Promise<string[]> {
  await requireBrandMember(args.userId, args.brandId);
  if (!UUID_RE.test(args.postId)) return [];
  const now = args.now ?? new Date();
  return getDb().withService(async (tx) => {
    const [row] = await tx.query<{ channel: string; ends_on: string | null; item_id: string | null }>(
      `select p.channel::text as channel, b.ends_on::text as ends_on, q.id::text as item_id
         from public.posts p
         left join public.post_briefs b on b.id = p.brief_id and b.brand_id = p.brand_id
         left join public.queue_items q on q.post_id = p.id and q.brand_id = p.brand_id
        where p.id = $1 and p.brand_id = $2 and p.carousel_id is null`,
      [args.postId, args.brandId],
    );
    if (!row || !isChannel(row.channel)) return [];
    const [timezone, settings] = await Promise.all([brandZone(tx, args.brandId), readQueueSettings(tx, args.brandId)]);
    if (hasEnded(row.ends_on, now, timezone)) return [];
    const occupied = await occupiedSlots(tx, args.brandId, now, row.item_id ?? undefined);
    return freeSlotsFor({ now, timezone, settings, occupied, endsOn: row.ends_on }, row.channel, Math.min(60, args.n ?? 8)).map((d) => d.toISOString());
  });
}

// ---------------------------------------------------------------------------------------------
// Owner actions on a queue item
// ---------------------------------------------------------------------------------------------

interface ItemContext extends ItemRow {
  post_status: string;
  ends_on: string | null;
  brief_id: string | null;
}

async function loadItemContext(tx: Tx, brandId: string, itemId: string): Promise<ItemContext | null> {
  if (!UUID_RE.test(itemId)) return null;
  const [row] = await tx.query<ItemContext>(
    `select ${ITEM_COLUMNS}, p.status::text as post_status, p.brief_id::text as brief_id, b.ends_on::text as ends_on
       from public.queue_items q
       join public.posts p on p.id = q.post_id and p.brand_id = q.brand_id
       left join public.post_briefs b on b.id = p.brief_id and b.brand_id = p.brand_id
      where q.id = $1 and q.brand_id = $2 for update of q`,
    [itemId, brandId],
  );
  return row ?? null;
}

type ItemArgs = { userId: string; brandId: string; itemId: string; now?: Date };

/** Moves an item to another free slot (one of those `listFreeSlots` offers for it). */
export async function moveQueueItem(args: ItemArgs & { slotAt: string }): Promise<QueueResult<{ item: QueueItem }>> {
  await requireBrandMember(args.userId, args.brandId);
  const now = args.now ?? new Date();
  return getDb().withService(async (tx): Promise<QueueResult<{ item: QueueItem }>> => {
    await lockBrandQueue(tx, args.brandId);
    const it = await loadItemContext(tx, args.brandId, args.itemId);
    if (!it) return queueFail('not_found');
    if (!ACTIONABLE.includes(it.status) || it.post_status !== 'approved') return queueFail('already_sent');
    const channel = it.channel as QueueChannel;
    const [timezone, settings, providers] = await Promise.all([brandZone(tx, args.brandId), readQueueSettings(tx, args.brandId), activeProviders(tx, args.brandId, now)]);
    if (hasEnded(it.ends_on, now, timezone)) return queueFail('ended');
    const occupied = await occupiedSlots(tx, args.brandId, now, it.id);
    const at = new Date(args.slotAt);
    const offered = freeSlotsFor({ now, timezone, settings, occupied, endsOn: it.ends_on }, channel, 60);
    if (Number.isNaN(at.getTime()) || !offered.some((d) => d.getTime() === at.getTime())) return queueFail('invalid_slot');
    const [saved] = await tx.query<ItemRow>(
      `update public.queue_items q set slot_at = $3::timestamptz, status = 'scheduled', mode = $4, attempts = 0, last_error = null, done_at = null, updated_at = now()
        where q.id = $1 and q.brand_id = $2 and q.status in ('scheduled', 'missed', 'failed') returning ${ITEM_COLUMNS}`,
      [it.id, args.brandId, at.toISOString(), modeFor(channel, providers)],
    );
    return saved ? { ok: true, item: toItem(saved) } : queueFail('busy');
  });
}

/**
 * Sets an item to go out now: its slot becomes the current time and the status goes back to scheduled. The caller
 * (see `postNowQueueItem` in ./post-now.ts) then runs it at once. Refuses when the offer has ended.
 */
export async function markDueNow(args: ItemArgs): Promise<QueueResult<{ item: QueueItem }>> {
  await requireBrandMember(args.userId, args.brandId);
  const now = args.now ?? new Date();
  return getDb().withService(async (tx): Promise<QueueResult<{ item: QueueItem }>> => {
    await lockBrandQueue(tx, args.brandId);
    const it = await loadItemContext(tx, args.brandId, args.itemId);
    if (!it) return queueFail('not_found');
    if (!ACTIONABLE.includes(it.status) || it.post_status !== 'approved') return queueFail('already_sent');
    const channel = it.channel as QueueChannel;
    const [timezone, providers] = await Promise.all([brandZone(tx, args.brandId), activeProviders(tx, args.brandId, now)]);
    if (hasEnded(it.ends_on, now, timezone)) return queueFail('ended');
    const [saved] = await tx.query<ItemRow>(
      `update public.queue_items q set slot_at = $3::timestamptz, status = 'scheduled', mode = $4, attempts = 0, last_error = null, done_at = null, updated_at = now()
        where q.id = $1 and q.brand_id = $2 and q.status in ('scheduled', 'missed', 'failed') returning ${ITEM_COLUMNS}`,
      [it.id, args.brandId, now.toISOString(), modeFor(channel, providers)],
    );
    return saved ? { ok: true, item: toItem(saved) } : queueFail('busy');
  });
}

/** The owner does not want this one: the item is skipped and so is its post (it can be approved again later). */
export async function skipQueueItem(args: ItemArgs): Promise<QueueResult<{ item: QueueItem }>> {
  await requireBrandMember(args.userId, args.brandId);
  const now = args.now ?? new Date();
  return getDb().withService(async (tx): Promise<QueueResult<{ item: QueueItem }>> => {
    await lockBrandQueue(tx, args.brandId);
    const it = await loadItemContext(tx, args.brandId, args.itemId);
    if (!it) return queueFail('not_found');
    if (!['scheduled', 'missed', 'failed', 'expired'].includes(it.status)) return queueFail('already_sent');
    const [saved] = await tx.query<ItemRow>(
      `update public.queue_items q set status = 'skipped', done_at = $3::timestamptz, updated_at = now()
        where q.id = $1 and q.brand_id = $2 and q.status in ('scheduled', 'missed', 'failed', 'expired') returning ${ITEM_COLUMNS}`,
      [it.id, args.brandId, now.toISOString()],
    );
    if (!saved) return queueFail('busy');
    const ids = await postWithSlides(tx, args.brandId, it.post_id);
    await tx.query(`update public.posts set status = 'skipped', skipped_at = $3::timestamptz where brand_id = $1 and id = any($2::uuid[]) and status = 'approved'`, [args.brandId, ids, now.toISOString()]);
    return { ok: true, item: toItem(saved) };
  });
}

/** Takes the post out of the queue: it stays approved and shows under "Ready to schedule". */
export async function unscheduleQueueItem(args: ItemArgs): Promise<QueueResult<{ postId: string }>> {
  await requireBrandMember(args.userId, args.brandId);
  return getDb().withService(async (tx): Promise<QueueResult<{ postId: string }>> => {
    await lockBrandQueue(tx, args.brandId);
    const it = await loadItemContext(tx, args.brandId, args.itemId);
    if (!it) return queueFail('not_found');
    if (!['scheduled', 'missed', 'failed', 'expired'].includes(it.status)) return queueFail('already_sent');
    await tx.query(`delete from public.queue_items where id = $1 and brand_id = $2 and status in ('scheduled', 'missed', 'failed', 'expired')`, [it.id, args.brandId]);
    return { ok: true, postId: it.post_id };
  });
}

/**
 * Removes the queue rows of posts that are no longer approved (the owner undid the approval or changed the post).
 * Called inside the transaction that changes the posts. Items already published or delivered stay as history.
 */
export async function dropQueuedItems(tx: Tx, brandId: string, postIds: string[]): Promise<void> {
  if (postIds.length === 0) return;
  await tx.query(`delete from public.queue_items where brand_id = $1 and post_id = any($2::uuid[]) and status in ('scheduled', 'missed', 'failed', 'expired', 'skipped')`, [brandId, postIds]);
}
