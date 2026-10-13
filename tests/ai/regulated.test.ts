import { describe, expect, it } from 'vitest';
import brands from '../../test-data/brands.json';
import { isRegulatedCategory } from '@/lib/ai/regulated';

describe('isRegulatedCategory', () => {
  it.each(brands.map((b) => [b.category, b.regulated] as const))('%s -> %s', (category, regulated) => {
    expect(isRegulatedCategory(category)).toBe(regulated);
  });
  it.each(['salon', 'gym and personal training', 'kirana store', 'mobile repair shop', 'restaurant'])(
    '%s is not regulated',
    (c) => expect(isRegulatedCategory(c)).toBe(false),
  );
});
