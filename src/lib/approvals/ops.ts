// Approval operations (Req 11, 12, 14, 15): approve, skip, undo, confirm or remove a flag, edit,
// swap the photo, and (rewrite.ts) rewrite with an instruction.
//
// The email-link pages (no login) and the dashboard (signed in) call exactly these, so they behave
// the same. Writes use the service role AFTER the caller has verified the link token (the
// dispatcher) or the user's membership (checked here for the dashboard actor). Every operation
// writes a post_actions row with the right via, user_id and jti hash.
//
// A post that was approved and is then changed (edit, photo, rewrite, removing a flag) goes back
// to draft: the owner approves the new version. A posted post can no longer be changed.

import { V2_CHANNEL_SPECS, V2_IMAGE_TEXT_LIMITS } from '@/lib/ai/prompts/v2-weekly';
import { BUBBLE_MAX_CHARS, loadUsableMascot } from '@/lib/mascot/posts';
import { postPoseOrDefault, TWEEN_POST_POSES } from '@/lib/mascot/poses';
import { getDb } from '@/lib/db';
import {
  GuardrailActionError,
  confirmFlag as confirmFlagText,
  hasBlockingFlags,
  loadGuardrailContext,
  removeFlagText,
  resolveRemovedSpans,
  type Flag,
} from '@/lib/guardrail';
import { avoidIssues } from '@/lib/guardrail/deterministic';
import { fill, s } from '@/lib/i18n/strings';
import { visibleChars } from '@/lib/weekly/normalize';
import { loadPhotoFile } from '@/lib/weekly/render-post';
import { commitChange } from './commit';
import { begin, checkActor, fail, loadPostIn, logAction, renderPost, storageOf } from './data';
import { cleanText } from './parse';
import type { OpDeps, OpFail, OpResult, PostRef } from './types';

export { logDownload, logShare, markPosted, unmarkPosted, UNMARK_WINDOW_MS } from './posting';
export { rewritePost } from './rewrite';
export type { RewriteDeps, RewriteOk } from './rewrite';

const e = s.approvals.errors;
const MAX_CTA_CHARS = 45;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Open flags that stop approval (the regulated reminder never does). */
export const blockingFlags = (flags: Flag[]): Flag[] => flags.filter((f) => f.status === 'open' && f.kind !== 'regulated_reminder');

// ---------------------------------------------------------------------------
// approve, skip, undo
// ---------------------------------------------------------------------------

export async function approvePost(ref: PostRef, deps: OpDeps = {}): Promise<OpResult<{ changed: boolean }>> {
  const denied = await checkActor(ref.actor, ref.brandId);
  if (denied) return denied;
  const now = (deps.now ?? new Date()).toISOString();
  return getDb().withService(async (tx): Promise<OpResult<{ changed: boolean }>> => {
    const post = await loadPostIn(tx, ref.brandId, ref.postId, true);
    if (!post) return fail('not_found', e.notFound);
    if (post.status === 'posted') return fail('posted', e.posted);
    if (post.status === 'approved') return { ok: true, post, changed: false };
    const open = blockingFlags(post.flags);
    if (hasBlockingFlags(post.flags)) return fail('blocked', e.blocked, { flags: open });
    await tx.query(
      `update public.posts set status = 'approved', approved_at = $3::timestamptz, skipped_at = null where id = $1 and brand_id = $2`,
      [ref.postId, ref.brandId, now],
    );
    await logAction(tx, ref.actor, ref.brandId, ref.postId, 'approve');
    return { ok: true, post: { ...post, status: 'approved', approvedAt: now, skippedAt: null }, changed: true };
  });
}

export async function skipPost(ref: PostRef, deps: OpDeps = {}): Promise<OpResult<{ changed: boolean }>> {
  const denied = await checkActor(ref.actor, ref.brandId);
  if (denied) return denied;
  const now = (deps.now ?? new Date()).toISOString();
  return getDb().withService(async (tx): Promise<OpResult<{ changed: boolean }>> => {
    const post = await loadPostIn(tx, ref.brandId, ref.postId, true);
    if (!post) return fail('not_found', e.notFound);
    if (post.status === 'posted') return fail('posted', e.posted);
    if (post.status === 'skipped') return { ok: true, post, changed: false };
    await tx.query(
      `update public.posts set status = 'skipped', skipped_at = $3::timestamptz, approved_at = null where id = $1 and brand_id = $2`,
      [ref.postId, ref.brandId, now],
    );
    await logAction(tx, ref.actor, ref.brandId, ref.postId, 'skip');
    return { ok: true, post: { ...post, status: 'skipped', skippedAt: now, approvedAt: null }, changed: true };
  });
}

