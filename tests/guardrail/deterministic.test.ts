import { describe, expect, it } from 'vitest';
import { avoidIssues, checkPostDeterministic, findContactSpans } from '@/lib/guardrail/deterministic';
import type { GuardrailPost, RegulatedKind } from '@/lib/guardrail/types';

const f = (value: string, label = '', neverUse = false) => ({ label, value, neverUse });
function run(
  p: Partial<GuardrailPost> & { headline?: string; subline?: string },
  facts: Array<ReturnType<typeof f>> = [],
  o: { regulated?: RegulatedKind; wordsToAvoid?: string[]; confirmed?: string[] } = {},
) {
  return checkPostDeterministic({
    post: {
      channel: p.channel ?? 'facebook',
      caption: p.caption ?? '',
      cta: p.cta ?? '',
      hashtags: p.hashtags ?? [],
      image_text: p.image_text ?? { headline: p.headline ?? '', subline: p.subline ?? '' },
    },
    facts,
    regulated: o.regulated ?? 'none',
    wordsToAvoid: o.wordsToAvoid ?? [],
    confirmed: o.confirmed,
  });
}
const texts = (r: ReturnType<typeof run>) => r.issues.map((i) => i.text);
const codes = (r: ReturnType<typeof run>) => r.issues.map((i) => i.code);

describe('numbers', () => {
  const facts = [f('£4.50', 'Sourdough loaf'), f('8am to 5pm', 'Hours')];

  it('accepts numbers that are in the facts and flags the rest, with the exact text', () => {
    const r = run({ caption: 'Loaf £4.50, open 8am to 5pm, or £3.90 after 5pm' }, facts);
    expect(r.issues).toEqual([expect.objectContaining({ code: 'unsupported_number', kind: 'price', text: '£3.90', field: 'caption', highlight: true })]);
    const i = r.issues[0];
    expect('Loaf £4.50, open 8am to 5pm, or £3.90 after 5pm'.slice(i.start, i.end)).toBe('£3.90');
  });

  it('compares number words with digits on both sides', () => {
    expect(run({ caption: 'Loaf for four pounds fifty' }, facts).issues).toEqual([]);
    expect(run({ caption: 'Loaf £4.50' }, [f('four pounds fifty', 'Loaf')]).issues).toEqual([]);
    expect(texts(run({ caption: 'Loaf for four pounds sixty' }, facts))).toEqual(['four pounds sixty']);
  });

  it('reads Hindi number words and Devanagari digits', () => {
    const hi = [f('₹240', 'काजू कतली')];
    expect(run({ caption: 'सिर्फ दो सौ चालीस रुपये' }, hi).issues).toEqual([]);
    expect(run({ caption: 'सिर्फ ₹२४०' }, hi).issues).toEqual([]);
    expect(run({ caption: 'डेढ़ सौ रुपये में' }, hi).issues.map((i) => i.text)).toEqual(['डेढ़ सौ रुपये']);
    expect(run({ caption: '2 सौ 50 रुपये' }, hi).issues.map((i) => i.code)).toEqual(['unsupported_number']);
  });

  it('reads Arabic-Indic digits', () => {
    expect(run({ caption: 'السعر ١٩٩ درهم' }, [f('AED 199')]).issues).toEqual([]);
    expect(run({ caption: 'السعر ٢٩٩ درهم' }, [f('AED 199')]).issues.map((i) => i.text)).toEqual(['٢٩٩ درهم']);
  });

  it('takes the span with am/pm and % and tells hours and offers from prices', () => {
    const r = run({ caption: 'Open till 10pm, 20% off' }, facts);
    expect(r.issues.map((i) => [i.text, i.kind])).toEqual([
      ['10pm', 'hours'],
      ['20%', 'offer'],
    ]);
  });

  it('does not flag a lone "one"', () => {
    expect(run({ caption: 'One of our best loaves, one by one' }, facts).issues.map((i) => i.text)).not.toContain('One');
  });

  it('finds numbers in cta and image text too', () => {
    const r = run({ cta: 'Order 3 today', headline: 'Only 99', subline: 'Since 1990' }, facts);
    expect(r.issues.map((i) => [i.field, i.text])).toEqual([
      ['cta', '3'],
      ['image_text.headline', '99'],
      ['image_text.subline', '1990'],
    ]);
  });

  it('treats texts the owner confirmed as sources', () => {
    expect(run({ caption: 'Now £3.90!' }, facts, { confirmed: ['£3.90'] }).issues).toEqual([]);
  });
});

