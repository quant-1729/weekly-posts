import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMockDb, setMockDbForTests, type MockDb } from '@/lib/db/mock';
import { s } from '@/lib/i18n/strings';
import { clicksPhrase, monthStartOf, timeSavedPhrase, zonedMidnight } from '@/lib/results/format';
import { buildSummary } from '@/lib/results/summary';
import { seedWeeklyBrand } from '../weekly/helpers';
import { addCheckin, seedResultPost, setMinutes } from './helpers';

// "now" is Tuesday 20 October 2026, midday UTC. Brand A is in New York (UTC-4 in October), so its
// months start at 04:00 UTC: 23:30 local on 30 September is 03:30 UTC on 1 October.
const NOW = new Date('2026-10-20T12:00:00Z');

let db: MockDb;
let a: { userId: string; brandId: string };
let b: { userId: string; brandId: string };
let o1: string;

beforeAll(async () => {
  db = await createMockDb();
  setMockDbForTests(db);
  a = await seedWeeklyBrand(db, { name: 'Brand A', timezone: 'America/New_York', country: 'US' });
  b = await seedWeeklyBrand(db, { name: 'Brand B', timezone: 'America/New_York', country: 'US' });
  await setMinutes(db, a.brandId, 20);
  const seed = (o: Parameters<typeof seedResultPost>[3]) => seedResultPost(db, a.brandId, a.userId, o);

  // September (local): 4 posts.
  await seed({ topic: 'Sept loaf', postedAt: '2026-09-10T14:00:00Z', clicks: ['2026-09-11T10:00:00Z', '2026-09-12T10:00:00Z'] });
  await seed({ shares: ['2026-09-12T14:00:00Z'] });
  await seed({ postedAt: '2026-10-01T03:30:00Z' }); // 23:30 on 30 Sep in New York: September, though UTC says October
  await seed({ postedAt: '2026-09-20T14:00:00Z', shares: ['2026-09-20T14:05:00Z'] }); // posted and shared: counted once
  // October (local): 6 posts.
  await seed({ postedAt: '2026-10-01T04:00:00Z' }); // exactly local midnight on 1 Oct
  o1 = await seed({
    topic: 'Diwali boxes',
    channel: 'instagram',
    suggestedDay: '2026-10-05',
    postedAt: '2026-10-02T14:00:00Z',
    clicks: ['2026-10-01T03:59:00Z', '2026-10-06T10:00:00Z', '2026-10-07T10:00:00Z', '2026-10-08T10:00:00Z'],
  });
  await seed({ shares: ['2026-10-03T10:00:00Z', '2026-10-03T11:00:00Z'] }); // shared twice: counted once
  await seed({ postedAt: '2026-10-05T10:00:00Z', shares: ['2026-10-05T10:01:00Z'] });
  await seed({ caption: 'Open late on Friday\nCome by', noTopic: true, channel: 'gbp', postedAt: '2026-10-15T10:00:00Z', clicks: ['2026-10-16T10:00:00Z'] });
  await seed({ shares: ['2026-10-18T10:00:00Z'] });
  await seed({}); // a draft nobody shared
  // Check-ins: 6 weeks back from last week (12 Oct); 31 Aug is older than that.
  await addCheckin(db, a.brandId, '2026-10-12', 'many');
  await addCheckin(db, a.brandId, '2026-09-28', 'few');
  await addCheckin(db, a.brandId, '2026-09-07', 'none');
  await addCheckin(db, a.brandId, '2026-08-31', 'many');

  // Brand B: activity of its own, which must never reach A.
  for (let i = 0; i < 3; i++) {
    await seedResultPost(db, b.brandId, b.userId, { postedAt: '2026-10-10T10:00:00Z', clicks: ['2026-10-11T10:00:00Z', '2026-10-12T10:00:00Z'] });
  }
  await addCheckin(db, b.brandId, '2026-10-12', 'none');
});
afterAll(async () => {
  setMockDbForTests(null);
  await db.close();
});