/** Approved or skipped goes back to draft and the timestamps are cleared. Not allowed once posted. */
export async function undoPost(ref: PostRef): Promise<OpResult<{ changed: boolean; from: string }>> {
  const denied = await checkActor(ref.actor, ref.brandId);
  if (denied) return denied;
  return getDb().withService(async (tx): Promise<OpResult<{ changed: boolean; from: string }>> => {
    const post = await loadPostIn(tx, ref.brandId, ref.postId, true);
    if (!post) return fail('not_found', e.notFound);
    if (post.status === 'posted') return fail('posted', e.posted);
    if (post.status !== 'approved' && post.status !== 'skipped') return { ok: true, post, changed: false, from: post.status };
    await tx.query(
      `update public.posts set status = 'draft', approved_at = null, skipped_at = null where id = $1 and brand_id = $2`,
      [ref.postId, ref.brandId],
    );
    await logAction(tx, ref.actor, ref.brandId, ref.postId, 'undo', { from: post.status });
    return { ok: true, post: { ...post, status: 'draft', approvedAt: null, skippedAt: null }, changed: true, from: post.status };
  });
}

// ---------------------------------------------------------------------------
// flags (Req 11, 12)
// ---------------------------------------------------------------------------

/** "This is true". A regulated flag needs `regulatedAck`. A word to avoid or the reminder cannot be confirmed. */
export async function confirmFlag(
  ref: PostRef & { flagId: string; regulatedAck?: boolean },
  deps: OpDeps = {},
): Promise<OpResult<object>> {
  const denied = await checkActor(ref.actor, ref.brandId);
  if (denied) return denied;
  const now = deps.now ?? new Date();
  return getDb().withService(async (tx): Promise<OpResult<object>> => {
    const post = await loadPostIn(tx, ref.brandId, ref.postId, true);
    if (!post) return fail('not_found', e.notFound);
    if (post.status === 'posted') return fail('posted', e.posted);
    let flags: Flag[];
    try {
      flags = confirmFlagText(post.flags, ref.flagId, { regulatedAck: ref.regulatedAck === true, now });
    } catch (err) {
      if (err instanceof GuardrailActionError) return flagFailure(err);
      throw err;
    }
    await tx.query('update public.posts set fact_flags = $3::jsonb where id = $1 and brand_id = $2', [ref.postId, ref.brandId, JSON.stringify(flags)]);
    const flag = post.flags.find((f) => f.id === ref.flagId)!;
    await logAction(tx, ref.actor, ref.brandId, ref.postId, 'edit', { flag: flag.id, decision: 'confirm', kind: flag.kind, field: flag.field, regulated_ack: flag.regulated ? true : undefined });
    return { ok: true, post: { ...post, flags } };
  });
}

function flagFailure(err: GuardrailActionError): OpFail {
  switch (err.code) {
    case 'not_found':
      return fail('not_found', e.flagNotFound);
    case 'not_open':
      return fail('not_open', e.flagNotOpen);
    case 'ack_required':
      return fail('ack_required', e.ackRequired);
    case 'must_edit':
      return fail('must_edit', e.mustEdit);
    case 'cannot_remove':
      return fail('cannot_remove', e.cannotRemove);
  }
}

/**
 * "Remove": the flagged text is cut out of its field (spaces and punctuation tidied), the flag
 * becomes `removed`, and the images are drawn again when the field is on the image
 * (image_text.* and the call to action).
 */
export async function removeFlag(ref: PostRef & { flagId: string }, deps: OpDeps = {}): Promise<OpResult<{ reapprove: boolean }>> {
  const started = await begin(ref);
  if ('fail' in started) return started.fail;
  const post = started.post;
  if (post.status === 'posted') return fail('posted', e.posted);
  const flag = post.flags.find((f) => f.id === ref.flagId);
  if (!flag) return fail('not_found', e.flagNotFound);
  if (flag.status !== 'open') return fail('not_open', e.flagNotOpen);
  const now = deps.now ?? new Date();

  let edited;
  try {
    edited = removeFlagText({ caption: post.caption, cta: post.cta, image_text: post.imageText }, flag);
  } catch (err) {
    if (err instanceof GuardrailActionError) return flagFailure(err);
    throw err;
  }
  if (!edited.caption.trim()) return fail('cannot_remove', e.removeEmptiesCaption);
  const flags = resolveRemovedSpans(
    edited,
    post.flags.map((f) => (f.id === flag.id ? { ...f, status: 'removed' as const, decided_at: now.toISOString() } : f)),
    now,
  );

  const onImage = flag.field !== 'caption';
  const storage = storageOf(deps);
  const images = onImage ? await renderPost({ storage, post, photoId: post.photoId, cta: edited.cta, imageText: edited.image_text }) : undefined;
  return commitChange({
    ref,
    deps,
    storage,
    patch: { caption: edited.caption, cta: edited.cta, imageText: edited.image_text, flags },
    images,
    action: 'edit',
    detail: { flag: flag.id, decision: 'remove', kind: flag.kind, field: flag.field },
  });
}

