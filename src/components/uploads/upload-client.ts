// Browser side of the upload routes: shrink the picture, send it, read the reply.

import { downscalePhoto } from "@/lib/image/downscale";
import { s } from "@/lib/i18n/strings";
import { PHOTO_MAX_PX } from "@/lib/uploads/limits";

export type UploadReply<T> = ({ ok: true } & T) | { ok: false; code: string; message: string };

function looksLikeHeic(file: File): boolean {
  return /heic|heif/i.test(file.type) || /\.(heic|heif)$/i.test(file.name);
}

/** Downscales to 2400 px (JPEG) and posts to one of the /api/uploads routes. Never throws. */
export async function postImage<T>(url: string, brandId: string, file: File): Promise<UploadReply<T>> {
  if (looksLikeHeic(file)) return { ok: false, code: "bad_type", message: s.uploads.errors.badType };
  let blob: Blob;
  try {
    blob = await downscalePhoto(file, PHOTO_MAX_PX);
  } catch {
    return { ok: false, code: "unreadable", message: s.uploads.errors.unreadable };
  }
  const form = new FormData();
  form.set("brand_id", brandId);
  form.set("file", blob, "upload.jpg");
  try {
    const res = await fetch(url, { method: "POST", body: form });
    return (await res.json()) as UploadReply<T>;
  } catch {
    return { ok: false, code: "generic", message: s.errors.generic };
  }
}
