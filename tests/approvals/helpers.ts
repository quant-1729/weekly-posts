import sharp from "sharp";
import type { Actor } from "@/lib/approvals/types";
import type { MockDb } from "@/lib/db/mock";
import type { Flag } from "@/lib/guardrail";
import { emailImagePath } from "@/lib/links/image";
import { jtiHash } from "@/lib/links/tokens";
import type { Storage } from "@/lib/storage";
import { seedReadyWeek, type SeededWeek } from "../links/helpers";
import type { WeeklyBrandOpts } from "../weekly/helpers";

export type Row = Record<string, unknown>;

export const emailActor = (jti = "jti-test-1"): Actor => ({ via: "email_link", jtiHash: jtiHash(jti) });
export const dashActor = (userId: string): Actor => ({ via: "dashboard", userId });

export interface FreshWeek extends SeededWeek {
  photoIds: string[];
}

/** A brand with a generated (fixture) week: 4 posts (instagram, facebook with a planted price, linkedin, gbp) and 2 photos. */
export async function freshWeek(db: MockDb, storage: Storage, opts: WeeklyBrandOpts = {}): Promise<FreshWeek> {
  const week = await seedReadyWeek(db, storage, opts);
  const photos = await db.withAdmin((tx) => tx.query<{ id: string }>("select id::text as id from public.photos where brand_id = $1 order by created_at", [week.brandId]));
  return { ...week, photoIds: photos.map((p) => p.id) };
}

export const refOf = (w: { brandId: string; postIds: string[] }, i: number, actor: Actor) => ({ brandId: w.brandId, postId: w.postIds[i], actor });

export async function postRow(db: MockDb, postId: string): Promise<Row> {
  const [r] = await db.withAdmin((tx) =>
    tx.query<Row>(
      `select status::text as status, caption, cta, hashtags, image_text, photo_id::text as photo_id, fact_flags, original,
              edited_at, approved_at, skipped_at, posted_at
         from public.posts where id = $1`,
      [postId],
    ),
  );
  return r;
}

export const flagsOf = async (db: MockDb, postId: string): Promise<Flag[]> => (await postRow(db, postId)).fact_flags as Flag[];

export async function setFlags(db: MockDb, postId: string, flags: Flag[]): Promise<void> {
  await db.withAdmin((tx) => tx.query("update public.posts set fact_flags = $2::jsonb where id = $1", [postId, JSON.stringify(flags)]));
}

export async function setPost(db: MockDb, postId: string, sets: string, params: unknown[] = []): Promise<void> {
  await db.withAdmin((tx) => tx.query(`update public.posts set ${sets} where id = $1`, [postId, ...params]));
}

export const makeFlag = (o: Partial<Flag> & { text: string }): Flag => ({
  id: `f_test_${o.text.length}${o.kind ?? "price"}`,
  kind: "price",
  field: "caption",
  layer: "code",
  regulated: false,
  highlight: true,
  status: "open",
  decided_at: null,
  ...o,
});

export async function actionsOf(db: MockDb, postId: string): Promise<Row[]> {
  return db.withAdmin((tx) =>
    tx.query<Row>("select action::text as action, via, user_id::text as user_id, detail, brand_id::text as brand_id from public.post_actions where post_id = $1 order by id", [postId]),
  );
}

export async function imageBytes(storage: Storage, brandId: string, postId: string, format: "square" | "vertical" | "landscape"): Promise<Buffer> {
  const f = await storage.get("renders", `${brandId}/${postId}/${format}.png`);
  if (!f) throw new Error(`no ${format} image for ${postId}`);
  return Buffer.from(f.bytes);
}

export async function imageRows(db: MockDb, postId: string): Promise<Row[]> {
  return db.withAdmin((tx) => tx.query<Row>("select format::text as format, template_id, image_path from public.post_images where post_id = $1 order by format", [postId]));
}

export async function putEmailImage(storage: Storage, brandId: string, postId: string): Promise<void> {
  const jpg = await sharp({ create: { width: 600, height: 600, channels: 3, background: "#00aa00" } }).jpeg().toBuffer();
  await storage.put("renders", emailImagePath(brandId, postId), jpg, "image/jpeg");
}

export const hasEmailImage = async (storage: Storage, brandId: string, postId: string) =>
  (await storage.get("renders", emailImagePath(brandId, postId))) !== null;
