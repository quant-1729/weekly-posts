import { describe, expect, it } from 'vitest';
import { findBlockedTerm } from '@/lib/ai/mascot-blocklist';
import { mascotEligibility } from '@/lib/ai/mascot-eligibility';

describe('mascot blocklist (R15g)', () => {
  it.each([
    'Make it look like Shah Rukh Khan',
    'ek chhota Hanuman ji jaisa mascot',
    'गणेश जी वाला मascot',
    'Modi ji ki tarah',
    'something like Chhota Bheem',
    'Amul girl style',
    'a Doraemon type robot',
    'Virat Kohli with a bat',
    'Sai Baba blessing customers',
    'like the Air India Maharaja',
    'Duo the owl but orange',
    'धोनी जैसा',
  ])('refuses: %s', (hint) => {
    expect(findBlockedTerm(hint)).not.toBeNull();
  });

  it.each(['ek cute laddoo', 'a happy chai cup with a scarf', 'smiling samosa', 'मीठा लड्डू', ''])('allows: %s', (hint) => {
    expect(findBlockedTerm(hint)).toBeNull();
  });

  it('ignores the business name itself', () => {
    expect(findBlockedTerm('mascot for Shri Ram Sweets, a laddoo', ['Shri Ram Sweets'])).toBeNull();
    expect(findBlockedTerm('Patel Snacks ka samosa', ['Patel Snacks'])).toBeNull();
  });
});

describe('mascot eligibility (R15a)', () => {
  it('blocks regulated brands with no override', () => {
    expect(mascotEligibility({ category: 'dental clinic', tone: 'Friendly' })).toEqual({ eligible: false, reason: 'regulated', canOverride: false });
  });
  it('treats Premium tone and formal categories as formal, with override', () => {
    expect(mascotEligibility({ category: 'jewellery shop', tone: 'Premium' }).reason).toBe('formal');
    expect(mascotEligibility({ category: 'funeral services', tone: 'Friendly' }).canOverride).toBe(true);
    // v2 (Req 12): legal is a regulated group, so a law firm gets no override.
    expect(mascotEligibility({ category: 'law firm', tone: 'Friendly' }).reason).toBe('regulated');
  });
  it('allows playful brands', () => {
    expect(mascotEligibility({ category: 'sweet shop', tone: 'Festive and lively' }).eligible).toBe(true);
    expect(mascotEligibility({ category: 'jewellery shop', tone: 'Friendly' }).eligible).toBe(true);
    expect(mascotEligibility({ category: 'kirana store', tone: 'Simple and respectful' }).eligible).toBe(true);
  });
});

describe('global blocklist', () => {
  it.each(['make it look like Paddington Bear', 'a Taylor Swift style cupcake', 'like the Michelin man but bread', 'Trump as a donut', 'SpongeBob but a sponge cake', 'a little Minion baker'])('refuses: %s', (hint) => {
    expect(findBlockedTerm(hint)).not.toBeNull();
  });
  it.each(['a happy croissant with a chef hat', 'a friendly coffee cup', 'Crumb the loaf'])('allows: %s', (hint) => {
    expect(findBlockedTerm(hint)).toBeNull();
  });
});

describe('mascot eligibility v2', () => {
  it('treats the v2 professional tone as formal and honours the owner regulated setting', () => {
    expect(mascotEligibility({ category: 'bakery', tone: 'professional' }).reason).toBe('formal');
    expect(mascotEligibility({ category: 'bakery', tone: 'friendly', regulated: 'health' }).reason).toBe('regulated');
    expect(mascotEligibility({ category: 'dental clinic', tone: 'friendly', regulated: 'none' }).eligible).toBe(true);
    expect(mascotEligibility({ category: 'Neighbourhood wine bar', tone: 'playful' }).reason).toBe('regulated');
  });
});
