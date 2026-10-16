// POST /api/faces/photo (F-6): one photo of the owner for one or more poses of their draft face. Sign-in check, form
// parsing and error replies; the work is `addOwnerPhoto`. A photo is too big for a server action (1 MB), so this is a route.

import type { NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getCurrentBrand } from '@/lib/brand/current';
import { s } from '@/lib/i18n/strings';
import { describeFaceError } from './describe';
import { addOwnerPhoto, OWNER_PHOTO_MAX_BYTES, type OwnerPhotoDeps } from './photos';
import { FACE_POSES, type FacePose } from './types';

/** Hosting rejects bodies over about 4.5 MB before our code runs; the browser shrinks the photo first. */
const MAX_BODY_BYTES = 4.5 * 1024 * 1024;

const fail = (code: string, message: string, status = 400) => Response.json({ ok: false, code, message }, { status });

export async function handleOwnerPhoto(req: NextRequest, deps?: OwnerPhotoDeps): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return fail('generic', s.errors.signedOut, 401);
  if (Number(req.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) return fail('bad_pose', s.faces.errors.bad_pose, 413);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return fail('bad_pose', s.faces.errors.bad_pose);
  }
  const faceId = form.get('face_id');
  const file = form.get('file');
  const poses = form.getAll('pose').filter((p): p is string => typeof p === 'string');
  if (typeof faceId !== 'string' || !(file instanceof File) || poses.length === 0 || file.size > OWNER_PHOTO_MAX_BYTES) return fail('bad_pose', s.faces.errors.bad_pose);
  if (!poses.every((p) => (FACE_POSES as readonly string[]).includes(p))) return fail('bad_pose', s.faces.errors.bad_pose);

  try {
    // The brand is the signed-in user's current brand (the service checks membership again).
    const brand = await getCurrentBrand(user.id);
    if (!brand) return fail('not_found', s.faces.errors.not_found, 404);
    const saved = await addOwnerPhoto({
      userId: user.id,
      brandId: brand.id,
      faceId,
      poses: poses as FacePose[],
      photo: Buffer.from(await file.arrayBuffer()),
      deps,
    });
    return Response.json({ ok: true, poses: saved.map((p) => p.pose) });
  } catch (e) {
    const f = describeFaceError(e);
    return fail(f.code, f.message, f.code === 'cutout_not_configured' ? 503 : 400);
  }
}
