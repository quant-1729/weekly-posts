// The poses Tween takes in a post (D9). The weekly prompt asks the model for exactly these names; anything else
// (or nothing) becomes `wave`. "point" is drawn as point-left or point-right so the hand points at the post's text.
// No server imports, so client components can use it.

import type { TweenPose } from './tween';

export const TWEEN_POST_POSES = ['wave', 'talk', 'point', 'think', 'celebrate', 'present', 'idle'] as const;
export type TweenPostPose = (typeof TWEEN_POST_POSES)[number];

export const DEFAULT_POST_POSE: TweenPostPose = 'wave';

/** The pose to draw: the stored one when it is one of the 7, else `wave`. */
export function postPoseOrDefault(pose: unknown): TweenPostPose {
  return typeof pose === 'string' && (TWEEN_POST_POSES as readonly string[]).includes(pose) ? (pose as TweenPostPose) : DEFAULT_POST_POSE;
}

/** Which side of the picture the mascot stands on. The post's text is on the other side. */
export type SlotSide = 'left' | 'right';

/**
 * The rig pose for a post pose. A mascot on the right of the picture points left (toward the text) and one on
 * the left points right.
 */
export function rigPoseFor(pose: unknown, side: SlotSide): TweenPose {
  const p = postPoseOrDefault(pose);
  if (p === 'point') return side === 'right' ? 'point-left' : 'point-right';
  return p;
}
