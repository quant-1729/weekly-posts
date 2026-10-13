import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createMockDb, setMockDbForTests, type MockDb } from '@/lib/db/mock';
import { s } from '@/lib/i18n/strings';
import { startGenerateNow } from '@/lib/weekly/button';
import { captionPreview, loadWeekView, type WeekView as WeekData } from '@/lib/weekly/view';
import { seedWeeklyBrand, tempStorage } from './helpers';

vi.mock('@/components/week/actions', () => ({ generateNowAction: vi.fn(), getWeekViewAction: vi.fn() }));
import { WeekView } from '@/components/week/week-view';

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

describe('startGenerateNow', () => {
  it('targets the current local week through Wednesday and next week after, claiming before it returns', async () => {
    const { userId, brandId } = await seedWeeklyBrand(db, { photos: 2, storage: store.storage });
    const wed = await startGenerateNow(userId, { now: new Date('2026-12-23T12:00:00Z'), storage: store.storage });
    if (!wed.ok) throw new Error(`expected ok, got ${wed.code}`);
    expect(wed.weekStart).toBe('2026-12-21');

    // The claim exists already, so a screen that polls sees "generating" at once.
    const during = await loadWeekView(userId, brandId, '2026-12-21');
    expect(during.batch?.status).toBe('generating');
    expect(during.canGenerate).toBe(false);
    // Pressing again while it runs is refused, not doubled.
    const again = await startGenerateNow(userId, { now: new Date('2026-12-23T12:01:00Z'), storage: store.storage });
    expect(again).toMatchObject({ ok: false, code: 'busy' });

    const result = await wed.run();
    expect(result.status).toBe('ready');
    const after = await loadWeekView(userId, brandId, '2026-12-21');
    expect(after.batch?.status).toBe('ready');
    expect(after.batch?.trigger).toBe('button');
    expect(after.posts).toHaveLength(4);

    // On a Thursday the button prepares next week.
    const thu = await startGenerateNow(userId, { now: new Date('2026-12-24T12:00:00Z'), storage: store.storage });
    if (!thu.ok) throw new Error(`expected ok, got ${thu.code}`);
    expect(thu.weekStart).toBe('2026-12-28');
    await thu.run();
    expect((await loadWeekView(userId, brandId, '2026-12-28')).posts).toHaveLength(4);
  });

  it('uses the brand time zone for the weekday', async () => {
    // 2026-12-23 23:30Z is already Thursday in Auckland.
    const { userId } = await seedWeeklyBrand(db, { timezone: 'Pacific/Auckland', photos: 0 });
    const r = await startGenerateNow(userId, { now: new Date('2026-12-23T23:30:00Z'), storage: store.storage });
    expect(r.ok && r.weekStart).toBe('2026-12-28');
  });

  it('refuses a user whose business setup is not finished', async () => {
    const { userId } = await seedWeeklyBrand(db, { setup: false });
    expect(await startGenerateNow(userId)).toMatchObject({ ok: false, code: 'no_brand' });
  });
});

const view = (o: Partial<WeekData> = {}): WeekData => ({
  weekStart: '2026-12-21',
  photos: [],
  batch: null,
  posts: [],
  canGenerate: true,
  regenerationsLeft: 3,
  hasApproved: false,
  ...o,
});
const html = (v: WeekData) => renderToString(createElement(WeekView, { initial: v }));
/** renderToString escapes apostrophes. */
const esc = (t: string) => t.replace(/'/g, '&#x27;');
const postRow = (o: Partial<WeekData['posts'][number]> = {}): WeekData['posts'][number] => ({
  id: 'p1',
  suggestedDay: '2026-12-22',
  channel: 'instagram',
  status: 'draft',
  caption: 'First line of the caption\nSecond line',
  fullCaption: 'First line of the caption\nSecond line',
  cta: 'Message us',
  hashtags: [],
  imageText: { headline: 'Headline', subline: '' },
  photoId: null,
  flags: [],
  reminder: false,
  flagCount: 0,
  imageUrl: '/api/files/renders/b/p1/square.png',
  occasion: null,
  images: { square: '/api/files/renders/b/p1/square.png' },
  shareText: 'First line of the caption\n\nMessage us',
  postedAt: null,
  postedOn: null,
  ...o,
});

describe('WeekView component', () => {
  it('with no batch shows the generate button and no spinner', () => {
    const out = html(view());
    expect(out).toContain(esc(s.week.generate));
    expect(out).not.toContain('about a minute');
    expect(out).toContain(s.week.emptyNone);
  });

  it('while generating shows the waiting text instead of the button', () => {
    const out = html(view({ batch: { id: 'b', status: 'generating', trigger: 'button', generatedAt: null, errorMessage: '' }, canGenerate: false }));
    expect(out).toContain('Generating… (about a minute)');
    expect(out).not.toContain(esc(s.week.generate));
    expect(out).not.toContain(s.week.regenerate);
  });

  it('lists each post with its square image, day, channel, first lines and flag count', () => {
    const out = html(
      view({
        batch: { id: 'b', status: 'ready', trigger: 'cron', generatedAt: '2026-12-21T08:00:00.000Z', errorMessage: '' },
        posts: [postRow(), postRow({ id: 'p2', suggestedDay: '2026-12-24', channel: 'gbp', flagCount: 2, caption: 'Second post text', imageUrl: null })],
        regenerationsLeft: 2,
      }),
    );
    expect(out).toContain('/api/files/renders/b/p1/square.png');
    expect(out).toMatch(/Tue,? 22 Dec/);
    expect(out).toContain('Instagram');
    expect(out).toContain('First line of the caption');
    expect(out).toContain(s.week.flagsNone);
    expect(out).toMatch(/Thu,? 24 Dec/);
    expect(out).toContain('Google Business Profile');
    expect(out).toContain('2 to check');
    expect(out).toContain(s.week.noImage);
    expect(out).toContain(s.week.statusReady);
    expect(out).toContain(s.week.regenerate);
    expect(out).toContain('2 more times');
  });

  it('hides the button when the week cannot be regenerated', () => {
    const out = html(
      view({ batch: { id: 'b', status: 'ready', trigger: 'cron', generatedAt: null, errorMessage: '' }, posts: [postRow()], canGenerate: false, hasApproved: true }),
    );
    expect(out).not.toContain(s.week.regenerate);
    expect(out).not.toContain(esc(s.week.generate));
  });

  it('after a failure says so and offers the button again', () => {
    const out = html(view({ batch: { id: 'b', status: 'failed', trigger: 'cron', generatedAt: null, errorMessage: 'The AI call failed twice' } }));
    expect(out).toContain(s.week.statusFailed);
    expect(out).toContain(esc(s.week.generate));
    expect(out).not.toContain('The AI call failed twice'); // the owner sees plain words, not the log
  });

  it('after a failed regeneration tells the owner the earlier posts are kept', () => {
    const out = html(view({ batch: { id: 'b', status: 'ready', trigger: 'button', generatedAt: null, errorMessage: 'boom' }, posts: [postRow()] }));
    expect(out).toContain(s.week.regenFailed);
  });
});

describe('captionPreview', () => {
  it('keeps the first three lines and shortens very long text', () => {
    expect(captionPreview('a\n\nb\nc\nd')).toBe('a\nb\nc');
    expect(captionPreview('x'.repeat(400)).length).toBeLessThanOrEqual(160);
  });
});
