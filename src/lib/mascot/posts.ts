// The mascot in weekly posts (V-25, D9). Server-only helpers for the weekly pipeline and the approval
// operations: which mascot a brand's posts may use, its colours, and how a pose is turned into the SVG
// group the renderer's mascot slot takes.
//
// Reads run as the service role: the callers have already checked the link token or the user's membership.

import { mascotEligibility } from '@/lib/ai/mascot-eligibility';
import { IMAGE_TEXT_LIMITS } from '@/lib/ai/prompts/shared';
import { getDb, type Tx } from '@/lib/db';
import type { MascotInput } from '@/lib/render';
import { tweenColorsFor, type BrandColorsInput, type TweenColors } from './colors';
import { DEFAULT_POST_POSE, postPoseOrDefault } from './poses';
import { tweenSlotSvg } from './slot';
import { parseTweenSpec, TWEEN_NAME, TWEEN_PERSONALITY } from './spec';

/** The most characters the mascot's speech bubble may hold. */
export const BUBBLE_MAX_CHARS = IMAGE_TEXT_LIMITS.bubble;

export { DEFAULT_POST_POSE };
export const DEFAULT_POSE = DEFAULT_POST_POSE;

/** The pose to draw: the stored one when valid, else `wave`. */
export const poseOrDefault = postPoseOrDefault;

export interface PostMascot {
  id: string;
  name: string;
  /** Fixed for every brand: what the weekly prompt is told about the character. */
  personality: string;
  /** Tween's colours for this brand (scarf from the owner's choice or the brand palette). */
  colors: TweenColors;
}

interface MascotRow {
  id: string;
  name: string;
  spec: unknown;
}

function toPostMascot(r: MascotRow | undefined, brandColors: BrandColorsInput | null): PostMascot | null {
  if (!r) return null;
  const spec = parseTweenSpec(r.spec); // an older row is drawn as Tween with the defaults
  return { id: r.id, name: r.name.trim() || TWEEN_NAME, personality: TWEEN_PERSONALITY, colors: tweenColorsFor(brandColors, spec.scarf) };
}

async function brandColors(tx: Tx, brandId: string): Promise<BrandColorsInput | null> {
  const [m] = await tx.query<{ colors: BrandColorsInput | null }>('select colors from public.brand_memory where brand_id = $1', [brandId]);
  return m?.colors ?? null;
}

/**
 * The brand's active mascot, or null when it has none or is a regulated business (a cartoon
 * character could make a promise it should not). Formal brands that chose "Try anyway" keep theirs.
 */
export async function loadUsableMascot(brandId: string): Promise<PostMascot | null> {
  const { mem, row, colors } = await getDb().withService(async (tx) => {
    const [mem] = await tx.query<{ category: string | null; tone: string | null; regulated: string | null }>(
      'select category, tone, regulated::text as regulated from public.brand_memory where brand_id = $1',
      [brandId],
    );
    const [row] = await tx.query<MascotRow>("select id::text as id, name, spec from public.mascots where brand_id = $1 and status = 'active'", [brandId]);
    return { mem, row, colors: await brandColors(tx, brandId) };
  });
  if (!mem || !row) return null;
  const e = mascotEligibility({
    category: mem.category ?? '',
    tone: mem.tone ?? '',
    regulated: (mem.regulated as Parameters<typeof mascotEligibility>[0]['regulated']) ?? null,
  });
  if (e.reason === 'regulated') return null;
  return toPostMascot(row, colors);
}

/** A mascot of the brand by id, whatever its status: an old post keeps drawing with the mascot it was made with. */
export async function loadMascotById(brandId: string, mascotId: string): Promise<PostMascot | null> {
  const { row, colors } = await getDb().withService(async (tx) => {
    const [row] = await tx.query<MascotRow>('select id::text as id, name, spec from public.mascots where id = $1 and brand_id = $2', [mascotId, brandId]);
    return { row, colors: await brandColors(tx, brandId) };
  });
  return toPostMascot(row, colors);
}

/**
 * The renderer's mascot input for a pose. The slot decides the side of the picture and whether the background is
 * dark, so a pointing hand turns toward the text and the halo is drawn only where it helps.
 */
export function mascotForRender(colors: TweenColors, pose: unknown): MascotInput {
  return {
    svg: tweenSlotSvg({ pose, colors }),
    build: ({ side, halo }) => tweenSlotSvg({ pose, colors, side, halo }),
  };
}
