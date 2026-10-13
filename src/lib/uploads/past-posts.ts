// Past posts (Req 4): pasted text, or a screenshot whose text the model reads. They feed the
// voice description (voice.ts). A screenshot that is not a post is not kept.

import { randomUUID } from "node:crypto";
import { generateJson } from "@/lib/ai/client";
import { SCREENSHOT_INSTRUCTION } from "@/lib/ai/prompts/v2-memory";
import { screenshotJsonSchema, screenshotSchema, type Screenshot } from "@/lib/ai/schemas-v2";
import { requireBrandMember } from "@/lib/brand/current";
import { getDb } from "@/lib/db";
import { getStorage, type Storage } from "@/lib/storage";
import { assertUnderDailyCap, failedCallUsd, recordUsage } from "@/lib/usage";
import { assertUnderWeeklyCap } from "@/lib/usage/caps";
import { UploadError } from "./errors";
import { screenshotFixture } from "./fixtures";
import { processUpload, shrinkForModel } from "./image";
import {
  MAX_PAST_POSTS,
  PAST_POST_MAX_CHARS,
  PAST_POST_MIN_CHARS,
  SCREENSHOT_MODEL_PX,
  uploadUrl,
} from "./limits";
import { photoStoragePath, removeStoredFile } from "./photos";

export interface PastPostView {
  id: string;
  text: string;
  /** Set when the post came from a screenshot: the stored image (`photos/{brand_id}/{id}.jpg`). */
  storagePath: string | null;
  imageUrl: string | null;
  createdAt: string;
}

interface PastPostRow {
  id: string;
  extracted_text: string | null;
  storage_path: string | null;
  created_at: string | Date;
}

const COLUMNS = "id, extracted_text, storage_path, created_at";

function toView(r: PastPostRow): PastPostView {
  return {
    id: r.id,
    text: r.extracted_text ?? "",
    storagePath: r.storage_path,
    imageUrl: uploadUrl(r.storage_path),
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
  };
}

/** Trims and checks the length (10-3000 characters). */
export function checkPastPostText(text: unknown): string {
  const t = typeof text === "string" ? text.trim() : "";
  if (t.length < PAST_POST_MIN_CHARS) throw new UploadError("text_too_short");
  if (t.length > PAST_POST_MAX_CHARS) throw new UploadError("text_too_long");
  return t;
}

/** Oldest first, so the voice read sees them in the order the owner added them. */
export async function listPastPosts(userId: string, brandId: string): Promise<PastPostView[]> {
  const rows = await getDb().withUser(userId, (tx) =>
    tx.query<PastPostRow>(
      `select ${COLUMNS} from public.photos where brand_id = $1 and kind = 'past_post' order by created_at asc, id asc`,
      [brandId],
    ),
  );
  return rows.map(toView);
}

async function assertRoomForPastPost(userId: string, brandId: string): Promise<void> {
  const n = await getDb().withUser(userId, async (tx) => {
    const [r] = await tx.query<{ n: number }>(
      "select count(*)::int as n from public.photos where brand_id = $1 and kind = 'past_post'",
      [brandId],
    );
    return r?.n ?? 0;
  });
  if (n >= MAX_PAST_POSTS) throw new UploadError("past_post_limit");
}

/** Throws UploadError (text_too_short, text_too_long, past_post_limit) or BrandAccessError. */
export async function addPastPostText(args: { userId: string; brandId: string; text: string }): Promise<PastPostView> {
  const { userId, brandId } = args;
  await requireBrandMember(userId, brandId);
  const text = checkPastPostText(args.text);
  await assertRoomForPastPost(userId, brandId);
  const [row] = await getDb().withUser(userId, (tx) =>
    tx.query<PastPostRow>(
      `insert into public.photos (brand_id, kind, extracted_text, created_by) values ($1, 'past_post', $2, $3) returning ${COLUMNS}`,
      [brandId, text, userId],
    ),
  );
  return toView(row);
}

/**
 * Stores the screenshot (downscaled, metadata removed) and reads its text. When the model says it
 * is not a post, or the text is empty, the stored image is deleted and UploadError("not_a_post")
 * is thrown. If the model call fails the image is deleted too, and the error is thrown, so the
 * owner can paste the text instead.
 */
