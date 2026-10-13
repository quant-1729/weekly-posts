import { describe, expect, it } from 'vitest';
import { checkChannelOutput, visibleLength } from '@/lib/ai/checks';
import type { ChannelOutput } from '@/lib/ai/schemas';

const out = (o: Partial<ChannelOutput> & { headline?: string; subline?: string }): ChannelOutput => ({
  caption: o.caption ?? 'ताज़ा जलेबी तैयार है',
  cta: o.cta ?? 'ऑर्डर के लिए WhatsApp करें',
  hashtags: o.hashtags ?? [],
  image_text: { headline: o.headline ?? 'ताज़ा जलेबी', subline: o.subline ?? '', bubble: '' },
});
const codes = (issues: { code: string }[]) => issues.map((i) => i.code);

describe('checkChannelOutput', () => {
  it('accepts a clean Hindi status with WhatsApp in English letters', () => {
    expect(checkChannelOutput('status', out({}), 'hi', 'jalebi')).toEqual([]);
  });

  it('flags a price that is not in the owner sources', () => {
    const issues = checkChannelOutput('status', out({ subline: '₹99 किलो' }), 'hi', 'jalebi 240 kilo');
    expect(issues).toContainEqual(expect.objectContaining({ code: 'unsupported_number', detail: '99' }));
  });

  it('accepts a price that is in the sources, in Devanagari digits too', () => {
    expect(codes(checkChannelOutput('status', out({ subline: '₹२४०' }), 'hi', 'Jalebi — ₹240 per kg'))).toEqual([]);
  });

  it('flags phone numbers and links', () => {
    const c = codes(checkChannelOutput('facebook', out({ caption: 'कॉल करें 98765 43210 या www.shop.in' }), 'hi', ''));
    expect(c.filter((x) => x === 'contact_detail').length).toBeGreaterThanOrEqual(2);
  });

  it('flags invented urgency unless the owner said it', () => {
    const o = out({ caption: 'Fresh jalebi, limited time only', cta: 'WhatsApp karein' });
    expect(codes(checkChannelOutput('facebook', o, 'hinglish', 'jalebi'))).toContain('unsupported_phrase');
    expect(codes(checkChannelOutput('facebook', o, 'hinglish', 'jalebi limited time'))).not.toContain('unsupported_phrase');
  });

  it('flags regulated outcome claims', () => {
    const o = out({ caption: 'Root canal with guaranteed zero pain', cta: 'Message us on WhatsApp' });
    expect(codes(checkChannelOutput('gbp', o, 'en', 'root canal'))).toContain('unsupported_phrase');
  });

  it('flags Devanagari in Hinglish and Latin-heavy Hindi', () => {
    expect(codes(checkChannelOutput('status', out({ caption: 'Aaj जलेबी ready hai', cta: 'WhatsApp karein', headline: 'Jalebi' }), 'hinglish', ''))).toContain('wrong_script');
    expect(codes(checkChannelOutput('status', out({ caption: 'Fresh jalebi ready hai aaj' }), 'hi', ''))).toContain('wrong_script');
  });

  it('enforces caption, image text and hashtag limits', () => {
    const c = codes(checkChannelOutput('status', out({ caption: 'क'.repeat(151), headline: 'ख'.repeat(29), hashtags: ['#a'] }), 'hi', ''));
    expect(c).toEqual(expect.arrayContaining(['too_long', 'hashtag_count']));
  });

  it('counts a Devanagari conjunct as one visible character', () => {
    expect(visibleLength('क्ष')).toBe(1);
  });
});

describe('script check allowances', () => {
  it('allows owner-given product names and units in English letters inside Hindi', () => {
    const o = out({ headline: 'Atta 10 kg बैग', subline: 'सिर्फ ₹420' });
    expect(checkChannelOutput('status', o, 'hi', 'Products: Atta — ₹420 per 10 kg bag')).toEqual([]);
  });
  it('still flags English words the owner never used', () => {
    const o = out({ headline: 'Fresh Atta Sale बैग' });
    expect(checkChannelOutput('status', o, 'hi', 'Atta').map((i) => i.code)).toContain('wrong_script');
  });
});
