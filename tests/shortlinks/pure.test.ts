import { describe, expect, it } from 'vitest';
import { V2_CHANNELS, V2_CHANNEL_SPECS } from '@/lib/ai/prompts/v2-weekly';
import { firstClickInWindow, isBotUserAgent, isPrefetch, resetClickDedupe } from '@/lib/shortlinks/bots';
import { composeShareText } from '@/lib/shortlinks/compose';
import { pickDestination, withUtm } from '@/lib/shortlinks/destination';
import { buildShortLink } from '@/lib/shortlinks/link';
import { shortLinkFor } from '@/lib/shortlinks';

const BASE = 'https://app.example.com';
const post = (channel: (typeof V2_CHANNELS)[number]) => ({
  channel,
  caption: ' Fresh sourdough today. ',
  cta: 'Order now.',
  hashtags: ['#bread', ' #local ', ''],
  postCode: 'abc1234',
});

describe('composeShareText', () => {
  it.each(V2_CHANNELS)('%s: link only where the channel allows a clickable link', (channel) => {
    const clickable = V2_CHANNEL_SPECS[channel].clickableLink;
    const withLink = composeShareText(post(channel), { includeLink: true, baseUrl: BASE });
    const without = composeShareText(post(channel), { includeLink: false, baseUrl: BASE });
    expect(without).toBe('Fresh sourdough today.\n\nOrder now.\n\n#bread #local');
    expect(withLink).toBe(
      clickable
        ? 'Fresh sourdough today.\n\nOrder now. https://app.example.com/r/abc1234\n\n#bread #local'
        : without,
    );
  });

  it('links by default, drops empty parts and trims a trailing slash on the base', () => {
    expect(composeShareText({ ...post('facebook'), cta: '', hashtags: [] }, { baseUrl: `${BASE}//` })).toBe(
      'Fresh sourdough today.\n\nhttps://app.example.com/r/abc1234',
    );
    expect(composeShareText({ ...post('instagram'), cta: '', hashtags: [] }, { baseUrl: BASE })).toBe('Fresh sourdough today.');
  });

  it('matches shortLinkFor', () => {
    expect(shortLinkFor('abc1234')).toBe(buildShortLink(process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000', 'abc1234'));
  });
});

describe('UTM', () => {
  const args = { channel: 'facebook', postCode: 'abc1234' };
  it('adds the four tags to a plain URL and to one with a query', () => {
    expect(withUtm(new URL('https://shop.example/'), args)).toBe(
      'https://shop.example/?utm_source=facebook&utm_medium=social&utm_campaign=weekly-posts&utm_content=abc1234',
    );
    expect(withUtm(new URL('https://shop.example/p?a=1&b=x%20y'), args)).toBe(
      'https://shop.example/p?a=1&b=x%20y&utm_source=facebook&utm_medium=social&utm_campaign=weekly-posts&utm_content=abc1234',
    );
  });
  it('keeps the fragment and any existing utm param', () => {
    const out = new URL(withUtm(new URL('https://shop.example/p?utm_medium=email#top'), args));
    expect(out.hash).toBe('#top');
    expect(out.searchParams.get('utm_medium')).toBe('email');
    expect(out.searchParams.get('utm_source')).toBe('facebook');
  });
  it.each(['https://wa.me/123', 'https://api.whatsapp.com/send?phone=1', 'https://m.me/page', 'https://t.me/chan', 'https://www.wa.me/1'])(
    'leaves the messaging link %s alone',
    (u) => {
      expect(withUtm(new URL(u), args)).toBe(new URL(u).href);
    },
  );
  it('prefers link_destination, then the website, skips values that are not http(s)', () => {
    const c = { channel: null, postCode: 'abc1234' };
    expect(pickDestination({ linkDestination: 'https://a.example/', websiteUrl: 'https://b.example/', ...c })).toContain('https://a.example/');
    expect(pickDestination({ linkDestination: null, websiteUrl: 'https://b.example/', ...c })).toContain('utm_source=other');
    expect(pickDestination({ linkDestination: 'javascript:alert(1)', websiteUrl: 'ftp://x.example', ...c })).toBeNull();
    expect(pickDestination({ linkDestination: '  ', websiteUrl: null, ...c })).toBeNull();
  });
});

describe('bots, prefetch and repeats', () => {
  it('knows a person from a bot', () => {
    expect(isBotUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1')).toBe(false);
    expect(isBotUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0')).toBe(false);
    expect(isBotUserAgent('SomeNewThing Crawler/1.0')).toBe(true);
    expect(isBotUserAgent(null)).toBe(true);
  });
  it('reads the three prefetch headers', () => {
    expect(isPrefetch(new Headers({ Purpose: 'prefetch' }))).toBe(true);
    expect(isPrefetch(new Headers({ 'Sec-Purpose': 'prefetch;prerender' }))).toBe(true);
    expect(isPrefetch(new Headers({ 'X-Moz': 'prefetch' }))).toBe(true);
    expect(isPrefetch(new Headers({ 'Sec-Purpose': 'navigate' }))).toBe(false);
    expect(isPrefetch(new Headers())).toBe(false);
  });
  it('counts a repeat only after 30 seconds', () => {
    resetClickDedupe();
    expect(firstClickInWindow('ua', 'p1', 1_000)).toBe(true);
    expect(firstClickInWindow('ua', 'p1', 20_000)).toBe(false);
    expect(firstClickInWindow('ua', 'p1', 30_999)).toBe(false); // the window is measured from the first click
    expect(firstClickInWindow('ua', 'p1', 31_000)).toBe(true);
    expect(firstClickInWindow('ua', 'p2', 31_001)).toBe(true);
    expect(firstClickInWindow('other', 'p1', 31_002)).toBe(true);
  });
});
