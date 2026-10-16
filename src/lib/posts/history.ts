import type { Channel, ContentLanguage } from "@/lib/ai/schemas";
import { channelFormats } from "@/lib/create/content";
import { getDb } from "@/lib/db";

/**
 * Past posts for the History screen (R13) and the "Use again" source.
 * Everything runs as the signed-in user, so row-level security keeps each brand's
 * posts separate (R14); the brand id in the query is a second guard, not the only one.
 *
 * Two data models share the `posts` table:
 *  - v1/v2: one post with `outputs` (caption and image per channel).
 *  - v3 (`brief_id` set): one post row PER CHANNEL of a brief, with its caption on the row, its pictures in
 *    `post_images` and its place in the queue in `queue_items`. History lists ONE entry per brief (its first
 *    channel's post); carousel slides never get an entry of their own.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CURSOR_RE = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{1,6}Z)\|([0-9a-f-]{36})$/i;
const LANGUAGE_ORDER: ContentLanguage[] = ["hi", "hinglish", "en"];

export const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

export type PostStatus = "generating" | "draft" | "ready" | "failed";

export interface HistoryOutput {
  channel: Channel;
  language: ContentLanguage;
  /** Storage path with the bucket first. Null for text-only outputs. */
  imagePath: string | null;
  /** Changes when the output is saved; added to image URLs to avoid stale caches. */
  version: string;
}

/** Where a v3 post stands, from its approval and its queue item. */
export type V3Status =
  | "draft"
  | "needs_approval"
  | "approved"
  | "scheduled"
  | "published"
  | "delivered"
  | "skipped"
  | "expired"
  | "missed"
  | "failed";

export interface HistoryV3 {
  briefId: string;
  channel: string;
  status: V3Status;
  /** When it is scheduled for, or when it was published or delivered. ISO. Null when no date applies. */
  at: string | null;
  /** Link to the live post, once published through a connection. */
  permalink: string | null;
  /** The brief's time zone, for showing `at`. */
  timezone: string;
  /** A carousel the owner asked for: how many slides (null for a single post). */
  carouselSlides: number | null;
}

export interface HistoryPost {
  id: string;
  /** ISO time, millisecond precision. */
  createdAt: string;
  status: PostStatus;
  inputType: "photo" | "text" | "voice";
  /** First line of the Instagram caption (or of the owner's input when there is no caption). May be empty. */
  title: string;
  /** Distinct languages across the outputs, Hindi first. */
  languages: ContentLanguage[];
  /** ig_feed image, else status image. Null when nothing was rendered. */
  thumbnail: { path: string; version: string } | null;
  outputs: HistoryOutput[];
  /** Set for posts made by the v3 flow (brief → design → review → queue); absent for v1/v2 posts. */
  v3?: HistoryV3;
}

export interface PostPage {
  posts: HistoryPost[];
  /** Pass back as `cursor` for the next page. Null on the last page. */
  nextCursor: string | null;
}

export interface ListPostsOptions {
  /** Posts created at or after this instant. */
  from?: Date | null;
  /** Posts created before this instant. */
  to?: Date | null;
  /** A post matches if any of its outputs is in this language. */
  language?: ContentLanguage | null;
  cursor?: string | null;
  limit?: number;
}

interface ListRow {
  id: string;
  created_iso: string;
  status: PostStatus;
  input_type: HistoryPost["inputType"];
  input_text: string | null;
  post_language: ContentLanguage;
  items: { channel: Channel; language: ContentLanguage; caption: string | null; image_path: string | null; version: string }[];
  // v3 posts only (null for v1/v2 rows)
  brief_id: string | null;
  v3_channel: string | null;
  v3_caption: string | null;
  v3_language: string | null;
  v3_designed: boolean | null;
  v3_approved_iso: string | null;
  v3_posted_iso: string | null;
  v3_timezone: string | null;
  v3_format: string | null;
  v3_slides: number | null;
  v3_images: { format: string; path: string; version: string }[] | null;
  q_status: string | null;
  q_slot_iso: string | null;
  q_done_iso: string | null;
  q_permalink: string | null;
}

