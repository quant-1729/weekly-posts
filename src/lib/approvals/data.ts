// Database and storage helpers for the approval operations. Everything here runs as the service
// role: the caller has already checked the link token or the user's membership.

import type { V2Channel } from '@/lib/ai/prompts/v2-weekly';
import { BrandAccessError, requireBrandMember } from '@/lib/brand/current';
import { getDb, type Tx } from '@/lib/db';
import type { Flag } from '@/lib/guardrail';
import { s } from '@/lib/i18n/strings';
import { emailImagePaths } from '@/lib/links/image';
import { loadMascotById, mascotForRender } from '@/lib/mascot/posts';
import type { PostActionName } from '@/lib/links/handlers';
import { getStorage, type Storage } from '@/lib/storage';
import { loadPhotoFile, loadRenderBrand, renderAndStore, type StoredImage } from '@/lib/weekly/render-post';
import type { Actor, OpDeps, OpFail, PostRecord } from './types';

export const fail = (code: OpFail['code'], message: string, extra: Partial<Pick<OpFail, 'flags' | 'errors'>> = {}): OpFail => ({
  ok: false,
  code,
  message,
  ...extra,
});

export const storageOf = (deps: OpDeps): Storage => deps.storage ?? getStorage();

const iso = (v: unknown): string | null => (v == null ? null : v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString());

/** Dashboard actors must belong to the brand. Returns a failure to give back, or null when all is well. */
export async function checkActor(actor: Actor, brandId: string): Promise<OpFail | null> {
  if (actor.via !== 'dashboard') return null;
  try {
    await requireBrandMember(actor.userId, brandId);
    return null;
  } catch (e) {
    if (e instanceof BrandAccessError) return fail('forbidden', s.approvals.errors.forbidden);
    throw e;
  }
}

interface PostRow {
  id: string;
  batch_id: string;
  week_start: string;
  status: string;
  channel: V2Channel;
  post_language: string | null;
  suggested_day: string | null;
  post_code: string;
  caption: string;
  cta: string;
  hashtags: string[] | null;
  image_text: { headline?: string; subline?: string; bubble?: string; pose?: string } | null;
  photo_id: string | null;
  mascot_id: string | null;
  fact_flags: Flag[] | null;
  edited_at: unknown;
  approved_at: unknown;
  skipped_at: unknown;
  posted_at: unknown;
}

const POST_SQL = `select p.id::text as id, p.batch_id::text as batch_id, w.week_start::text as week_start, p.status::text as status,
       p.channel::text as channel, p.post_language, p.suggested_day::text as suggested_day, p.post_code,
       coalesce(p.caption, '') as caption, coalesce(p.cta, '') as cta, p.hashtags, p.image_text, p.photo_id::text as photo_id, p.mascot_id::text as mascot_id,
       p.fact_flags, p.edited_at, p.approved_at, p.skipped_at, p.posted_at
  from public.posts p
  join public.weekly_batches w on w.id = p.batch_id and w.brand_id = p.brand_id
 where p.id = $1 and p.brand_id = $2 and p.channel is not null`;

function toRecord(brandId: string, r: PostRow): PostRecord {
  return {
    id: r.id,
    brandId,
    batchId: r.batch_id,
    weekStart: r.week_start,
    status: r.status,
    channel: r.channel,
    postLanguage: r.post_language ?? 'en',
    suggestedDay: r.suggested_day,
    postCode: r.post_code,
    caption: r.caption,
    cta: r.cta,
    hashtags: r.hashtags ?? [],
    imageText: {
      headline: r.image_text?.headline ?? '',
      subline: r.image_text?.subline ?? '',
      bubble: r.image_text?.bubble ?? '',
      pose: r.image_text?.pose ?? '',
    },
    photoId: r.photo_id,
    mascotId: r.mascot_id,
    flags: Array.isArray(r.fact_flags) ? r.fact_flags : [],
    editedAt: iso(r.edited_at),
    approvedAt: iso(r.approved_at),
    skippedAt: iso(r.skipped_at),
    postedAt: iso(r.posted_at),
  };
}

/** A weekly post of the brand, or null. With `lock`, the row is locked until the transaction ends. */
export async function loadPostIn(tx: Tx, brandId: string, postId: string, lock = false): Promise<PostRecord | null> {
  const [row] = await tx.query<PostRow>(`${POST_SQL}${lock ? ' for update of p' : ''}`, [postId, brandId]);
  return row ? toRecord(brandId, row) : null;
}

export async function loadPost(brandId: string, postId: string): Promise<PostRecord | null> {
  return getDb().withService((tx) => loadPostIn(tx, brandId, postId));
}

