import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/ai/client', async (orig) => {
  const mod = await orig<typeof import('@/lib/ai/client')>();
  return { ...mod, generateJson: vi.fn(mod.generateJson) };
});

import { generateJson } from '@/lib/ai/client';
import type { WeeklyBatch } from '@/lib/ai/schemas-v2';
import type { MockDb } from '@/lib/db/mock';
import { fitBubble, validPose } from '@/lib/weekly/normalize';
import { TWEEN_POST_POSES } from '@/lib/mascot/poses';
import { poseOrDefault } from '@/lib/mascot/posts';
import { generateWeek, type GenerateDeps } from '@/lib/weekly/generate';
import { fixtureWeeklyBatch, PLANTED_PRICE, type FixtureContext } from '@/lib/weekly/fixtures';
import { loadWeekView } from '@/lib/weekly/view';
import { closeTestDb, openTestDb } from '../brand/helpers';
import { seedWeeklyBrand, tempStorage } from '../weekly/helpers';
import { colorPixels as bodyPixels, insertActiveMascot, seedMascotBrand } from './helpers';

const ai = vi.mocked(generateJson);
const WEEK = '2026-12-21';
const NOW = new Date('2026-12-21T08:00:00Z');

let db: MockDb;
let store: Awaited<ReturnType<typeof tempStorage>>;
beforeAll(async () => {
  db = await openTestDb();
  store = await tempStorage();
});
afterAll(async () => {
  await closeTestDb(db);
  await store.cleanup();
});
beforeEach(() => {
  ai.mockClear();
});

const deps = (extra: GenerateDeps = {}): GenerateDeps => ({ now: NOW, storage: store.storage, ...extra });
const rows = (sql: string, params: unknown[] = []) => db.withAdmin((tx) => tx.query<Record<string, unknown>>(sql, params));

async function postsOf(batchId: string) {
  return rows(
    `select id::text as id, channel::text as channel, mascot_id::text as mascot_id, image_text, fact_flags, occasion
       from public.posts where batch_id = $1 order by suggested_day`,
    [batchId],
  );
}
async function image(brandId: string, postId: string, format: 'square' | 'vertical' | 'landscape'): Promise<Buffer> {
  const f = await store.storage.get('renders', `${brandId}/${postId}/${format}.png`);
  return Buffer.from(f!.bytes);
}
/** The weekly fixture with a bubble and pose on every post, whatever the occasion (as a careless model might give). */
const chatty = (bubble: (i: number) => string, pose = 'celebrate') => (ctx: FixtureContext): WeeklyBatch => {
  const batch = fixtureWeeklyBatch({ ...ctx, mascot: false });
  return { posts: batch.posts.map((p, i) => ({ ...p, image_text: { ...p.image_text, bubble: bubble(i), pose } })) };
};

