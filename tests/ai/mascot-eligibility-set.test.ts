import { describe, expect, it } from 'vitest';
import set from '../../test-data/mascot-eligibility-20.json';
import { mascotEligibility } from '@/lib/ai/mascot-eligibility';

describe('mascot eligibility on the 20-brand test set (R15 AC)', () => {
  it.each(set.map((b) => [b.id, b.category, b.tone, b.expected_eligible] as const))('%s %s / %s -> %s', (_id, category, tone, expected) => {
    expect(mascotEligibility({ category, tone }).eligible).toBe(expected);
  });
});
