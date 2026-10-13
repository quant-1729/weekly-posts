// What the week screen shows: the batch for one week and its posts, read as the signed-in user
// (row-level security). Plain data, safe to send to a client component.

import type { V2Channel } from '@/lib/ai/prompts/v2-weekly';
import { mascotEligibility } from '@/lib/ai/mascot-eligibility';
import { BrandAccessError } from '@/lib/brand/current';
import { getDb } from '@/lib/db';
import type { Flag } from '@/lib/guardrail';
import { getEnv } from '@/lib/env';
import { isValidIsoDate, localDateIn } from '@/lib/occasions/dates';
import type { ShareFormat } from '@/lib/share/formats';
import { composeShareText } from '@/lib/shortlinks/compose';
import { BATCH_STATE_COLUMNS, MAX_REGENERATIONS, readBatchState } from './meta';

export interface WeekPostView {
  id: string;
  suggestedDay: string | null;
  channel: V2Channel | null;
  status: string;
  /** The first lines of the caption. */
  caption: string;
  /** The whole caption, for the editor (V-16). */
  fullCaption: string;
  cta: string;
  hashtags: string[];
  imageText: { headline: string; subline: string };
  /** What the post's mascot says and its pose ('' when none), and the mascot drawn on it (null = off). */
  bubble?: string;
  pose?: string;
  mascotId?: string | null;
  /** The brand has an active mascot that posts may use, so the editor can offer "Show my mascot". */
  canShowMascot?: boolean;
  photoId: string | null;
  /** Every flag of the post, open or decided (V-16). The regulated reminder is `reminder`, never counted. */
  flags: Flag[];
  reminder: boolean;
  /** Open flags the owner has to look at (the regulated reminder does not count). */
  flagCount: number;
  /** Square image for the list, served by /api/files. Null when it was not rendered. */
  imageUrl: string | null;
  occasion: string | null;
  /** Full-size pictures by format, served by /api/files (for Share and Download). Only formats that were rendered. */
  images: Partial<Record<ShareFormat, string>>;
  /** What Share and Copy send: caption, call to action with the short link, hashtags (V-17). */
  shareText: string;
  /** The day the post was marked posted, in the brand's time zone (YYYY-MM-DD), or null. */
  postedOn: string | null;
  /** When it was marked posted (ISO), or null. */
  postedAt: string | null;
}

/** A photo from the brand's library, for the editor's photo picker. */
export interface PhotoChoice {
  id: string;
  url: string;
  description: string;
  /** False = the model found it dark or blurry. */
  usable: boolean;
}

export interface WeekView {
  weekStart: string;
  /** The brand's photos (newest first, low quality last), for swapping a post's photo. */
  photos: PhotoChoice[];
  batch: {
    id: string;
    status: 'generating' | 'ready' | 'failed';
    trigger: 'cron' | 'button';
    generatedAt: string | null;
    /** Why the last run failed, in a short plain sentence for the log, or ''. */
    errorMessage: string;
  } | null;
  posts: WeekPostView[];
  /** The button may start a run now: no batch, a failed one, or a ready one with no approved posts and runs left. */
  canGenerate: boolean;
  /** Button regenerations left for this week (of 3). */
  regenerationsLeft: number;
  hasApproved: boolean;
}

interface BatchRow {
  id: string;
  status: 'generating' | 'ready' | 'failed';
  trigger: 'cron' | 'button';
  error: string | null;
  attempts: number;
  regens: number;
  claimed_at: Date | string | null;
  generated_at: Date | string | null;
}
interface PostRow {
  id: string;
  suggested_day: string | null;
  channel: V2Channel | null;
  status: string;
  caption: string | null;
  cta: string | null;
  hashtags: string[] | null;
  image_text: { headline?: string; subline?: string; bubble?: string; pose?: string } | null;
  photo_id: string | null;
  mascot_id: string | null;
  fact_flags: Flag[] | null;
  occasion: string | null;
  square: string | null;
  vertical: string | null;
  landscape: string | null;
  post_code: string;
  posted_at: Date | string | null;
}

function postedDay(at: Date, timezone: string): string {
  try {
    return localDateIn(at, timezone);
  } catch {
    return at.toISOString().slice(0, 10);
  }
}

/** First lines of a caption: up to 3 lines or 160 characters. */
export function captionPreview(caption: string): string {
  const lines = caption.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 3).join('\n');
  return lines.length > 160 ? `${lines.slice(0, 159).trimEnd()}…` : lines;
}

