// Mascot eligibility (old R15a, kept as an owner-approved extra in v2). Deterministic,
// so the same brand always gets the same answer. Owned by the orchestrator. See docs/mascot.md (eligibility rules).

import { isRegulatedCategory, regulatedGroup, type RegulatedGroup } from './regulated';

export type MascotEligibility = { eligible: boolean; reason: 'regulated' | 'formal' | 'ok'; canOverride: boolean };

const FORMAL_KEYWORDS = [
  'law', 'legal', 'advocate', 'lawyer', 'notary', 'funeral', 'cremation', 'government',
  'contractor', 'consultancy', 'real estate', 'property',
];

/**
 * v1 tones: "Premium" is formal. v2 tones: "professional" is formal (owner can "Try anyway").
 * Regulated: the owner's setting in brand_memory.regulated wins; otherwise detect from the
 * category / what they sell (v2 groups) and the v1 keyword list.
 */
export function mascotEligibility(brand: { category: string; tone: string; regulated?: RegulatedGroup | 'other' | null }): MascotEligibility {
  const regulated =
    brand.regulated != null ? brand.regulated !== 'none' : regulatedGroup(brand.category) !== 'none' || isRegulatedCategory(brand.category);
  if (regulated) return { eligible: false, reason: 'regulated', canOverride: false };
  const c = ` ${brand.category.toLowerCase()} `;
  const formal = FORMAL_KEYWORDS.some((k) => c.includes(k)) || /\b(premium|professional)\b/i.test(brand.tone);
  if (formal) return { eligible: false, reason: 'formal', canOverride: true };
  return { eligible: true, reason: 'ok', canOverride: false };
}