/** The status of a v3 post and the date that goes with it. Pure, so it is tested without a database. */
export function deriveV3Status(r: {
  postStatus: string;
  designed: boolean;
  queueStatus: string | null;
  slotIso: string | null;
  doneIso: string | null;
  postedIso: string | null;
}): { status: V3Status; at: string | null } {
  switch (r.queueStatus) {
    case "scheduled":
    case "publishing":
      return { status: "scheduled", at: r.slotIso };
    case "published":
      return { status: "published", at: r.doneIso ?? r.slotIso };
    case "delivered":
      return { status: "delivered", at: r.doneIso ?? r.slotIso };
    case "skipped":
      return { status: "skipped", at: null };
    case "expired":
      return { status: "expired", at: null };
    case "missed":
      return { status: "missed", at: null };
    case "failed":
      return { status: "failed", at: null };
  }
  if (r.postStatus === "posted") return { status: "published", at: r.postedIso };
  if (r.postStatus === "skipped") return { status: "skipped", at: null };
  if (r.postStatus === "approved") return { status: "approved", at: null };
  return { status: r.designed ? "needs_approval" : "draft", at: null };
}

function toHistoryV3Post(r: ListRow): HistoryPost {
  const { status, at } = deriveV3Status({
    postStatus: r.status,
    designed: r.v3_designed === true,
    queueStatus: r.q_status,
    slotIso: r.q_slot_iso,
    doneIso: r.q_done_iso,
    postedIso: r.v3_posted_iso,
  });
  const channel = r.v3_channel ?? "instagram";
  const images = r.v3_images ?? [];
  // The main picture of the channel (its first size), else whatever was drawn.
  const thumb = channelFormats(channel).map((f) => images.find((i) => i.format === f)).find(Boolean) ?? images[0];
  const lang = LANGUAGE_ORDER.find((l) => l === r.v3_language);
  return {
    id: r.id,
    createdAt: new Date(r.created_iso).toISOString(),
    status: status === "draft" ? "draft" : "ready",
    inputType: "text",
    title: firstLine(r.v3_caption),
    languages: lang ? [lang] : [],
    thumbnail: thumb ? { path: thumb.path, version: thumb.version } : null,
    outputs: [],
    v3: {
      briefId: r.brief_id!,
      channel,
      status,
      at: at ? new Date(at).toISOString() : null,
      permalink: status === "published" ? r.q_permalink : null,
      timezone: r.v3_timezone || "UTC",
      carouselSlides: r.v3_format === "carousel" ? (r.v3_slides ?? null) : null,
    },
  };
}

function firstLine(text: string | null | undefined): string {
  return (text ?? "").split(/\r?\n/).map((l) => l.trim()).find(Boolean) ?? "";
}

export function encodeCursor(createdIso: string, id: string): string {
  return `${createdIso}|${id}`;
}

function decodeCursor(cursor: string | null | undefined): { createdIso: string; id: string } | null {
  if (!cursor) return null;
  const m = CURSOR_RE.exec(cursor);
  if (!m || !UUID_RE.test(m[2])) throw new Error("Invalid cursor");
  return { createdIso: m[1], id: m[2] };
}

function toHistoryPost(r: ListRow): HistoryPost {
  if (r.brief_id) return toHistoryV3Post(r);
  const items = r.items ?? [];
  const igCaption = items.find((i) => i.channel === "ig_feed")?.caption;
  const languages = LANGUAGE_ORDER.filter((l) => items.some((i) => i.language === l));
  // A post with no outputs (failed before writing) still shows the language it was made for.
  const shown = languages.length > 0 ? languages : [r.post_language];
  const thumb = items.find((i) => i.channel === "ig_feed" && i.image_path) ?? items.find((i) => i.channel === "status" && i.image_path);
  return {
    id: r.id,
    createdAt: new Date(r.created_iso).toISOString(),
    status: r.status,
    inputType: r.input_type,
    title: firstLine(igCaption) || firstLine(r.input_text),
    languages: shown,
    thumbnail: thumb?.image_path ? { path: thumb.image_path, version: thumb.version } : null,
    outputs: items.map((i) => ({ channel: i.channel, language: i.language, imagePath: i.image_path, version: i.version })),
  };
}

/**
 * A page of the brand's posts, newest first, with their outputs, in one query
 * (a lateral join aggregates the outputs per post: no query per post).
 * Paging is keyset on (created_at, id), so a post is never listed twice or
 * skipped, even when new posts arrive between pages.
 */
