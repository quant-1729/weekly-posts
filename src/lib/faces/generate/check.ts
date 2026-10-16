// The vision check of a pose try (Gemini text model with the images) and the choice of the best try. The model call is a
// dependency (`FaceCheckFn`) so tests use fixtures; the selection logic is pure.

import { z } from 'zod';
import { generateJson } from '@/lib/ai/client';
import { FACE_CHECK_JSON_SCHEMA, FACE_CHECK_SYSTEM, FACE_CHECK_USER } from '@/lib/ai/prompts/faces';
import type { FaceCheck } from '../types';

export const faceCheckSchema = z.object({
  sameCharacter: z.boolean(),
  hasText: z.boolean(),
  hasLogo: z.boolean(),
  showsProductOrPremises: z.boolean(),
  credentialCues: z.boolean(),
  extraLimbs: z.boolean(),
  notes: z.string().max(400).default(''),
});

export interface FaceCheckResult {
  check: FaceCheck;
  /** What the check cost (0 in fixture runs). */
  usd: number;
}

/** Compares a candidate with the master. The real one is checkWithGemini; tests pass fakes. */
export type FaceCheckFn = (args: { master: Buffer; candidate: Buffer; brandId?: string }) => Promise<FaceCheckResult>;

export const checkWithGemini: FaceCheckFn = async ({ master, candidate, brandId }) => {
  const { data, stats } = await generateJson({
    system: FACE_CHECK_SYSTEM,
    user: FACE_CHECK_USER,
    media: [
      { mimeType: 'image/png', data: master },
      { mimeType: 'image/png', data: candidate },
    ],
    zodSchema: faceCheckSchema,
    jsonSchema: FACE_CHECK_JSON_SCHEMA,
    temperature: 0,
    ...(brandId ? { logContext: { brandId } } : {}),
  });
  return { check: data, usd: stats?.usd ?? 0 };
};

/** A check passes only when every question is answered and none of the problems is present. */
export function checkPasses(c: FaceCheck): boolean {
  return c.sameCharacter === true && c.hasText === false && c.hasLogo === false && c.showsProductOrPremises === false && c.credentialCues === false && c.extraLimbs === false;
}

/** Problems found, worst first in weight: a different character or a credential cue counts double. An unanswered question is a problem. */
export function checkProblems(c: FaceCheck): number {
  let n = 0;
  if (c.sameCharacter !== true) n += 2;
  if (c.credentialCues !== false) n += 2;
  if (c.hasText !== false) n += 1;
  if (c.hasLogo !== false) n += 1;
  if (c.showsProductOrPremises !== false) n += 1;
  if (c.extraLimbs !== false) n += 1;
  return n;
}

export interface PoseTry {
  png: Buffer;
  check: FaceCheck;
}

export interface BestTry {
  index: number;
  passed: boolean;
}

/**
 * The best of the tries: the first one that passes every check; if none passes, the one with the fewest problems
 * (earlier wins a tie). Null for no tries.
 */
export function pickBestTry(tries: readonly { check: FaceCheck }[]): BestTry | null {
  if (tries.length === 0) return null;
  const passing = tries.findIndex((t) => checkPasses(t.check));
  if (passing >= 0) return { index: passing, passed: true };
  let best = 0;
  for (let i = 1; i < tries.length; i++) if (checkProblems(tries[i].check) < checkProblems(tries[best].check)) best = i;
  return { index: best, passed: false };
}
