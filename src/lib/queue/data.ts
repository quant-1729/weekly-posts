// Shared database helpers of the queue: row mapping, the brand's time zone, connections and what already
// holds a slot. Reads and writes here run in a transaction the caller opened (service role, after the caller
// has checked brand membership or the sweep's own rules).

import type { Tx } from '@/lib/db';
import { PUBLISH_PROVIDER, type Provider, type QueueChannel, type QueueItem, type QueueMode, type QueueStatus } from './types';
import type { Occupied } from './slots';

export interface ItemRow {
  id: string;
  brand_id: string;
  post_id: string;
  channel: string;
  slot_at: Date | string;
  status: string;
  mode: string;
  attempts: number;
  last_error: string | null;
  platform_post_id: string | null;
  permalink: string | null;
  done_at: Date | string | null;
}

export const ITEM_COLUMNS = `q.id::text as id, q.brand_id::text as brand_id, q.post_id::text as post_id, q.channel::text as channel, q.slot_at, q.status,
  q.mode, q.attempts::int as attempts, q.last_error, q.platform_post_id, q.permalink, q.done_at`;

const iso = (v: Date | string): string => (v instanceof Date ? v : new Date(v)).toISOString();

export function toItem(r: ItemRow): QueueItem {
  return {
    id: r.id,
    brandId: r.brand_id,
    postId: r.post_id,
    channel: r.channel as QueueChannel,
    slotAt: iso(r.slot_at),
    status: r.status as QueueStatus,
    mode: r.mode as QueueMode,
    attempts: r.attempts,
    lastError: r.last_error,
    platformPostId: r.platform_post_id,
    permalink: r.permalink,
    doneAt: r.done_at ? iso(r.done_at) : null,
  };
}

/** The brand's time zone (UTC when it has none or the name is unknown). */
export async function brandZone(tx: Tx, brandId: string): Promise<string> {
  const [row] = await tx.query<{ timezone: string | null }>('select timezone from public.brand_memory where brand_id = $1', [brandId]);
  const zone = row?.timezone || 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return zone;
  } catch {
    return 'UTC';
  }
}

/** Providers with a working connection right now (active, and not past the token's expiry). */
export async function activeProviders(tx: Tx, brandId: string, now: Date): Promise<Set<Provider>> {
  const rows = await tx.query<{ provider: Provider }>(
    `select provider from public.channel_connections where brand_id = $1 and status = 'active' and (expires_at is null or expires_at > $2::timestamptz)`,
    [brandId, now.toISOString()],
  );
  return new Set(rows.map((r) => r.provider));
}

/** Auto-publish when the channel has a provider and a working connection; otherwise deliver to the owner. */
export function modeFor(channel: QueueChannel, providers: Set<Provider>): QueueMode {
  const provider = PUBLISH_PROVIDER[channel];
  return provider && providers.has(provider) ? 'publish' : 'deliver';
}

/** Items that hold a slot: everything except skipped and expired ones (and the one being moved). */
export async function occupiedSlots(tx: Tx, brandId: string, now: Date, exceptItemId?: string): Promise<Occupied[]> {
  const rows = await tx.query<{ channel: string; slot_at: Date | string }>(
    `select channel::text as channel, slot_at from public.queue_items
      where brand_id = $1 and status not in ('skipped', 'expired') and slot_at >= $2::timestamptz - interval '15 days'
        and ($3::uuid is null or id <> $3::uuid)`,
    [brandId, now.toISOString(), exceptItemId ?? null],
  );
  return rows.map((r) => ({ channel: r.channel as QueueChannel, slotAt: new Date(r.slot_at) }));
}

/** One queue write at a time per brand: two taps (or a tap and the sweep) never choose the same slot. */
export async function lockBrandQueue(tx: Tx, brandId: string): Promise<void> {
  await tx.query('select pg_advisory_xact_lock(hashtext($1))', [`queue:${brandId}`]);
}

/** The ids of a post and, for a carousel, its slides (they follow the first slide's post). */
export async function postWithSlides(tx: Tx, brandId: string, postId: string): Promise<string[]> {
  const rows = await tx.query<{ id: string }>(
    `select id::text as id from public.posts
      where brand_id = $2 and (id = $1 or carousel_id = (select (design -> 'carousel' ->> 'id')::uuid from public.posts where id = $1 and brand_id = $2))`,
    [postId, brandId],
  );
  return rows.map((r) => r.id);
}
