// Loads what the publisher needs for one queue item (service role): the item, the post (status, words), its pictures
// and, for a carousel, the slides in order. Reads only; the queue changes queue rows, never this code.

import { getDb } from "@/lib/db";
import type { DesignFormat } from "@/lib/design/types";
import type { QueueChannel, QueueMode } from "@/lib/queue/types";

export interface LoadedItem {
  id: string;
  brandId: string;
  postId: string;
  channel: QueueChannel;
  mode: QueueMode;
  platformPostId: string | null;
  permalink: string | null;
}

export interface LoadedPost {
  id: string;
  status: string;
  caption: string | null;
  hashtags: string[];
  /** The picture shows a realistic AI person (posts.design.aiFace): the caption gets the AI disclosure line. */
  aiFace: boolean;
}

/** One picture of a post: format -> path like "renders/{brand}/{post}/{format}.png". */
export type ImageSet = Partial<Record<DesignFormat, string>>;

export interface Loaded {
  item: LoadedItem;
  post: LoadedPost;
  images: ImageSet;
  /** The pictures of the carousel slides in order (empty when the post is not a carousel). */
  slides: ImageSet[];
}

export async function loadForPublish(itemId: string, brandId: string): Promise<Loaded | null> {
  return getDb().withService(async (tx) => {
    const [item] = await tx.query<{ id: string; brand_id: string; post_id: string; channel: QueueChannel; mode: QueueMode; platform_post_id: string | null; permalink: string | null }>(
      `select id::text as id, brand_id::text as brand_id, post_id::text as post_id, channel::text as channel, mode, platform_post_id, permalink
         from public.queue_items where id = $1 and brand_id = $2`,
      [itemId, brandId],
    );
    if (!item) return null;
    const [post] = await tx.query<{ id: string; status: string; caption: string | null; hashtags: string[] | null; carousel_id: string | null; design: { carousel?: { id?: string }; aiFace?: boolean } | null }>(
      `select id::text as id, status::text as status, caption, hashtags, carousel_id::text as carousel_id, design
         from public.posts where id = $1 and brand_id = $2`,
      [item.post_id, brandId],
    );
    if (!post) return null;

    const carouselId = post.carousel_id ?? post.design?.carousel?.id ?? null;
    const slideRows = carouselId
      ? await tx.query<{ id: string }>(
          `select id::text as id from public.posts where brand_id = $1 and carousel_id = $2 order by slide_index`,
          [brandId, carouselId],
        )
      : [];
    const ids = [post.id, ...slideRows.map((r) => r.id)];
    const imageRows = await tx.query<{ post_id: string; format: DesignFormat; image_path: string }>(
      `select post_id::text as post_id, format::text as format, image_path from public.post_images where brand_id = $1 and post_id = any($2::uuid[])`,
      [brandId, ids],
    );
    const byPost = new Map<string, ImageSet>();
    for (const r of imageRows) byPost.set(r.post_id, { ...(byPost.get(r.post_id) ?? {}), [r.format]: r.image_path });

    return {
      item: {
        id: item.id,
        brandId: item.brand_id,
        postId: item.post_id,
        channel: item.channel,
        mode: item.mode,
        platformPostId: item.platform_post_id,
        permalink: item.permalink,
      },
      post: { id: post.id, status: post.status, caption: post.caption, hashtags: post.hashtags ?? [], aiFace: post.design?.aiFace === true },
      images: byPost.get(post.id) ?? {},
      slides: slideRows.map((r) => byPost.get(r.id) ?? {}),
    };
  });
}
