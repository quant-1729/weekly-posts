import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMockDb, setMockDbForTests, type MockDb } from '@/lib/db/mock';
import { buttonWeekStart, dueBrands, localClock, targetWeekStart } from '@/lib/weekly/schedule';
import { insertBatch, seedWeeklyBrand } from './helpers';

let db: MockDb;
beforeAll(async () => {
  db = await createMockDb();
  setMockDbForTests(db);
});
afterAll(async () => {
  setMockDbForTests(null);
  await db.close();
});

const at = (iso: string) => new Date(iso);
async function dueFor(brandId: string, iso: string) {
  return (await dueBrands(at(iso))).filter((d) => d.brandId === brandId);
}

describe('targetWeekStart', () => {
  it('is the date itself on a Monday, else the next Monday', () => {
    // 2026-11-09 is a Monday.
    expect(targetWeekStart('2026-11-09')).toBe('2026-11-09');
    expect(targetWeekStart('2026-11-10')).toBe('2026-11-16'); // Tuesday
    expect(targetWeekStart('2026-11-11')).toBe('2026-11-16'); // Wednesday
    expect(targetWeekStart('2026-11-12')).toBe('2026-11-16'); // Thursday
    expect(targetWeekStart('2026-11-13')).toBe('2026-11-16'); // Friday
    expect(targetWeekStart('2026-11-14')).toBe('2026-11-16'); // Saturday
    expect(targetWeekStart('2026-11-15')).toBe('2026-11-16'); // Sunday
  });

  it('crosses month and year ends, and ignores a time suffix', () => {
    expect(targetWeekStart('2026-12-30')).toBe('2027-01-04');
    expect(targetWeekStart('2026-11-13T17:00:00')).toBe('2026-11-16');
    expect(() => targetWeekStart('2026-13-40')).toThrow();
  });
});

describe('buttonWeekStart', () => {
  it('is the current local week through Wednesday, else next week', () => {
    // Local Monday 2026-11-09 to Sunday 2026-11-15, in London (= UTC in November).
    const day = (d: string) => buttonWeekStart(at(`${d}T12:00:00Z`), 'Europe/London');
    expect(day('2026-11-09')).toBe('2026-11-09');
    expect(day('2026-11-10')).toBe('2026-11-09');
    expect(day('2026-11-11')).toBe('2026-11-09');
    expect(day('2026-11-12')).toBe('2026-11-16');
    expect(day('2026-11-13')).toBe('2026-11-16');
    expect(day('2026-11-14')).toBe('2026-11-16');
    expect(day('2026-11-15')).toBe('2026-11-16');
  });

  it('uses the owner time zone, not UTC', () => {
    // 2026-11-11 23:30Z is already Thursday 05:00 in Kolkata, still Wednesday in London.
    expect(buttonWeekStart(at('2026-11-11T23:30:00Z'), 'Asia/Kolkata')).toBe('2026-11-16');
    expect(buttonWeekStart(at('2026-11-11T23:30:00Z'), 'Europe/London')).toBe('2026-11-09');
  });
});