describe('phones, links and email', () => {
  const facts = [f('+44 20 7946 0183', 'Phone'), f('https://www.bakery.example.com/order', 'Order')];

  it('accepts the fact phone in any layout, even national format', () => {
    expect(run({ cta: 'Call +44 20 7946 0183' }, facts).issues).toEqual([]);
    expect(run({ cta: 'Call 020 7946 0183' }, facts).issues).toEqual([]);
    expect(run({ cta: 'Call 02079460183.' }, facts).issues).toEqual([]);
  });

  it('flags a wrong phone once: the digits inside it are not extra number flags', () => {
    const r = run({ cta: 'Call +44 20 7946 0999 now' }, facts);
    expect(r.issues).toHaveLength(1);
    expect(r.issues[0]).toMatchObject({ code: 'contact_detail', kind: 'phone', text: '+44 20 7946 0999', highlight: true });
  });

  it('knows US, Indian, Emirati and South African layouts', () => {
    expect(findContactSpans('Call (503) 555-0199 to book').map((s) => s.text)).toEqual(['(503) 555-0199']);
    expect(findContactSpans('WhatsApp 98765 43210').map((s) => s.text)).toEqual(['98765 43210']);
    expect(findContactSpans('+971 4 555 0177').map((s) => s.text)).toEqual(['+971 4 555 0177']);
    expect(findContactSpans('Call +27 21 555 0136.').map((s) => s.text)).toEqual(['+27 21 555 0136']);
    expect(findContactSpans('اتصل على ٠٥٠ ١٢٣ ٤٥٦٧').map((s) => s.text)).toEqual(['٠٥٠ ١٢٣ ٤٥٦٧']);
  });

  it('does not take dates, year ranges, postcodes and price lists for phones', () => {
    expect(findContactSpans('Valid 2026-10-19 and 2009-2011, postcode 069414, SE5 8QJ, M4Y 1J4')).toEqual([]);
    expect(findContactSpans('Prices 4.50 5.50 6.50')).toEqual([]);
  });

  it('accepts a link that is in the facts and flags another', () => {
    expect(run({ cta: 'Order at www.bakery.example.com/order' }, facts).issues).toEqual([]);
    const r = run({ cta: 'Order at https://shop.example.net/buy.' }, facts);
    expect(r.issues.map((i) => [i.code, i.text])).toEqual([['contact_detail', 'https://shop.example.net/buy']]);
  });

  it('flags an email that is not a fact', () => {
    const r = run({ cta: 'Write to hello@bakery.com' }, facts);
    expect(r.issues.map((i) => i.text)).toEqual(['hello@bakery.com']);
  });
});

describe('risky phrases', () => {
  it('flags unsupported claims and offers, whole words only', () => {
    const r = run({ caption: 'Guaranteed to cure. Free delivery. A great manicure and a secure door.' });
    expect(texts(r)).toEqual(['Guaranteed', 'cure', 'Free delivery']);
    expect(r.issues.map((i) => i.kind)).toEqual(['claim', 'claim', 'offer']);
  });

  it('allows a phrase the facts contain', () => {
    expect(run({ caption: 'Free delivery on orders over £30' }, [f('Free delivery on orders over £30')]).issues).toEqual([]);
  });

  it('marks claims in regulated brands as regulated', () => {
    expect(run({ caption: 'Pain-free care' }, [], { regulated: 'health' }).issues[0]).toMatchObject({ text: 'Pain-free', regulated: true });
    expect(run({ caption: 'Pain-free care' }).issues[0]).toMatchObject({ regulated: false });
  });

  it('does not trust a NEVER USE fact in a regulated brand, but does in an unregulated one', () => {
    const facts = [f('Pain-free dentistry guaranteed', 'Banner', true)];
    expect(texts(run({ caption: 'Pain-free dentistry guaranteed' }, facts, { regulated: 'health' }))).toEqual(['Pain-free', 'guaranteed']);
    expect(run({ caption: 'Pain-free dentistry guaranteed' }, facts, { regulated: 'none' }).issues).toEqual([]);
  });
});

