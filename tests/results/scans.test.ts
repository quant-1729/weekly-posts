import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMockDb, setMockDbForTests, type MockDb } from '@/lib/db/mock';
import { loadEmailSummary } from '@/lib/results/email';
import { buildSummary } from '@/lib/results/summary';
import { clicksByPost, clicksByWeek } from '@/lib/shortlinks';
import { seedWeeklyBrand } from '../weekly/helpers';
import { seedResultPost } from './helpers';

const NOW = new Date('2026-10-20T12:00:00Z');
let db: MockDb;
let a: { userId: string; brandId: string };
let b: { userId: string; brandId: string };

beforeAll(async () => {
  db = await createMockDb();
  setMockDbForTests(db);
  a = await seedWeeklyBrand(db, { name: 'Scans A', timezone: 'UTC', country: 'GB' });
  b = await seedWeeklyBrand(db, { name: 'Scans B', timezone: 'UTC', country: 'GB' });
  await seedResultPost(db, a.brandId, a.userId, { topic: 'Menu', postedAt: '2026-10-02T10:00:00Z', clicks: ['2026-10-03T10:00:00Z'], scans: ['2026-10-04T10:00:00Z', '2026-10-05T10:00:00Z'] });
  await seedResultPost(db, a.brandId, a.userId, { topic: 'Only scans', postedAt: '2026-10-06T10:00:00Z', scans: ['2026-10-07T10:00:00Z'] });
  await seedResultPost(db, a.brandId, a.userId, { topic: 'Old', postedAt: '2026-09-06T10:00:00Z', scans: ['2026-09-07T10:00:00Z'] });
  await seedResultPost(db, b.brandId, b.userId, { scans: ['2026-10-04T10:00:00Z'] });
});
afterAll(async () => {
  setMockDbForTests(null);
  await db.close();
});

describe('QR scans are shown apart from clicks', () => {
  it('buildSummary counts link clicks and scans separately', async () => {
    const sum = await buildSummary(a.userId, a.brandId, NOW);
    expect(sum.clicks.totalThisMonth).toBe(1);
    expect(sum.clicks.thisMonth.map((c) => [c.topic, c.clicks])).toEqual([['Menu', 1]]);
    expect(sum.scans.totalThisMonth).toBe(3);
    expect(sum.scans.thisMonth.map((c) => [c.topic, c.clicks])).toEqual([['Menu', 2], ['Only scans', 1]]);
    expect(sum.scans.totalLastMonth).toBe(1);
    expect(sum.scans.lastMonth.map((c) => c.topic)).toEqual(['Old']);
    expect(sum.scans.line).toBe('Your QR codes were scanned at least 3 times this month.');
    expect(sum.empty).toBe(false);
  });

  it('a brand with only scans is not empty, and with none says so', async () => {
    const only = await buildSummary(b.userId, b.brandId, NOW);
    expect(only.clicks.totalThisMonth).toBe(0);
    expect(only.scans.totalThisMonth).toBe(1);
    expect(only.empty).toBe(false);
    const none = await buildSummary(a.userId, a.brandId, new Date('2027-03-20T12:00:00Z'));
    expect(none.scans.line).toBe('No QR code scans yet this month.');
  });

  it('clicksByPost, clicksByWeek and the email summary count link clicks only', async () => {
    const range = { from: '2026-10-01T00:00:00Z', to: '2026-11-01T00:00:00Z' };
    expect((await clicksByPost(a.userId, a.brandId, range)).map((r) => r.clicks)).toEqual([1]);
    expect(await clicksByWeek(a.userId, a.brandId, range)).toEqual([{ weekStart: '2026-09-28', clicks: 1 }]);
    const email = await loadEmailSummary(a.brandId, NOW);
    expect(email?.clicks).toBe(1);
  });
});
