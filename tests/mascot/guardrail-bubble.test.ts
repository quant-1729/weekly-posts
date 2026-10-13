import { describe, expect, it } from 'vitest';
import { removeFlagText, resolveRemovedSpans } from '@/lib/guardrail/actions';
import { checkPostDeterministic } from '@/lib/guardrail/deterministic';
import { mergeFlags } from '@/lib/guardrail/merge';
import { FLAG_FIELDS, fieldText, type Flag } from '@/lib/guardrail/types';

const f = (value: string, label = '') => ({ label, value, neverUse: false });
const check = (bubble: string, facts = [f('£4.50', 'Sourdough loaf')], wordsToAvoid: string[] = []) =>
  checkPostDeterministic({
    post: { channel: 'instagram', caption: 'Fresh bread today.', cta: 'Message us.', hashtags: [], image_text: { headline: 'Fresh bread', subline: '', bubble } },
    facts,
    regulated: 'none',
    wordsToAvoid,
  });

describe('image_text.bubble is a guardrail field (V-25)', () => {
  it('is in the list of checked fields and read by fieldText', () => {
    expect(FLAG_FIELDS).toContain('image_text.bubble');
    const post = { caption: 'c', cta: 'd', image_text: { headline: 'h', subline: 's', bubble: 'Hello!' } };
    expect(fieldText(post, 'image_text.bubble')).toBe('Hello!');
    expect(fieldText({ ...post, image_text: { headline: 'h', subline: 's' } }, 'image_text.bubble')).toBe('');
  });

  it('flags a price in the bubble that is not in the facts, with its exact text', () => {
    const r = check('Only £3.90 today!');
    expect(r.issues).toEqual([expect.objectContaining({ field: 'image_text.bubble', code: 'unsupported_number', kind: 'price', text: '£3.90', highlight: true })]);
    const i = r.issues[0];
    expect('Only £3.90 today!'.slice(i.start, i.end)).toBe('£3.90');
  });

  it('flags a currency written with a symbol the facts do not use, a phone number and a risky phrase', () => {
    expect(check('Just $17.99 today').issues.map((i) => i.field)).toEqual(['image_text.bubble']);
    expect(check('Call 020 7946 0999!').issues.map((i) => i.code)).toContain('contact_detail');
    expect(check('Free delivery for everyone!').issues.length).toBeGreaterThan(0);
  });

  it('accepts a price that is in the facts, and plain friendly words', () => {
    expect(check('Loaf only £4.50!').issues).toEqual([]);
    expect(check('Come and say hello!').issues).toEqual([]);
    expect(check('').issues).toEqual([]);
  });

  it('applies the words to avoid to the bubble', () => {
    const r = check('So cheap today', [], ['cheap']);
    expect(r.issues).toEqual([expect.objectContaining({ field: 'image_text.bubble', code: 'avoid', text: 'cheap' })]);
  });

  it('shows up in the merged flags on the right field, and can be removed from the bubble', () => {
    const post = { channel: 'instagram' as const, caption: 'Fresh bread today.', cta: 'Message us.', hashtags: [], image_text: { headline: 'Fresh bread', subline: '', bubble: 'Only £3.90 today!' } };
    const det = checkPostDeterministic({ post, facts: [f('£4.50')], regulated: 'none', wordsToAvoid: [] }).issues;
    const flags = mergeFlags({ post, det, ai: [], brandRegulated: false, now: new Date('2026-12-21T08:00:00Z') });
    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatchObject({ field: 'image_text.bubble', kind: 'price', text: '£3.90', status: 'open', layer: 'code' });

    const edited = removeFlagText(post, flags[0]);
    expect(edited.image_text.bubble).toBe('Only today!');
    expect(edited.image_text.headline).toBe('Fresh bread');
    const after = resolveRemovedSpans(edited, flags);
    expect(after[0].status).toBe('removed' satisfies Flag['status']);
  });
});
