import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMockDb, setMockDbForTests, type MockDb } from '@/lib/db/mock';
import { clicksByPost, clicksByWeek } from '@/lib/shortlinks';
import { loadWeekInputs } from '@/lib/weekly/inputs';
import { seedWeeklyBrand } from '../weekly/helpers';
import { seedPost } from './helpers';

let db: MockDb;
let a: { userId: string; brandId: string };
let b: { userId: string; brandId: string };
let p1: { postId: string; postCode: string };
let p2: { postId: string; postCode: string };
let p3: { postId: string; postCode: string };

const click = (postId: string, brandId: string, at: string) =>
  db.withAdmin((tx) => tx.query('insert into public.clicks (post_id, brand_id, clicked_at, user_agent) values ($1, $2, $3::timestamptz, $4)', [postId, brandId, at, 'Mozilla/5.0']));

beforeAll(async () => {
  db = await createMockDb();
  setMockDbForTests(db);
  a = await seedWeeklyBrand(db, { name: 'Brand A', timezone: 'Pacific/Auckland', country: 'NZ' });
  b = await seedWeeklyBrand(db, { name: 'Brand B' });
  p1 = await seedPost(db, a.brandId, a.userId, { channel: 'facebook', withBatch: true, topic: 'Sourdough' });
  p2 = await seedPost(db, a.brandId, a.userId, { channel: 'gbp', withBatch: true, weekStart: '2026-10-12', topic: 'Opening hours' });
  p3 = await seedPost(db, a.brandId, a.userId, { channel: 'linkedin', withBatch: true, weekStart: '2026-10-12', topic: 'No clicks yet' });
  // p1: 3 clicks, p2: 1 click, one old click outside the ranges.
  await click(p1.postId, a.brandId, '2026-10-06T10:00:00Z'); // Tue, week of 5 Oct
  await click(p1.postId, a.brandId, '2026-10-07T10:00:00Z');
  await click(p1.postId, a.brandId, '2026-10-13T10:00:00Z'); // Tue, week of 12 Oct
  await click(p2.postId, a.brandId, '2026-10-14T10:00:00Z');
  await click(p2.postId, a.brandId, '2026-01-01T10:00:00Z');
});
afterAll(async () => {
  setMockDbForTests(null);
  await db.close();
});

const range = { from: '2026-10-01T00:00:00Z', to: '2026-11-01T00:00:00Z' };

describe('clicksByPost', () => {
  it('counts clicks per post in the range, most first, leaving out posts with none', async () => {
    const rows = await clicksByPost(a.userId, a.brandId, range);
    expect(rows).toEqual([
      { postId: p1.postId, clicks: 3 },
      { postId: p2.postId, clicks: 1 },
    ]);
    expect(rows.find((r) => r.postId === p3.postId)).toBeUndefined();
  });

  it('respects the range (from inclusive, to exclusive) and accepts Dates', async () => {
    const rows = await clicksByPost(a.userId, a.brandId, { from: new Date('2026-10-13T10:00:00Z'), to: new Date('2026-10-14T10:00:00Z') });
    expect(rows).toEqual([{ postId: p1.postId, clicks: 1 }]);
    expect(await clicksByPost(a.userId, a.brandId, { from: '2026-01-01T00:00:00Z', to: '2026-02-01T00:00:00Z' })).toEqual([{ postId: p2.postId, clicks: 1 }]);
  });

  it('RLS: another brand sees 0, and its own owner sees nothing of A', async () => {
    expect(await clicksByPost(b.userId, a.brandId, range)).toEqual([]);
    expect(await clicksByPost(b.userId, b.brandId, range)).toEqual([]);
    expect(await clicksByWeek(b.userId, a.brandId, range)).toEqual([]);
    // And A cannot read B's by asking with B's brand id.
    expect(await clicksByPost(a.userId, b.brandId, range)).toEqual([]);
  });

  it('a member cannot write clicks (server only)', async () => {
    await expect(
      db.withUser(a.userId, (tx) => tx.query('insert into public.clicks (post_id, brand_id) values ($1, $2)', [p1.postId, a.brandId])),
    ).rejects.toThrow();
  });
});

describe('clicksByWeek', () => {
  it('groups by Monday week in the brand timezone, oldest first', async () => {
    // Auckland is UTC+13 in October: 2026-10-11T20:00Z is Monday 12 Oct there but still Sunday in UTC.
    await click(p3.postId, a.brandId, '2026-10-11T20:00:00Z');
    const rows = await clicksByWeek(a.userId, a.brandId, range);
    expect(rows).toEqual([
      { weekStart: '2026-10-05', clicks: 2 },
      { weekStart: '2026-10-12', clicks: 3 },
    ]);
  });
});

describe('V-10 performance query reads the same clicks', () => {
  it('lists the posts with the same counts as clicksByPost (batch posts, last 28 days)', async () => {
    const now = new Date('2026-10-19T08:00:00Z');
    const inputs = await loadWeekInputs(a.brandId, '2026-10-19', now);
    const byPost = await clicksByPost(a.userId, a.brandId, { from: new Date(now.getTime() - 28 * 86_400_000), to: now });
    const counted = byPost.reduce((n, r) => n + r.clicks, 0);
    const listed = inputs.performance.map((l) => Number(/: (\d+) click/.exec(l)![1]));
    expect(listed.reduce((n, x) => n + x, 0)).toBe(counted);
    expect(inputs.performance[0]).toBe('Sourdough (facebook): 3 clicks');
    expect(inputs.performance).toContain('Opening hours (gbp): 1 click');
    expect(inputs.performance).toContain('No clicks yet (linkedin): 1 click'); // the Monday-in-Auckland click
  });
});
