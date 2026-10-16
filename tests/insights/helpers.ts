import type { MockDb } from "@/lib/db/mock";
import { saveConnection } from "@/lib/connections/service";
import { FB_INSIGHTS_SCOPES, IG_INSIGHTS_SCOPE } from "@/lib/insights/types";
import type { Provider } from "@/lib/queue/types";
import { NOW, makeShop, rows, seedApproved, seedItem, type Shop } from "../queue/helpers";

export { openDb, closeDb } from "../helpers/details";
export { fakeFetch, graphError, stubMetaEnv, when, type Call, type Reply } from "../connections/helpers";
export { NOW, makeShop, rows, seedApproved, seedItem, type Shop };

export const HOUR = 60 * 60 * 1000;
export const hoursAgo = (h: number, from: Date = NOW) => new Date(from.getTime() - h * HOUR);

/** A token-looking secret, to prove it never shows up in logs, errors or results. */
export const IG_TOKEN = "IGAAtoken-1234567890abcdefghijklmnop";
export const FB_TOKEN = "EAAtoken-1234567890abcdefghijklmnopqrst";

export const SCOPES: Record<Provider, string[]> = {
  instagram: ["instagram_business_basic", "instagram_business_content_publish", IG_INSIGHTS_SCOPE],
  facebook: ["pages_manage_posts", "pages_read_engagement", "pages_show_list", ...FB_INSIGHTS_SCOPES.filter((s) => s !== "pages_read_engagement")],
};

/** Connects the shop's account with an encrypted token (needs stubMetaEnv for the key). */
export async function connectWith(shop: Shop, provider: Provider, scopes: string[] = SCOPES[provider]): Promise<string> {
  const conn = await saveConnection({
    brandId: shop.brandId,
    userId: shop.userId,
    provider,
    accountId: provider === "instagram" ? "17841400000000000" : "100200300",
    accountName: "Corner Bakery",
    scopes,
    platformUserId: null,
    expiresAt: new Date(NOW.getTime() + 30 * 24 * HOUR),
    token: provider === "instagram" ? IG_TOKEN : FB_TOKEN,
  });
  return conn.id;
}

export interface Published {
  itemId: string;
  postId: string;
  briefId: string;
}

/** A published post of the shop: queue item `published` with a platform id, done `ageHours` before `from`. */
export async function seedPublished(
  db: MockDb,
  shop: Shop,
  channel: "instagram" | "facebook",
  o: { ageHours: number; platformPostId?: string; from?: Date; formats?: string[]; carousel?: number; briefId?: string },
): Promise<Published> {
  const x = await seedApproved(db, shop, [channel], { carousel: o.carousel });
  let post = x.posts[0];
  if (o.formats) {
    // Replace the pictures to make a story-only (vertical) or other post.
    await rows(db, "delete from public.post_images where post_id = $1", [post.id]);
    for (const f of o.formats) {
      await rows(db, `insert into public.post_images (post_id, brand_id, format, template_id, image_path) values ($1, $2, $3::public.image_format, 'a', $4)`, [post.id, shop.brandId, f, `renders/${shop.brandId}/${post.id}/${f}.png`]);
    }
  }
  const doneAt = hoursAgo(o.ageHours, o.from ?? NOW).toISOString();
  const itemId = await seedItem(db, shop, post, { slotAt: doneAt, status: "published", mode: "publish" });
  await rows(db, "update public.queue_items set platform_post_id = $2, done_at = $3::timestamptz, permalink = 'https://www.instagram.com/p/abc/' where id = $1", [itemId, o.platformPostId ?? `media-${itemId.slice(0, 8)}`, doneAt]);
  await rows(db, "update public.posts set status = 'posted', posted_at = $2::timestamptz where id = $1", [post.id, doneAt]);
  post = { ...post };
  return { itemId, postId: post.id, briefId: x.briefId };
}

export const metricRows = (db: MockDb, itemId: string) =>
  rows<{ id: string; age_hours: number; fetched_at: Date; reach: number | null; impressions: number | null; likes: number | null; comments: number | null; saves: number | null; shares: number | null; views: number | null }>(
    db,
    "select id::text as id, age_hours::int as age_hours, fetched_at, reach, impressions, likes, comments, saves, shares, views from public.post_metrics where queue_item_id = $1 order by age_hours",
    [itemId],
  );

/** An Instagram insights answer for the given metric names (value = 10 * position, so mapping mistakes show). */
export function igBody(names: string[], shape: "values" | "total" = "values") {
  return {
    data: names.map((name, i) => (shape === "values" ? { name, period: "lifetime", values: [{ value: (i + 1) * 10 }], title: name, id: `m/insights/${name}/lifetime` } : { name, period: "day", total_value: { value: (i + 1) * 10 } })),
  };
}
