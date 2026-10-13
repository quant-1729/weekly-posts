import { describe, expect, it } from 'vitest';
import { currenciesCompatible, extractAmounts, findCurrencyMismatches } from '@/lib/guardrail/currency';
import { checkPostDeterministic } from '@/lib/guardrail/deterministic';
import type { GuardrailPost } from '@/lib/guardrail/types';

const f = (value: string, label = '') => ({ label, value, neverUse: false });
const post = (caption: string): GuardrailPost => ({ channel: 'facebook', caption, cta: '', hashtags: [], image_text: { headline: '', subline: '' } });
const check = (caption: string, facts: Array<ReturnType<typeof f>>) =>
  checkPostDeterministic({ post: post(caption), facts, regulated: 'none', wordsToAvoid: [] }).issues;

describe('extractAmounts: symbols and codes', () => {
  it.each([
    ['Loaf £4.50 today', '£4.50', 4.5, 'GBP'],
    ['Loaf $4.50', '$4.50', 4.5, '$'],
    ['Pasta €12', '€12', 12, 'EUR'],
    ['Haircut ₹300', '₹300', 300, 'INR'],
    ['Rs. 250 only', 'Rs. 250', 250, 'INR'],
    ['Rs250', 'Rs250', 250, 'INR'],
    ['Flowers AED 180', 'AED 180', 180, 'AED'],
    ['Flowers 180 AED', '180 AED', 180, 'AED'],
    ['باقة 199 درهم', '199 درهم', 199, 'AED'],
    ['باقة 150 د.إ', '150 د.إ', 150, 'AED'],
    ['Flight S$36', 'S$36', 36, 'SGD'],
    ['Return CAD 150', 'CAD 150', 150, 'CAD'],
    ['Return C$150', 'C$150', 150, 'CAD'],
    ['Pass A$220', 'A$220', 220, 'AUD'],
    ['Service R350', 'R350', 350, 'ZAR'],
    ['Service ZAR 350', 'ZAR 350', 350, 'ZAR'],
    ['Cost US$5', 'US$5', 5, 'USD'],
    ['4,50 €', '4,50 €', 4.5, 'EUR'],
    ['Loaf for four pounds fifty', 'four pounds fifty', 4.5, 'GBP'],
    ['पचास रुपये', 'पचास रुपये', 50, 'INR'],
    ['Only 50 rupees', '50 rupees', 50, 'INR'],
    ['Open 9 to 5', '9', 9, null],
  ])('%s', (text, span, amount, currency) => {
    const a = extractAmounts(text).find((x) => x.text === span);
    expect(a, JSON.stringify(extractAmounts(text))).toBeDefined();
    expect(a!.amount).toBe(amount);
    expect(a!.currency).toBe(currency);
  });

  it('does not read an "R" inside a word as rand', () => {
    expect(extractAmounts('CAR 50 and Bar5').every((a) => a.currency === null)).toBe(true);
  });
});

describe('currency compatibility', () => {
  it('a bare $ fits any dollar, but dollars of different countries do not match each other', () => {
    expect(currenciesCompatible('$', 'AUD')).toBe(true);
    expect(currenciesCompatible('USD', '$')).toBe(true);
    expect(currenciesCompatible('CAD', 'AUD')).toBe(false);
    expect(currenciesCompatible('GBP', '$')).toBe(false);
  });
});

describe('currency mismatch', () => {
  it('flags £4.50 in the facts shown as $4.50 in the post', () => {
    const issues = check('Our sourdough loaf is $4.50 today', [f('£4.50', 'Sourdough loaf')]);
    expect(issues).toEqual([expect.objectContaining({ code: 'currency_mismatch', kind: 'price', text: '$4.50', highlight: true })]);
  });

  it('does not flag "4.50" in the post when the fact is in £', () => {
    expect(check('Our sourdough loaf is 4.50 today', [f('£4.50', 'Sourdough loaf')])).toEqual([]);
  });

  it('does not flag £4.50 when the fact has no currency, or when it matches', () => {
    expect(check('Loaf £4.50', [f('4.50', 'Sourdough loaf')])).toEqual([]);
    expect(check('Loaf £4.50', [f('£4.50', 'Sourdough loaf')])).toEqual([]);
  });

  it('a different amount is an unsupported number, not a currency issue', () => {
    expect(check('Loaf $4.80', [f('£4.50')]).map((i) => i.code)).toEqual(['unsupported_number']);
  });

  it('accepts the fact if any source has the same amount in the same currency', () => {
    expect(check('Loaf $4.50', [f('£4.50'), f('A$4.50')])).toEqual([]);
  });

  it('flags a different dollar: C$ post vs A$ fact', () => {
    const issues = check('Pass C$220', [f('A$220')]);
    expect(issues.map((i) => i.code)).toEqual(['currency_mismatch']);
  });

  it('works for words and for other scripts', () => {
    expect(check('Loaf for four dollars fifty', [f('£4.50')]).map((i) => i.code)).toEqual(['currency_mismatch']);
    expect(check('Loaf for four pounds fifty', [f('£4.50')])).toEqual([]);
    expect(check('الباقة بسعر 199 درهم', [f('AED 199')])).toEqual([]);
  });

  it('findCurrencyMismatches ignores post amounts without a currency', () => {
    const post = extractAmounts('Loaf 4.50');
    expect(findCurrencyMismatches(post, extractAmounts('£4.50'))).toEqual([]);
  });
});
