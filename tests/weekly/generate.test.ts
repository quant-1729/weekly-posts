import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { V2_CHANNEL_SPECS } from '@/lib/ai/prompts/v2-weekly';
import type { WeeklyBatch } from '@/lib/ai/schemas-v2';
import { createMockDb, setMockDbForTests, type MockDb } from '@/lib/db/mock';
import { FORMAT_SIZE, listTemplates, templateInfo } from '@/lib/render';
import { BrandAccessError } from '@/lib/brand/current';
import { generateWeek, startGeneration, type GenerateDeps } from '@/lib/weekly/generate';
import { PLANTED_PRICE, fixtureWeeklyBatch } from '@/lib/weekly/fixtures';
import { MAX_CRON_ATTEMPTS } from '@/lib/weekly/meta';
import { loadWeekView } from '@/lib/weekly/view';
import { seedHistoryPost } from '../guardrail/helpers';
import { count, seedWeeklyBrand, tempStorage } from './helpers';

// A week with a (non-sensitive) public holiday in Great Britain: Christmas Day is Friday 25 Dec 2026.
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
const brand = (o: Parameters<typeof seedWeeklyBrand>[1] = {}) => seedWeeklyBrand(db, { photos: 3, storage: store.storage, ...o });

type Row = Record<string, unknown>;
const rows = (sql: string, params: unknown[] = []) => db.withAdmin((tx) => tx.query<Row>(sql, params));

