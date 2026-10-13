import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMockDb, setMockDbForTests, type MockDb } from '@/lib/db/mock';
import { generateWeek, startGeneration, type GenerateDeps } from '@/lib/weekly/generate';
import { batchErrorMessage, readBatchState } from '@/lib/weekly/meta';
import { loadWeekView } from '@/lib/weekly/view';
import { dueBrands } from '@/lib/weekly/schedule';
import { insertBatch, seedWeeklyBrand, tempStorage } from './helpers';

// H-3: attempts, regens and claimed_at are real columns; `error` is plain text or null.
const WEEK = '2026-12-21';
const NOW = new Date('2026-12-21T08:00:00Z');

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

const deps = (extra: GenerateDeps = {}): GenerateDeps => ({ now: NOW, storage: store.storage, ...extra });
const brand = () => seedWeeklyBrand(db, { photos: 1, storage: store.storage });
type Row = { status: string; error: string | null; attempts: number; regens: number; claimed_at: Date | null };
const batchOf = async (brandId: string): Promise<Row> =>
  (await db.withAdmin((tx) => tx.query<Row>('select status::text as status, error, attempts, regens, claimed_at from public.weekly_batches where brand_id = $1', [brandId])))[0];
const old = (o: { attempts?: number; regens?: number; claimedAt?: string | null; message?: string }) =>
  JSON.stringify({ attempts: o.attempts ?? 0, regens: o.regens ?? 0, claimedAt: o.claimedAt ?? null, message: o.message ?? '' });

describe('the columns hold the counters', () => {
  it('a claim writes attempts 1, a claim time and no error; a finished run clears the claim', async () => {
    const { brandId } = await brand();
    const started = await startGeneration({ brandId, weekStart: WEEK, trigger: 'cron' }, deps());
    if (!started.started) throw new Error('expected a claim');
    expect(await batchOf(brandId)).toMatchObject({ status: 'generating', error: null, attempts: 1, regens: 0 });
    expect((await batchOf(brandId)).claimed_at?.toISOString()).toBe(NOW.toISOString());
    await started.run();
    expect(await batchOf(brandId)).toMatchObject({ status: 'ready', error: null, attempts: 1, regens: 0, claimed_at: null });
  });

  it('a failed run keeps the count and stores the plain message; a retry adds one and clears the message', async () => {
    const { brandId } = await brand();
    const failing = deps({ fixtures: { weekly: () => { throw new Error('down'); } } });
    const first = await generateWeek({ brandId, weekStart: WEEK, trigger: 'cron' }, failing);
    expect(first.status).toBe('failed');
    const failed = await batchOf(brandId);
    expect(failed).toMatchObject({ status: 'failed', attempts: 1, regens: 0, claimed_at: null });
    expect(failed.error).toContain('down');
    expect(() => JSON.parse(failed.error as string)).toThrow(); // not JSON any more

    const retry = await generateWeek({ brandId, weekStart: WEEK, trigger: 'cron' }, deps());
    expect(retry.status).toBe('ready');
    expect(await batchOf(brandId)).toMatchObject({ status: 'ready', error: null, attempts: 2, regens: 0, claimed_at: null });
  });

  it('regenerations add to regens, stop at 3, and a failed regeneration keeps the drafts and the count', async () => {
    const { brandId, userId } = await brand();
    const button = (extra: GenerateDeps = {}) => generateWeek({ brandId, weekStart: WEEK, trigger: 'button', userId }, deps(extra));
    expect((await button()).status).toBe('ready');
    expect(await batchOf(brandId)).toMatchObject({ regens: 0, attempts: 1 });
    expect((await button()).status).toBe('ready');
    expect(await batchOf(brandId)).toMatchObject({ regens: 1, attempts: 2 });

    const failed = await button({ fixtures: { weekly: () => { throw new Error('boom'); } } });
    expect(failed).toMatchObject({ status: 'failed', keptPrevious: true });
    const kept = await batchOf(brandId);
    expect(kept).toMatchObject({ status: 'ready', regens: 2, claimed_at: null });
    expect(kept.error).toContain('boom');
    const view = await loadWeekView(userId, brandId, WEEK);
    expect(view.batch?.errorMessage).toContain('boom');
    expect(view.regenerationsLeft).toBe(1);

    expect((await button()).status).toBe('ready');
    expect(await batchOf(brandId)).toMatchObject({ regens: 3, error: null });
    expect(await button()).toMatchObject({ status: 'skipped', reason: 'limit_reached' });
    expect((await loadWeekView(userId, brandId, WEEK)).regenerationsLeft).toBe(0);
  });

  it('a stale claim (over 10 minutes) is retaken by the cron and counts a new attempt', async () => {
    const { brandId } = await brand();
    await insertBatch(db, brandId, WEEK, { status: 'generating', attempts: 1, claimedAt: new Date(NOW.getTime() - 11 * 60_000).toISOString(), createdAt: new Date(NOW.getTime() - 11 * 60_000).toISOString() });
    expect(await generateWeek({ brandId, weekStart: WEEK, trigger: 'cron' }, deps({ now: new Date(NOW.getTime() - 5 * 60_000) }))).toMatchObject({ status: 'skipped', reason: 'busy' });
    expect((await generateWeek({ brandId, weekStart: WEEK, trigger: 'cron' }, deps())).status).toBe('ready');
    expect(await batchOf(brandId)).toMatchObject({ attempts: 2, claimed_at: null });
  });

  it('the cron stops after 3 attempts', async () => {
    const { brandId } = await brand();
    await insertBatch(db, brandId, WEEK, { status: 'failed', error: 'down', attempts: 3, createdAt: NOW.toISOString() });
    expect(await generateWeek({ brandId, weekStart: WEEK, trigger: 'cron' }, deps())).toMatchObject({ status: 'skipped', reason: 'retry_limit' });
  });
});

