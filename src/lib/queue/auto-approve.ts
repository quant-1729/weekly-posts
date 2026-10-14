// Auto-approve (PRD v3 S-4; change C-28): when a channel has "Auto-approve posts with no flags" on, a post of a
// brief with nothing left to check is approved and queued by itself. Off by default, per channel. A post with
// any open flag, or a picture problem, always waits for the owner.

import { approvalCheck, approveCreatePost, listBriefPosts } from '@/lib/create';
import { requireBrandMember } from '@/lib/brand/current';
import { scheduleApproved, type ScheduleOutcome } from './service';
import { getQueueSettings } from './settings';
import { QUEUE_CHANNELS, type QueueChannel } from './types';

export interface AutoApproveResult {
  /** Post ids approved by themselves. */
  approved: string[];
  /** Posts left for the owner, and why. */
  waiting: { postId: string; channel: string; reason: 'off' | 'flags' | 'design' | 'blocked' }[];
  /** What the queue did with the approved posts (null when nothing was approved). */
  scheduled: ScheduleOutcome | null;
}

/**
 * Call after a design was chosen for the brief. Approves each draft post whose channel has auto-approve on and
 * that passes the same check as the Approve button (`approveCreatePost`: no open flag, pictures drawn, no
 * overflow, QR reads back), then queues the approved posts in the next free slots.
 */
export async function autoApproveBrief(args: { userId: string; brandId: string; briefId: string; now?: Date }): Promise<AutoApproveResult> {
  const { userId, brandId, briefId } = args;
  await requireBrandMember(userId, brandId);
  const settings = await getQueueSettings(userId, brandId);
  const posts = await listBriefPosts(userId, brandId, briefId);
  const out: AutoApproveResult = { approved: [], waiting: [], scheduled: null };
  for (const post of posts) {
    if (post.carouselId !== null || post.status !== 'draft') continue;
    const channel = post.channel as QueueChannel;
    if (!(QUEUE_CHANNELS as readonly string[]).includes(channel) || settings.autoApprove[channel] !== true) {
      out.waiting.push({ postId: post.id, channel: post.channel, reason: 'off' });
      continue;
    }
    const check = approvalCheck(post);
    if (!check.ok) {
      out.waiting.push({ postId: post.id, channel: post.channel, reason: check.noDesign ? 'design' : check.flags.length > 0 ? 'flags' : 'blocked' });
      continue;
    }
    const r = await approveCreatePost({ userId, brandId, postId: post.id, now: args.now });
    if (r.ok) out.approved.push(post.id);
    else out.waiting.push({ postId: post.id, channel: post.channel, reason: r.code === 'blocked' ? 'flags' : 'blocked' });
  }
  if (out.approved.length > 0) {
    const r = await scheduleApproved({ userId, brandId, postIds: out.approved, now: args.now });
    if (r.ok) out.scheduled = r.outcome;
  }
  return out;
}
