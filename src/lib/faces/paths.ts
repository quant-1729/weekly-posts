// Where a face's files live. Pose PNGs sit in the `mascots` bucket (a face is the mascot, generalised) under
// `{brand_id}/faces/{face_id}/`, so account export lists them as `mascots/faces/...` and account deletion removes them
// with the brand's prefix. The database holds the "{bucket}/{brand_id}/..." form, like photos.

import type { FacePose } from './types';

export const FACE_BUCKET = 'mascots' as const;

/** Bucket-relative path of a pose image. */
export const facePoseRel = (brandId: string, faceId: string, pose: FacePose) => `${brandId}/faces/${faceId}/${pose}.png`;
/** The prefix of everything stored for one face. */
export const faceFolder = (brandId: string, faceId: string) => `${brandId}/faces/${faceId}`;
/** The form saved in `brand_face_poses.storage_path`. */
export const facePoseStored = (brandId: string, faceId: string, pose: FacePose) => `${FACE_BUCKET}/${facePoseRel(brandId, faceId, pose)}`;

/** Bucket-relative part of a stored path, or null when it is not in the faces bucket. */
export function relOfStored(stored: string): string | null {
  return stored.startsWith(`${FACE_BUCKET}/`) ? stored.slice(FACE_BUCKET.length + 1) : null;
}
