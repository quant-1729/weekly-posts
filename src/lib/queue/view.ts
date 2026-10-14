// What the Queue page and the Schedule step show, as plain data (safe to send to client components).
// Reads run as the signed-in user (row-level security).

import { requireBrandMember } from '@/lib/brand/current';
import { channelFormats } from '@/lib/create/content';
import { getDb } from '@/lib/db';
import { s } from '@/lib/i18n/strings';
import { channelLabel } from './deliver';
import { formatSlot, formatSlotDay, slotParts } from './format';
import { getQueueSettings } from './settings';
import { hasEnded } from './slots';
import { ITEM_COLUMNS, toItem, type ItemRow } from './data';
import { PROVIDERS, PUBLISH_PROVIDER, QUEUE_CHANNELS, type Provider, type QueueChannel, type QueueMode, type QueueSettings, type QueueStatus } from './types';

export interface QueueCard {
  id: string;
  postId: string;
  briefId: string | null;
  channel: QueueChannel;
  channelLabel: string;
  status: QueueStatus;
  mode: QueueMode;
  modeLabel: string;
  statusLabel: string;
  slotAt: string;
  /** Local date "YYYY-MM-DD" and time "HH:MM" in the brand's zone. */
  date: string;
  time: string;
  when: string;
  headline: string;
  imageUrl: string | null;
  lastError: string | null;
  permalink: string | null;
  endsOn: string | null;
  /** The owner can move, post now, skip or take it out. */
  actionable: boolean;
  /** Why it needs attention (missed, failed, expired), in words. */
  reason: string | null;
  reviewHref: string | null;
}

export interface ReadyCard {
  postId: string;
  briefId: string;
  channel: QueueChannel;
  channelLabel: string;
  headline: string;
  imageUrl: string | null;
  endsOn: string | null;
  ended: boolean;
}

export interface QueueDay {
  date: string;
  label: string;
  items: QueueCard[];
}

export interface QueueView {
  timezone: string;
  /** The page's clock (ISO), so the client does not guess. */
  nowIso: string;
  settings: QueueSettings;
  /** Which publishing providers have a working connection. */
  connected: Record<Provider, boolean>;
  upcoming: QueueDay[];
  attention: QueueCard[];
  recent: QueueCard[];
  ready: ReadyCard[];
  /** Channels shown in the settings (time and auto-approve per channel). */
  channels: { channel: QueueChannel; label: string; provider: Provider | null; connected: boolean }[];
}

interface Row extends ItemRow {
  brief_id: string | null;
  headline: string | null;
  ends_on: string | null;
}

async function imageMap(userId: string, brandId: string, postIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (postIds.length === 0) return out;
  const rows = await getDb().withUser(userId, (tx) =>
    tx.query<{ post_id: string; channel: string; format: string; image_path: string; v: string | number }>(
      `select i.post_id::text as post_id, p.channel::text as channel, i.format::text as format, i.image_path,
              floor(extract(epoch from i.updated_at) * 1000)::text as v
         from public.post_images i join public.posts p on p.id = i.post_id and p.brand_id = i.brand_id
        where i.brand_id = $1 and i.post_id = any($2::uuid[])`,
      [brandId, postIds],
    ),
  );
  for (const id of postIds) {
    const mine = rows.filter((r) => r.post_id === id);
    if (mine.length === 0) continue;
    const order = channelFormats(mine[0].channel);
    const best = order.map((f) => mine.find((r) => r.format === f)).find(Boolean) ?? mine[0];
    out.set(id, `/api/files/${best.image_path}?v=${best.v}`);
  }
  return out;
}

