// The mascot in weekly posts (V-25, old R15d and R15e). Server-only helpers for the weekly
// pipeline and the approval operations: which mascot a brand's posts may use, and how a
// pose is turned into the SVG group the renderer's mascot slot takes.
//
// Reads run as the service role: the callers have already checked the link token or the
// user's membership.

import { mascotEligibility } from '@/lib/ai/mascot-eligibility';
import { MASCOT_POSES, type MascotPose } from '@/lib/ai/prompts/mascot';
import { IMAGE_TEXT_LIMITS } from '@/lib/ai/prompts/shared';
import { mascotSpecSchema, type MascotSpec } from '@/lib/ai/schemas';
import { getDb } from '@/lib/db';
import { drawMascot } from './rig';

/** The most characters the mascot's speech bubble may hold. */
export const BUBBLE_MAX_CHARS = IMAGE_TEXT_LIMITS.bubble;

export const DEFAULT_POSE: MascotPose = 'wave';

/** The pose to draw: the stored one when valid, else `wave`. */
export function poseOrDefault(pose: unknown): MascotPose {
  return typeof pose === 'string' && (MASCOT_POSES as readonly string[]).includes(pose) ? (pose as MascotPose) : DEFAULT_POSE;
}

export interface PostMascot {
  id: string;
  name: string;
  personality: string;
  spec: MascotSpec;
}

interface MascotRow {
  id: string;
  name: string;
  concept: { personality?: string } | null;
  spec: unknown;
}

function toPostMascot(r: MascotRow | undefined): PostMascot | null {
  if (!r) return null;
  const spec = mascotSpecSchema.safeParse(r.spec);
  if (!spec.success) return null;
  return { id: r.id, name: r.name, personality: r.concept?.personality ?? '', spec: spec.data };
}

/**
 * The brand's active mascot, or null when it has none or is a regulated business (a cartoon
 * character could make a promise it should not). Formal brands that chose "Try anyway" keep theirs.
 */
export async function loadUsableMascot(brandId: string): Promise<PostMascot | null> {
  const { mem, row } = await getDb().withService(async (tx) => {
    const [mem] = await tx.query<{ category: string | null; tone: string | null; regulated: string | null }>(
      'select category, tone, regulated::text as regulated from public.brand_memory where brand_id = $1',
      [brandId],
    );
    const [row] = await tx.query<MascotRow>(
      "select id::text as id, name, concept, spec from public.mascots where brand_id = $1 and status = 'active'",
      [brandId],
    );
    return { mem, row };
  });
  if (!mem || !row) return null;
  const e = mascotEligibility({
    category: mem.category ?? '',
    tone: mem.tone ?? '',
    regulated: (mem.regulated as Parameters<typeof mascotEligibility>[0]['regulated']) ?? null,
  });
  if (e.reason === 'regulated') return null;
  return toPostMascot(row);
}

/** A mascot of the brand by id, whatever its status: an old post keeps drawing with the mascot it was made with. */
export async function loadMascotById(brandId: string, mascotId: string): Promise<PostMascot | null> {
  const [row] = await getDb().withService((tx) =>
    tx.query<MascotRow>('select id::text as id, name, concept, spec from public.mascots where id = $1 and brand_id = $2', [mascotId, brandId]),
  );
  return toPostMascot(row);
}

/** The renderer's mascot input for a pose. */
export function mascotForRender(spec: MascotSpec, pose: unknown): { svg: string } {
  return { svg: drawMascot(spec, poseOrDefault(pose)) };
}
