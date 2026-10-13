import { NextRequest } from 'next/server';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { isPublicPath } from '@/lib/auth/public-paths';
import { createMockDb, setMockDbForTests, type MockDb } from '@/lib/db/mock';
import { getEnv } from '@/lib/env';
import { runWeeklySweep } from '@/lib/weekly/sweep';
import { GET, maxDuration } from '@/app/api/cron/weekly/route';
import { count, seedWeeklyBrand, tempStorage } from './helpers';

let db: MockDb;
let store: Awaited<ReturnType<typeof tempStorage>>;
beforeAll(async () => {
  db = await createMockDb();
  setMockDbForTests(db);
  store = await tempStorage();
});
afterAll(async () => {
  setMockDbForTests(null);
  await db.close();
  await store.cleanup();
});
afterEach(() => vi.unstubAllEnvs());

const call = (headers: Record<string, string> = {}) => GET(new NextRequest('http://localhost/api/cron/weekly', { headers }));

describe('GET /api/cron/weekly', () => {
  it('answers 401 without a CRON_SECRET configured', async () => {
    vi.stubEnv('CRON_SECRET', '');
    expect(getEnv().cronSecret).toBeUndefined();
    expect((await call()).status).toBe(401);
    // Even a header that looks right does not work when no secret is set.
    expect((await call({ authorization: 'Bearer ' })).status).toBe(401);
    expect((await call({ authorization: 'Bearer undefined' })).status).toBe(401);
  });

  it('answers 401 for a missing or wrong bearer token', async () => {
    vi.stubEnv('CRON_SECRET', 's3cret-value');
    expect((await call()).status).toBe(401);
    expect((await call({ authorization: 'Bearer wrong' })).status).toBe(401);
    expect((await call({ authorization: 's3cret-value' })).status).toBe(401);
    expect((await call({ authorization: 'Bearer s3cret-value-and-more' })).status).toBe(401);
  });

  it('runs the sweep with the right token and returns a summary', async () => {
    vi.stubEnv('CRON_SECRET', 's3cret-value');
    const res = await call({ authorization: 'Bearer s3cret-value' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, due: expect.any(Number), processed: expect.any(Number), ready: expect.any(Number), failed: expect.any(Number), skipped: expect.any(Number), deferred: expect.any(Number) });
    expect(Array.isArray(body.items)).toBe(true);
  });

  it('is a long-running route and its path is public (it checks the secret itself)', () => {
    expect(maxDuration).toBe(300);
    expect(isPublicPath('/api/cron/weekly')).toBe(true);
    expect(isPublicPath('/api/cron')).toBe(false);
  });
});

describe('the sweep', () => {
  it('generates the week for each due brand, one at a time, and leaves not-due brands alone', async () => {
    const due1 = await seedWeeklyBrand(db, { name: 'Due one', timezone: 'Europe/London', weekday: 1, time: '08:00' });
    const due2 = await seedWeeklyBrand(db, { name: 'Due two', timezone: 'America/New_York', weekday: 1, time: '07:30', country: 'US' });
    const later = await seedWeeklyBrand(db, { name: 'Not yet', timezone: 'Asia/Kolkata', weekday: 5, time: '17:00', country: 'IN' });
    const paused = await seedWeeklyBrand(db, { name: 'Paused', pausedUntil: '2027-01-01' });
    const now = new Date('2026-11-09T12:45:00Z'); // 12:45 in London, 07:45 in New York, 18:15 Monday in Kolkata
    const sweep = await runWeeklySweep({ now, deps: { storage: store.storage } });

    const mine = [due1.brandId, due2.brandId, later.brandId, paused.brandId];
    const items = sweep.items.filter((i) => mine.includes(i.brandId));
    expect(items.map((i) => i.brandId).sort()).toEqual([due1.brandId, due2.brandId].sort());
    expect(items.every((i) => i.outcome === 'ready' && i.weekStart === '2026-11-09')).toBe(true);
    expect(sweep.ready).toBeGreaterThanOrEqual(2);
    for (const b of [due1, due2]) expect(await count(db, 'select 1 from public.posts where brand_id = $1', [b.brandId])).toBe(4);
    for (const b of [later, paused]) expect(await count(db, 'select 1 from public.weekly_batches where brand_id = $1', [b.brandId])).toBe(0);

    // The next hour's sweep finds nothing left for them.
    const next = await runWeeklySweep({ now: new Date('2026-11-09T13:45:00Z'), deps: { storage: store.storage } });
    expect(next.items.filter((i) => mine.includes(i.brandId))).toEqual([]);
  });

  it('stops starting new brands when the time budget is used up, leaving them for the next sweep', async () => {
    const a = await seedWeeklyBrand(db, { name: 'Budget one', timezone: 'Pacific/Auckland', weekday: 1, time: '09:00' });
    const now = new Date('2026-11-08T22:30:00Z'); // Monday 11:30 in Auckland (NZDT, UTC+13)
    const none = await runWeeklySweep({ now, budgetMs: 0, deps: { storage: store.storage } });
    expect(none.processed).toBe(0);
    expect(none.deferred).toBeGreaterThanOrEqual(1);
    expect(await count(db, 'select 1 from public.weekly_batches where brand_id = $1', [a.brandId])).toBe(0);
    const next = await runWeeklySweep({ now, deps: { storage: store.storage } });
    expect(next.items.find((i) => i.brandId === a.brandId)?.outcome).toBe('ready');
  });

  it('one failing brand does not stop the others, and a failed batch is retried by the next sweep', async () => {
    const bad = await seedWeeklyBrand(db, { name: 'Fails', timezone: 'Europe/Paris', weekday: 1, time: '08:00', country: 'FR' });
    const good = await seedWeeklyBrand(db, { name: 'Works', timezone: 'Europe/Paris', weekday: 1, time: '08:00', country: 'FR' });
    const now = new Date('2026-11-16T09:00:00Z');
    // Reaching the daily cap makes one brand's run fail without touching the other.
    await db.withAdmin((tx) => tx.query('update public.brands set daily_generation_cap = 0 where id = $1', [bad.brandId]));
    const sweep = await runWeeklySweep({ now, deps: { storage: store.storage } });
    expect(sweep.items.find((i) => i.brandId === bad.brandId)?.outcome).toBe('failed');
    expect(sweep.items.find((i) => i.brandId === good.brandId)?.outcome).toBe('ready');
    expect(sweep.failed).toBeGreaterThanOrEqual(1);

    await db.withAdmin((tx) => tx.query('update public.brands set daily_generation_cap = 30 where id = $1', [bad.brandId]));
    const retry = await runWeeklySweep({ now: new Date('2026-11-16T10:00:00Z'), deps: { storage: store.storage } });
    expect(retry.items.find((i) => i.brandId === bad.brandId)).toMatchObject({ outcome: 'ready', reason: 'retry' });
    expect(retry.items.find((i) => i.brandId === good.brandId)).toBeUndefined();
  });
});
