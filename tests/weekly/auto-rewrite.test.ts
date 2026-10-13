import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { rewriteSchema, v2FactCheckSchema, weeklyBatchSchema } from '@/lib/ai/schemas-v2';

// Every fixture-mode call gets a cost by kind of call, so the week's USD total can be checked.
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
import { rewritePost } from '@/lib/approvals/ops';
import { WEEKLY_COUNT_CAPS, WEEKLY_REWRITES, WEEKLY_USD_CAP, WeeklyCapError, assertUnderWeeklyCap } from '@/lib/usage/caps';
import { weekCost, weekCounts } from '@/lib/usage/weekly';
import { weekStartFor } from '@/lib/occasions/dates';
import { generateWeek } from '@/lib/weekly/generate';
import { fixtureWeeklyBatch } from '@/lib/weekly/fixtures';
import { count, seedWeeklyBrand, tempStorage } from './helpers';

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

// The first post also uses the word the owner avoids ("tasting"), so the pipeline rewrites two posts:
// that one and the Facebook post, which already has it.
// Usage events are stamped with the real clock, so the week totals are read for the real current week.
const TZ = 'Europe/London';
const thisWeek = () => weekStartFor(new Date(), TZ);

const twoAvoided = (ctx: Parameters<typeof fixtureWeeklyBatch>[0]) => {
  const batch = fixtureWeeklyBatch(ctx);
  batch.posts[0] = { ...batch.posts[0], caption: `${batch.posts[0].caption}\nOur tasting corner is open all week.` };
  return batch;
};

describe('H-1: the pipeline’s own rewrites are auto_rewrite', () => {
  it('two automatic rewrites leave the owner’s rewrite count at 0 and are in the USD total', async () => {
    const { brandId } = await seedWeeklyBrand(db, { photos: 1, storage: store.storage, wordsToAvoid: ['tasting'] });
    const res = await generateWeek({ brandId, weekStart: WEEK, trigger: 'cron' }, { now: NOW, storage: store.storage, fixtures: { weekly: twoAvoided } });
    if (res.status !== 'ready') throw new Error('expected ready');
    expect(res.rewrites).toBe(2);

    const counts = await weekCounts(brandId, thisWeek());
    expect(counts.auto_rewrite).toBe(2);
    expect(counts.rewrite ?? 0).toBe(0);
    expect(await count(db, `select 1 from public.usage_events where brand_id = $1 and kind = 'rewrite'`, [brandId])).toBe(0);

    // The owner still has all 15; no count cap stops the pipeline’s own kind.
    await expect(assertUnderWeeklyCap(brandId, 'rewrite')).resolves.toBeUndefined();
    expect(Object.keys(WEEKLY_COUNT_CAPS)).not.toContain('auto_rewrite');

    // The cost counts: batch + fact check + 2 rewrites + the second fact check.
    const expected = COST.weekly + COST.factCheck + 2 * COST.rewrite + COST.factCheck;
    expect(res.usd).toBeCloseTo(expected, 6);
    expect(await weekCost(brandId, thisWeek())).toBeCloseTo(expected, 6);
    const [auto] = await db.withAdmin((tx) => tx.query<{ usd: string }>(`select sum(usd) as usd from public.usage_events where brand_id = $1 and kind = 'auto_rewrite'`, [brandId]));
    expect(Number(auto.usd)).toBeCloseTo(2 * COST.rewrite, 9);
    const [batch] = await db.withAdmin((tx) => tx.query<{ usd: string }>('select usd from public.weekly_batches where id = $1', [res.batchId]));
    expect(Number(batch.usd)).toBeCloseTo(expected, 6);
  });

  it('auto rewrites do not use the owner’s 15, and the owner’s own rewrites still do', async () => {
    const { brandId, userId } = await seedWeeklyBrand(db, { photos: 1, storage: store.storage, wordsToAvoid: ['tasting'] });
    const res = await generateWeek({ brandId, weekStart: WEEK, trigger: 'cron' }, { now: NOW, storage: store.storage, fixtures: { weekly: twoAvoided } });
    if (res.status !== 'ready') throw new Error('expected ready');
    // 14 owner rewrites: still room for one more, even with 2 automatic ones in the week.
    await db.withAdmin((tx) =>
      tx.query(
        `insert into public.usage_events (brand_id, user_id, kind, usd) select $1, $2, 'rewrite', 0 from generate_series(1, ${WEEKLY_REWRITES - 1})`,
        [brandId, userId],
      ),
    );
    await expect(assertUnderWeeklyCap(brandId, 'rewrite')).resolves.toBeUndefined();
    await db.withAdmin((tx) => tx.query(`insert into public.usage_events (brand_id, user_id, kind, usd) values ($1, $2, 'rewrite', 0)`, [brandId, userId]));
    await expect(assertUnderWeeklyCap(brandId, 'rewrite')).rejects.toBeInstanceOf(WeeklyCapError);
    await expect(assertUnderWeeklyCap(brandId, 'rewrite')).rejects.toMatchObject({ kind: 'rewrite', reason: 'count' });
  });

  it('an owner rewrite is still recorded as rewrite', async () => {
    const { brandId, userId } = await seedWeeklyBrand(db, { photos: 1, storage: store.storage });
    const res = await generateWeek({ brandId, weekStart: WEEK, trigger: 'cron' }, { now: NOW, storage: store.storage });
    if (res.status !== 'ready') throw new Error('expected ready');
    const r = await rewritePost({ brandId, postId: res.posts[0].id, actor: { via: 'dashboard', userId }, instruction: 'Shorter please' }, { storage: store.storage, now: NOW });
    expect(r.ok).toBe(true);
    const counts = await weekCounts(brandId, thisWeek());
    expect(counts.rewrite).toBe(1);
    expect(counts.auto_rewrite ?? 0).toBe(0);
  });

  it('the weekly USD cap still sees the automatic rewrites', async () => {
    const { brandId, userId } = await seedWeeklyBrand(db, { photos: 1, storage: store.storage });
    await db.withAdmin((tx) =>
      tx.query(`insert into public.usage_events (brand_id, user_id, kind, usd) values ($1, $2, 'auto_rewrite', $3)`, [brandId, userId, WEEKLY_USD_CAP]),
    );
    await expect(assertUnderWeeklyCap(brandId, 'weekly_batch')).rejects.toMatchObject({ reason: 'usd' });
  });
});
