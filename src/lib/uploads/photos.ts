// The photo library (Req 4, 5, 9). Photos are cleaned (rotated, metadata and GPS removed, at most
// 2400 px), stored in the "photos" bucket, and described once by the model for the weekly job.
// The model is never allowed to lose an upload: if describing fails, the photo is kept.

import { randomUUID } from "node:crypto";
import { generateJson } from "@/lib/ai/client";
import { PHOTO_DESCRIBE_INSTRUCTION } from "@/lib/ai/prompts/v2-weekly";
import { photoDescribeJsonSchema, photoDescribeSchema } from "@/lib/ai/schemas-v2";
import { requireBrandMember } from "@/lib/brand/current";
import { getDb } from "@/lib/db";
import { s } from "@/lib/i18n/strings";
import { getStorage, type Storage } from "@/lib/storage";
import { assertUnderDailyCap, failedCallUsd, recordUsage } from "@/lib/usage";
import { assertUnderWeeklyCap } from "@/lib/usage/caps";
import { UploadError } from "./errors";
import { describeFixture, type PhotoDescription } from "./fixtures";
import { processUpload, shrinkForModel } from "./image";
import { MAX_PHOTOS, uploadUrl } from "./limits";

export interface PhotoView {
  id: string;
  /** Storage path: `photos/{brand_id}/{photo_id}.jpg`. Show it through /api/files/. */
  storagePath: string;
  url: string;
  description: string | null;
  hasPeople: boolean | null;
  /** The model's quality check, kept so the warning shows on the tile later: false = dark or blurry, null = not checked. */
  usable: boolean | null;
  width: number | null;
  height: number | null;
  createdAt: string;
  /** 'instagram' for photos the owner picked from their Instagram posts. */
  source: "upload" | "instagram";
  /** Link to the original Instagram post, when there is one. */
  sourceUrl: string | null;
}

interface PhotoRow {
  id: string;
  storage_path: string;
  description: string | null;
  has_people: boolean | null;
  usable: boolean | null;
  width: number | null;
  height: number | null;
  created_at: string | Date;
  source: "upload" | "instagram";
  source_url: string | null;
}

const COLUMNS = "id, storage_path, description, has_people, usable, width, height, created_at, source, source_url";

function toView(r: PhotoRow): PhotoView {
  return {
    id: r.id,
    storagePath: r.storage_path,
    url: uploadUrl(r.storage_path) ?? "",
    description: r.description,
    hasPeople: r.has_people,
    usable: r.usable,
    width: r.width,
    height: r.height,
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
    source: r.source,
    sourceUrl: r.source_url,
  };
}

export function photoStoragePath(brandId: string, photoId: string): string {
  return `photos/${brandId}/${photoId}.jpg`;
}

/** Newest first. Runs as the user (row-level security). */
export async function listPhotos(userId: string, brandId: string): Promise<PhotoView[]> {
  const rows = await getDb().withUser(userId, (tx) =>
    tx.query<PhotoRow>(
      `select ${COLUMNS} from public.photos where brand_id = $1 and kind = 'photo' order by created_at desc, id desc`,
      [brandId],
    ),
  );
  return rows.map(toView);
}

export interface AddPhotoResult {
  photo: PhotoView;
  /** Plain-words warning when the model found the photo dark, blurry or not a real photo. The photo is kept. */
  warning: string | null;
}

/**
 * Adds one photo. Throws UploadError (bad_type, too_large, unreadable, empty, photo_limit),
 * BrandAccessError. A failure of the description step never throws: the photo is kept with
 * description null.
 */
