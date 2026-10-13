import { describe, expect, it } from 'vitest';
import brands from '../../test-data/v2/brands.json';
import { regulatedGroup } from '@/lib/ai/regulated';

describe('regulatedGroup (v2)', () => {
  it.each(brands.map((b) => [b.id, b.what_they_sell, b.regulated] as const))('%s: %s -> %s', (_id, sell, expected) => {
    expect(regulatedGroup(sell)).toBe(expected);
  });
  it.each([
    ['Family law firm in Toronto', 'legal'],
    ['Craft brewery and taproom', 'alcohol'],
    ['Wedding cakes and cupcakes', 'none'],
    ['Bike repair and servicing', 'none'],
    ['Barbershop', 'none'],
    ['Taxi and airport transfers', 'none'],
    ['Neighbourhood wine bar', 'alcohol'],
    ['Physiotherapy for sports injuries', 'health'],
  ] as const)('%s -> %s', (sell, expected) => expect(regulatedGroup(sell)).toBe(expected));
});