describe('weekly posts with the mascot on (R15d)', () => {
  it('asks for a bubble and pose, saves the active mascot on each post and draws it in square and vertical only', async () => {
    const { brandId, mascotId } = await seedMascotBrand(db, store.storage);
    const res = await generateWeek({ brandId, weekStart: WEEK, trigger: 'cron' }, deps());
    if (res.status !== 'ready') throw new Error(JSON.stringify(res));

    // The prompt carries the mascot's name and personality.
    const weeklyCall = ai.mock.calls.map((c) => c[0] as { user: string }).find((c) => c.user.includes('MASCOT:'));
    expect(weeklyCall?.user).toContain('MASCOT: Pip, friendly, curious and a little playful');

    const posts = await postsOf(res.batchId);
    expect(posts).toHaveLength(4);
    for (const p of posts) {
      expect(p.mascot_id).toBe(mascotId);
      const it = p.image_text as { bubble?: string; pose?: string };
      expect(it.bubble?.length).toBeGreaterThan(0);
      expect(Array.from(it.bubble!).length).toBeLessThanOrEqual(30);
      expect(TWEEN_POST_POSES as readonly string[]).toContain(it.pose);
      // Square and vertical show Tween's scarf colour; landscape has no mascot.
      expect(await bodyPixels(await image(brandId, p.id as string, 'square')), 'square').toBeGreaterThan(1500);
      expect(await bodyPixels(await image(brandId, p.id as string, 'vertical')), 'vertical').toBeGreaterThan(1500);
      expect(await bodyPixels(await image(brandId, p.id as string, 'landscape')), 'landscape').toBe(0);
    }
    for (const gp of res.posts) expect(gp.mascotId).toBe(mascotId);
  });

  it('draws no mascot and asks for none when the switch is off', async () => {
    const { brandId } = await seedMascotBrand(db, store.storage);
    await db.withAdmin((tx) => tx.query('update public.brand_memory set mascot_in_posts = false where brand_id = $1', [brandId]));
    const res = await generateWeek({ brandId, weekStart: WEEK, trigger: 'cron' }, deps());
    if (res.status !== 'ready') throw new Error(JSON.stringify(res));
    expect(ai.mock.calls.map((c) => (c[0] as { user: string }).user).find((u) => u.includes('MASCOT:'))).toContain('MASCOT: none');
    for (const p of await postsOf(res.batchId)) {
      expect(p.mascot_id).toBeNull();
      expect(p.image_text).not.toHaveProperty('bubble');
      expect(await bodyPixels(await image(brandId, p.id as string, 'square'))).toBe(0);
    }
  });

  it('draws no mascot when the switch is on but the brand has no active mascot', async () => {
    const { brandId } = await seedWeeklyBrand(db, { photos: 2, storage: store.storage });
    await db.withAdmin((tx) => tx.query('update public.brand_memory set mascot_in_posts = true where brand_id = $1', [brandId]));
    const res = await generateWeek({ brandId, weekStart: WEEK, trigger: 'cron' }, deps());
    if (res.status !== 'ready') throw new Error(JSON.stringify(res));
    for (const p of await postsOf(res.batchId)) expect(p.mascot_id).toBeNull();
  });

  it('a regulated brand never gets the mascot, whatever the switch says', async () => {
    const { brandId } = await seedMascotBrand(db, store.storage, { regulated: 'health' });
    const res = await generateWeek({ brandId, weekStart: WEEK, trigger: 'cron' }, deps());
    if (res.status !== 'ready') throw new Error(JSON.stringify(res));
    for (const p of await postsOf(res.batchId)) {
      expect(p.mascot_id).toBeNull();
      expect(await bodyPixels(await image(brandId, p.id as string, 'vertical'))).toBe(0);
    }
  });

  it('keeps the bubble short and the pose valid, whatever the model gives', async () => {
    const { brandId } = await seedMascotBrand(db, store.storage);
    const long = 'Come in this week for a really lovely warm welcome and a sweet treat';
    const res = await generateWeek({ brandId, weekStart: WEEK, trigger: 'cron' }, deps({ fixtures: { weekly: chatty(() => long, 'dancing') } }));
    if (res.status !== 'ready') throw new Error(JSON.stringify(res));
    for (const p of await postsOf(res.batchId)) {
      const it = p.image_text as { bubble: string; pose: string };
      expect(Array.from(it.bubble).length).toBeLessThanOrEqual(30);
      expect(long.startsWith(it.bubble)).toBe(true);
      expect(it.pose).toBe(''); // not one of the 7: the renderer draws `wave`
      expect(await bodyPixels(await image(brandId, p.id as string, 'square'))).toBeGreaterThan(1500); // still drawn
    }
  });

  it('unit: pose and bubble clean-up', () => {
    expect(poseOrDefault('point')).toBe('point');
    for (const pose of TWEEN_POST_POSES) expect(poseOrDefault(pose)).toBe(pose);
    expect(poseOrDefault('namaste')).toBe('wave'); // an old v1 pose name
    expect(validPose('thinking')).toBe('');
    expect(poseOrDefault('dancing')).toBe('wave');
    expect(poseOrDefault('')).toBe('wave');
    expect(poseOrDefault(undefined)).toBe('wave');
    expect(validPose(' celebrate ')).toBe('celebrate');
    expect(validPose('Celebrate')).toBe('');
    expect(fitBubble('  Fresh   from\nthe oven!  ')).toBe('Fresh from the oven!');
    expect(Array.from(fitBubble('x'.repeat(80))).length).toBeLessThanOrEqual(30);
  });
});

