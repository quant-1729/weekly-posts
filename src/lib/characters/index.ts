// Brand characters: public entry point. The design engine (CH-2) and the Brand Face card (CH-3) only import from here.

import { BODIES } from './bodies';
import type { CharacterAction, CharacterColors, CharacterDrawing, CharacterId } from './types';
import { drawRig } from './rig';
import { drawTween } from './tween';

export * from './types';

/**
 * Draws one character in one action as a still frame (the action's key time), recoloured to the brand.
 * `mirror` flips it horizontally (anchors are flipped too). Pure and deterministic; never draws text.
 */
export function drawCharacter(
  id: CharacterId,
  action: CharacterAction,
  colors: CharacterColors,
  opts: { mirror?: boolean } = {},
): CharacterDrawing {
  if (id === 'tween') return drawTween(action, colors, opts);
  const body = BODIES[id];
  if (!body) throw new Error(`Unknown character: ${String(id)}`);
  const r = drawRig(body, action, colors, opts);
  return { body: r.full, anchors: r.anchors };
}