export async function loadWeekView(userId: string, brandId: string, weekStart: string): Promise<WeekView> {
  if (!isValidIsoDate(weekStart)) throw new Error(`Invalid week start: ${weekStart}`);
  return getDb().withUser(userId, async (tx) => {
    const [member] = await tx.query<{ ok: boolean }>('select public.is_brand_member($1::uuid) as ok', [brandId]);
    if (!member?.ok) throw new BrandAccessError();
    const [batch] = await tx.query<BatchRow>(
      `select id::text as id, status::text as status, trigger, ${BATCH_STATE_COLUMNS}, generated_at
         from public.weekly_batches where brand_id = $1 and week_start = $2::date`,
      [brandId, weekStart],
    );
    const posts = batch
      ? await tx.query<PostRow>(
          `select p.id::text as id, p.suggested_day::text as suggested_day, p.channel::text as channel, p.status::text as status,
                  p.caption, p.cta, p.hashtags, p.image_text, p.photo_id::text as photo_id, p.mascot_id::text as mascot_id, p.fact_flags, p.occasion, i.image_path as square, iv.image_path as vertical, il.image_path as landscape,
                  p.post_code, p.posted_at
             from public.posts p
             left join public.post_images i on i.post_id = p.id and i.brand_id = p.brand_id and i.format = 'square'
             left join public.post_images iv on iv.post_id = p.id and iv.brand_id = p.brand_id and iv.format = 'vertical'
             left join public.post_images il on il.post_id = p.id and il.brand_id = p.brand_id and il.format = 'landscape'
            where p.batch_id = $1
            order by p.suggested_day, p.created_at, p.id`,
          [batch.id],
        )
      : [];
    const photos = await tx.query<{ id: string; storage_path: string; description: string | null; usable: boolean | null }>(
      `select id::text as id, storage_path, description, usable from public.photos
        where brand_id = $1 and kind = 'photo' and storage_path is not null
        order by (usable is false), created_at desc, id limit 30`,
      [brandId],
    );
    const [mem] = await tx.query<{ timezone: string | null; category: string | null; tone: string | null; regulated: string | null }>(
      'select timezone, category, tone, regulated::text as regulated from public.brand_memory where brand_id = $1',
      [brandId],
    );
    const timezone = mem?.timezone || 'UTC';
    const [activeMascot] = await tx.query<{ id: string }>("select id::text as id from public.mascots where brand_id = $1 and status = 'active'", [brandId]);
    const canShowMascot =
      !!activeMascot &&
      mascotEligibility({ category: mem?.category ?? '', tone: mem?.tone ?? '', regulated: (mem?.regulated as Parameters<typeof mascotEligibility>[0]['regulated']) ?? null }).reason !== 'regulated';
    const baseUrl = getEnv().appUrl;
    const meta = readBatchState(batch ?? { error: null });
    const hasApproved = posts.some((p) => p.status === 'approved' || p.status === 'posted');
    const regenerationsLeft = batch ? Math.max(0, MAX_REGENERATIONS - meta.regens) : MAX_REGENERATIONS;
    const canGenerate = !batch || batch.status === 'failed' || (batch.status === 'ready' && !hasApproved && regenerationsLeft > 0);
    return {
      weekStart,
      photos: photos.map((p) => ({ id: p.id, url: `/api/files/${p.storage_path}`, description: p.description ?? '', usable: p.usable !== false })),
      batch: batch
        ? {
            id: batch.id,
            status: batch.status,
            trigger: batch.trigger,
            generatedAt: batch.generated_at ? new Date(batch.generated_at).toISOString() : null,
            errorMessage: meta.message,
          }
        : null,
      posts: posts.map((p) => ({
        id: p.id,
        suggestedDay: p.suggested_day,
        channel: p.channel,
        status: p.status,
        caption: captionPreview(p.caption ?? ''),
        fullCaption: p.caption ?? '',
        cta: p.cta ?? '',
        hashtags: p.hashtags ?? [],
        imageText: { headline: p.image_text?.headline ?? '', subline: p.image_text?.subline ?? '' },
        bubble: p.image_text?.bubble ?? '',
        pose: p.image_text?.pose ?? '',
        mascotId: p.mascot_id,
        canShowMascot,
        photoId: p.photo_id,
        flags: Array.isArray(p.fact_flags) ? p.fact_flags : [],
        reminder: (p.fact_flags ?? []).some((f) => f.kind === 'regulated_reminder'),
        flagCount: (p.fact_flags ?? []).filter((f) => f.status === 'open' && f.kind !== 'regulated_reminder').length,
        imageUrl: p.square ? `/api/files/${p.square}` : null,
        occasion: p.occasion,
        images: {
          ...(p.square ? { square: `/api/files/${p.square}` } : {}),
          ...(p.vertical ? { vertical: `/api/files/${p.vertical}` } : {}),
          ...(p.landscape ? { landscape: `/api/files/${p.landscape}` } : {}),
        },
        shareText: p.channel ? composeShareText({ channel: p.channel, caption: p.caption ?? '', cta: p.cta ?? '', hashtags: p.hashtags ?? [], postCode: p.post_code }, { baseUrl }) : '',
        postedAt: p.posted_at ? new Date(p.posted_at).toISOString() : null,
        postedOn: p.posted_at ? postedDay(new Date(p.posted_at), timezone) : null,
      })),
      canGenerate,
      regenerationsLeft,
      hasApproved,
    };
  });
}