describe('sensitive occasions have no mascot', () => {
  it('draws no mascot and no bubble, and leaves mascot_id empty, even if the model gave a bubble', async () => {
    // Remembrance Sunday (8 Nov 2026) is a sensitive occasion in England.
    const { brandId, mascotId } = await seedMascotBrand(db, store.storage, { country: 'GB', region: 'GB-ENG' });
    const week = '2026-11-02';
    const now = new Date('2026-11-02T08:00:00Z');
    let sensitiveKey = '';
    const fixture = (ctx: FixtureContext): WeeklyBatch => {
      const s = ctx.occasions.find((o) => o.sensitive);
      sensitiveKey = s?.key ?? '';
      const batch = chatty(() => 'Remembering together')(ctx);
      return { posts: batch.posts.map((p, i) => (i === 2 && s ? { ...p, occasion_key: s.key, image_text: { ...p.image_text, headline: s.name } } : p)) };
    };
    const res = await generateWeek({ brandId, weekStart: week, trigger: 'cron' }, deps({ now, fixtures: { weekly: fixture } }));
    if (res.status !== 'ready') throw new Error(JSON.stringify(res));
    expect(sensitiveKey).not.toBe('');

    const posts = await postsOf(res.batchId);
    const sensitive = posts.filter((p) => p.occasion);
    expect(sensitive).toHaveLength(1);
    const s = sensitive[0];
    expect(s.mascot_id).toBeNull();
    expect(s.image_text).toMatchObject({ bubble: '', pose: '' });
    for (const format of ['square', 'vertical', 'landscape'] as const) expect(await bodyPixels(await image(brandId, s.id as string, format)), format).toBe(0);

    // The other posts of the week still have it.
    for (const p of posts.filter((x) => !x.occasion)) {
      expect(p.mascot_id).toBe(mascotId);
      expect(await bodyPixels(await image(brandId, p.id as string, 'square'))).toBeGreaterThan(1500);
    }
  });
});

describe('the bubble goes through the guardrail like other text', () => {
  it('flags a price in the bubble that is not in brand memory', async () => {
    const { brandId } = await seedMascotBrand(db, store.storage);
    const res = await generateWeek(
      { brandId, weekStart: WEEK, trigger: 'cron' },
      deps({ fixtures: { weekly: chatty((i) => (i === 1 ? `Only ${PLANTED_PRICE} today!` : 'Come and say hello!')) } }),
    );
    if (res.status !== 'ready') throw new Error(JSON.stringify(res));
    const posts = await postsOf(res.batchId);
    const flagsOn = (i: number) => (posts[i].fact_flags as Array<{ field: string; text: string; kind: string; status: string }>).filter((f) => f.field === 'image_text.bubble');
    const flagged = posts.map((_, i) => flagsOn(i));
    const withBubbleFlag = flagged.filter((f) => f.length > 0);
    expect(withBubbleFlag).toHaveLength(1);
    expect(withBubbleFlag[0][0]).toMatchObject({ kind: 'price', status: 'open' });
    expect(withBubbleFlag[0][0].text).toContain('17.99');
    expect(res.posts.some((p) => p.flags.some((f) => f.field === 'image_text.bubble'))).toBe(true);
  });

  it('does not flag a bubble that only states a price from brand memory', async () => {
    const { brandId } = await seedMascotBrand(db, store.storage); // facts include the loaf at £4.50
    const res = await generateWeek({ brandId, weekStart: WEEK, trigger: 'cron' }, deps({ fixtures: { weekly: chatty(() => 'Loaf only £4.50!') } }));
    if (res.status !== 'ready') throw new Error(JSON.stringify(res));
    for (const p of await postsOf(res.batchId)) {
      expect((p.fact_flags as Array<{ field: string }>).filter((f) => f.field === 'image_text.bubble')).toHaveLength(0);
    }
  });
});

describe('the week screen knows about the mascot', () => {
  it('reports each post\'s mascot, bubble and whether the editor can offer one', async () => {
    const { userId, brandId, mascotId } = await seedMascotBrand(db, store.storage);
    const res = await generateWeek({ brandId, weekStart: WEEK, trigger: 'cron' }, deps());
    if (res.status !== 'ready') throw new Error(JSON.stringify(res));
    const view = await loadWeekView(userId, brandId, WEEK);
    for (const p of view.posts) {
      expect(p.mascotId).toBe(mascotId);
      expect(p.bubble?.length).toBeGreaterThan(0);
      expect(p.canShowMascot).toBe(true);
    }
    // A brand without a mascot: nothing to offer.
    const plain = await seedWeeklyBrand(db, { photos: 1, storage: store.storage });
    const res2 = await generateWeek({ brandId: plain.brandId, weekStart: WEEK, trigger: 'cron' }, deps());
    if (res2.status !== 'ready') throw new Error(JSON.stringify(res2));
    const view2 = await loadWeekView(plain.userId, plain.brandId, WEEK);
    for (const p of view2.posts) expect([p.mascotId ?? null, p.canShowMascot]).toEqual([null, false]);
    await insertActiveMascot(db, plain.brandId, { name: 'Late' });
    expect((await loadWeekView(plain.userId, plain.brandId, WEEK)).posts.every((p) => p.canShowMascot === true)).toBe(true);
  });
});