// ---------------------------------------------------------------------------
// edit (Req 15)
// ---------------------------------------------------------------------------

export interface EditInput {
  caption?: string;
  cta?: string;
  hashtags?: string[];
  /** `bubble` is what the mascot says and `pose` is how it stands (one of TWEEN_POST_POSES; anything else is ignored) (V-25, D9). */
  image_text?: { headline?: string; subline?: string; bubble?: string; pose?: string };
  /** true = show the brand's mascot; false = no mascot; omitted = leave as it is. */
  showMascot?: boolean;
}

/**
 * Saves the owner's own text. Owner text is a source, so the AI fact check is not run again.
 * The words-to-avoid check and the channel limits run, as validation errors (nothing is saved
 * when there is one). Open flags whose text is gone become `removed`. The images are drawn
 * again when the headline, subline, call to action, mascot or the mascot's words changed.
 * The mascot switch is per post: off sets mascot_id to null, on uses the brand's active mascot
 * (a post that already has one keeps it).
 */
export async function editPost(ref: PostRef & { input: EditInput }, deps: OpDeps = {}): Promise<OpResult<{ changed: boolean; reapprove: boolean }>> {
  const started = await begin(ref);
  if ('fail' in started) return started.fail;
  const post = started.post;
  if (post.status === 'posted') return fail('posted', e.posted);
  const now = deps.now ?? new Date();
  const input = ref.input;
  const spec = V2_CHANNEL_SPECS[post.channel];
  const channel = s.week.channels[post.channel];

  const caption = input.caption === undefined ? post.caption : cleanText(input.caption);
  const cta = input.cta === undefined ? post.cta : cleanText(input.cta).replace(/\s+/g, ' ');
  const hashtags = input.hashtags ?? post.hashtags;
  const imageText = {
    headline: input.image_text?.headline === undefined ? post.imageText.headline : cleanText(input.image_text.headline).replace(/\s+/g, ' '),
    subline: input.image_text?.subline === undefined ? post.imageText.subline : cleanText(input.image_text.subline).replace(/\s+/g, ' '),
  };

  const bubble = input.image_text?.bubble === undefined ? post.imageText.bubble : cleanText(input.image_text.bubble).replace(/\s+/g, ' ');
  const pose =
    typeof input.image_text?.pose === 'string' && (TWEEN_POST_POSES as readonly string[]).includes(input.image_text.pose) ? input.image_text.pose : post.imageText.pose;
  let mascotId = post.mascotId;
  const errors: string[] = [];
  if (input.showMascot === false) mascotId = null;
  else if (input.showMascot === true && !post.mascotId) {
    const mascot = await loadUsableMascot(ref.brandId);
    if (mascot) mascotId = mascot.id;
    else errors.push(s.mascot.post.noMascot);
  }
  if (!caption) errors.push(e.captionEmpty);
  else if (visibleChars(caption) > spec.captionMaxChars) errors.push(fill(e.captionTooLong, { channel, max: spec.captionMaxChars }));
  if (visibleChars(cta) > MAX_CTA_CHARS) errors.push(fill(e.ctaTooLong, { max: MAX_CTA_CHARS }));
  if (hashtags.length > spec.hashtags[1]) errors.push(fill(e.hashtagsTooMany, { channel, max: spec.hashtags[1] }));
  if (visibleChars(imageText.headline) > V2_IMAGE_TEXT_LIMITS.headline) errors.push(fill(e.headlineTooLong, { max: V2_IMAGE_TEXT_LIMITS.headline }));
  if (visibleChars(imageText.subline) > V2_IMAGE_TEXT_LIMITS.subline) errors.push(fill(e.sublineTooLong, { max: V2_IMAGE_TEXT_LIMITS.subline }));
  if (visibleChars(bubble) > BUBBLE_MAX_CHARS) errors.push(fill(s.mascot.post.bubbleTooLong, { max: BUBBLE_MAX_CHARS }));

  // Words to avoid, in the fields the owner changed. (Older words in untouched fields are already flags.)
  const ctx = await loadGuardrailContext(ref.brandId);
  const checks = [
    ['caption', caption, post.caption],
    ['cta', cta, post.cta],
    ['image_text.headline', imageText.headline, post.imageText.headline],
    ['image_text.subline', imageText.subline, post.imageText.subline],
    ['image_text.bubble', bubble, post.imageText.bubble],
  ] as const;
  const seen = new Set<string>();
  for (const [field, text, before] of checks) {
    if (text === before) continue;
    for (const issue of avoidIssues(field, text, ctx.wordsToAvoid)) {
      const key = issue.text.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      errors.push(fill(e.avoidWord, { word: issue.text }));
    }
  }
  if (errors.length > 0) return fail('invalid', errors[0], { errors });

  const copy = { caption, cta, image_text: { ...imageText, bubble } };
  const sameTags = hashtags.length === post.hashtags.length && hashtags.every((t, i) => t === post.hashtags[i]);
  const bubbleChanged = bubble !== post.imageText.bubble;
  const mascotChanged = mascotId !== post.mascotId;
  // 'wave' is what an empty pose draws, so the two are the same pose.
  const poseChanged = postPoseOrDefault(pose) !== postPoseOrDefault(post.imageText.pose);
  const changed =
    poseChanged || caption !== post.caption || cta !== post.cta || !sameTags || imageText.headline !== post.imageText.headline || imageText.subline !== post.imageText.subline || bubbleChanged || mascotChanged;
  if (!changed) return { ok: true, post, changed: false, reapprove: false };

  const flags = resolveRemovedSpans(copy, post.flags, now);
  // The bubble is only on the picture when the post has a mascot.
  const onImage =
    cta !== post.cta || imageText.headline !== post.imageText.headline || imageText.subline !== post.imageText.subline || mascotChanged || ((bubbleChanged || poseChanged) && mascotId !== null);
  const storage = storageOf(deps);
  const images = onImage ? await renderPost({ storage, post, photoId: post.photoId, cta, imageText: { ...imageText, bubble, pose }, mascotId }) : undefined;
  const fields = [
    caption !== post.caption && 'caption',
    cta !== post.cta && 'cta',
    !sameTags && 'hashtags',
    imageText.headline !== post.imageText.headline && 'headline',
    imageText.subline !== post.imageText.subline && 'subline',
    bubbleChanged && 'bubble',
    poseChanged && 'pose',
    mascotChanged && (mascotId ? 'mascot_on' : 'mascot_off'),
  ].filter(Boolean);
  const saved = await commitChange({ ref, deps, storage, patch: { caption, cta, hashtags, imageText: { ...imageText, bubble, pose }, mascotId, flags }, images, action: 'edit', detail: { fields } });
  return saved.ok ? { ...saved, changed: true } : saved;
}