describe('AC 7: brands in three time zones are due exactly after their local time', () => {
  it('Europe/London Monday 08:00, America/New_York Monday 07:30, Asia/Kolkata Friday 17:00', async () => {
    const london = await seedWeeklyBrand(db, { name: 'London Co', timezone: 'Europe/London', weekday: 1, time: '08:00' });
    const ny = await seedWeeklyBrand(db, { name: 'NY Co', timezone: 'America/New_York', weekday: 1, time: '07:30', country: 'US' });
    const kol = await seedWeeklyBrand(db, { name: 'Kolkata Co', timezone: 'Asia/Kolkata', weekday: 5, time: '17:00', country: 'IN' });

    // Week of Monday 9 November 2026 (no clock change). London = UTC, New York = UTC-5, Kolkata = UTC+5:30.
    expect(await dueFor(london.brandId, '2026-11-09T07:59:59Z')).toEqual([]);
    expect(await dueFor(london.brandId, '2026-11-09T08:00:00Z')).toEqual([
      { brandId: london.brandId, weekStart: '2026-11-09', attempt: 1, reason: 'scheduled' },
    ]);

    expect(await dueFor(ny.brandId, '2026-11-09T12:29:59Z')).toEqual([]);
    expect(await dueFor(ny.brandId, '2026-11-09T12:30:00Z')).toEqual([
      { brandId: ny.brandId, weekStart: '2026-11-09', attempt: 1, reason: 'scheduled' },
    ]);

    // Friday 17:00 IST = 11:30Z. The posts are for the following week.
    expect(await dueFor(kol.brandId, '2026-11-13T11:29:59Z')).toEqual([]);
    expect(await dueFor(kol.brandId, '2026-11-13T11:30:00Z')).toEqual([
      { brandId: kol.brandId, weekStart: '2026-11-16', attempt: 1, reason: 'scheduled' },
    ]);
    // Still due on Saturday until a batch exists.
    expect((await dueFor(kol.brandId, '2026-11-14T10:00:00Z'))[0]?.weekStart).toBe('2026-11-16');
    // Monday morning in Kolkata the new local week has begun and its Friday has not come.
    expect(await dueFor(kol.brandId, '2026-11-16T00:30:00Z')).toEqual([]);
  });

  it('follows the local clock across daylight-saving changes', async () => {
    const london = await seedWeeklyBrand(db, { name: 'London DST', timezone: 'Europe/London', weekday: 1, time: '08:00' });
    const ny = await seedWeeklyBrand(db, { name: 'NY DST', timezone: 'America/New_York', weekday: 1, time: '07:30', country: 'US' });

    // London: BST ends Sunday 25 Oct 2026. Monday 19 Oct 08:00 is BST (07:00Z); Monday 26 Oct 08:00 is GMT (08:00Z).
    expect(await dueFor(london.brandId, '2026-10-19T06:59:59Z')).toEqual([]);
    expect((await dueFor(london.brandId, '2026-10-19T07:00:00Z'))[0]?.weekStart).toBe('2026-10-19');
    expect(await dueFor(london.brandId, '2026-10-26T07:59:59Z')).toEqual([]);
    expect((await dueFor(london.brandId, '2026-10-26T08:00:00Z'))[0]?.weekStart).toBe('2026-10-26');

    // New York: EDT ends Sunday 1 Nov 2026. Monday 26 Oct 07:30 EDT = 11:30Z; Monday 2 Nov 07:30 EST = 12:30Z.
    expect(await dueFor(ny.brandId, '2026-10-26T11:29:59Z')).toEqual([]);
    expect((await dueFor(ny.brandId, '2026-10-26T11:30:00Z'))[0]?.weekStart).toBe('2026-10-26');
    expect(await dueFor(ny.brandId, '2026-11-02T12:29:59Z')).toEqual([]);
    expect((await dueFor(ny.brandId, '2026-11-02T12:30:00Z'))[0]?.weekStart).toBe('2026-11-02');

    // Spring forward 2027: EDT starts Sunday 14 Mar. Monday 8 Mar 07:30 EST = 12:30Z; Monday 15 Mar 07:30 EDT = 11:30Z.
    expect(await dueFor(ny.brandId, '2027-03-08T12:29:59Z')).toEqual([]);
    expect((await dueFor(ny.brandId, '2027-03-08T12:30:00Z'))[0]?.weekStart).toBe('2027-03-08');
    expect(await dueFor(ny.brandId, '2027-03-15T11:29:59Z')).toEqual([]);
    expect((await dueFor(ny.brandId, '2027-03-15T11:30:00Z'))[0]?.weekStart).toBe('2027-03-15');
  });

  it('a time that does not exist on the clock-change day is due as soon as the clock passes it', async () => {
    // London springs forward on Sunday 28 Mar 2027: 01:00 GMT becomes 02:00 BST, so 01:30 never happens.
    const b = await seedWeeklyBrand(db, { name: 'Sunday night', timezone: 'Europe/London', weekday: 7, time: '01:30' });
    expect(await dueFor(b.brandId, '2027-03-28T00:59:59Z')).toEqual([]);
    expect((await dueFor(b.brandId, '2027-03-28T01:00:00Z'))[0]?.weekStart).toBe('2027-03-29');
  });

  it('is not due again once the week has a ready batch, or a live generating one', async () => {
    const b = await seedWeeklyBrand(db, { name: 'Ready Co', timezone: 'Europe/London', weekday: 1, time: '08:00' });
    const now = '2026-11-09T09:00:00Z';
    expect(await dueFor(b.brandId, now)).toHaveLength(1);
    await insertBatch(db, b.brandId, '2026-11-09', { status: 'ready', createdAt: '2026-11-09T08:00:00Z' });
    expect(await dueFor(b.brandId, now)).toEqual([]);
    expect(await dueFor(b.brandId, '2026-11-12T09:00:00Z')).toEqual([]);

    const c = await seedWeeklyBrand(db, { name: 'Busy Co', timezone: 'Europe/London', weekday: 1, time: '08:00' });
    await insertBatch(db, c.brandId, '2026-11-09', {
      status: 'generating',
      attempts: 1,
      claimedAt: '2026-11-09T08:55:00.000Z',
      createdAt: '2026-11-09T08:55:00Z',
    });
    expect(await dueFor(c.brandId, now)).toEqual([]);
    // A run that died (claimed over 10 minutes ago) is taken again.
    expect(await dueFor(c.brandId, '2026-11-09T09:30:00Z')).toEqual([
      { brandId: c.brandId, weekStart: '2026-11-09', attempt: 2, reason: 'stale' },
    ]);
  });

  it('retries a failed batch up to 3 attempts within 24 hours', async () => {
    const b = await seedWeeklyBrand(db, { name: 'Retry Co', timezone: 'Europe/London', weekday: 1, time: '08:00' });
    const id = await insertBatch(db, b.brandId, '2026-11-09', {
      status: 'failed',
      error: 'The AI call failed twice',
      attempts: 1,
      createdAt: '2026-11-09T08:00:00Z',
    });

    expect(await dueFor(b.brandId, '2026-11-09T09:00:00Z')).toEqual([{ brandId: b.brandId, weekStart: '2026-11-09', attempt: 2, reason: 'retry' }]);

    const setAttempts = (n: number) => db.withAdmin((tx) => tx.query('update public.weekly_batches set attempts = $2 where id = $1', [id, n]));
    await setAttempts(2);
    expect((await dueFor(b.brandId, '2026-11-09T10:00:00Z'))[0]?.attempt).toBe(3);
    await setAttempts(3);
    expect(await dueFor(b.brandId, '2026-11-09T11:00:00Z')).toEqual([]);

    // Older than 24 hours: no more retries even with attempts left.
    await setAttempts(1);
    expect(await dueFor(b.brandId, '2026-11-10T07:59:00Z')).toHaveLength(1);
    expect(await dueFor(b.brandId, '2026-11-10T08:01:00Z')).toEqual([]);
  });

  it('still reads the old JSON in error: its attempts count once (before the columns were used)', async () => {
    const b = await seedWeeklyBrand(db, { name: 'Old Co', timezone: 'Europe/London', weekday: 1, time: '08:00' });
    const old = (attempts: number, claimedAt: string | null = null) =>
      JSON.stringify({ attempts, regens: 0, claimedAt, message: 'The AI call failed twice' });
    const id = await insertBatch(db, b.brandId, '2026-11-09', { status: 'failed', error: old(2), createdAt: '2026-11-09T08:00:00Z' });
    expect((await dueFor(b.brandId, '2026-11-09T10:00:00Z'))[0]).toMatchObject({ attempt: 3, reason: 'retry' });
    await db.withAdmin((tx) => tx.query('update public.weekly_batches set error = $2 where id = $1', [id, old(3)]));
    expect(await dueFor(b.brandId, '2026-11-09T11:00:00Z')).toEqual([]);

    // A crashed run recorded the old way is stale once its claimedAt is over 10 minutes old.
    const c = await seedWeeklyBrand(db, { name: 'Old Busy Co', timezone: 'Europe/London', weekday: 1, time: '08:00' });
    await insertBatch(db, c.brandId, '2026-11-09', {
      status: 'generating',
      error: old(1, '2026-11-09T08:55:00.000Z'),
      createdAt: '2026-11-09T08:55:00Z',
    });
    expect(await dueFor(c.brandId, '2026-11-09T09:00:00Z')).toEqual([]);
    expect((await dueFor(c.brandId, '2026-11-09T09:30:00Z'))[0]).toMatchObject({ attempt: 2, reason: 'stale' });
  });

  it('never includes paused, unsubscribed or not-yet-set-up brands', async () => {
    const now = '2026-11-09T09:00:00Z';
    const unsub = await seedWeeklyBrand(db, { name: 'Unsub', unsubscribed: true });
    const pausedFuture = await seedWeeklyBrand(db, { name: 'Paused', pausedUntil: '2026-11-20' });
    const pausedOver = await seedWeeklyBrand(db, { name: 'Pause over', pausedUntil: '2026-11-09' });
    const noSetup = await seedWeeklyBrand(db, { name: 'No setup', setup: false });
    expect(await dueFor(unsub.brandId, now)).toEqual([]);
    expect(await dueFor(pausedFuture.brandId, now)).toEqual([]);
    expect(await dueFor(noSetup.brandId, now)).toEqual([]);
    // The pause ends on its date.
    expect(await dueFor(pausedOver.brandId, now)).toHaveLength(1);
    // Paused yesterday's date but still paused until it passes: not due the day before.
    expect(await dueFor(pausedOver.brandId, '2026-11-08T09:00:00Z')).toEqual([]);
  });

  it('skips a brand with an unknown time zone instead of failing the sweep', async () => {
    const bad = await seedWeeklyBrand(db, { name: 'Bad zone', timezone: 'Mars/Olympus' });
    const good = await seedWeeklyBrand(db, { name: 'Good zone' });
    const due = await dueBrands(at('2026-11-09T09:00:00Z'));
    expect(due.find((d) => d.brandId === bad.brandId)).toBeUndefined();
    expect(due.find((d) => d.brandId === good.brandId)).toBeDefined();
  });
});

describe('localClock', () => {
  it('reads midnight as 00:00:00, not 24:00:00', () => {
    expect(localClock(at('2026-11-09T00:00:00Z'), 'Europe/London')).toEqual({ date: '2026-11-09', time: '00:00:00' });
  });
});
