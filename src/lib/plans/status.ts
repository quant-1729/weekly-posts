// What the automation stage shows for each day of a plan, worked out from the stored state only (the post, its open flags
// and its queue row), so it is the same after a reload as right after pressing the button. Pure: safe in the browser.

import type { Flag } from '@/lib/guardrail';

export interface PlanPostStatus {
  id: string;
  channel: string;
  /** The queue row's status when there is one, else the post's. */
  status: string;
  /** The post's own status (draft, approved, ...). */
  postStatus: string;
  /** The queue row's status, or null while the post is not in the queue. */
  queueStatus: string | null;
  image: string | null;
  caption: string;
  flags: number;
  openFlags: Flag[];
  /** Nothing left that stops the server approving it (no open flag, no design problem, drawn). */
  canApprove: boolean;
  slot: string | null;
  mode: string | null;
  slotLabel: string | null;
}

export interface DayLike {
  date: string;
  label: string;
  posts: PlanPostStatus[];
}

export type DayState = 'not_drawn' | 'needs_look' | 'ready' | 'approved' | 'scheduled' | 'published' | 'attention' | 'skipped';

const LIVE = ['scheduled', 'publishing', 'published', 'delivered'];
const DONE = ['published', 'delivered'];
const LOST = ['missed', 'failed', 'expired'];

export function dayStateOf(posts: PlanPostStatus[]): DayState {
  if (posts.length === 0) return 'not_drawn';
  const q = posts.map((p) => p.queueStatus);
  if (q.every((s) => s !== null && DONE.includes(s))) return 'published';
  if (q.every((s) => s !== null && LIVE.includes(s))) return 'scheduled';
  if (q.some((s) => s !== null && LOST.includes(s))) return 'attention';
  if (posts.some((p) => p.openFlags.length > 0)) return 'needs_look';
  if (q.some((s) => s === 'skipped')) return 'skipped';
  if (posts.some((p) => !p.image)) return 'not_drawn';
  if (posts.every((p) => p.postStatus === 'approved')) return 'approved';
  // A design problem (not a flagged line) also needs the owner's look.
  if (posts.some((p) => !p.canApprove)) return 'needs_look';
  return 'ready';
}

export const willPublish = (channel: string, live: ReadonlySet<string>): boolean => (channel === 'instagram' || channel === 'facebook') && live.has(channel);

export type Tone = 'neutral' | 'ok' | 'warn' | 'err' | 'info' | 'coral';

/** The always-visible badge of a day. */
export function dayBadge(day: DayLike): { state: DayState; tone: Tone; label: string } {
  const state = dayStateOf(day.posts);
  const first = day.posts[0];
  switch (state) {
    case 'needs_look':
      return { state, tone: 'warn', label: 'Needs a look' };
    case 'scheduled':
      return { state, tone: 'ok', label: first?.slotLabel ? `Scheduled · ${first.slotLabel}` : 'Scheduled' };
    case 'published':
      return { state, tone: 'ok', label: day.posts.every((p) => p.mode === 'deliver') ? 'Delivered' : 'Published' };
    case 'approved':
      return { state, tone: 'info', label: 'Approved' };
    case 'attention':
      return { state, tone: 'err', label: 'Did not go out' };
    case 'skipped':
      return { state, tone: 'neutral', label: 'Skipped' };
    case 'not_drawn':
      return { state, tone: 'neutral', label: 'Not drawn yet' };
    default:
      return { state, tone: 'neutral', label: 'Ready' };
  }
}

/** One line per post: where it goes and how ("Will be emailed to you", "Will post to Instagram", "Tue 20 Oct, 09:00 · Instagram (...)"). */
export function postLine(p: PlanPostStatus, name: string, live: ReadonlySet<string>): string {
  const how = p.mode ? p.mode === 'publish' : willPublish(p.channel, live);
  if (p.queueStatus && DONE.includes(p.queueStatus)) return how ? `Published to ${name}` : `Delivered to you for ${name}`;
  if (p.queueStatus && LIVE.includes(p.queueStatus)) return `${p.slotLabel ? `${p.slotLabel} · ` : ''}${name} (${how ? 'will post for you' : 'emailed to you'})`;
  if (p.queueStatus && LOST.includes(p.queueStatus)) return `${name}: did not go out`;
  return how ? `Will post to ${name}` : `Will be emailed to you (${name})`;
}

export interface PlanSummary {
  total: number;
  /** Days with nothing left to check that are not in the queue yet. */
  ready: number;
  readyPosts: number;
  needsLook: number;
  scheduled: number;
  scheduledPosts: number;
  attention: number;
  notDrawn: number;
}

export function summarize(days: DayLike[]): PlanSummary {
  const s: PlanSummary = { total: days.length, ready: 0, readyPosts: 0, needsLook: 0, scheduled: 0, scheduledPosts: 0, attention: 0, notDrawn: 0 };
  for (const d of days) {
    const st = dayStateOf(d.posts);
    if (st === 'ready' || st === 'approved') {
      s.ready++;
      s.readyPosts += d.posts.length;
    } else if (st === 'needs_look') s.needsLook++;
    else if (st === 'scheduled' || st === 'published') {
      s.scheduled++;
      s.scheduledPosts += d.posts.length;
    } else if (st === 'attention') s.attention++;
    else if (st === 'not_drawn') s.notDrawn++;
  }
  return s;
}

/** The label of the approve button, and why it is off when it is. */
export function approveButton(sum: PlanSummary): { label: string; disabled: boolean; reason: string | null } {
  if (sum.ready === 0) {
    const reason =
      sum.needsLook > 0
        ? 'Every day left still needs a look. Open a day below and confirm or remove what is flagged.'
        : sum.notDrawn > 0
          ? 'The posts are not drawn yet. Open the studio and press “Use for all days”.'
          : sum.attention > 0
            ? 'Some posts did not go out. Open the queue to move or retry them.'
            : 'Nothing is waiting to be scheduled.';
    return { label: 'Approve and schedule the week', disabled: true, reason };
  }
  const partial = sum.ready < sum.total;
  return { label: partial ? `Approve and schedule ${sum.ready} ready day${sum.ready === 1 ? '' : 's'}` : 'Approve and schedule the week', disabled: false, reason: null };
}

/** True when every day is in the queue (or done): the page shows "Your week is scheduled" and no button. */
export const allScheduled = (sum: PlanSummary): boolean => sum.total > 0 && sum.scheduled === sum.total;