// ---------------------------------------------------------------------------
// swap the photo (Req 15)
// ---------------------------------------------------------------------------

/**
 * Uses another photo from the brand's library, or none (`null`: a text-only design). The photo
 * must belong to the brand. One marked unusable (dark, blurry) is refused with `photo_unusable`
 * unless `insist` is true, and then it is used with `warning: true`. The three images are redrawn.
 */
export async function swapPhoto(
  ref: PostRef & { photoId: string | null; insist?: boolean },
  deps: OpDeps = {},
): Promise<OpResult<{ warning: boolean; reapprove: boolean }>> {
  const started = await begin(ref);
  if ('fail' in started) return started.fail;
  const post = started.post;
  if (post.status === 'posted') return fail('posted', e.posted);

  const storage = storageOf(deps);
  let warning = false;
  if (ref.photoId !== null) {
    if (!UUID_RE.test(ref.photoId)) return fail('photo_not_found', e.photoNotFound);
    const [photo] = await getDb().withService((tx) =>
      tx.query<{ usable: boolean | null; storage_path: string | null }>(`select usable, storage_path from public.photos where id = $1 and brand_id = $2 and kind = 'photo'`, [ref.photoId, ref.brandId]),
    );
    if (!photo) return fail('photo_not_found', e.photoNotFound);
    if (photo.usable === false) {
      if (ref.insist !== true) return fail('photo_unusable', e.photoUnusable);
      warning = true;
    }
    if (!(await loadPhotoFile(storage, photo.storage_path))) return fail('photo_missing', e.photoMissing);
  }

  const images = await renderPost({ storage, post, photoId: ref.photoId, cta: post.cta, imageText: post.imageText });
  const saved = await commitChange({
    ref,
    deps,
    storage,
    patch: { photoId: ref.photoId },
    images,
    action: 'swap_photo',
    detail: { photo_id: ref.photoId, ...(warning ? { insisted: true } : {}) },
  });
  return saved.ok ? { ...saved, warning } : saved;
}