export async function addPastPostScreenshot(args: {
  userId: string;
  brandId: string;
  bytes: Uint8Array;
  mimeType?: string;
  storage?: Storage;
  /** Test/dev override for the model's answer in fixture mode. May throw to simulate a failed call. */
  fixture?: Screenshot | (() => Screenshot);
}): Promise<PastPostView> {
  const { userId, brandId } = args;
  const storage = args.storage ?? getStorage();
  await requireBrandMember(userId, brandId);
  await assertRoomForPastPost(userId, brandId);
  const img = await processUpload(args.bytes, args.mimeType);
  await assertUnderDailyCap(brandId);
  await assertUnderWeeklyCap(brandId, "upload_extract");

  const id = randomUUID();
  const storagePath = photoStoragePath(brandId, id);
  const inBucket = `${brandId}/${id}.jpg`;
  await storage.put("photos", inBucket, img.jpeg, "image/jpeg");

  let shot: Screenshot;
  try {
    const res = await generateJson({
      system: "You read screenshots of social media posts for a small business.",
      user: SCREENSHOT_INSTRUCTION,
      media: [{ mimeType: "image/jpeg", data: await shrinkForModel(img.jpeg, SCREENSHOT_MODEL_PX) }],
      zodSchema: screenshotSchema,
      jsonSchema: screenshotJsonSchema,
      temperature: 0,
      timeoutMs: 30_000,
      budgetMs: 45_000,
      logContext: { brandId },
      fixture: args.fixture ?? (() => screenshotFixture(img.jpeg.byteLength)),
    });
    await recordUsage(brandId, userId, "upload_extract", res.stats?.usd ?? 0);
    shot = res.data;
  } catch (e) {
    const lost = failedCallUsd(e); // an answer that did not validate still cost money (H-2)
    if (lost > 0) await recordUsage(brandId, userId, "upload_extract", lost).catch(() => undefined);
    await storage.remove("photos", inBucket).catch(() => undefined);
    throw e;
  }

  const text = shot.text.trim().slice(0, PAST_POST_MAX_CHARS);
  // Nothing there, or not a post: "paste the text instead". Something there but under the 10 characters
  // a pasted post needs: the same "too short" message as for pasted text.
  if (!shot.is_post || text.length === 0) {
    await storage.remove("photos", inBucket).catch(() => undefined);
    throw new UploadError("not_a_post");
  }
  if (text.length < PAST_POST_MIN_CHARS) {
    await storage.remove("photos", inBucket).catch(() => undefined);
    throw new UploadError("text_too_short");
  }

  try {
    const [row] = await getDb().withUser(userId, (tx) =>
      tx.query<PastPostRow>(
        `insert into public.photos (id, brand_id, kind, storage_path, extracted_text, width, height, created_by)
         values ($1, $2, 'past_post', $3, $4, $5, $6, $7) returning ${COLUMNS}`,
        [id, brandId, storagePath, text, img.width, img.height, userId],
      ),
    );
    return toView(row);
  } catch (e) {
    await storage.remove("photos", inBucket).catch(() => undefined);
    throw e;
  }
}

/** The owner's correction of the text read from a screenshot (or of a pasted post). */
export async function updatePastPostText(args: { userId: string; brandId: string; postId: string; text: string }): Promise<PastPostView> {
  const { userId, brandId } = args;
  await requireBrandMember(userId, brandId);
  const text = checkPastPostText(args.text);
  const rows = await getDb().withUser(userId, (tx) =>
    tx.query<PastPostRow>(
      `update public.photos set extracted_text = $3 where id = $1 and brand_id = $2 and kind = 'past_post' returning ${COLUMNS}`,
      [args.postId, brandId, text],
    ),
  );
  if (rows.length === 0) throw new UploadError("not_found");
  return toView(rows[0]);
}

/** Deletes the row and any stored screenshot. Returns false when there is no such post. */
export async function removePastPost(args: { userId: string; brandId: string; postId: string; storage?: Storage }): Promise<boolean> {
  const { userId, brandId, postId } = args;
  const storage = args.storage ?? getStorage();
  await requireBrandMember(userId, brandId);
  const rows = await getDb().withUser(userId, (tx) =>
    tx.query<{ storage_path: string | null }>(
      "delete from public.photos where id = $1 and brand_id = $2 and kind = 'past_post' returning storage_path",
      [postId, brandId],
    ),
  );
  if (rows.length === 0) return false;
  await removeStoredFile(storage, rows[0].storage_path);
  return true;
}