describe('old rows with JSON in error are read once, then written to the columns', () => {
  it('readBatchState takes the numbers from the old JSON, and the columns win when larger', () => {
    const state = readBatchState({ error: old({ attempts: 2, regens: 1, claimedAt: '2026-12-21T07:00:00.000Z', message: 'The AI call failed twice' }), attempts: 0, regens: 0, claimed_at: null });
    expect(state).toEqual({ attempts: 2, regens: 1, claimedAt: '2026-12-21T07:00:00.000Z', message: 'The AI call failed twice' });
    expect(readBatchState({ error: old({ attempts: 1, message: 'x' }), attempts: 3, regens: 0, claimed_at: null }).attempts).toBe(3);
    expect(readBatchState({ error: 'plain words', attempts: 1, regens: 2, claimed_at: null })).toMatchObject({ attempts: 1, regens: 2, message: 'plain words' });
    expect(readBatchState({ error: null })).toEqual({ attempts: 0, regens: 0, claimedAt: null, message: '' });
    expect(batchErrorMessage(old({ message: 'old words' }))).toBe('old words');
    expect(batchErrorMessage('plain words')).toBe('plain words');
    expect(batchErrorMessage(null)).toBe('');
  });

  it('a failed batch with old attempts 2 is retried as attempt 3, and the next write puts the numbers in the columns', async () => {
    const { brandId, userId } = await brand();
    await insertBatch(db, brandId, WEEK, { status: 'failed', error: old({ attempts: 2, message: 'The AI call failed twice' }), createdAt: NOW.toISOString() });
    expect((await loadWeekView(userId, brandId, WEEK)).batch?.errorMessage).toBe('The AI call failed twice');
    expect(await dueBrands(new Date(NOW.getTime() + 3_600_000))).toEqual(expect.arrayContaining([expect.objectContaining({ brandId, attempt: 3, reason: 'retry' })]));

    expect((await generateWeek({ brandId, weekStart: WEEK, trigger: 'cron' }, deps())).status).toBe('ready');
    expect(await batchOf(brandId)).toMatchObject({ status: 'ready', error: null, attempts: 3, regens: 0, claimed_at: null });
  });

  it('old attempts 3 still stops the cron; old regens 3 still stops the button', async () => {
    const a = await brand();
    await insertBatch(db, a.brandId, WEEK, { status: 'failed', error: old({ attempts: 3, message: 'down' }), createdAt: NOW.toISOString() });
    expect(await generateWeek({ brandId: a.brandId, weekStart: WEEK, trigger: 'cron' }, deps())).toMatchObject({ status: 'skipped', reason: 'retry_limit' });

    const b = await brand();
    await insertBatch(db, b.brandId, WEEK, { status: 'ready', error: old({ attempts: 4, regens: 3 }), createdAt: NOW.toISOString() });
    expect((await loadWeekView(b.userId, b.brandId, WEEK)).regenerationsLeft).toBe(0);
    expect(await generateWeek({ brandId: b.brandId, weekStart: WEEK, trigger: 'button', userId: b.userId }, deps())).toMatchObject({ status: 'skipped', reason: 'limit_reached' });

    const c = await brand();
    await insertBatch(db, c.brandId, WEEK, { status: 'ready', error: old({ attempts: 2, regens: 2 }), createdAt: NOW.toISOString() });
    expect((await generateWeek({ brandId: c.brandId, weekStart: WEEK, trigger: 'button', userId: c.userId }, deps())).status).toBe('ready');
    expect(await batchOf(c.brandId)).toMatchObject({ status: 'ready', error: null, attempts: 3, regens: 3 });
  });

  it('a crashed run recorded the old way (old claimedAt) is retaken once it is over 10 minutes old', async () => {
    const { brandId } = await brand();
    const at = new Date(NOW.getTime() - 11 * 60_000).toISOString();
    await insertBatch(db, brandId, WEEK, { status: 'generating', error: old({ attempts: 1, claimedAt: at }), createdAt: at });
    expect((await generateWeek({ brandId, weekStart: WEEK, trigger: 'cron' }, deps())).status).toBe('ready');
    expect(await batchOf(brandId)).toMatchObject({ attempts: 2, error: null, claimed_at: null });
  });
});
