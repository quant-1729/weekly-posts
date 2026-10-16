// Which face the brand's posts use, read inside the caller's transaction. Shared by the post pipeline
// (`loadCreateBrand`) and the face service.
//
// The rules (docs/10 section 2, keeping older code working):
//   - brand_memory.active_face_id + face_in_posts say which face is on; brand_memory.mascot_in_posts is kept equal to
//     "the active face is a mascot and it is on" by the service, and older code (the mascot switch, the weekly
//     pipeline) still reads and writes it.
//   - A mascot face is on when mascot_in_posts is on (the old switch stays the truth for Tween).
//   - A brand with mascot_in_posts on and no face row yet (set by code that predates faces) gets Tween.
//   - Any other face is on when face_in_posts is on, it is approved and all 7 poses are there and approved.
//   - A realistic AI person is never used by a health, finance, legal or alcohol brand, whatever is saved.

import type { CharacterId } from '@/lib/characters/types';
import type { CreateFace } from '@/lib/create/types';
import type { Tx } from '@/lib/db';
import { facePoseStored } from './paths';
import { FACE_POSES, faceKindAllowed, type FaceKind, type FacePlacement, type FacePose } from './types';
import type { PostType } from '@/lib/briefs/types';

interface ActiveRow {
  mascot_in_posts: boolean | null;
  face_in_posts: boolean | null;
  regulated: string | null;
  face_id: string | null;
  kind: FaceKind | null;
  name: string | null;
  character: CharacterId | null;
  status: string | null;
  never_say: string[] | null;
  post_types: PostType[] | null;
  placement: FacePlacement | null;
}

export const TWEEN_FACE_NAME = 'Tween';

/** The face to draw for a brand, or null. Reads as the transaction's role (row-level security applies to a user). */
export async function readActiveFace(tx: Tx, brandId: string, regulated?: string): Promise<CreateFace | null> {
  const [m] = await tx.query<ActiveRow>(
    `select m.mascot_in_posts, m.face_in_posts, m.regulated::text as regulated, f.id::text as face_id, f.kind, f.name, f.character, f.status,
            f.never_say, f.post_types::text[] as post_types, f.placement
       from public.brand_memory m
       left join public.brand_faces f on f.id = m.active_face_id and f.brand_id = m.brand_id
      where m.brand_id = $1`,
    [brandId],
  );
  if (!m) return null;
  const reg = regulated ?? m.regulated ?? 'none';

  const base = (kind: FaceKind, name: string, id: string | null, poses: CreateFace['poses']): CreateFace => ({
    id,
    kind,
    name,
    poses,
    placement: m.placement ?? {},
    neverSay: m.never_say ?? [],
    postTypes: m.post_types && m.post_types.length > 0 ? m.post_types : null,
    // A mascot made before characters existed (null) is Tween.
    ...(kind === 'mascot' ? { character: m.character ?? ('tween' as const) } : {}),
  });

  if (m.face_id && m.kind && m.status === 'approved') {
    if (m.kind === 'mascot') return m.mascot_in_posts ? base('mascot', m.name ?? TWEEN_FACE_NAME, m.face_id, null) : null;
    if (!m.face_in_posts || !faceKindAllowed(m.kind, reg)) return null;
    const poses = await tx.query<{ pose: FacePose; approved_at: string | null }>(
      'select pose, approved_at from public.brand_face_poses where face_id = $1 and brand_id = $2',
      [m.face_id, brandId],
    );
    const ok = new Set(poses.filter((p) => p.approved_at).map((p) => p.pose));
    if (!FACE_POSES.every((p) => ok.has(p))) return null;
    const map = {} as Record<FacePose, string>;
    for (const p of FACE_POSES) map[p] = facePoseStored(brandId, m.face_id, p);
    return base(m.kind, m.name ?? '', m.face_id, map);
  }
  // No usable active face: the old switch alone means Tween.
  if (m.mascot_in_posts && !m.face_id) return { id: null, kind: 'mascot', name: TWEEN_FACE_NAME, character: 'tween', poses: null, placement: {}, neverSay: [], postTypes: null };
  return null;
}
