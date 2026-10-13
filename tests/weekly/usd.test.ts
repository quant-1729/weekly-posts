import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { v2FactCheckSchema, rewriteSchema, weeklyBatchSchema } from '@/lib/ai/schemas-v2';

// Give every fixture-mode call a cost, by kind of call, so the batch's usd can be checked.
const COST = { weekly: 0.02, factCheck: 0.003, rewrite: 0.001 };
vi.mock('@/lib/ai/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ai/client')>();
  return {
    ...actual,
    generateJson: async (args: Parameters<typeof actual.generateJson>[0]) => {
      const res = await actual.generateJson(args);
      const usd = args.zodSchema === weeklyBatchSchema ? COST.weekly : args.zodSchema === v2FactCheckSchema ? COST.factCheck : args.zodSchema === rewriteSchema ? COST.rewrite : 0;
      return { ...res, stats: { model: 'test', ms: 1, inputTokens: 1, outputTokens: 1, usd } };
    },
  };
});

import { createMockDb, setMockDbForTests, type MockDb } from '@/lib/db/mock';
import { generateWeek } from '@/lib/weekly/generate';
import { seedHistoryPost } from '../guardrail/helpers';
import { seedWeeklyBrand, tempStorage } from './helpers';

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

const batchUsd = async (batchId: string) => {
  const [r] = await db.withAdmin((tx) => tx.query<{ usd: string }>('select usd from public.weekly_batches where id = $1', [batchId]));
  return Number(r.usd);
};

describe('cost (Req 23)', () => {
  it('stores the sum of the run’s usage on the batch: weekly call plus fact check', async () => {
    const { brandId } = await seedWeeklyBrand(db, { photos: 1, storage: store.storage });
    const res = await generateWeek({ brandId, weekStart: WEEK, trigger: 'cron' }, { now: NOW, storage: store.storage });
    if (res.status !== 'ready') throw new Error('expected ready');
    expect(res.usd).toBeCloseTo(COST.weekly + COST.factCheck, 6);
    expect(await batchUsd(res.batchId)).toBeCloseTo(0.023, 6);
    const [ev] = await db.withAdmin((tx) =>
      tx.query<{ usd: string }>(`select sum(usd) as usd from public.usage_events where brand_id = $1 and kind in ('weekly_batch', 'fact_check', 'rewrite')`, [brandId]),
    );
    expect(Number(ev.usd)).toBeCloseTo(0.023, 6);
  });

  it('includes a rewrite and the second fact check', async () => {
    const { brandId, userId } = await seedWeeklyBrand(db, { photos: 1, storage: store.storage });
    await seedHistoryPost(db, brandId, userId, '2026-12-14', 'We said hello. Every order is checked by hand before it leaves us. Bye.');
    const res = await generateWeek({ brandId, weekStart: WEEK, trigger: 'cron' }, { now: NOW, storage: store.storage });
    if (res.status !== 'ready') throw new Error('expected ready');
    expect(res.rewrites).toBe(1);
    const expected = COST.weekly + COST.factCheck + COST.rewrite + COST.factCheck;
    expect(res.usd).toBeCloseTo(expected, 6);
    expect(await batchUsd(res.batchId)).toBeCloseTo(expected, 6);
  });

  it('a failed run still records what it cost, and a later run adds to it', async () => {
    const { brandId } = await seedWeeklyBrand(db, { photos: 1, storage: store.storage });
    // The weekly call works, but the save step then fails: no posts are written, the cost stays.
    const failedSave = await generateWeek(
      { brandId, weekStart: WEEK, trigger: 'cron' },
      { now: NOW, storage: { ...store.storage, put: async () => { throw new Error('disk full'); } } },
    );
    expect(failedSave.status).toBe('failed');
    if (failedSave.status !== 'failed') return;
    expect(failedSave.usd).toBeCloseTo(COST.weekly + COST.factCheck, 6);
    expect(await batchUsd(failedSave.batchId)).toBeCloseTo(0.023, 6);

    const retry = await generateWeek({ brandId, weekStart: WEEK, trigger: 'cron' }, { now: new Date(NOW.getTime() + 3_600_000), storage: store.storage });
    expect(retry.status).toBe('ready');
    expect(await batchUsd(failedSave.batchId)).toBeCloseTo(0.046, 6);
  });
});
