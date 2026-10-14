// The Schedule step of /create (PRD v3 §4): after approval it shows the slot proposed for each channel, with
// Confirm, "Post now" and "Pick another time". Nothing is saved until the owner confirms.

import { requireBrandMember } from '@/lib/brand/current';
import { listBriefPosts } from '@/lib/create';
import { getDb } from '@/lib/db';
import { s } from '@/lib/i18n/strings';
import { channelLabel } from './deliver';
import { formatSlot } from './format';
import { brandZone, toItem, ITEM_COLUMNS, type ItemRow } from './data';
import { proposeSlots } from './service';
import { QUEUE_CHANNELS, type QueueChannel } from './types';
import type { ScheduleLine, ScheduleStep } from './view';

export async function loadScheduleStep(userId: string, brandId: string, briefId: string, now: Date = new Date()): Promise<ScheduleStep> {
  await requireBrandMember(userId, brandId);
  const posts = (await listBriefPosts(userId, brandId, briefId)).filter((p) => p.carouselId === null && (QUEUE_CHANNELS as readonly string[]).includes(p.channel));
  const [timezone, items, briefRow] = await Promise.all([
    getDb().withService((tx) => brandZone(tx, brandId)),
    posts.length
      ? getDb().withUser(userId, (tx) =>
          tx.query<ItemRow>(`select ${ITEM_COLUMNS} from public.queue_items q where q.brand_id = $1 and q.post_id = any($2::uuid[])`, [brandId, posts.map((p) => p.id)]),
        )
      : Promise.resolve([] as ItemRow[]),
    getDb().withUser(userId, (tx) => tx.query<{ ends_on: string | null }>('select ends_on::text as ends_on from public.post_briefs where id = $1 and brand_id = $2', [briefId, brandId])),
  ]);
  const byPost = new Map(items.map((r) => [r.post_id, toItem(r)]));

  // What the queue would do with the approved posts that are not queued yet.
  const waiting = posts.filter((p) => p.status === 'approved' && !byPost.has(p.id));
  const proposal = waiting.length > 0 ? await proposeSlots({ userId, brandId, postIds: waiting.map((p) => p.id), now }) : null;
  const outcome = proposal && proposal.ok ? proposal.outcome : null;

  const lines: ScheduleLine[] = posts.map((p): ScheduleLine => {
    const channel = p.channel as QueueChannel;
    const queued = byPost.get(p.id) ?? null;
    const placed = outcome?.placed.find((x) => x.postId === p.id) ?? null;
    const none = outcome?.noSlot.find((x) => x.postId === p.id) ?? null;
    const mode = queued?.mode ?? placed?.mode ?? 'deliver';
    return {
      postId: p.id,
      channel,
      channelLabel: channelLabel(channel),
      proposedAt: placed?.slotAt ?? null,
      proposedWhen: placed ? formatSlot(placed.slotAt, timezone) : null,
      mode,
      modeLine: s.queue.modeLine[mode],
      queued: queued ? { itemId: queued.id, status: queued.status, slotAt: queued.slotAt, when: formatSlot(queued.slotAt, timezone) } : null,
      noSlot: none?.reason ?? null,
      approved: p.status === 'approved' || p.status === 'posted',
    };
  });
  return { timezone, endsOn: briefRow[0]?.ends_on ?? null, lines };
}

/** The brand's time zone, read as the signed-in user. */
export async function loadBrandTimezone(userId: string, brandId: string): Promise<string> {
  await requireBrandMember(userId, brandId);
  const [row] = await getDb().withUser(userId, (tx) => tx.query<{ timezone: string | null }>('select timezone from public.brand_memory where brand_id = $1', [brandId]));
  const zone = row?.timezone || 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return zone;
  } catch {
    return 'UTC';
  }
}
