// The price the owner approves before a generation step runs, and the checks that enforce it (CLAUDE.md: any AI run
// estimated over $0.50 needs the owner's approval; Imagen and Veo included). Pure: no database, no network.

import { FACE_CHECK_USD, FACE_IMAGE_USD, FACE_OPTIONS, FACE_POSES, TRIES_PER_POSE } from '../types';
import { FaceGenError } from './errors';

/** What one face may cost in total, however many times the owner asks again. */
export const FACE_CAP_USD = 2.0;
/** Allowance for one Gemini vision check (src/lib/faces/types.ts); real cost is recorded after. */
export { FACE_CHECK_USD };

export type FaceStep = 'options' | 'sheet' | 'poses';

const micro = (usd: number) => Math.round(usd * 1_000_000);
const ceilCent = (usd: number) => Math.ceil(micro(usd) / 10_000) / 100;

/**
 * Estimate for one step, rounded up to the cent (this is the figure shown to the owner).
 * options: FACE_OPTIONS images. sheet: 1 image. poses: TRIES_PER_POSE images plus a vision check per image, per pose
 * (`count` poses; all seven by default, fewer when the owner redoes one).
 */
export function stepEstimateUsd(step: FaceStep, count?: number): number {
  switch (step) {
    case 'options':
      return ceilCent(FACE_OPTIONS * FACE_IMAGE_USD);
    case 'sheet':
      return ceilCent(FACE_IMAGE_USD);
    case 'poses': {
      const poses = count ?? FACE_POSES.length;
      return ceilCent(poses * TRIES_PER_POSE * (FACE_IMAGE_USD + FACE_CHECK_USD));
    }
  }
}

/** All three steps once: what a first face costs including the vision checks (slightly above faceCreateEstimateUsd). */
export function wholeFaceEstimateUsd(): number {
  return ceilCent(stepEstimateUsd('options') + stepEstimateUsd('sheet') + stepEstimateUsd('poses'));
}

/**
 * Refuses a step the owner has not approved at (at least) its current price, or that would take this face past its cap.
 * `spentUsd` is the face's own spend so far (brand_faces.created_cost_usd).
 */
export function assertStepAllowed(args: { estimateUsd: number; approvedEstimateUsd: unknown; spentUsd: number }): void {
  const approved = args.approvedEstimateUsd;
  if (typeof approved !== 'number' || !Number.isFinite(approved) || approved <= 0 || micro(approved) < micro(args.estimateUsd)) {
    throw new FaceGenError('not_approved', `estimate ${args.estimateUsd.toFixed(2)}`);
  }
  if (micro(args.spentUsd) + micro(args.estimateUsd) > micro(FACE_CAP_USD)) {
    throw new FaceGenError('over_cap', `spent ${args.spentUsd.toFixed(2)} + ${args.estimateUsd.toFixed(2)} > ${FACE_CAP_USD.toFixed(2)}`);
  }
}

/**
 * Keeps one running step inside what the owner approved and inside the face's cap while images are being made.
 * Reserve before each image (its price), settle with the real cost after.
 */
export class StepBudget {
  private spent = 0;
  constructor(
    private readonly approvedUsd: number,
    private readonly facePriorUsd: number,
  ) {}

  /** Throws FaceGenError('over_budget') when one more image would pass the approved amount or the face cap. */
  reserve(usd: number): void {
    if (micro(this.spent) + micro(usd) > micro(this.approvedUsd) || micro(this.facePriorUsd) + micro(this.spent) + micro(usd) > micro(FACE_CAP_USD)) {
      throw new FaceGenError('over_budget');
    }
    this.spent += usd;
  }

  /** Replaces a reservation with what the call really cost (can be a little more with a vision check). */
  settle(reserved: number, actual: number): void {
    this.spent += actual - reserved;
  }

  get totalUsd(): number {
    return this.spent;
  }
}
