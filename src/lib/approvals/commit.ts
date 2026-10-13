// The one place where a changed post is saved: copy, flags, photo, new images, the action log,
// and the clean-up of the cached email picture. Used by edit, remove-flag, swap-photo and rewrite.

import { getDb, type Tx } from '@/lib/db';
import type { Flag } from '@/lib/guardrail';
import type { PostActionName } from '@/lib/links/handlers';
import type { Storage } from '@/lib/storage';
import type { StoredImage } from '@/lib/weekly/render-post';
import { clearEmailImages, fail, loadPostIn, logAction, saveImages } from './data';
import { s } from '@/lib/i18n/strings';
import type { OpDeps, OpResult, PostRecord, PostRef } from './types';

/** The image text as stored: bubble and pose only when set, so a brand without a mascot keeps the two-field shape. */
function storedImageText(t: PostRecord['imageText']): Record<string, string> {
  const { bubble, pose, ...rest } = t;
  return { ...rest, ...(bubble ? { bubble } : {}), ...(pose ? { pose } : {}) };
}

export interface PostPatch {
  caption?: string;
  cta?: string;
  hashtags?: string[];
  /** Merged into the stored image text, so a patch with only the headline and subline keeps the mascot's bubble and pose. */
  imageText?: { headline: string; subline: string; bubble?: string; pose?: string };
  /** undefined = keep; null = no photo. */
  photoId?: string | null;
  /** undefined = keep; null = mascot off. */
  mascotId?: string | null;
  flags?: Flag[];
}

/**
 * Saves `patch` on the post in one transaction and sets edited_at. A post that was approved goes
 * back to draft: what the owner approved is no longer what the post says, so it needs a new
 * approval (`reapprove` tells the page to say so). A skipped post stays skipped. A posted post
 * cannot be changed.
 */
export async function commitChange(a: {
  ref: PostRef;
  deps: OpDeps;
  storage: Storage;
  patch: PostPatch;
  /** New images, when the picture changed. */
  images?: StoredImage[];
  action: PostActionName;
  detail?: Record<string, unknown>;
  /** More writes in the same transaction (the voice feedback of a rewrite). */
  also?: (tx: Tx) => Promise<void>;
}): Promise<OpResult<{ reapprove: boolean }>> {
  const { ref, patch } = a;
  const now = (a.deps.now ?? new Date()).toISOString();
  const result = await getDb().withService(async (tx): Promise<OpResult<{ reapprove: boolean }>> => {
    const cur = await loadPostIn(tx, ref.brandId, ref.postId, true);
    if (!cur) return fail('not_found', s.approvals.errors.notFound);
    if (cur.status === 'posted') return fail('posted', s.approvals.errors.posted);
    const wasApproved = cur.status === 'approved';
    const next: PostRecord = {
      ...cur,
      caption: patch.caption ?? cur.caption,
      cta: patch.cta ?? cur.cta,
      hashtags: patch.hashtags ?? cur.hashtags,
      imageText: patch.imageText ? { ...cur.imageText, ...patch.imageText } : cur.imageText,
      mascotId: patch.mascotId === undefined ? cur.mascotId : patch.mascotId,
      photoId: patch.photoId === undefined ? cur.photoId : patch.photoId,
      flags: patch.flags ?? cur.flags,
      editedAt: now,
      status: wasApproved ? 'draft' : cur.status,
      approvedAt: wasApproved ? null : cur.approvedAt,
    };
    await tx.query(
      `update public.posts
          set caption = $3, cta = $4, hashtags = $5::text[], image_text = $6::jsonb, photo_id = $7::uuid,
              fact_flags = $8::jsonb, edited_at = $9::timestamptz, mascot_id = $10::uuid,
              status = case when status = 'approved' then 'draft'::public.post_status else status end,
              approved_at = case when status = 'approved' then null else approved_at end
        where id = $1 and brand_id = $2`,
      [
        ref.postId, ref.brandId, next.caption, next.cta, next.hashtags, JSON.stringify(storedImageText(next.imageText)), next.photoId,
        JSON.stringify(next.flags), now, next.mascotId,
      ],
    );
    if (a.images) await saveImages(tx, next, a.images);
    await a.also?.(tx);
    await logAction(tx, ref.actor, ref.brandId, ref.postId, a.action, a.detail ?? {});
    return { ok: true, post: next, reapprove: wasApproved };
  });
  if (result.ok) await clearEmailImages(a.storage, ref.brandId, ref.postId);
  return result;
}