export async function addPhoto(args: {
  userId: string;
  brandId: string;
  bytes: Uint8Array;
  mimeType?: string;
  storage?: Storage;
  /** Test/dev override for the model's answer in fixture mode. May throw to simulate a failed call. */
  fixture?: PhotoDescription | (() => PhotoDescription);
  /** Set when the photo comes from the owner's Instagram posts (the import keeps the link back to the post). */
  source?: { id: string; url: string | null; postedAt: string | null };
}): Promise<AddPhotoResult> {
  const { userId, brandId } = args;
  const storage = args.storage ?? getStorage();
  await requireBrandMember(userId, brandId);

  const count = await getDb().withUser(userId, async (tx) => {
    const [r] = await tx.query<{ n: number }>(
      "select count(*)::int as n from public.photos where brand_id = $1 and kind = 'photo'",
      [brandId],
    );
    return r?.n ?? 0;
  });
  if (count >= MAX_PHOTOS) throw new UploadError("photo_limit");

  const img = await processUpload(args.bytes, args.mimeType);

  const id = randomUUID();
  const storagePath = photoStoragePath(brandId, id);
  await storage.put("photos", `${brandId}/${id}.jpg`, img.jpeg, "image/jpeg");
  try {
    await getDb().withUser(userId, (tx) =>
      tx.query(
        `insert into public.photos (id, brand_id, kind, storage_path, width, height, created_by, source, source_id, source_url, source_posted_at)
         values ($1, $2, 'photo', $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          id,
          brandId,
          storagePath,
          img.width,
          img.height,
          userId,
          args.source ? "instagram" : "upload",
          args.source?.id ?? null,
          args.source?.url ?? null,
          args.source?.postedAt ?? null,
        ],
      ),
    );
  } catch (e) {
    await storage.remove("photos", `${brandId}/${id}.jpg`).catch(() => undefined);
    throw e;
  }

  // Describe it. Whatever happens here, the upload stays.
  let warning: string | null = null;
  try {
    await assertUnderDailyCap(brandId);
    await assertUnderWeeklyCap(brandId, "upload_extract");
    const small = await shrinkForModel(img.jpeg);
    const res = await generateJson({
      system: "You describe photos for a small business's photo library.",
      user: PHOTO_DESCRIBE_INSTRUCTION,
      media: [{ mimeType: "image/jpeg", data: small }],
      zodSchema: photoDescribeSchema,
      jsonSchema: photoDescribeJsonSchema,
      temperature: 0,
      timeoutMs: 30_000,
      budgetMs: 45_000,
      logContext: { brandId },
      fixture: args.fixture ?? (() => describeFixture(img.width, img.height)),
    });
    await recordUsage(brandId, userId, "upload_extract", res.stats?.usd ?? 0);
    const description = res.data.description.trim().slice(0, 300) || null;
    await getDb().withUser(userId, (tx) =>
      tx.query("update public.photos set description = $3, has_people = $4, usable = $5 where id = $1 and brand_id = $2", [
        id,
        brandId,
        description,
        res.data.has_people,
        res.data.usable,
      ]),
    );
    if (!res.data.usable) warning = s.uploads.photos.lowQuality;
  } catch (e) {
    const lost = failedCallUsd(e); // an answer that did not validate still cost money (H-2)
    if (lost > 0) await recordUsage(brandId, userId, "upload_extract", lost).catch(() => undefined);
    console.warn("[uploads] could not describe a photo; keeping it without a description", e instanceof Error ? e.message : e);
  }

  const [row] = await getDb().withUser(userId, (tx) =>
    tx.query<PhotoRow>(`select ${COLUMNS} from public.photos where id = $1 and brand_id = $2`, [id, brandId]),
  );
  return { photo: toView(row), warning };
}

/** Removes `photos/{brand_id}/{file}` from the photos bucket. Quiet if the file is already gone. */
export async function removeStoredFile(storage: Storage, storagePath: string | null): Promise<void> {
  if (!storagePath) return;
  const prefix = "photos/";
  const inBucket = storagePath.startsWith(prefix) ? storagePath.slice(prefix.length) : storagePath;
  await storage.remove("photos", inBucket);
}

/** Deletes the row and the stored file. Returns false when there is no such photo. */
export async function removePhoto(args: { userId: string; brandId: string; photoId: string; storage?: Storage }): Promise<boolean> {
  const { userId, brandId, photoId } = args;
  const storage = args.storage ?? getStorage();
  await requireBrandMember(userId, brandId);
  const rows = await getDb().withUser(userId, (tx) =>
    tx.query<{ storage_path: string | null }>(
      "delete from public.photos where id = $1 and brand_id = $2 and kind = 'photo' returning storage_path",
      [photoId, brandId],
    ),
  );
  if (rows.length === 0) return false;
  await removeStoredFile(storage, rows[0].storage_path);
  return true;
}

/** The owner's own answer to "are there people in this photo?". Returns false when there is no such photo. */
export async function setHasPeople(args: { userId: string; brandId: string; photoId: string; hasPeople: boolean }): Promise<boolean> {
  await requireBrandMember(args.userId, args.brandId);
  const rows = await getDb().withUser(args.userId, (tx) =>
    tx.query(
      "update public.photos set has_people = $3 where id = $1 and brand_id = $2 and kind = 'photo' returning id",
      [args.photoId, args.brandId, args.hasPeople === true],
    ),
  );
  return rows.length > 0;
}
