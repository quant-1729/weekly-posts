import { describe, expect, it } from 'vitest';
import { V2_CHANNEL_SPECS } from '@/lib/ai/prompts/v2-weekly';
import type { WeeklyPost } from '@/lib/ai/schemas-v2';
import {
  assignDays,
  fitHashtags,
  fitImageText,
  normaliseHashtags,
  normalizePosts,
  trimAtWord,
  trimCaption,
  visibleChars,
} from '@/lib/weekly/normalize';

const WEEK = '2026-11-09'; // Monday
const post = (o: Partial<WeeklyPost> = {}): WeeklyPost => ({
  suggested_day: '2026-11-09',
  channel: 'instagram',
  caption: 'Fresh bread every morning.',
  hashtags: ['#bread', '#fresh', '#local'],
  cta: 'Message us to order.',
  link: true, // the model's value is ignored
  image_text: { headline: 'Fresh bread', subline: '' },
  photo_id: '',
  occasion_key: '',
  fact_ids: [],
  topic: 'fresh bread',
  ...o,
});
const ctx = (extra: Partial<Parameters<typeof normalizePosts>[1]> = {}) => ({
  weekStart: WEEK,
  photoIds: new Map([
    ['p1', 'uuid-1'],
    ['p2', 'uuid-2'],
  ]),
  occasions: [{ key: 'holiday-christmas-2026-11-12', name: 'Christmas', date: '2026-11-12', sensitive: false, source: 'holiday' as const }],
  brand: { name: 'Corner Bakery', city: 'London' },
  ...extra,
});

describe('photos', () => {
  it('maps short ids back to photos and drops invalid or repeated ones (that post goes text-only)', () => {
    const out = normalizePosts(
      [
        post({ suggested_day: '2026-11-09', photo_id: 'p1' }),
        post({ suggested_day: '2026-11-10', photo_id: 'p1' }), // repeated
        post({ suggested_day: '2026-11-11', photo_id: 'p9' }), // not in the list
        post({ suggested_day: '2026-11-12', photo_id: 'p2' }),
        post({ suggested_day: '2026-11-13', photo_id: '' }),
      ],
      ctx(),
    );
    expect(out.map((p) => p.photoId)).toEqual(['uuid-1', null, null, 'uuid-2', null]);
  });
});

describe('days', () => {
  it('keeps valid unique days', () => {
    expect(assignDays(['2026-11-09', '2026-11-11', '2026-11-13'], WEEK)).toEqual(['2026-11-09', '2026-11-11', '2026-11-13']);
  });

  it('moves a duplicate day to the nearest free day', () => {
    expect(assignDays(['2026-11-11', '2026-11-11', '2026-11-13'], WEEK)).toEqual(['2026-11-11', '2026-11-10', '2026-11-13']);
  });

  it('moves out-of-week and invalid days to free days; every day ends up unique and in the week', () => {
    const days = assignDays(['2026-11-02', '2026-11-16', 'tomorrow', '2026-11-09', '2026-11-09'], WEEK);
    expect(new Set(days).size).toBe(5);
    for (const d of days) expect(d >= WEEK && d <= '2026-11-15').toBe(true);
    expect(days[3]).toBe('2026-11-09'); // the valid one keeps its day
  });

  it('sorts the normalised posts by day', () => {
    const out = normalizePosts([post({ suggested_day: '2026-11-13', topic: 'c' }), post({ suggested_day: '2026-11-09', topic: 'a' }), post({ suggested_day: '2026-11-11', topic: 'b' })], ctx());
    expect(out.map((p) => p.topic)).toEqual(['a', 'b', 'c']);
  });
});

describe('hashtags', () => {
  it('adds a # where missing, removes spaces and punctuation, drops repeats', () => {
    expect(normaliseHashtags(['bread', '#Bread', '  ##fresh loaf ', '#café!', '#', ''], 8)).toEqual(['#bread', '#freshloaf', '#café']);
  });

  it('trims to the channel maximum', () => {
    const many = Array.from({ length: 12 }, (_, i) => `#tag${i}`);
    expect(fitHashtags(many, 'instagram', { name: 'X' })).toHaveLength(8);
    expect(fitHashtags(many, 'facebook', { name: 'X' })).toHaveLength(5);
    expect(fitHashtags(many, 'linkedin', { name: 'X' })).toHaveLength(5);
    expect(fitHashtags(many, 'gbp', { name: 'X' })).toHaveLength(3);
  });

  it('GBP may have none; other channels are filled up to 3 from the business name and place', () => {
    expect(fitHashtags([], 'gbp', { name: 'X' })).toEqual([]);
    const filled = fitHashtags(['#one'], 'instagram', { name: 'Corner Bakery', city: 'London' });
    expect(filled).toEqual(['#one', '#CornerBakery', '#London']);
  });

  it('never exceeds the limits of any channel', () => {
    for (const [channel, spec] of Object.entries(V2_CHANNEL_SPECS)) {
      for (const n of [0, 1, 4, 20]) {
        const out = fitHashtags(Array.from({ length: n }, (_, i) => `t${i}`), channel as keyof typeof V2_CHANNEL_SPECS, { name: 'Shop', city: 'Town' });
        expect(out.length).toBeGreaterThanOrEqual(Math.min(spec.hashtags[0], 3));
        expect(out.length).toBeLessThanOrEqual(spec.hashtags[1]);
      }
    }
  });
});