describe('words to avoid (Req 13)', () => {
  it('matches whole words only', () => {
    expect(texts(run({ caption: 'Cheap and cheerful, not on Cheapside' }, [], { wordsToAvoid: ['cheap'] }))).toEqual(['Cheap']);
  });

  it('is case-insensitive and finds every occurrence, in caption, cta and image text', () => {
    const r = run({ caption: 'CHEAP bread, cheap tricks', cta: 'Cheap!', headline: 'Not Cheap', subline: '' }, [], { wordsToAvoid: ['cheap'] });
    expect(r.issues.map((i) => [i.field, i.text, i.kind])).toEqual([
      ['caption', 'CHEAP', 'avoid'],
      ['caption', 'cheap', 'avoid'],
      ['cta', 'Cheap', 'avoid'],
      ['image_text.headline', 'Cheap', 'avoid'],
    ]);
  });

  it('matches after NFC normalisation', () => {
    const nfd = 'Un café pour vous'; // "café" with a combining accent
    const issues = avoidIssues('caption', nfd, ['café']);
    expect(issues).toHaveLength(1);
    expect(issues[0].text).toBe('café');
    expect(issues[0].highlight).toBe(false); // the composed text is not a substring of the stored decomposed text
    const composed = avoidIssues('caption', 'Un café pour vous', ['café']);
    expect(composed).toHaveLength(1);
    expect(composed[0]).toMatchObject({ text: 'café', highlight: true, start: 3 });
  });

  it('handles phrases, Hindi and punctuation next to the word', () => {
    expect(texts(run({ caption: 'Our "best price" deal!' }, [], { wordsToAvoid: ['best  price'] }))).toEqual(['best price']);
    expect(texts(run({ caption: 'बेहतरीन केक, बेहतरीनता' }, [], { wordsToAvoid: ['बेहतरीन'] }))).toEqual(['बेहतरीन']);
    expect(texts(run({ caption: 'Cheap.' }, [], { wordsToAvoid: ['cheap', '', '  '] }))).toEqual(['Cheap']);
  });

  it('escapes regex characters', () => {
    const r = run({ caption: 'Buy (now) for a b and a.b' }, [], { wordsToAvoid: ['(now)', 'a.b'] });
    expect(r.issues.map((i) => i.text)).toEqual(['(now)', 'a.b']);
  });

  it('is not merged with a fact flag: a word to avoid is its own reason', () => {
    const r = run({ caption: 'Guaranteed cheap' }, [], { wordsToAvoid: ['guaranteed'] });
    expect(codes(r).sort()).toEqual(['avoid', 'unsupported_phrase']);
  });
});

describe('channel limits', () => {
  it('returns caption length and hashtag count problems separately, not as flags', () => {
    const r = run({ channel: 'gbp', caption: 'x'.repeat(1001), hashtags: ['#a', '#b', '#c', '#d'] });
    expect(r.issues).toEqual([]);
    expect(r.formatIssues).toEqual([
      { field: 'caption', code: 'too_long', detail: '1001 > 1000' },
      { field: 'hashtags', code: 'hashtag_count', detail: '4, expected 0-3' },
    ]);
  });

  it('uses each channel\'s own limits', () => {
    expect(run({ channel: 'instagram', caption: 'x'.repeat(1200), hashtags: ['#a', '#b'] }).formatIssues).toEqual([{ field: 'hashtags', code: 'hashtag_count', detail: '2, expected 3-8' }]);
    expect(run({ channel: 'linkedin', caption: 'x'.repeat(1300), hashtags: ['#a', '#b', '#c'] }).formatIssues).toEqual([]);
    expect(run({ channel: 'facebook', caption: 'x'.repeat(1201), hashtags: ['#a', '#b', '#c'] }).formatIssues).toHaveLength(1);
  });

  it('counts what a reader sees: a Devanagari conjunct is one character', () => {
    expect(run({ channel: 'gbp', caption: 'क्ष'.repeat(1000), hashtags: [] }).formatIssues).toEqual([]);
  });
});
