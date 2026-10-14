import { randomUUID } from "node:crypto";
import type { MockDb } from "@/lib/db/mock";
import type { DesignFormat } from "@/lib/design/types";
import type { Storage } from "@/lib/storage";
import type { Owner } from "../connections/helpers";

export type Images = Partial<Record<DesignFormat, string>>;

/** A storage that hands out public https links, like Cloud Storage. Everything else is not needed. */
export function publicStorage(host = "storage.example.com"): Storage {
  const no = () => {
    throw new Error("not used");
  };
  return {
    put: no,
    get: no,
    remove: no,
    list: no,
    removePrefix: no,
    signedUrl: async (bucket: string, path: string, ttl: number) => `https://${host}/${bucket}/${path}?X-Expires=${ttl}&sig=abc`,
  } as unknown as Storage;
}

const code = () => randomUUID().replace(/-/g, "").slice(0, 8);

export interface SeedPost {
  channel?: "instagram" | "facebook" | "whatsapp" | "linkedin";
  status?: string;
  caption?: string | null;
  hashtags?: string[];
  /** formats -> file name; the stored path becomes renders/{brand}/{post}/{name}. */
  images?: Images;
  /** One entry per carousel slide, each with its own images. */
  slides?: Images[];
  mode?: "publish" | "deliver";
  platformPostId?: string | null;
}

export interface Seeded {
  itemId: string;
  postId: string;
  slideIds: string[];
}

export async function seedPost(db: MockDb, owner: Owner, o: SeedPost = {}): Promise<Seeded> {
  const postId = randomUUID();
  const channel = o.channel ?? "instagram";
  const carouselId = o.slides?.length ? randomUUID() : null;
  const design = carouselId ? JSON.stringify({ v: 1, carousel: { id: carouselId, slides: o.slides!.length } }) : null;
  const path = (id: string, name: string) => `renders/${owner.brandId}/${id}/${name}`;
  const slideIds: string[] = [];

  await db.withAdmin(async (tx) => {
    await tx.query(
      `insert into public.posts (id, brand_id, post_code, status, channel, caption, hashtags, design, created_by)
       values ($1, $2, $3, $4::public.post_status, $5::public.post_channel, $6, $7::text[], $8::jsonb, $9)`,
      [postId, owner.brandId, code(), o.status ?? "approved", channel, o.caption === undefined ? "Fresh sourdough today." : o.caption, o.hashtags ?? ["bakery", "#sourdough"], design, owner.userId],
    );
    for (const [format, name] of Object.entries(o.images ?? { square: "square.png" })) {
      await tx.query(`insert into public.post_images (post_id, brand_id, format, template_id, image_path) values ($1, $2, $3::public.image_format, 't', $4)`, [postId, owner.brandId, format, path(postId, name)]);
    }
    for (let i = 0; i < (o.slides?.length ?? 0); i++) {
      const id = randomUUID();
      slideIds.push(id);
      await tx.query(
        `insert into public.posts (id, brand_id, post_code, status, channel, caption, hashtags, carousel_id, slide_index, created_by)
         values ($1, $2, $3, 'draft', $4::public.post_channel, null, '{}', $5, $6, $7)`,
        [id, owner.brandId, code(), channel, carouselId, i, owner.userId],
      );
      for (const [format, name] of Object.entries(o.slides![i])) {
        await tx.query(`insert into public.post_images (post_id, brand_id, format, template_id, image_path) values ($1, $2, $3::public.image_format, 't', $4)`, [id, owner.brandId, format, path(id, name)]);
      }
    }
  });
  const [item] = await db.withAdmin((tx) =>
    tx.query<{ id: string }>(
      `insert into public.queue_items (brand_id, post_id, channel, slot_at, mode, platform_post_id)
       values ($1, $2, $3::public.post_channel, now(), $4, $5) returning id::text as id`,
      [owner.brandId, postId, channel, o.mode ?? "publish", o.platformPostId ?? null],
    ),
  );
  return { itemId: item.id, postId, slideIds };
}

export const queueRow = async (db: MockDb, itemId: string) =>
  (await db.withAdmin((tx) => tx.query<Record<string, unknown>>("select * from public.queue_items where id = $1", [itemId])))[0];