describe('buildSummary: posts shared, month over month, in the brand timezone (AC 21)', () => {
  it('counts each post once, and splits months at local midnight', async () => {
    const sum = await buildSummary(a.userId, a.brandId, NOW);
    expect(sum.timezone).toBe('America/New_York');
    expect(sum.thisMonth).toEqual({ start: '2026-10-01', name: 'October' });
    expect(sum.lastMonth).toEqual({ start: '2026-09-01', name: 'September' });
    expect(sum.shared.thisMonth).toBe(6);
    expect(sum.shared.lastMonth).toBe(4); // includes the 23:30 post on 30 September
    expect(sum.shared.change).toBe(2);
    expect(sum.shared.line).toBe('You shared 6 posts this month, up from 4 in September.');
  });

  it('words the change in plain words', async () => {
    // 25 Sep: this month (September) has 4 posts; August has none.
    const first = await buildSummary(a.userId, a.brandId, new Date('2026-09-25T12:00:00Z'));
    expect(first.shared.line).toBe('You shared 4 posts this month. You shared none in August.');
    // 20 Nov: November has no posts; October had 6.
    const none = await buildSummary(a.userId, a.brandId, new Date('2026-11-20T12:00:00Z'));
    expect(none.shared.line).toBe('You have not shared any posts this month yet. In October you shared 6 posts.');
    const only = await buildSummary(b.userId, b.brandId, NOW);
    expect(only.shared.line).toBe('You shared 3 posts this month. You shared none in September.');
  });

  it('down, and the same', async () => {
    const c = await seedWeeklyBrand(db, { name: 'Down', timezone: 'Europe/London' });
    await seedResultPost(db, c.brandId, c.userId, { postedAt: '2026-09-02T10:00:00Z' });
    await seedResultPost(db, c.brandId, c.userId, { postedAt: '2026-09-03T10:00:00Z' });
    await seedResultPost(db, c.brandId, c.userId, { postedAt: '2026-10-03T10:00:00Z' });
    expect((await buildSummary(c.userId, c.brandId, NOW)).shared.line).toBe('You shared 1 post this month, down from 2 in September.');
    await seedResultPost(db, c.brandId, c.userId, { postedAt: '2026-10-04T10:00:00Z' });
    expect((await buildSummary(c.userId, c.brandId, NOW)).shared.line).toBe('You shared 2 posts this month, the same as in September.');
  });

  it('the first instant of a month is local midnight, whichever side of UTC', () => {
    expect(zonedMidnight('2026-10-01', 'America/New_York').toISOString()).toBe('2026-10-01T04:00:00.000Z');
    expect(zonedMidnight('2026-12-01', 'America/New_York').toISOString()).toBe('2026-12-01T05:00:00.000Z');
    expect(zonedMidnight('2026-10-01', 'Pacific/Auckland').toISOString()).toBe('2026-09-30T11:00:00.000Z');
    expect(zonedMidnight('2026-10-01', 'Asia/Kolkata').toISOString()).toBe('2026-09-30T18:30:00.000Z');
    expect(monthStartOf('2026-01-15', -1)).toBe('2025-12-01');
    expect(monthStartOf('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('a timezone ahead of UTC: 00:30 local on 1 October is still September in UTC', async () => {
    const nz = await seedWeeklyBrand(db, { name: 'Kiwi', timezone: 'Pacific/Auckland', country: 'NZ' });
    await seedResultPost(db, nz.brandId, nz.userId, { postedAt: '2026-09-30T11:30:00Z' }); // 00:30 on 1 Oct in Auckland (UTC+13)
    await seedResultPost(db, nz.brandId, nz.userId, { postedAt: '2026-09-30T10:30:00Z' }); // 23:30 on 30 Sep in Auckland
    const sum = await buildSummary(nz.userId, nz.brandId, NOW);
    expect(sum.shared.thisMonth).toBe(1);
    expect(sum.shared.lastMonth).toBe(1);
  });
});

describe('buildSummary: clicks (at least N)', () => {
  it('lists clicks per post for both months, with topic, channel and day', async () => {
    const sum = await buildSummary(a.userId, a.brandId, NOW);
    expect(sum.clicks.thisMonth.map((c) => [c.topic, c.channel, c.day, c.clicks])).toEqual([
      ['Diwali boxes', 'instagram', '2026-10-05', 3],
      ['Open late on Friday', 'gbp', null, 1],
    ]);
    // The click at 23:59 local on 30 Sep is September's.
    expect(sum.clicks.lastMonth.map((c) => [c.topic, c.clicks])).toEqual([
      ['Sept loaf', 2],
      ['Diwali boxes', 1],
    ]);
    expect(sum.clicks.totalThisMonth).toBe(4);
    expect(sum.clicks.totalLastMonth).toBe(3);
    expect(sum.clicks.top?.postId).toBe(o1);
    expect(sum.clicks.line).toBe('Your links got at least 4 clicks this month. Most clicked: Diwali boxes, at least 3 clicks.');
    expect(sum.clicks.footnote).toMatch(/link previews/);
    expect(sum.clicks.footnote).toMatch(/Instagram captions have no clickable links/);
  });

  it('wording is a floor, and singular for one', () => {
    expect(clicksPhrase(23)).toBe('at least 23 clicks');
    expect(clicksPhrase(1)).toBe('at least 1 click');
  });

  it('no clicks: says so, and has no top post', async () => {
    const sum = await buildSummary(a.userId, a.brandId, new Date('2026-12-20T12:00:00Z'));
    expect(sum.clicks.totalThisMonth).toBe(0);
    expect(sum.clicks.top).toBeNull();
    expect(sum.clicks.line).toBe('No clicks yet this month.');
  });
});

describe('buildSummary: check-ins and time saved', () => {
  it('shows the last 6 weeks, newest first, in plain words', async () => {
    const sum = await buildSummary(a.userId, a.brandId, NOW);
    expect(sum.checkins.map((c) => [c.weekStart, c.label])).toEqual([
      ['2026-10-12', 'Many'],
      ['2026-10-05', 'Not answered'],
      ['2026-09-28', 'A few'],
      ['2026-09-21', 'Not answered'],
      ['2026-09-14', 'Not answered'],
      ['2026-09-07', 'None'],
    ]);
  });

  it('time saved = posts shared this month x minutes per post', async () => {
    const sum = await buildSummary(a.userId, a.brandId, NOW);
    expect(sum.time.minutesPerPost).toBe(20);
    expect(sum.time.minutesSaved).toBe(120); // 6 x 20
    expect(sum.time.text).toBe('about 2 hours');
    expect(sum.time.line).toBe('You saved about 2 hours this month.');
    expect(sum.time.needsMinutes).toBe(false);
    await setMinutes(db, a.brandId, 30);
    expect((await buildSummary(a.userId, a.brandId, NOW)).time.text).toBe('about 3 hours'); // 6 x 30 = 180 minutes
    await setMinutes(db, a.brandId, 20);
  });

  it('formats minutes, hours and half hours', () => {
    expect(timeSavedPhrase(180)).toBe('about 3 hours');
    expect(timeSavedPhrase(60)).toBe('about 1 hour');
    expect(timeSavedPhrase(90)).toBe('about 1.5 hours');
    expect(timeSavedPhrase(40)).toBe('about 40 minutes');
    expect(timeSavedPhrase(0)).toBeNull();
  });

  it('a null minutes_per_post gives the prompt instead of a number', async () => {
    const c = await seedWeeklyBrand(db, { name: 'No minutes', timezone: 'America/New_York' });
    await setMinutes(db, c.brandId, null);
    await seedResultPost(db, c.brandId, c.userId, { postedAt: '2026-10-10T10:00:00Z' });
    const sum = await buildSummary(c.userId, c.brandId, NOW);
    expect(sum.shared.thisMonth).toBe(1);
    expect(sum.time.needsMinutes).toBe(true);
    expect(sum.time.line).toBeNull();
    expect(sum.time.minutesSaved).toBeNull();
    expect(sum.time.prompt).toBe('Tell us how long a post takes you to see time saved');
  });
});

describe('buildSummary: the not-measured line and the empty state', () => {
  const NOT_MEASURED = 'Not counted here: messages, calls and walk-ins. Your weekly check-in is how we track those.';

  it('the "not measured" line is always there', async () => {
    expect(s.results.notMeasured).toBe(NOT_MEASURED);
    expect((await buildSummary(a.userId, a.brandId, NOW)).notMeasured).toBe(NOT_MEASURED);
    const fresh = await seedWeeklyBrand(db, { name: 'Fresh', timezone: 'America/New_York' });
    expect((await buildSummary(fresh.userId, fresh.brandId, NOW)).notMeasured).toBe(NOT_MEASURED);
  });

  it('a new owner gets the empty state', async () => {
    const fresh = await seedWeeklyBrand(db, { name: 'Fresh 2', timezone: 'America/New_York' });
    const sum = await buildSummary(fresh.userId, fresh.brandId, NOW);
    expect(sum.empty).toBe(true);
    expect(s.results.empty).toBe('Your results will show here after your first week of posts.');
    expect(sum.shared.thisMonth).toBe(0);
    expect(sum.checkins.every((c) => c.answer === null)).toBe(true);
    expect((await buildSummary(a.userId, a.brandId, NOW)).empty).toBe(false);
  });
});

describe('buildSummary: row-level security', () => {
  it("never counts another brand's posts, clicks or check-ins", async () => {
    const sumA = await buildSummary(a.userId, a.brandId, NOW);
    const sumB = await buildSummary(b.userId, b.brandId, NOW);
    expect(sumA.shared.thisMonth).toBe(6); // B's 3 posts are not in A's
    expect(sumA.clicks.totalThisMonth).toBe(4);
    expect(sumB.shared.thisMonth).toBe(3);
    expect(sumB.clicks.totalThisMonth).toBe(6);
    expect(sumB.checkins[0]).toMatchObject({ weekStart: '2026-10-12', answer: 'none' });
    expect(sumA.checkins[0]).toMatchObject({ weekStart: '2026-10-12', answer: 'many' });
  });

  it('a user who is not a member of the brand cannot read its summary', async () => {
    await expect(buildSummary(b.userId, a.brandId, NOW)).rejects.toThrow();
    await expect(buildSummary(a.userId, b.brandId, NOW)).rejects.toThrow();
  });
});
