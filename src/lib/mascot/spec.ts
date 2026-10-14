// What is stored in mascots.spec for a Tween mascot (D9): { v: 2, base: 'tween', scarf }. `scarf` is the colour the
// owner chose, or null to use the brand's colours. Older rows (the v1 parametric mascots) hold something else;
// they are drawn as Tween with the defaults. No server imports.

import { z } from 'zod';

export const tweenSpecSchema = z.object({
  v: z.literal(2),
  base: z.literal('tween'),
  scarf: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .nullable(),
});
export type TweenSpec = z.infer<typeof tweenSpecSchema>;

export const DEFAULT_TWEEN_SPEC: TweenSpec = { v: 2, base: 'tween', scarf: null };

export const TWEEN_NAME = 'Tween';
/** What the weekly prompt is told about the character, whatever the owner calls it. */
export const TWEEN_PERSONALITY = 'friendly, curious and a little playful';

/** The spec of a stored row. Never fails: a v1 row, junk or nothing gives the defaults. */
export function parseTweenSpec(raw: unknown): TweenSpec {
  const r = tweenSpecSchema.safeParse(raw);
  if (!r.success) return DEFAULT_TWEEN_SPEC;
  return { ...r.data, scarf: r.data.scarf ? r.data.scarf.toLowerCase() : null };
}
