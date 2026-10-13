// Mascot eligibility storage (R15a). The rules are the orchestrator's
// (src/lib/ai/mascot-eligibility.ts); this stores the result in
// brand_memory.mascot_eligibility as { eligible, reason, canOverride, checked_at }.

import { mascotEligibility, type MascotEligibility } from '@/lib/ai/mascot-eligibility';
import type { RegulatedGroup } from '@/lib/ai/regulated';
import type { Tx } from '@/lib/db/types';

export interface StoredEligibility extends MascotEligibility {
  checked_at: string;
}

/** What decides eligibility. `regulated` is the owner's choice from settings: null or missing = detect from the category. */
export interface EligibilityInput {
  category: string | null;
  tone: string | null;
  regulated?: RegulatedGroup | 'other' | null;
}

export function computeEligibility(brand: EligibilityInput, now: Date = new Date()): StoredEligibility {
  return {
    ...mascotEligibility({ category: brand.category ?? '', tone: brand.tone ?? '', regulated: brand.regulated ?? null }),
    checked_at: now.toISOString(),
  };
}

/**
 * Recomputes and saves the result. Runs inside the caller's transaction (as the user, so row-level
 * security applies). When the caller does not know the owner's regulated choice (`undefined`), it is
 * read from brand_memory.
 */
export async function storeEligibility(tx: Tx, brandId: string, brand: EligibilityInput): Promise<StoredEligibility> {
  let regulated = brand.regulated;
  if (regulated === undefined) {
    const [row] = await tx.query<{ regulated: RegulatedGroup | 'other' | null }>(
      'select regulated::text as regulated from public.brand_memory where brand_id = $1',
      [brandId],
    );
    regulated = row?.regulated ?? null;
  }
  const value = computeEligibility({ ...brand, regulated });
  await tx.query('update public.brand_memory set mascot_eligibility = $2::jsonb where brand_id = $1', [brandId, JSON.stringify(value)]);
  return value;
}