/** Everything the Queue page shows for the brand. */
export async function loadQueueView(userId: string, brandId: string, now: Date = new Date()): Promise<QueueView> {
  await requireBrandMember(userId, brandId);
  const t = s.queue;
  const db = getDb();
  const [settings, zoneRow, items, readyRows, conns] = await Promise.all([
    getQueueSettings(userId, brandId),
    db.withUser(userId, (tx) => tx.query<{ timezone: string | null }>('select timezone from public.brand_memory where brand_id = $1', [brandId])),
    db.withUser(userId, (tx) =>
      tx.query<Row>(
        `select ${ITEM_COLUMNS}, p.brief_id::text as brief_id, p.image_text ->> 'headline' as headline, b.ends_on::text as ends_on
           from public.queue_items q
           join public.posts p on p.id = q.post_id and p.brand_id = q.brand_id
           left join public.post_briefs b on b.id = p.brief_id and b.brand_id = p.brand_id
          where q.brand_id = $1
            and (q.status in ('scheduled', 'publishing', 'missed', 'failed', 'expired')
                 or (q.status in ('published', 'delivered') and q.done_at >= $2::timestamptz - interval '14 days'))
          order by q.slot_at, q.id`,
        [brandId, now.toISOString()],
      ),
    ),
    db.withUser(userId, (tx) =>
      tx.query<{ id: string; brief_id: string; channel: string; headline: string | null; ends_on: string | null }>(
        `select p.id::text as id, p.brief_id::text as brief_id, p.channel::text as channel, p.image_text ->> 'headline' as headline, b.ends_on::text as ends_on
           from public.posts p
           join public.post_briefs b on b.id = p.brief_id and b.brand_id = p.brand_id
           left join public.queue_items q on q.post_id = p.id and q.brand_id = p.brand_id
          where p.brand_id = $1 and p.carousel_id is null and p.status = 'approved' and q.id is null
          order by p.approved_at nulls last, p.created_at limit 30`,
        [brandId],
      ),
    ),
    db.withUser(userId, (tx) =>
      tx.query<{ provider: Provider }>(`select provider from public.channel_connections where brand_id = $1 and status = 'active' and (expires_at is null or expires_at > $2::timestamptz)`, [brandId, now.toISOString()]),
    ),
  ]);
  const timezone = zoneRow[0]?.timezone || 'UTC';
  const connected = Object.fromEntries(PROVIDERS.map((p) => [p, conns.some((c) => c.provider === p)])) as Record<Provider, boolean>;
  const images = await imageMap(userId, brandId, [...items.map((i) => i.post_id), ...readyRows.map((r) => r.id)]);

  const card = (r: Row): QueueCard => {
    const item = toItem(r);
    const parts = slotParts(item.slotAt, timezone);
    const reason = item.status === 'missed' || item.status === 'failed' || item.status === 'expired' ? t.attention.reasons[item.status] : null;
    return {
      id: item.id,
      postId: item.postId,
      briefId: r.brief_id,
      channel: item.channel,
      channelLabel: channelLabel(item.channel),
      status: item.status,
      mode: item.mode,
      modeLabel: t.modes[item.mode],
      statusLabel: t.statuses[item.status],
      slotAt: item.slotAt,
      date: parts.date,
      time: parts.time,
      when: formatSlot(item.slotAt, timezone),
      headline: r.headline ?? '',
      imageUrl: images.get(item.postId) ?? null,
      lastError: item.lastError,
      permalink: item.permalink,
      endsOn: r.ends_on,
      actionable: ['scheduled', 'missed', 'failed'].includes(item.status),
      reason,
      reviewHref: r.brief_id ? `/create/${r.brief_id}/review` : null,
    };
  };

  const cards = items.map(card);
  const upcoming = new Map<string, QueueDay>();
  for (const c of cards.filter((x) => x.status === 'scheduled' || x.status === 'publishing')) {
    const day = upcoming.get(c.date) ?? { date: c.date, label: formatSlotDay(c.slotAt, timezone), items: [] };
    day.items.push(c);
    upcoming.set(c.date, day);
  }
  const done = cards.filter((c) => c.status === 'published' || c.status === 'delivered').sort((a, b) => b.slotAt.localeCompare(a.slotAt)).slice(0, 8);
  return {
    timezone,
    nowIso: now.toISOString(),
    settings,
    connected,
    upcoming: [...upcoming.values()].sort((a, b) => a.date.localeCompare(b.date)),
    attention: cards.filter((c) => c.status === 'missed' || c.status === 'failed' || c.status === 'expired'),
    recent: done,
    ready: readyRows
      .filter((r) => (QUEUE_CHANNELS as readonly string[]).includes(r.channel))
      .map((r) => ({
        postId: r.id,
        briefId: r.brief_id,
        channel: r.channel as QueueChannel,
        channelLabel: channelLabel(r.channel),
        headline: r.headline ?? '',
        imageUrl: images.get(r.id) ?? null,
        endsOn: r.ends_on,
        ended: hasEnded(r.ends_on, now, timezone),
      })),
    channels: QUEUE_CHANNELS.map((channel) => {
      const provider = PUBLISH_PROVIDER[channel] ?? null;
      return { channel, label: channelLabel(channel), provider, connected: provider ? connected[provider] : false };
    }),
  };
}

// ---------------------------------------------------------------------------------------------
// The Schedule step of /create
// ---------------------------------------------------------------------------------------------

export interface ScheduleLine {
  postId: string;
  channel: QueueChannel;
  channelLabel: string;
  /** Approved but not in the queue: the slot we would use (null when there is none). */
  proposedAt: string | null;
  proposedWhen: string | null;
  mode: QueueMode;
  modeLine: string;
  /** Already in the queue or sent. */
  queued: { itemId: string; status: QueueStatus; slotAt: string; when: string } | null;
  /** Why there is no slot. */
  noSlot: 'ends_before_slot' | 'no_slot' | 'ended' | null;
  /** The posts is still a draft or flagged. */
  approved: boolean;
}

export interface ScheduleStep {
  timezone: string;
  endsOn: string | null;
  lines: ScheduleLine[];
}
