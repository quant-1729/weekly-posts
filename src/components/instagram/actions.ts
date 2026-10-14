"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { normalizeInstagramHandle } from "@/lib/instagram/handle";
import {
  addInstagramPhotos,
  getInstagramState,
  importInstagram,
  listInstagramImages,
  removeInstagramPosts,
  type InstagramImageView,
  type InstagramState,
} from "@/lib/instagram/import";
import { s } from "@/lib/i18n/strings";
import { describeUploadError, type UploadFailure } from "@/lib/uploads/errors";
import type { PhotoView } from "@/lib/uploads/photos";

export type InstagramActionResult<T = object> = ({ ok: true } & T) | ({ ok: false } & UploadFailure);

const signedOut: UploadFailure = { code: "signed_out", message: s.errors.signedOut };

async function run<T extends object>(fn: (userId: string) => Promise<T>): Promise<InstagramActionResult<T>> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, ...signedOut };
  try {
    return { ok: true, ...(await fn(user.id)) };
  } catch (e) {
    return { ok: false, ...describeUploadError(e) };
  }
}

const str = (v: unknown) => (typeof v === "string" ? v : "");

/** A refresh within this long of the last read is not sent to Instagram again (Meta's limit is per token, shared by every owner). */
const MIN_REFRESH_MS = 30_000;

/** The Instagram card's state after a change. */
export interface InstagramSnapshot {
  state: InstagramState;
  images: InstagramImageView[];
}

async function snapshot(userId: string, brandId: string, images: InstagramImageView[] = []): Promise<InstagramSnapshot> {
  return { state: await getInstagramState(userId, brandId), images };
}

/** "Bring in my recent posts": saves the handle (source: owner) and reads the account now. */
export async function importInstagramAction(brandId: string, handleInput: string): Promise<InstagramActionResult<InstagramSnapshot>> {
  const handle = normalizeInstagramHandle(str(handleInput));
  if (!handle) return { ok: false, code: "generic", message: s.instagram.invalidHandle };
  return run(async (userId) => {
    const out = await importInstagram({ userId, brandId: str(brandId), handle, source: "owner" });
    revalidatePath("/brand");
    return snapshot(userId, str(brandId), out.images);
  });
}

/** "Refresh": reads the saved handle again. */
export async function refreshInstagramAction(brandId: string): Promise<InstagramActionResult<InstagramSnapshot>> {
  return run(async (userId) => {
    const before = await getInstagramState(userId, str(brandId));
    if (!before.handle) return snapshot(userId, str(brandId));
    const recent = before.checkedAt && Date.now() - Date.parse(before.checkedAt) < MIN_REFRESH_MS;
    if (recent) {
      const pics = await listInstagramImages({ userId, brandId: str(brandId) });
      return snapshot(userId, str(brandId), pics.ok ? pics.images : []);
    }
    const out = await importInstagram({ userId, brandId: str(brandId), handle: before.handle, source: before.handleSource ?? "owner" });
    revalidatePath("/brand");
    return snapshot(userId, str(brandId), out.images);
  });
}

/** "Remove Instagram posts": deletes the imported past posts, keeps the handle. */
export async function removeInstagramPostsAction(brandId: string): Promise<InstagramActionResult<InstagramSnapshot>> {
  return run(async (userId) => {
    await removeInstagramPosts({ userId, brandId: str(brandId) });
    revalidatePath("/brand");
    return snapshot(userId, str(brandId));
  });
}

/** "Choose photos from my posts": the pictures of the last read (one Instagram call at most, only when asked). */
export async function loadInstagramImagesAction(brandId: string): Promise<InstagramActionResult<{ images: InstagramImageView[] }>> {
  return run(async (userId) => {
    const r = await listInstagramImages({ userId, brandId: str(brandId) });
    return { images: r.ok ? r.images : [] };
  });
}

export interface AddedInstagramPhotos {
  photos: PhotoView[];
  failed: number;
  limitReached: boolean;
  images: InstagramImageView[];
}

/** "Add to my photos": the chosen pictures, by Instagram media id. */
export async function addInstagramPhotosAction(
  brandId: string,
  mediaIds: string[],
): Promise<InstagramActionResult<AddedInstagramPhotos>> {
  return run(async (userId) => {
    const ids = Array.isArray(mediaIds) ? mediaIds.map(str).filter(Boolean) : [];
    const r = await addInstagramPhotos({ userId, brandId: str(brandId), mediaIds: ids });
    revalidatePath("/brand");
    const pics = await listInstagramImages({ userId, brandId: str(brandId) });
    return {
      photos: r.added.map((a) => a.photo),
      failed: r.failed.length,
      limitReached: r.failed.some((f) => f.code === "photo_limit"),
      images: pics.ok ? pics.images : [],
    };
  });
}
