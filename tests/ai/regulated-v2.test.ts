import { describe, expect, it } from 'vitest';
import brands from '../../test-data/v2/brands.json';
import { regulatedGroup, resolveRegulated } from '@/lib/ai/regulated';

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
    ['HEalthcare Products', 'health'],
    ['Healthcare software', 'health'],
    ['Health care consulting', 'health'],
    ['Healthtech app', 'health'],
    ['Wellness retreat', 'health'],
    ['Longevity clinic', 'health'],
    ['Medicine delivery', 'health'],
    ['Pharmaceutical distributor', 'health'],
    ['Patient transport', 'health'],
    ['Health food store', 'health'],
    ['Impatient Cafe', 'none'],
    ['Comedic stand-up nights', 'none'],
  ] as const)('%s -> %s', (sell, expected) => expect(regulatedGroup(sell)).toBe(expected));
});

describe('resolveRegulated', () => {
  it('uses the owner setting when set, and detects from what they sell when Automatic (null or empty)', () => {
    expect(resolveRegulated('none', 'Healthcare Products')).toBe('none');
    expect(resolveRegulated('finance', 'Bakery')).toBe('finance');
    expect(resolveRegulated(null, 'HEalthcare Products')).toBe('health');
    expect(resolveRegulated('', 'Wellness retreat')).toBe('health');
    expect(resolveRegulated(undefined, null)).toBe('none');
  });
});