/** Checks the actor and loads the post: the start of every operation that renders or calls the model. */
export async function begin(ref: { brandId: string; postId: string; actor: Actor }): Promise<{ post: PostRecord } | { fail: OpFail }> {
  const denied = await checkActor(ref.actor, ref.brandId);
  if (denied) return { fail: denied };
  const post = await loadPost(ref.brandId, ref.postId);
  if (!post) return { fail: fail('not_found', s.approvals.errors.notFound) };
  return { post };
}

/** Writes a post_actions row: via, user_id and the jti hash follow from the actor. */
export async function logAction(
  tx: Tx,
  actor: Actor,
  brandId: string,
  postId: string,
  action: PostActionName,
  detail: Record<string, unknown> = {},
): Promise<void> {
  const full = actor.via === 'email_link' ? { ...detail, jti_hash: actor.jtiHash } : detail;
  await tx.query(
    `insert into public.post_actions (post_id, brand_id, action, via, detail, user_id)
     values ($1, $2, $3::public.post_action, $4, $5::jsonb, $6)`,
    [postId, brandId, action, actor.via, JSON.stringify(full), actor.via === 'dashboard' ? actor.userId : null],
  );
}

/** The cached email pictures of a post (V-15 caches renders/{brand}/{post}/email.jpg) must go when the post's image or copy changes. */
export async function clearEmailImages(storage: Storage, brandId: string, postId: string): Promise<void> {
  await Promise.all(emailImagePaths(brandId, postId).map((p) => storage.remove('renders', p).catch(() => undefined)));
}

/** The post's place in its week, which picks its template (the same index weekly generation used). */
async function postIndex(tx: Tx, post: PostRecord): Promise<number> {
  const rows = await tx.query<{ id: string }>(
    'select id::text as id from public.posts where batch_id = $1 order by suggested_day, created_at, id',
    [post.batchId],
  );
  return Math.max(0, rows.findIndex((r) => r.id === post.id));
}

/**
 * Renders the post's three images from the given copy and photo and returns them. Nothing is
 * written to the database; call saveImages in the same transaction as the copy change.
 */
export async function renderPost(args: {
  storage: Storage;
  post: PostRecord;
  photoId: string | null;
  cta: string;
  imageText: { headline: string; subline: string; bubble?: string; pose?: string };
  /** undefined = the post's own mascot; null = no mascot; an id = that mascot. Old posts keep drawing with theirs. */
  mascotId?: string | null;
}): Promise<StoredImage[]> {
  const { storage, post } = args;
  const mascotId = args.mascotId === undefined ? post.mascotId : args.mascotId;
  const bubble = args.imageText.bubble ?? post.imageText.bubble;
  const pose = args.imageText.pose ?? post.imageText.pose;
  const [brand, extra, mascot] = await Promise.all([
    loadRenderBrand(post.brandId, storage),
    getDb().withService(async (tx) => {
      const [photo] = args.photoId
        ? await tx.query<{ storage_path: string | null }>(
            `select storage_path from public.photos where id = $1 and brand_id = $2 and kind = 'photo'`,
            [args.photoId, post.brandId],
          )
        : [];
      return { path: photo?.storage_path ?? null, index: await postIndex(tx, post) };
    }),
    mascotId ? loadMascotById(post.brandId, mascotId) : Promise.resolve(null),
  ]);
  const photo = args.photoId ? await loadPhotoFile(storage, extra.path) : null;
  return renderAndStore({
    storage,
    brandId: post.brandId,
    postId: post.id,
    brand,
    photo: photo ?? undefined,
    text: { headline: args.imageText.headline, subline: args.imageText.subline, cta: args.cta, bubble },
    mascot: mascot ? mascotForRender(mascot.colors, pose) : null,
    seed: extra.index,
  });
}

export async function saveImages(tx: Tx, post: PostRecord, images: StoredImage[]): Promise<void> {
  for (const img of images) {
    await tx.query(
      `insert into public.post_images (post_id, brand_id, format, template_id, image_path)
       values ($1, $2, $3::public.image_format, $4, $5)
       on conflict (post_id, format) do update set template_id = excluded.template_id, image_path = excluded.image_path, updated_at = now()`,
      [post.id, post.brandId, img.format, img.templateId, img.path],
    );
  }
}

/** A member of the brand to act as where the guardrail needs a user (the owner first). */
export async function brandMemberFor(brandId: string): Promise<string> {
  const [row] = await getDb().withService((tx) =>
    tx.query<{ user_id: string }>(
      `select user_id::text as user_id from public.brand_members where brand_id = $1 order by (role = 'owner') desc, created_at asc limit 1`,
      [brandId],
    ),
  );
  if (!row) throw new Error('Brand has no members');
  return row.user_id;
}
