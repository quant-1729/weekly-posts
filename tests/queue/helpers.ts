import { randomUUID } from "node:crypto";
import { channelFormats } from "@/lib/create/content";
import type { MockDb } from "@/lib/db/mock";
import { listOutbox, type OutboxEntry } from "@/lib/email/outbox";
import type { QueueChannel } from "@/lib/queue/types";
import { makeOwner, type Owner } from "../helpers/details";

/** Wednesday 14 Oct 2026, noon UTC: 13:00 in London (BST). */
export const NOW = new Date("2026-10-14T12:00:00Z");

export interface Shop extends Owner {
  name: string;
  timezone: string;
}

export async function makeShop(db: MockDb, o: { name?: string; timezone?: string; country?: string } = {}): Promise<Shop> {
  const name = o.name ?? "Corner Bakery";
  const timezone = o.timezone ?? "Europe/London";
  const owner = await makeOwner(db, { name, country: o.country ?? "GB", timezone });
  return { ...owner, name, timezone };
}

export const rows = <T,>(db: MockDb, sql: string, params: unknown[] = []) => db.withAdmin((tx) => tx.query<T>(sql, params));

/** A ready brief with the given end date and channels (inserted directly: the queue does not care about its details). */
export async function seedBrief(db: MockDb, shop: Shop, o: { endsOn?: string | null; channels?: QueueChannel[] } = {}): Promise<string> {
  const [row] = await rows<{ id: string }>(
    db,
    `insert into public.post_briefs (brand_id, post_type, status, ends_on, channels, timezone, created_by)
     values ($1, 'announcement', 'ready', $2::date, $3::text[]::public.post_channel[], $4, $5) returning id::text as id`,
    [shop.brandId, o.endsOn === undefined ? "2026-10-31" : o.endsOn, o.channels ?? ["instagram"], shop.timezone, shop.userId],
  );
  return row.id;
}

const CODE = "abcdefghijklmnopqrstuvwxyz0123456789";
const code = () => Array.from({ length: 8 }, () => CODE[Math.floor(Math.random() * CODE.length)]).join("");

export interface SeededPost {
  id: string;
  channel: QueueChannel;
  briefId: string;
}

/**
 * An approved channel post of a brief with its picture row, as the Review step leaves it. `carousel` adds that many
 * slide posts (extra rows with a carousel id and one picture each) and marks the main post as their carousel.
 */
export async function seedPost(
  db: MockDb,
  shop: Shop,
  briefId: string,
  channel: QueueChannel,
  o: { status?: string; caption?: string; carousel?: number; headline?: string; formats?: string[] } = {},
): Promise<SeededPost> {
  const id = randomUUID();
  const formats = o.formats ?? channelFormats(channel);
  const carouselId = o.carousel ? randomUUID() : null;
  const design = { v: 1, content: {}, blockers: [], formats, ...(carouselId ? { carousel: { id: carouselId, slides: o.carousel } } : {}) };
  const insert = (postId: string, extra: { carouselId?: string; slideIndex?: number } = {}) =>
    rows(
      db,
      `insert into public.posts (id, brand_id, created_by, brief_id, status, post_code, channel, post_language, caption, cta, hashtags, image_text, fact_flags, theme_id, layout_id, design,
                                 carousel_id, slide_index, approved_at)
       values ($1, $2, $3, $4, $5::public.post_status, $6, $7::public.post_channel, 'en', $8, 'Visit us', '{"#bakery"}', $9::jsonb, '[]'::jsonb, 'classic', 'a', $10::jsonb, $11::uuid, $12::smallint, $13::timestamptz)`,
      [
        postId, shop.brandId, shop.userId, briefId, o.status ?? "approved", code(), channel, o.caption ?? "Fresh bread every morning at Corner Bakery.",
        JSON.stringify({ headline: o.headline ?? "Fresh bread", subline: "" }), JSON.stringify(design), extra.carouselId ?? null, extra.slideIndex ?? null,
        (o.status ?? "approved") === "approved" ? NOW.toISOString() : null,
      ],
    );
  await insert(id);
  for (const format of formats) {
    await rows(db, `insert into public.post_images (post_id, brand_id, format, template_id, image_path) values ($1, $2, $3::public.image_format, 'a', $4)`, [id, shop.brandId, format, `renders/${shop.brandId}/${id}/${format}.png`]);
  }
  if (carouselId) {
    for (let k = 0; k < (o.carousel ?? 0); k++) {
      const slide = randomUUID();
      await insert(slide, { carouselId, slideIndex: k });
      await rows(db, `insert into public.post_images (post_id, brand_id, format, template_id, image_path) values ($1, $2, $3::public.image_format, 'a', $4)`, [slide, shop.brandId, formats[0], `renders/${shop.brandId}/${slide}/${formats[0]}.png`]);
    }
  }
  return { id, channel, briefId };
}

