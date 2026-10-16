// Post filter presets (UX-2): the names, the stored shape and the validation. Safe to import from client components
// (no image library). The pixels are changed in ./filters.

import { z } from 'zod';

export const POST_FILTER_PRESETS = ['none', 'warm', 'cool', 'vivid', 'soft', 'mono', 'vintage'] as const;
export type PostFilterPreset = (typeof POST_FILTER_PRESETS)[number];

export const postFilterSchema = z.object({
  preset: z.enum(POST_FILTER_PRESETS),
  /** 0 = the picture as it is, 100 = the full look of the preset. */
  intensity: z.number().int().min(0).max(100),
});
export type PostFilter = z.infer<typeof postFilterSchema>;

/** What a post has before the owner picks one. */
export const DEFAULT_POST_FILTER: PostFilter = { preset: 'none', intensity: 100 };

/** Display names for the Design step's filter buttons. */
export const POST_FILTER_LABELS: Record<PostFilterPreset, string> = {
  none: 'None',
  warm: 'Warm',
  cool: 'Cool',
  vivid: 'Vivid',
  soft: 'Soft',
  mono: 'Black & white',
  vintage: 'Vintage',
};

/** True when the filter changes pixels (a preset other than "none" at an intensity above 0). */
export function filterActive(f: PostFilter | null | undefined): f is PostFilter {
  return !!f && f.preset !== 'none' && f.intensity > 0;
}

/** Reads a stored or posted filter: anything invalid becomes "none" (never throws). */
export function parsePostFilter(v: unknown): PostFilter {
  const r = postFilterSchema.safeParse(v);
  return r.success ? r.data : DEFAULT_POST_FILTER;
}
