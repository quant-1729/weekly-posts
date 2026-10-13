// Posting operations (Req 17, 18): mark an approved post as posted, take it back within a day,
// and log that the owner shared or downloaded it.
//
// Same actors as the other approval operations: an email link (checked by the dispatcher, logged
// with the jti hash) or a signed-in dashboard user (membership checked here). A post that is not
// approved (a draft, or skipped) can be neither shared, downloaded nor marked posted.

import { getDb } from '@/lib/db';
import { s } from '@/lib/i18n/strings';
import { UNMARK_WINDOW_MS, isShareFormat } from '@/lib/share/formats';

export { UNMARK_WINDOW_MS };
import { checkActor, fail, loadPostIn, logAction } from './data';
import type { OpDeps, OpResult, PostRef } from './types';

const e = s.share.errors;

const notApproved = () => fail('not_approved', e.notApproved);

/** Approved becomes posted and `posted_at` is set. Already posted is a quiet no-op. */
export async function markPosted(ref: PostRef, deps: OpDeps = {}): Promise<OpResult<{ changed: boolean }>> {
  const denied = await checkActor(ref.actor, ref.brandId);
  if (denied) return denied;
  const now = (deps.now ?? new Date()).toISOString();
  return getDb().withService(async (tx): Promise<OpResult<{ changed: boolean }>> => {
    const post = await loadPostIn(tx, ref.brandId, ref.postId, true);
    if (!post) return fail('not_found', s.approvals.errors.notFound);
    if (post.status === 'posted') return { ok: true, post, changed: false };
    if (post.status !== 'approved') return notApproved();
    await tx.query(
      `update public.posts set status = 'posted', posted_at = $3::timestamptz where id = $1 and brand_id = $2`,
      [ref.postId, ref.brandId, now],
    );
    await logAction(tx, ref.actor, ref.brandId, ref.postId, 'posted');
    return { ok: true, post: { ...post, status: 'posted', postedAt: now }, changed: true };
  });
}

/** Posted goes back to approved, but only within 24 hours of being marked. Already approved is a quiet no-op. */
export async function unmarkPosted(ref: PostRef, deps: OpDeps = {}): Promise<OpResult<{ changed: boolean }>> {
  const denied = await checkActor(ref.actor, ref.brandId);
  if (denied) return denied;
  const now = deps.now ?? new Date();
  return getDb().withService(async (tx): Promise<OpResult<{ changed: boolean }>> => {
    const post = await loadPostIn(tx, ref.brandId, ref.postId, true);
    if (!post) return fail('not_found', s.approvals.errors.notFound);
    if (post.status === 'approved') return { ok: true, post, changed: false };
    if (post.status !== 'posted') return notApproved();
    const postedAt = post.postedAt ? new Date(post.postedAt).getTime() : 0;
    if (now.getTime() - postedAt > UNMARK_WINDOW_MS) return fail('too_late', e.tooLate);
    await tx.query(`update public.posts set status = 'approved', posted_at = null where id = $1 and brand_id = $2`, [ref.postId, ref.brandId]);
    await logAction(tx, ref.actor, ref.brandId, ref.postId, 'undo', { from: 'posted' });
    return { ok: true, post: { ...post, status: 'approved', postedAt: null }, changed: true };
  });
}

async function logShareLike(ref: PostRef & { format?: string }, action: 'share' | 'download', detail: Record<string, unknown>): Promise<OpResult<object>> {
  const denied = await checkActor(ref.actor, ref.brandId);
  if (denied) return denied;
  return getDb().withService(async (tx): Promise<OpResult<object>> => {
    const post = await loadPostIn(tx, ref.brandId, ref.postId);
    if (!post) return fail('not_found', s.approvals.errors.notFound);
    // A post that is already posted may be shared again (another app); a draft or skipped one may not.
    if (post.status !== 'approved' && post.status !== 'posted') return notApproved();
    const format = isShareFormat(ref.format) ? ref.format : undefined;
    await logAction(tx, ref.actor, ref.brandId, ref.postId, action, { ...detail, ...(format ? { format } : {}) });
    return { ok: true, post };
  });
}

/** The owner shared the post (the share sheet opened). `story` marks the vertical "story or status" share. */
export function logShare(ref: PostRef & { format?: string; story?: boolean }): Promise<OpResult<object>> {
  return logShareLike(ref, 'share', ref.story ? { story: true } : {});
}

/** The owner downloaded the post's image. */
export function logDownload(ref: PostRef & { format?: string }): Promise<OpResult<object>> {
  return logShareLike(ref, 'download', {});
}