describe('caption trimming (PRD §8: trim to the channel limit)', () => {
  const sentence = 'We bake fresh sourdough every single morning for the whole street.';
  it('keeps whole sentences and ends on a sentence boundary', () => {
    const long = Array.from({ length: 30 }, (_, i) => `${sentence} Number ${i}.`).join(' ');
    const out = trimCaption(long, 1000);
    expect(visibleChars(out)).toBeLessThanOrEqual(1000);
    expect(out.endsWith('.')).toBe(true);
    expect(long.startsWith(out)).toBe(true);
    expect(out).not.toMatch(/Number \d+$/); // the cut sentence is not left dangling
  });

  it('leaves a caption within the limit alone', () => {
    expect(trimCaption('Short one.', 1000)).toBe('Short one.');
  });

  it('cuts a single over-long sentence at a word with an ellipsis, within the limit', () => {
    const one = Array.from({ length: 300 }, () => 'word').join(' ');
    const out = trimCaption(one, 100);
    expect(visibleChars(out)).toBeLessThanOrEqual(100);
    expect(out.endsWith('…')).toBe(true);
    expect(out).not.toMatch(/wor…$/);
  });

  it('counts Devanagari letters as a reader does and cuts at the Hindi full stop', () => {
    const hi = Array.from({ length: 60 }, (_, i) => `हम हर सुबह ताज़ा रोटी बनाते हैं ${i}।`).join(' ');
    const out = trimCaption(hi, 300);
    expect(visibleChars(out)).toBeLessThanOrEqual(300);
    expect(out.endsWith('।')).toBe(true);
  });

  it('the call to action is a separate field and is kept when the caption is trimmed', () => {
    const [p] = normalizePosts([post({ caption: Array.from({ length: 80 }, (_, i) => `Sentence number ${i} is here.`).join(' '), cta: 'Book now by message.' })], ctx());
    expect(visibleChars(p.caption)).toBeLessThanOrEqual(V2_CHANNEL_SPECS.instagram.captionMaxChars);
    expect(p.cta).toBe('Book now by message.');
  });

  it('applies each channel limit (gbp 1000, linkedin 1300)', () => {
    const text = Array.from({ length: 200 }, (_, i) => `Sentence ${i} ends here.`).join(' ');
    const out = normalizePosts([post({ channel: 'gbp', caption: text, suggested_day: '2026-11-09' }), post({ channel: 'linkedin', caption: text, suggested_day: '2026-11-10' })], ctx());
    expect(visibleChars(out[0].caption)).toBeLessThanOrEqual(1000);
    expect(visibleChars(out[1].caption)).toBeLessThanOrEqual(1300);
    expect(visibleChars(out[1].caption)).toBeGreaterThan(1000);
  });
});

describe('image text', () => {
  it('is trimmed to 40 and 70 characters at a word boundary', () => {
    const t = fitImageText({
      headline: 'Our wonderful seasonal sourdough collection is back',
      subline: 'Freshly baked every morning in the oven at the back of our little shop by the river',
    });
    expect(t.headline.length).toBeLessThanOrEqual(40);
    expect(t.subline.length).toBeLessThanOrEqual(70);
    expect(t.headline).toBe('Our wonderful seasonal sourdough');
    expect('Our wonderful seasonal sourdough collection is back'.startsWith(t.headline)).toBe(true);
    expect('Freshly baked every morning in the oven at the back of our little shop by the river'.startsWith(t.subline)).toBe(true);
    expect(t.subline.endsWith(' ')).toBe(false);
  });

  it('leaves short text alone and hard-cuts one very long word', () => {
    expect(fitImageText({ headline: 'Fresh bread', subline: '' })).toEqual({ headline: 'Fresh bread', subline: '' });
    expect(trimAtWord('x'.repeat(60), 40)).toBe('x'.repeat(40));
  });
});

describe('link, occasion and channel fields', () => {
  it('takes link from the channel, not from the model', () => {
    const out = normalizePosts(
      [post({ channel: 'instagram', link: true, suggested_day: '2026-11-09' }), post({ channel: 'facebook', link: false, suggested_day: '2026-11-10' }), post({ channel: 'gbp', link: false, suggested_day: '2026-11-11' }), post({ channel: 'linkedin', link: false, suggested_day: '2026-11-12' })],
      ctx(),
    );
    expect(out.map((p) => [p.channel, p.link])).toEqual([
      ['instagram', false],
      ['facebook', true],
      ['gbp', true],
      ['linkedin', true],
    ]);
  });

  it('keeps an occasion key that exists and blanks one that does not', () => {
    const out = normalizePosts(
      [post({ suggested_day: '2026-11-09', occasion_key: 'holiday-christmas-2026-11-12' }), post({ suggested_day: '2026-11-10', occasion_key: 'made-up-day' })],
      ctx(),
    );
    expect(out[0]).toMatchObject({ occasionKey: 'holiday-christmas-2026-11-12', occasion: 'Christmas' });
    expect(out[1]).toMatchObject({ occasionKey: '', occasion: null });
  });
});
