// The owner as the face (kind 'owner_photo', F-6): the owner's own photos, background removed, become the pose images.
// No AI makes the face. The original photo is sent to the cut-out service and never stored; only the transparent PNG is
// saved (as an unapproved pose, like the generated kinds), and it goes away with the face (retireFace).
//
// Needs: a draft owner_photo face, the consent confirmed by email (consent.ts), and the cut-out service (CUTOUT_URL).

import { requireBrandMember } from '@/lib/brand/current';
import { FaceError } from './errors';
import { cutout, mattingConfigured, type CutoutFn } from './generate/cutout';
import { FaceGenError } from './generate/errors';
import { getFace, savePoseImage } from './service';
import { FACE_POSES, type FacePose, type FacePoseImage } from './types';
import type { Storage } from '@/lib/storage';

export const OWNER_PHOTO_MAX_BYTES = 10 * 1024 * 1024;

export { mattingConfigured };

/** Test hooks: the cut-out and the storage. */
export interface OwnerPhotoDeps {
  cutout?: CutoutFn;
  storage?: Storage;
}

/**
 * Cuts the photo out and saves it as the image of each pose in `poses` (one photo can fill several poses). The poses are
 * not approved yet; the owner approves each. Throws FaceError (bad_status, needs_consent, bad_pose, not_found) or
 * FaceGenError (cutout_not_configured, cutout_failed).
 */
export async function addOwnerPhoto(args: {
  userId: string;
  brandId: string;
  faceId: string;
  poses: readonly FacePose[];
  photo: Buffer;
  deps?: OwnerPhotoDeps;
}): Promise<FacePoseImage[]> {
  const { userId, brandId, faceId } = args;
  await requireBrandMember(userId, brandId);
  const poses = [...new Set(args.poses)];
  if (poses.length === 0 || !poses.every((p) => (FACE_POSES as readonly string[]).includes(p))) throw new FaceError('bad_pose', 'pose');
  if (args.photo.length === 0 || args.photo.length > OWNER_PHOTO_MAX_BYTES) throw new FaceError('bad_pose', 'size');

  const face = await getFace(userId, brandId, faceId);
  if (face.kind !== 'owner_photo' || face.status !== 'draft') throw new FaceError('bad_status');
  if (!face.consent?.emailConfirmedAt) throw new FaceError('needs_consent');
  const cut = args.deps?.cutout ?? cutout;
  if (!args.deps?.cutout && !mattingConfigured()) throw new FaceGenError('cutout_not_configured');

  const png = await cut(args.photo, 'matting');
  const saved: FacePoseImage[] = [];
  for (const pose of poses) {
    saved.push(await savePoseImage({ userId, brandId, faceId, pose, png, checks: { notes: 'Your own photo.' }, storage: args.deps?.storage }));
  }
  return saved;
}