/** One brief with one approved post per channel. */
export async function seedApproved(db: MockDb, shop: Shop, channels: QueueChannel[], o: { endsOn?: string | null; carousel?: number; caption?: string } = {}) {
  const briefId = await seedBrief(db, shop, { endsOn: o.endsOn, channels });
  const posts: SeededPost[] = [];
  for (const c of channels) posts.push(await seedPost(db, shop, briefId, c, { carousel: o.carousel, caption: o.caption }));
  return { briefId, posts };
}

export interface ItemRow {
  id: string;
  post_id: string;
  channel: string;
  slot_at: Date;
  status: string;
  mode: string;
  attempts: number;
  last_error: string | null;
  platform_post_id: string | null;
  permalink: string | null;
}

export const itemsOf = (db: MockDb, brandId: string) =>
  rows<ItemRow>(db, `select id::text as id, post_id::text as post_id, channel::text as channel, slot_at, status, mode, attempts::int as attempts, last_error, platform_post_id, permalink from public.queue_items where brand_id = $1 order by slot_at, channel`, [brandId]);

export const itemOf = async (db: MockDb, postId: string) => (await rows<ItemRow>(db, `select id::text as id, post_id::text as post_id, channel::text as channel, slot_at, status, mode, attempts::int as attempts, last_error, platform_post_id, permalink from public.queue_items where post_id = $1`, [postId]))[0] ?? null;

export const postStatus = async (db: MockDb, postId: string) => (await rows<{ status: string }>(db, "select status::text as status from public.posts where id = $1", [postId]))[0]?.status;

/** Direct write to the queue (a row as the scheduler would have left it). */
export async function seedItem(db: MockDb, shop: Shop, post: SeededPost, o: { slotAt: string; status?: string; mode?: string; attempts?: number }): Promise<string> {
  const [row] = await rows<{ id: string }>(
    db,
    `insert into public.queue_items (brand_id, post_id, channel, slot_at, status, mode, attempts)
     values ($1, $2, $3::public.post_channel, $4::timestamptz, $5, $6, $7) returning id::text as id`,
    [shop.brandId, post.id, post.channel, o.slotAt, o.status ?? "scheduled", o.mode ?? "deliver", o.attempts ?? 0],
  );
  return row.id;
}

export async function connect(db: MockDb, shop: Shop, provider: "instagram" | "facebook", o: { status?: string; expiresAt?: string | null } = {}): Promise<void> {
  await rows(
    db,
    `insert into public.channel_connections (brand_id, provider, account_id, account_name, status, expires_at, connected_by)
     values ($1, $2, $3, 'Corner Bakery', $4, $5::timestamptz, $6)
     on conflict (brand_id, provider) do update set status = excluded.status, expires_at = excluded.expires_at`,
    [shop.brandId, provider, `${provider}-1`, o.status ?? "active", o.expiresAt ?? null, shop.userId],
  );
}

/** Emails to this brand in the mock outbox, oldest first. */
export async function mailOf(shop: Shop, kind?: string): Promise<OutboxEntry[]> {
  const all = await listOutbox(500);
  return all.filter((e) => e.brandId === shop.brandId && (!kind || e.kind === kind)).reverse();
}