export async function listPosts(userId: string, brandId: string, opts: ListPostsOptions = {}): Promise<PostPage> {
  if (!UUID_RE.test(brandId)) return { posts: [], nextCursor: null };
  const limit = Math.min(Math.max(Math.floor(opts.limit ?? DEFAULT_PAGE_SIZE), 1), MAX_PAGE_SIZE);
  const cursor = decodeCursor(opts.cursor);

  const rows = await getDb().withUser(userId, (tx) =>
    tx.query<ListRow>(
      `select p.id,
              to_char(p.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as created_iso,
              p.status::text as status,
              p.input_type::text as input_type,
              p.input_text,
              p.language::text as post_language,
              coalesce(o.items, '[]'::jsonb) as items,
              p.brief_id::text as brief_id,
              p.channel::text as v3_channel,
              p.caption as v3_caption,
              p.post_language as v3_language,
              (p.theme_id is not null and p.design is not null) as v3_designed,
              to_char(p.posted_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as v3_posted_iso,
              b.timezone as v3_timezone,
              b.content_format as v3_format,
              b.slide_count as v3_slides,
              im.imgs as v3_images,
              q.status as q_status,
              to_char(q.slot_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as q_slot_iso,
              to_char(q.done_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as q_done_iso,
              q.permalink as q_permalink
         from public.posts p
         left join public.post_briefs b on b.id = p.brief_id and b.brand_id = p.brand_id
         left join public.queue_items q on q.post_id = p.id and q.brand_id = p.brand_id
         left join lateral (
           select jsonb_agg(jsonb_build_object(
                    'format', i.format::text,
                    'path', i.image_path,
                    'version', (extract(epoch from i.updated_at) * 1000)::bigint::text
                  )) as imgs
             from public.post_images i
            where i.post_id = p.id and i.brand_id = p.brand_id and p.brief_id is not null
         ) im on true
         left join lateral (
           select jsonb_agg(jsonb_build_object(
                    'channel', x.channel::text,
                    'language', x.language::text,
                    'caption', case when x.channel = 'ig_feed' then x.caption end,
                    'image_path', x.image_path,
                    'version', (extract(epoch from x.updated_at) * 1000)::bigint::text
                  ) order by x.channel) as items
             from public.outputs x
            where x.post_id = p.id
         ) o on true
        where p.brand_id = $1::uuid
          and p.carousel_id is null
          and (p.brief_id is null or not exists (
                 select 1 from public.posts p2
                  where p2.brief_id = p.brief_id and p2.brand_id = p.brand_id and p2.carousel_id is null
                    and (coalesce(array_position(b.channels::text[], p2.channel::text), 99), p2.id)
                      < (coalesce(array_position(b.channels::text[], p.channel::text), 99), p.id)))
          and ($2::timestamptz is null or p.created_at >= $2::timestamptz)
          and ($3::timestamptz is null or p.created_at < $3::timestamptz)
          and ($4::public.content_language is null
               or exists (select 1 from public.outputs l where l.post_id = p.id and l.language = $4::public.content_language)
               or (p.brief_id is not null and p.post_language = $4::public.content_language::text)
               or (p.brief_id is null and not exists (select 1 from public.outputs l where l.post_id = p.id) and p.language = $4::public.content_language))
          and ($5::timestamptz is null or (p.created_at, p.id) < ($5::timestamptz, $6::uuid))
        order by p.created_at desc, p.id desc
        limit $7`,
      [
        brandId,
        opts.from ? opts.from.toISOString() : null,
        opts.to ? opts.to.toISOString() : null,
        opts.language ?? null,
        cursor?.createdIso ?? null,
        cursor?.id ?? null,
        limit + 1,
      ],
    ),
  );

  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    posts: page.map(toHistoryPost),
    nextCursor: rows.length > limit && last ? encodeCursor(last.created_iso, last.id) : null,
  };
}

// ---------------------------------------------------------------------------
// Use again
// ---------------------------------------------------------------------------

export interface ReuseSource {
  postId: string;
  /** Pre-filled text: the typed text, the photo's caption or the voice transcript. */
  text: string;
  /** Normalised photo of a photo post (storage path with bucket first), else null. */
  photoPath: string | null;
}

/**
 * What "Use again" pre-fills on /create. Only posts of the given (current)
 * brand qualify, so another brand's photo is never reused by accident.
 */
export async function getReuseSource(userId: string, brandId: string, postId: string): Promise<ReuseSource | null> {
  if (!UUID_RE.test(postId) || !UUID_RE.test(brandId)) return null;
  const [row] = await getDb().withUser(userId, (tx) =>
    tx.query<{ id: string; input_type: string; input_text: string | null; photo_path: string | null }>(
      "select id, input_type::text as input_type, input_text, photo_path from public.posts where id = $1 and brand_id = $2",
      [postId, brandId],
    ),
  );
  if (!row) return null;
  return {
    postId: row.id,
    text: row.input_text ?? "",
    photoPath: row.input_type === "photo" ? row.photo_path : null,
  };
}
