// Choosing the mascot's character (CH-3). The owner picks one of the kit characters, may give it their own name, and it
// becomes the brand's face in posts, the same as turning the mascot switch on. No AI call and no cost.

import { getFaceState, setActiveFace, type FaceState } from './service';
import { FaceError } from './errors';
import { cleanCharacter } from './rules';
import { setMascotInPosts } from '@/lib/mascot/service';

/**
 * Uses `character` as the brand's mascot in posts (`name` is the owner's own name for it; empty = the character's object
 * name). Makes the brand's mascot when there is none (a formal brand confirms with `tryAnyway`, a regulated brand is
 * refused). Throws FaceError (bad_character, bad_name, blocked_name, kind_not_allowed), MascotError or BrandAccessError.
 */
export async function chooseMascotCharacter(args: {
  userId: string;
  brandId: string;
  character: unknown;
  name?: unknown;
  tryAnyway?: boolean;
}): Promise<FaceState> {
  const { userId, brandId } = args;
  const character = cleanCharacter(args.character);
  await setMascotInPosts(userId, brandId, true, { tryAnyway: args.tryAnyway });
  const state = await getFaceState(userId, brandId);
  const face = state.faces.find((f) => f.id === state.activeFaceId && f.kind === 'mascot');
  if (!face) throw new FaceError('not_found');
  return setActiveFace({ userId, brandId, faceId: face.id, inPosts: true, character, name: typeof args.name === 'string' ? args.name : '' });
}