describe('AC 8 and 10: a generated week', () => {
  it('has every field on every post and three exactly-sized images', async () => {
    const { brandId, photoIds } = await brand();
    const res = await generateWeek({ brandId, weekStart: WEEK, trigger: 'cron' }, deps());
    if (res.status !== 'ready') throw new Error(`expected ready, got ${JSON.stringify(res)}`);
    expect(res.posts).toHaveLength(4);

    const posts = await rows(
      `select id::text, status::text, suggested_day::text as day, channel::text, post_language, caption, cta, hashtags, image_text,
              occasion, photo_id::text, fact_flags, original, post_code, input_type, language, batch_id::text, brand_id::text, created_by
         from public.posts where batch_id = $1 order by suggested_day`,
      [res.batchId],
    );
    expect(posts).toHaveLength(4);
    const codes = new Set<string>();
    for (const p of posts) {
      const channel = p.channel as keyof typeof V2_CHANNEL_SPECS;
      const spec = V2_CHANNEL_SPECS[channel];
      expect(p.status).toBe('draft');
      expect(String(p.caption).length).toBeGreaterThan(0);
      expect(String(p.cta).length).toBeGreaterThan(0);
      const tags = p.hashtags as string[];
      expect(tags.length).toBeGreaterThanOrEqual(spec.hashtags[0]);
      expect(tags.length).toBeLessThanOrEqual(spec.hashtags[1]);
      if (channel !== 'gbp') expect(tags.length).toBeGreaterThanOrEqual(3);
      expect(tags.length).toBeLessThanOrEqual(channel === 'instagram' ? 8 : channel === 'gbp' ? 3 : 5);
      for (const t of tags) expect(t).toMatch(/^#\S+$/);
      expect(p.post_language).toBe('en');
      expect(p.post_code).toMatch(/^[a-z0-9]{7}$/);
      codes.add(p.post_code as string);
      expect(p.day as string >= WEEK && (p.day as string) <= '2026-12-27').toBe(true);
      expect(p.input_type).toBeNull();
      expect(p.language).toBeNull();
      expect(p.brand_id).toBe(brandId);
      expect((p.original as Row).caption).toBe(p.caption);
      expect((p.original as Row).link).toBe(spec.clickableLink);
      expect(Array.isArray(p.fact_flags)).toBe(true);
    }
    expect(codes.size).toBe(4);
    expect(new Set(posts.map((p) => p.day)).size).toBe(4);

    // The link flag follows the channel and is returned on every post.
    for (const p of res.posts) expect(p.link).toBe(V2_CHANNEL_SPECS[p.channel].clickableLink);
    expect(res.posts.find((p) => p.channel === 'instagram')?.link).toBe(false);

    // Three images per post, in the exact sizes, stored under renders/{brand}/{post}/{format}.png.
    const images = await rows('select post_id::text, format::text, template_id, image_path from public.post_images where brand_id = $1', [brandId]);
    expect(images).toHaveLength(12);
    for (const p of posts) {
      for (const format of ['square', 'vertical', 'landscape'] as const) {
        const img = images.find((i) => i.post_id === p.id && i.format === format);
        expect(img, `${p.id} ${format}`).toBeDefined();
        expect(img!.image_path).toBe(`renders/${brandId}/${p.id}/${format}.png`);
        const file = await store.storage.get('renders', `${brandId}/${p.id}/${format}.png`);
        expect(file).not.toBeNull();
        const meta = await sharp(Buffer.from(file!.bytes)).metadata();
        expect(meta.format).toBe('png');
        expect([meta.width, meta.height]).toEqual([FORMAT_SIZE[format].w, FORMAT_SIZE[format].h]);
      }
    }
    expect(FORMAT_SIZE.square).toEqual({ w: 1080, h: 1080 });
    expect(FORMAT_SIZE.vertical).toEqual({ w: 1080, h: 1920 });
    expect(FORMAT_SIZE.landscape).toEqual({ w: 1200, h: 630 });

    // Photos used belong to this brand's library; the batch is ready with a generated_at.
    for (const p of posts) if (p.photo_id) expect(photoIds).toContain(p.photo_id);
    const [batch] = await rows('select status::text, generated_at, trigger from public.weekly_batches where id = $1', [res.batchId]);
    expect(batch.status).toBe('ready');
    expect(batch.generated_at).not.toBeNull();
  });

  it('posts without a photo use text-only templates, posts with a photo use photo templates', async () => {
    const { brandId } = await brand();
    const res = await generateWeek({ brandId, weekStart: WEEK, trigger: 'cron' }, deps());
    if (res.status !== 'ready') throw new Error('expected ready');
    const noPhoto = res.posts.filter((p) => p.photoId === null);
    const withPhoto = res.posts.filter((p) => p.photoId !== null);
    expect(noPhoto.length).toBeGreaterThanOrEqual(1);
    expect(withPhoto.length).toBeGreaterThanOrEqual(1);
    for (const p of noPhoto) for (const img of p.images) expect(templateInfo(img.templateId)?.needsPhoto).toBe(false);
    for (const p of withPhoto) for (const img of p.images) expect(templateInfo(img.templateId)?.needsPhoto).toBe(true);
    expect(listTemplates('square').some((t) => !t.needsPhoto)).toBe(true);
  });

  it('a brand with no photos at all gets four text-only posts with all three formats', async () => {
    const { brandId } = await seedWeeklyBrand(db, { name: 'No photos' });
    const res = await generateWeek({ brandId, weekStart: WEEK, trigger: 'cron' }, deps());
    if (res.status !== 'ready') throw new Error('expected ready');
    expect(res.posts).toHaveLength(4);
    for (const p of res.posts) {
      expect(p.photoId).toBeNull();
      expect(p.images).toHaveLength(3);
      for (const img of p.images) expect(templateInfo(img.templateId)?.needsPhoto).toBe(false);
    }
  });

  it('one post is tied to a holiday of the brand country and stores the occasion name', async () => {
    const { brandId } = await brand();
    const res = await generateWeek({ brandId, weekStart: WEEK, trigger: 'cron' }, deps());
    if (res.status !== 'ready') throw new Error('expected ready');
    const withOccasion = res.posts.filter((p) => p.occasion);
    expect(withOccasion).toHaveLength(1);
    expect(withOccasion[0].occasion).toMatch(/christmas/i);
    const [row] = await rows('select occasion from public.posts where id = $1', [withOccasion[0].id]);
    expect(row.occasion).toBe(withOccasion[0].occasion);
  });

  it('logs and returns timings; a full fixture week takes well under 3 minutes', async () => {
    const { brandId } = await brand();
    const res = await generateWeek({ brandId, weekStart: WEEK, trigger: 'cron' }, deps());
    if (res.status !== 'ready') throw new Error('expected ready');
    const t = res.timings;
    console.log(`fixture week timings: ${JSON.stringify(t)}`);
    expect(t.totalMs).toBeLessThan(30_000);
    expect(t.totalMs).toBeLessThan(180_000);
    expect(t.renderMs).toBeGreaterThan(0);
    expect(t.totalMs).toBeGreaterThanOrEqual(t.aiMs + t.guardrailMs + t.renderMs - 5);
    expect(res.usd).toBe(0);
  });
});

describe('guardrail in the pipeline', () => {
  it('flags the planted unsupported price on its post and nothing else blocks', async () => {
    const { brandId } = await brand();
    const res = await generateWeek({ brandId, weekStart: WEEK, trigger: 'cron' }, deps());
    if (res.status !== 'ready') throw new Error('expected ready');
    const planted = res.posts.filter((p) => p.caption.includes(PLANTED_PRICE));
    expect(planted).toHaveLength(1);
    const stored = await rows('select fact_flags from public.posts where id = $1', [planted[0].id]);
    const flags = stored[0].fact_flags as Array<{ text: string; kind: string; status: string }>;
    expect(flags.some((f) => f.text === PLANTED_PRICE && f.kind === 'price' && f.status === 'open')).toBe(true);
    for (const p of res.posts.filter((x) => x.id !== planted[0].id)) {
      expect(p.flags.filter((f) => f.status === 'open' && f.kind !== 'regulated_reminder'), p.caption).toEqual([]);
    }
  });

  it('a repeated 6+ word phrase from the last 4 weeks triggers exactly one rewrite', async () => {
    const { brandId, userId } = await brand();
    await seedHistoryPost(db, brandId, userId, '2026-12-14', 'We said hello. Every order is checked by hand before it leaves us. Bye.');
    const rewrite = vi.fn((post: Parameters<NonNullable<NonNullable<GenerateDeps['fixtures']>['rewrite']>>[0], remove: { phrases: string[]; words: string[] }) => ({
      caption: 'A calm look at our workshop this week. We look over every order ourselves.',
      hashtags: post.hashtags,
      cta: post.cta,
      image_text: post.image_text,
      note: `removed ${remove.phrases.length}`,
    }));
    const res = await generateWeek({ brandId, weekStart: WEEK, trigger: 'cron' }, deps({ fixtures: { rewrite } }));
    if (res.status !== 'ready') throw new Error('expected ready');
    expect(rewrite).toHaveBeenCalledTimes(1);
    expect(rewrite.mock.calls[0][1].phrases.join(' ').toLowerCase()).toContain('checked by hand');
    expect(res.rewrites).toBe(1);
    expect(await count(db, `select 1 from public.usage_events where brand_id = $1 and kind = 'auto_rewrite'`, [brandId])).toBe(1);
    expect(await count(db, `select 1 from public.usage_events where brand_id = $1 and kind = 'rewrite'`, [brandId])).toBe(0);

    const first = res.posts.find((p) => p.channel === 'instagram')!;
    expect(first.caption).toBe('A calm look at our workshop this week. We look over every order ourselves.');
    expect(first.flags.some((f) => f.kind === 'repeat')).toBe(false);
    // The caption the model wrote first is kept for measuring edits.
    const [row] = await rows('select original from public.posts where id = $1', [first.id]);
    expect(String((row.original as Row).model_caption)).toContain('checked by hand');
  });

  it('a repeat that survives the one rewrite is stored as an open repeat flag, with no second rewrite', async () => {
    const { brandId, userId } = await brand();
    await seedHistoryPost(db, brandId, userId, '2026-12-14', 'We said hello. Every order is checked by hand before it leaves us. Bye.');
    const rewrite = vi.fn((post: { caption: string; cta: string; hashtags: string[]; image_text: { headline: string; subline: string } }) => ({ ...post, note: '' }));
    const res = await generateWeek({ brandId, weekStart: WEEK, trigger: 'cron' }, deps({ fixtures: { rewrite } }));
    if (res.status !== 'ready') throw new Error('expected ready');
    expect(rewrite).toHaveBeenCalledTimes(1);
    const first = res.posts.find((p) => p.channel === 'instagram')!;
    expect(first.flags.filter((f) => f.kind === 'repeat' && f.status === 'open')).toHaveLength(1);
    const [row] = await rows('select fact_flags from public.posts where id = $1', [first.id]);
    expect((row.fact_flags as Array<{ kind: string }>).some((f) => f.kind === 'repeat')).toBe(true);
  });

  it('image text with a word to avoid triggers a rewrite that removes it', async () => {
    const { brandId } = await brand({ wordsToAvoid: ['tasting'] });
    const rewriteSpy = vi.fn();
    const res = await generateWeek(
      { brandId, weekStart: WEEK, trigger: 'cron' },
      deps({
        fixtures: {
          rewrite: (post, remove) => {
            rewriteSpy(remove);
            const strip = (t: string) => t.replace(/\s*tasting\s*/gi, ' ').trim();
            return { caption: strip(post.caption), hashtags: post.hashtags, cta: post.cta, image_text: { headline: strip(post.image_text.headline), subline: strip(post.image_text.subline) }, note: '' };
          },
        },
      }),
    );
    if (res.status !== 'ready') throw new Error('expected ready');
    expect(rewriteSpy).toHaveBeenCalledTimes(1);
    expect(rewriteSpy.mock.calls[0][0].words).toEqual(['tasting']);
    const post = res.posts.find((p) => p.channel === 'facebook')!;
    expect(`${post.caption} ${post.cta} ${post.imageText.headline} ${post.imageText.subline}`.toLowerCase()).not.toContain('tasting');
    expect(post.flags.some((f) => f.kind === 'avoid')).toBe(false);
    // The rewrite did not make the price supported: it is still flagged.
    expect(post.flags.some((f) => f.kind === 'price' && f.status === 'open')).toBe(true);
  });
});

describe('normalising the model output in the pipeline', () => {
  it('fixes bad photo ids, repeated and out-of-week days, hashtag counts and caption length', async () => {
    const { brandId, photoIds } = await brand();
    const long = Array.from({ length: 120 }, (_, i) => `Sentence number ${i} says something warm.`).join(' ');
    const batch = (ctx: Parameters<typeof fixtureWeeklyBatch>[0]): WeeklyBatch => {
      const base = fixtureWeeklyBatch(ctx).posts;
      return {
        posts: [
          { ...base[0], suggested_day: '2026-12-22', photo_id: 'p1', caption: long, hashtags: Array.from({ length: 15 }, (_, i) => `tag${i}`) },
          { ...base[1], suggested_day: '2026-12-22', photo_id: 'p1' }, // same day, same photo
          { ...base[2], suggested_day: '2026-12-01', photo_id: 'p77', occasion_key: 'nope' }, // out of week, bad photo, bad occasion
          { ...base[3], suggested_day: '2026-12-23', photo_id: 'p2', hashtags: ['#a', '#b', '#c', '#d', '#e'] }, // gbp max 3
        ],
      };
    };
    const res = await generateWeek({ brandId, weekStart: WEEK, trigger: 'cron' }, deps({ fixtures: { weekly: batch } }));
    if (res.status !== 'ready') throw new Error('expected ready');
    expect(new Set(res.posts.map((p) => p.suggestedDay)).size).toBe(4);
    for (const p of res.posts) expect(p.suggestedDay >= WEEK && p.suggestedDay <= '2026-12-27').toBe(true);
    const photos = res.posts.map((p) => p.photoId).filter(Boolean);
    expect(new Set(photos).size).toBe(photos.length);
    expect(photos).toEqual(expect.arrayContaining([photoIds[2], photoIds[1]]));
    expect(photos).toHaveLength(2);
    const ig = res.posts.find((p) => p.channel === 'instagram')!;
    expect(ig.hashtags).toHaveLength(8);
    expect(ig.caption.length).toBeLessThanOrEqual(V2_CHANNEL_SPECS.instagram.captionMaxChars);
    expect(ig.caption.endsWith('.')).toBe(true);
    expect(res.posts.find((p) => p.channel === 'gbp')!.hashtags).toHaveLength(3);
    expect(res.posts.every((p) => p.occasion === null || /christmas|boxing|new year/i.test(p.occasion))).toBe(true);
  });
});

describe('LLM failure (PRD §8)', () => {
  it('retries the whole call once, then marks the batch failed and writes no posts', async () => {
    const { brandId } = await brand();
    const weekly = vi.fn((): WeeklyBatch => {
      throw new Error('model unavailable');
    });
    const res = await generateWeek({ brandId, weekStart: WEEK, trigger: 'cron' }, deps({ fixtures: { weekly } }));
    expect(weekly).toHaveBeenCalledTimes(2);
    expect(res.status).toBe('failed');
    if (res.status !== 'failed') return;
    expect(res.error).toContain('model unavailable');
    expect(res.keptPrevious).toBe(false);
    const [batch] = await rows('select status::text as status, error, attempts, regens, claimed_at, generated_at from public.weekly_batches where id = $1', [res.batchId]);
    expect(batch.status).toBe('failed');
    expect(batch.generated_at).toBeNull();
    expect(batch).toMatchObject({ attempts: 1, regens: 0, claimed_at: null });
    expect(batch.error).toBe(res.error); // plain text, not JSON
    expect(batch.error as string).toContain('model unavailable');
    expect(await count(db, 'select 1 from public.posts where brand_id = $1', [brandId])).toBe(0);
    expect(await count(db, 'select 1 from public.post_images where brand_id = $1', [brandId])).toBe(0);
  });

  it('succeeds when the second attempt works', async () => {
    const { brandId } = await brand();
    let calls = 0;
    const res = await generateWeek(
      { brandId, weekStart: WEEK, trigger: 'cron' },
      deps({
        fixtures: {
          weekly: (ctx) => {
            calls += 1;
            if (calls === 1) throw new Error('timeout');
            return fixtureWeeklyBatch(ctx);
          },
        },
      }),
    );
    expect(calls).toBe(2);
    expect(res.status).toBe('ready');
  });

  it('a failed batch can be retried by the cron up to 3 attempts, then no more', async () => {
    const { brandId } = await brand();
    const failing = deps({ fixtures: { weekly: () => { throw new Error('down'); } } });
    for (let attempt = 1; attempt <= MAX_CRON_ATTEMPTS; attempt++) {
      const r = await generateWeek({ brandId, weekStart: WEEK, trigger: 'cron' }, failing);
      expect(r.status).toBe('failed');
      const [b] = await rows('select attempts from public.weekly_batches where brand_id = $1', [brandId]);
      expect(b.attempts).toBe(attempt);
    }
    const again = await generateWeek({ brandId, weekStart: WEEK, trigger: 'cron' }, deps());
    expect(again).toMatchObject({ status: 'skipped', reason: 'retry_limit' });
    // The owner can still press the button.
    const { userId } = await rows('select user_id::text as "userId" from public.brand_members where brand_id = $1', [brandId]).then((r) => ({ userId: r[0].userId as string }));
    const viaButton = await generateWeek({ brandId, weekStart: WEEK, trigger: 'button', userId }, deps());
    expect(viaButton.status).toBe('ready');
  });

  it('does not retry the call when the daily cap is reached, and says so', async () => {
    const { brandId } = await brand();
    await db.withAdmin((tx) => tx.query('update public.brands set daily_generation_cap = 0 where id = $1', [brandId]));
    const weekly = vi.fn(fixtureWeeklyBatch);
    const res = await generateWeek({ brandId, weekStart: WEEK, trigger: 'cron' }, { storage: store.storage, fixtures: { weekly } });
    expect(weekly).not.toHaveBeenCalled();
    expect(res.status).toBe('failed');
  });
});

describe('claiming the batch', () => {
  it('two simultaneous runs produce one batch with one set of posts', async () => {
    const { brandId } = await brand();
    const weekly = vi.fn(fixtureWeeklyBatch);
    const results = await Promise.all([
      generateWeek({ brandId, weekStart: WEEK, trigger: 'cron' }, deps({ fixtures: { weekly } })),
      generateWeek({ brandId, weekStart: WEEK, trigger: 'cron' }, deps({ fixtures: { weekly } })),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual(['ready', 'skipped']);
    expect(results.find((r) => r.status === 'skipped')).toMatchObject({ reason: 'busy' });
    expect(weekly).toHaveBeenCalledTimes(1);
    expect(await count(db, 'select 1 from public.weekly_batches where brand_id = $1', [brandId])).toBe(1);
    expect(await count(db, 'select 1 from public.posts where brand_id = $1', [brandId])).toBe(4);
  });

  it('the cron never regenerates a ready batch', async () => {
    const { brandId } = await brand();
    const first = await generateWeek({ brandId, weekStart: WEEK, trigger: 'cron' }, deps());
    expect(first.status).toBe('ready');
    const weekly = vi.fn(fixtureWeeklyBatch);
    const again = await generateWeek({ brandId, weekStart: WEEK, trigger: 'cron' }, deps({ fixtures: { weekly } }));
    expect(again).toMatchObject({ status: 'skipped', reason: 'already_ready' });
    expect(weekly).not.toHaveBeenCalled();
    expect(await count(db, 'select 1 from public.posts where brand_id = $1', [brandId])).toBe(4);
  });

  it('takes over a batch whose run died more than 10 minutes ago, but not a live one', async () => {
    const { brandId } = await brand();
    const live = await startGeneration({ brandId, weekStart: WEEK, trigger: 'cron' }, deps());
    expect(live.started).toBe(true); // claimed, run() not called: the "generating" row is live
    const blocked = await generateWeek({ brandId, weekStart: WEEK, trigger: 'cron' }, deps({ now: new Date(NOW.getTime() + 5 * 60_000) }));
    expect(blocked).toMatchObject({ status: 'skipped', reason: 'busy' });
    const taken = await generateWeek({ brandId, weekStart: WEEK, trigger: 'cron' }, deps({ now: new Date(NOW.getTime() + 11 * 60_000) }));
    expect(taken.status).toBe('ready');
    const [b] = await rows('select error, attempts, claimed_at from public.weekly_batches where brand_id = $1', [brandId]);
    expect(b).toMatchObject({ attempts: 2, error: null, claimed_at: null });
  });
});

describe('the Generate now button', () => {
  it('needs a member of the brand', async () => {
    const mine = await brand();
    const other = await brand();
    await expect(startGeneration({ brandId: mine.brandId, weekStart: WEEK, trigger: 'button', userId: other.userId }, deps())).rejects.toBeInstanceOf(BrandAccessError);
    await expect(startGeneration({ brandId: mine.brandId, weekStart: WEEK, trigger: 'button' }, deps())).rejects.toBeInstanceOf(BrandAccessError);
    expect(await count(db, 'select 1 from public.weekly_batches where brand_id = $1', [mine.brandId])).toBe(0);
    const ok = await generateWeek({ brandId: mine.brandId, weekStart: WEEK, trigger: 'button', userId: mine.userId }, deps());
    expect(ok.status).toBe('ready');
    const [post] = await rows('select created_by::text as created_by from public.posts where brand_id = $1 limit 1', [mine.brandId]);
    expect(post.created_by).toBe(mine.userId);
  });

  it('replaces draft posts and their images, at most 3 times a week', async () => {
    const { brandId, userId } = await brand();
    const run = () => generateWeek({ brandId, weekStart: WEEK, trigger: 'button', userId }, deps());
    const first = await run();
    if (first.status !== 'ready') throw new Error('expected ready');
    let previous = first;
    for (let n = 1; n <= 3; n++) {
      const next = await run();
      if (next.status !== 'ready') throw new Error(`regeneration ${n}: ${JSON.stringify(next)}`);
      expect(next.batchId).toBe(first.batchId);
      expect(await count(db, 'select 1 from public.posts where batch_id = $1', [first.batchId])).toBe(4);
      expect(await count(db, 'select 1 from public.post_images where brand_id = $1', [brandId])).toBe(12);
      // The old drafts and their image files are gone.
      const oldIds = previous.posts.map((p) => p.id);
      expect(await count(db, 'select 1 from public.posts where id = any($1::uuid[])', [oldIds])).toBe(0);
      expect(await store.storage.get('renders', `${brandId}/${oldIds[0]}/square.png`)).toBeNull();
      expect(await store.storage.get('renders', `${brandId}/${next.posts[0].id}/square.png`)).not.toBeNull();
      previous = next;
    }
    const view = await loadWeekView(userId, brandId, WEEK);
    expect(view.regenerationsLeft).toBe(0);
    expect(view.canGenerate).toBe(false);
    const fourth = await run();
    expect(fourth).toMatchObject({ status: 'skipped', reason: 'limit_reached' });
    expect(await count(db, 'select 1 from public.posts where batch_id = $1', [first.batchId])).toBe(4);
  });

  it('never deletes approved posts', async () => {
    const { brandId, userId } = await brand();
    const first = await generateWeek({ brandId, weekStart: WEEK, trigger: 'button', userId }, deps());
    if (first.status !== 'ready') throw new Error('expected ready');
    await db.withAdmin((tx) => tx.query(`update public.posts set status = 'approved', approved_at = now() where id = $1`, [first.posts[0].id]));
    const weekly = vi.fn(fixtureWeeklyBatch);
    const again = await generateWeek({ brandId, weekStart: WEEK, trigger: 'button', userId }, deps({ fixtures: { weekly } }));
    expect(again).toMatchObject({ status: 'skipped', reason: 'has_approved' });
    expect(weekly).not.toHaveBeenCalled();
    expect(await count(db, 'select 1 from public.posts where batch_id = $1', [first.batchId])).toBe(4);
    expect(await count(db, `select 1 from public.posts where id = $1 and status = 'approved'`, [first.posts[0].id])).toBe(1);
    const view = await loadWeekView(userId, brandId, WEEK);
    expect(view.hasApproved).toBe(true);
    expect(view.canGenerate).toBe(false);
  });

  it('a posted post is protected the same way', async () => {
    const { brandId, userId } = await brand();
    const first = await generateWeek({ brandId, weekStart: WEEK, trigger: 'button', userId }, deps());
    if (first.status !== 'ready') throw new Error('expected ready');
    await db.withAdmin((tx) => tx.query(`update public.posts set status = 'posted' where id = $1`, [first.posts[1].id]));
    const again = await generateWeek({ brandId, weekStart: WEEK, trigger: 'button', userId }, deps());
    expect(again).toMatchObject({ status: 'skipped', reason: 'has_approved' });
  });

  it('keeps the earlier drafts when a regeneration fails', async () => {
    const { brandId, userId } = await brand();
    const first = await generateWeek({ brandId, weekStart: WEEK, trigger: 'button', userId }, deps());
    if (first.status !== 'ready') throw new Error('expected ready');
    const failed = await generateWeek({ brandId, weekStart: WEEK, trigger: 'button', userId }, deps({ fixtures: { weekly: () => { throw new Error('boom'); } } }));
    expect(failed).toMatchObject({ status: 'failed', keptPrevious: true });
    const view = await loadWeekView(userId, brandId, WEEK);
    expect(view.batch?.status).toBe('ready');
    expect(view.batch?.errorMessage).toContain('boom');
    expect(view.posts.map((p) => p.id).sort()).toEqual(first.posts.map((p) => p.id).sort());
    expect(await store.storage.get('renders', `${brandId}/${first.posts[0].id}/square.png`)).not.toBeNull();
  });

  it('shows the batch to the owner, and only to the owner', async () => {
    const mine = await brand();
    const other = await brand();
    const res = await generateWeek({ brandId: mine.brandId, weekStart: WEEK, trigger: 'button', userId: mine.userId }, deps());
    if (res.status !== 'ready') throw new Error('expected ready');
    const view = await loadWeekView(mine.userId, mine.brandId, WEEK);
    expect(view.batch?.status).toBe('ready');
    expect(view.posts).toHaveLength(4);
    expect(view.posts[0].imageUrl).toBe(`/api/files/renders/${mine.brandId}/${view.posts[0].id}/square.png`);
    const planted = view.posts.find((p) => p.caption.includes(PLANTED_PRICE))!;
    expect(planted.flagCount).toBeGreaterThanOrEqual(1);
    await expect(loadWeekView(other.userId, mine.brandId, WEEK)).rejects.toBeInstanceOf(BrandAccessError);
  });
});
