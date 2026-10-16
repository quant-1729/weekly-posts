// Small helpers shared by the Face card's parts (src/components/brand/face-*.tsx).

import { downscalePhoto } from "@/lib/image/downscale";
import { s } from "@/lib/i18n/strings";
import { PHOTO_MAX_PX } from "@/lib/uploads/limits";
import type { FacePose } from "@/lib/faces/types";

export const money = (usd: number): string => `$${usd.toFixed(2)}`;

export const poseLabel = (pose: FacePose): string => s.faces.poses[pose];

/** Poses are made two at a time (what the generation code runs together), so every server call stays short. */
export const POSE_BATCH = 2;

export function batches<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export type PhotoReply = { ok: true; poses: FacePose[] } | { ok: false; code: string; message: string };

/** Shrinks the owner's photo in the browser and sends it for the given poses. Never throws. */
export async function uploadOwnerPhoto(faceId: string, poses: readonly FacePose[], file: File): Promise<PhotoReply> {
  if (/heic|heif/i.test(file.type) || /\.(heic|heif)$/i.test(file.name)) return { ok: false, code: "bad_type", message: s.uploads.errors.badType };
  let blob: Blob;
  try {
    blob = await downscalePhoto(file, PHOTO_MAX_PX);
  } catch {
    return { ok: false, code: "unreadable", message: s.uploads.errors.unreadable };
  }
  const form = new FormData();
  form.set("face_id", faceId);
  for (const p of poses) form.append("pose", p);
  form.set("file", blob, "photo.jpg");
  try {
    const res = await fetch("/api/faces/photo", { method: "POST", body: form });
    return (await res.json()) as PhotoReply;
  } catch {
    return { ok: false, code: "generic", message: s.errors.generic };
  }
}
