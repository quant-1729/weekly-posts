// Tween as the SVG group a post template's mascot slot takes: authored in the renderer's 400 x 400 mascot space.
// Pure and server-safe.

import type { TweenColors } from './colors';
import { rigPoseFor, type SlotSide } from './poses';
import { tweenParts } from './tween';

/** The part of the rig canvas every post pose fits in (pointing arms reach furthest sideways), so Tween keeps one size. */
const FRAME = { x: -42, y: -12, w: 484, h: 480 };
const BOX = 400;

/**
 * Tween in a pose, scaled into the 400 x 400 mascot space and centred, with the same size in every pose.
 * `side` is where the slot sits in the picture (a pointing hand turns toward the text on the other side);
 * `halo` adds the thin white glow for a dark background.
 */
export function tweenSlotSvg(args: { pose: unknown; colors: TweenColors; side?: SlotSide; halo?: boolean }): string {
  const k = BOX / Math.max(FRAME.w, FRAME.h);
  const tx = (BOX - FRAME.w * k) / 2 - FRAME.x * k;
  const ty = (BOX - FRAME.h * k) / 2 - FRAME.y * k;
  const rig = rigPoseFor(args.pose, args.side ?? 'right');
  return `<g transform="translate(${Math.round(tx * 100) / 100} ${Math.round(ty * 100) / 100}) scale(${Math.round(k * 10000) / 10000})">${tweenParts({ pose: rig, colors: args.colors, halo: args.halo })}</g>`;
}
