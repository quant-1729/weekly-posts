import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { WeeklyBatch } from '@/lib/ai/schemas-v2';
import { approvePost, editPost, removeFlag, rewritePost } from '@/lib/approvals/ops';
import type { Actor } from '@/lib/approvals/types';
import type { MockDb } from '@/lib/db/mock';
import { setStorageForTests } from '@/lib/storage';
import { signLink } from '@/lib/links/tokens';
import { FIXTURE_SPECS } from '@/lib/mascot/fixtures';
import { generateMascotConcepts, pickMascot } from '@/lib/mascot/service';
import { generateWeek } from '@/lib/weekly/generate';
import { fixtureWeeklyBatch, PLANTED_PRICE, type FixtureContext } from '@/lib/weekly/fixtures';
import { closeTestDb, createUser, openTestDb } from '../brand/helpers';
import { cookieOf, nonceOf, openLink, pressLink } from '../links/helpers';
import { dashActor, emailActor, imageBytes, imageRows, postRow } from '../approvals/helpers';
import { seedMascotBrand, bodyPixels, GREEN_SPEC } from './helpers';
import { tempStorage } from '../weekly/helpers';

const WEEK = '2026-12-21';
const NOW = new Date('2026-12-21T08:00:00Z');
const LATER = new Date('2026-12-22T10:00:00Z');

let db: MockDb;
let store: Awaited<ReturnType<typeof tempStorage>>;
let outsider: string;
beforeAll(async () => {
  db = await openTestDb();
  store = await tempStorage();
  setStorageForTests(store.storage);
  outsider = (await createUser(db)).id;
});
afterAll(async () => {
  setStorageForTests(null);
  await closeTestDb(db);
  await store.cleanup();
});

const rows = (sql: string, params: unknown[] = []) => db.withAdmin((tx) => tx.query<Record<string, unknown>>(sql, params));
const deps = { storage: undefined as never, now: LATER };

interface Week {
  userId: string;
  brandId: string;
  mascotId: string;
  postIds: string[];
}

async function mascotWeek(opts: { switchOn?: boolean; weekly?: (ctx: FixtureContext) => WeeklyBatch; wordsToAvoid?: string[] } = {}): Promise<Week> {
  const { userId, brandId, mascotId } = await seedMascotBrand(db, store.storage, { wordsToAvoid: opts.wordsToAvoid });
  if (opts.switchOn === false) await db.withAdmin((tx) => tx.query('update public.brand_memory set mascot_in_posts = false where brand_id = $1', [brandId]));
  const res = await generateWeek({ brandId, weekStart: WEEK, trigger: 'cron' }, { now: NOW, storage: store.storage, fixtures: opts.weekly ? { weekly: opts.weekly } : undefined });
  if (res.status !== 'ready') throw new Error(JSON.stringify(res));
  return { userId, brandId, mascotId, postIds: res.posts.map((p) => p.id) };
}

const ref = (w: Week, i: number, actor: Actor) => ({ brandId: w.brandId, postId: w.postIds[i], actor });
const d = () => ({ ...deps, storage: store.storage });
const mascotOf = async (postId: string) => (await rows('select mascot_id::text as m, image_text from public.posts where id = $1', [postId]))[0];
const squareGreen = async (w: Week, i: number, spec = GREEN_SPEC) => bodyPixels(await imageBytes(store.storage, w.brandId, w.postIds[i], 'square'), spec);

describe('per post: show mascot on or off (R15e)', () => {
  it('off sets mascot_id to null and redraws all three pictures without it; on brings the active mascot back', async () => {
    const w = await mascotWeek();
    expect(await squareGreen(w, 0)).toBeGreaterThan(1500);
    const before = await imageBytes(store.storage, w.brandId, w.postIds[0], 'vertical');

    const off = await editPost({ ...ref(w, 0, dashActor(w.userId)), input: { showMascot: false } }, d());
    if (!off.ok) throw new Error(off.message);
    expect(off.changed).toBe(true);
    expect(off.post.mascotId).toBeNull();
    expect((await mascotOf(w.postIds[0])).m).toBeNull();
    expect(await squareGreen(w, 0)).toBe(0);
    expect(await bodyPixels(await imageBytes(store.storage, w.brandId, w.postIds[0], 'vertical'))).toBe(0);
    expect((await imageBytes(store.storage, w.brandId, w.postIds[0], 'vertical')).equals(before)).toBe(false);
    expect((await imageRows(db, w.postIds[0])).map((r) => r.format)).toEqual(['landscape', 'square', 'vertical']);
    // The bubble words are kept, so switching back on restores them.
    expect((await mascotOf(w.postIds[0])).image_text).toHaveProperty('bubble');
    // The other posts are untouched.
    expect(await squareGreen(w, 1)).toBeGreaterThan(1500);

    const on = await editPost({ ...ref(w, 0, dashActor(w.userId)), input: { showMascot: true } }, d());
    if (!on.ok) throw new Error(on.message);
    expect((await mascotOf(w.postIds[0])).m).toBe(w.mascotId);
    expect(await squareGreen(w, 0)).toBeGreaterThan(1500);
    expect((await imageBytes(store.storage, w.brandId, w.postIds[0], 'vertical')).equals(before)).toBe(true); // same picture as at the start

    const log = await rows("select detail from public.post_actions where post_id = $1 and action = 'edit' order by id", [w.postIds[0]]);
    expect(log.map((r) => (r.detail as { fields: string[] }).fields)).toEqual([['mascot_off'], ['mascot_on']]);
  });

  it('can switch a mascot on for a post made while the brand switch was off', async () => {
    const w = await mascotWeek({ switchOn: false });
    expect((await mascotOf(w.postIds[1])).m).toBeNull();
    expect(await squareGreen(w, 1)).toBe(0);
    const r = await editPost({ ...ref(w, 1, emailActor('jti-m-1')), input: { showMascot: true, image_text: { bubble: 'Hello there!' } } }, d());
    if (!r.ok) throw new Error(r.message);
    const row = await mascotOf(w.postIds[1]);
    expect(row.m).toBe(w.mascotId);
    expect(row.image_text).toMatchObject({ bubble: 'Hello there!' });
    expect(await squareGreen(w, 1)).toBeGreaterThan(1500);
  });

  it('turning it on needs a mascot', async () => {
    const w = await mascotWeek({ switchOn: false });
    await db.withAdmin((tx) => tx.query("update public.mascots set status = 'archived' where brand_id = $1", [w.brandId]));
    const r = await editPost({ ...ref(w, 0, dashActor(w.userId)), input: { showMascot: true } }, d());
    expect(r).toMatchObject({ ok: false, code: 'invalid' });
    expect((await mascotOf(w.postIds[0])).m).toBeNull();
  });

  it('changing what the mascot says redraws the picture; too long, or a word to avoid, is refused', async () => {
    const w = await mascotWeek({ wordsToAvoid: ['cheap'] });
    const before = await imageBytes(store.storage, w.brandId, w.postIds[2], 'square');
    const r = await editPost({ ...ref(w, 2, dashActor(w.userId)), input: { image_text: { bubble: 'See you on Sunday!' } } }, d());
    if (!r.ok) throw new Error(r.message);
    expect((await mascotOf(w.postIds[2])).image_text).toMatchObject({ bubble: 'See you on Sunday!' });
    expect((await imageBytes(store.storage, w.brandId, w.postIds[2], 'square')).equals(before)).toBe(false);
    expect(await squareGreen(w, 2)).toBeGreaterThan(1500);

    const tooLong = await editPost({ ...ref(w, 2, dashActor(w.userId)), input: { image_text: { bubble: 'x'.repeat(31) } } }, d());
    expect(tooLong).toMatchObject({ ok: false, code: 'invalid' });
    expect(tooLong.ok ? '' : tooLong.message).toMatch(/30 characters/);
    const avoid = await editPost({ ...ref(w, 2, dashActor(w.userId)), input: { image_text: { bubble: 'So cheap today!' } } }, d());
    expect(avoid).toMatchObject({ ok: false, code: 'invalid' });
    expect((await mascotOf(w.postIds[2])).image_text).toMatchObject({ bubble: 'See you on Sunday!' });
  });

  it('a text-only edit keeps the mascot, its bubble and its pose, and an approved post goes back to draft when the mascot changes', async () => {
    const w = await mascotWeek();
    const first = (await mascotOf(w.postIds[3])).image_text as { bubble: string; pose: string };
    const r = await editPost({ ...ref(w, 3, dashActor(w.userId)), input: { image_text: { headline: 'A new headline' } } }, d());
    if (!r.ok) throw new Error(r.message);
    const after = await mascotOf(w.postIds[3]);
    expect(after.m).toBe(w.mascotId);
    expect(after.image_text).toMatchObject({ headline: 'A new headline', bubble: first.bubble, pose: first.pose });
    expect(await squareGreen(w, 3)).toBeGreaterThan(1500);

    // Approve (the planted price is on post 1, so use post 3), then change the mascot: it must be approved again.
    const ok = await approvePost(ref(w, 3, dashActor(w.userId)), d());
    expect(ok.ok).toBe(true);
    const off = await editPost({ ...ref(w, 3, dashActor(w.userId)), input: { showMascot: false } }, d());
    expect(off).toMatchObject({ ok: true, reapprove: true });
    expect((await postRow(db, w.postIds[3])).status).toBe('draft');
  });

  it("a person who is not a member of the brand cannot change a post's mascot", async () => {
    const w = await mascotWeek();
    const r = await editPost({ ...ref(w, 0, dashActor(outsider)), input: { showMascot: false } }, d());
    expect(r).toMatchObject({ ok: false, code: 'forbidden' });
    expect((await mascotOf(w.postIds[0])).m).toBe(w.mascotId);
  });

  it('a rewrite keeps the mascot and what it says', async () => {
    const w = await mascotWeek();
    const before = (await mascotOf(w.postIds[0])).image_text as { bubble: string; pose: string };
    const r = await rewritePost({ ...ref(w, 0, dashActor(w.userId)), instruction: 'Make it shorter' }, { storage: store.storage, now: LATER });
    if (!r.ok) throw new Error(r.message);
    const after = await mascotOf(w.postIds[0]);
    expect(after.m).toBe(w.mascotId);
    expect(after.image_text).toMatchObject({ bubble: before.bubble, pose: before.pose });
    expect(await squareGreen(w, 0)).toBeGreaterThan(1500);
  });
});

describe('a flagged bubble can be removed', () => {
  it('cuts the price out of the bubble and redraws', async () => {
    const w = await mascotWeek({
      weekly: (ctx) => {
        const batch = fixtureWeeklyBatch({ ...ctx, mascot: false });
        return { posts: batch.posts.map((p, i) => ({ ...p, image_text: { ...p.image_text, bubble: i === 0 ? `Just ${PLANTED_PRICE} today` : 'Hello there', pose: 'point' } })) };
      },
    });
    const flags = (await postRow(db, w.postIds[0])).fact_flags as Array<{ id: string; field: string; status: string; text: string }>;
    const flag = flags.find((f) => f.field === 'image_text.bubble');
    expect(flag?.status).toBe('open');
    const before = await imageBytes(store.storage, w.brandId, w.postIds[0], 'square');
    const r = await removeFlag({ ...ref(w, 0, dashActor(w.userId)), flagId: flag!.id }, d());
    if (!r.ok) throw new Error(r.message);
    const row = await mascotOf(w.postIds[0]);
    expect((row.image_text as { bubble: string }).bubble).not.toContain('17.99');
    expect((row.image_text as { bubble: string }).bubble).toContain('Just');
    expect(((await postRow(db, w.postIds[0])).fact_flags as Array<{ field: string; status: string }>).find((f) => f.field === 'image_text.bubble')?.status).toBe('removed');
    expect((await imageBytes(store.storage, w.brandId, w.postIds[0], 'square')).equals(before)).toBe(false);
    expect(row.m).toBe(w.mascotId);
  });
});

describe('regenerating the mascot never changes old posts', () => {
  it('old posts keep their mascot_id and pictures; edits to them still use their own mascot; new weeks use the new one', async () => {
    const w = await mascotWeek();
    const oldBytes = await imageBytes(store.storage, w.brandId, w.postIds[0], 'square');

    // The owner makes a new mascot: concepts, then a pick.
    const { concepts } = await generateMascotConcepts({ userId: w.userId, brandId: w.brandId });
    const fresh = await pickMascot({ userId: w.userId, brandId: w.brandId, mascotId: concepts[0].id, storage: store.storage });
    expect((await rows('select status::text as s from public.mascots where id = $1', [w.mascotId]))[0].s).toBe('archived');

    // Old posts: same mascot_id, same stored pictures.
    for (const id of w.postIds) expect((await mascotOf(id)).m).toBe(w.mascotId);
    expect((await imageBytes(store.storage, w.brandId, w.postIds[0], 'square')).equals(oldBytes)).toBe(true);

    // Editing an old post redraws it with its own (archived) mascot, not the new one.
    const r = await editPost({ ...ref(w, 0, dashActor(w.userId)), input: { image_text: { headline: 'Edited later' } } }, d());
    if (!r.ok) throw new Error(r.message);
    expect((await mascotOf(w.postIds[0])).m).toBe(w.mascotId);
    expect(await squareGreen(w, 0)).toBeGreaterThan(1500);
    expect(await squareGreen(w, 0, FIXTURE_SPECS[0])).toBe(0);

    // A new week uses the new mascot.
    await db.withAdmin((tx) => tx.query('update public.brand_memory set mascot_in_posts = true where brand_id = $1', [w.brandId]));
    const next = await generateWeek({ brandId: w.brandId, weekStart: '2026-12-28', trigger: 'cron' }, { now: new Date('2026-12-28T08:00:00Z'), storage: store.storage });
    if (next.status !== 'ready') throw new Error(JSON.stringify(next));
    for (const p of next.posts) {
      expect(p.mascotId).toBe(fresh.id);
      expect(await bodyPixels(await imageBytes(store.storage, w.brandId, p.id, 'square'), FIXTURE_SPECS[0])).toBeGreaterThan(1500);
      expect(await bodyPixels(await imageBytes(store.storage, w.brandId, p.id, 'square'))).toBe(0);
    }
  });
});

describe('the emailed edit page (no sign-in)', () => {
  const token = (w: Week, i: number) => signLink({ brandId: w.brandId, postId: w.postIds[i], act: 'edit', weekStart: WEEK });
  async function press(t: string, fields: Record<string, string>) {
    const got = await openLink(t);
    const cookie = cookieOf(got);
    const html = await got.text();
    const res = await pressLink(t, { nonce: nonceOf(html), ...fields }, cookie);
    return { status: res.status, html: await res.text() };
  }

  it('shows the mascot choice, and saves it', async () => {
    const w = await mascotWeek();
    const t = await token(w, 0);
    const page = await (await openLink(t)).text();
    expect(page).toContain('Your mascot on this post');
    expect(page).toMatch(/name="show" value="1" checked/);
    expect(page).toContain('name="bubble"');

    const r = await press(t, { op: 'mascot', show: '0', bubble: 'Bye for now' });
    expect(r.status).toBe(200);
    expect(r.html).toContain('Saved.');
    expect((await mascotOf(w.postIds[0])).m).toBeNull();
    expect(await squareGreen(w, 0)).toBe(0);
    expect(await (await openLink(t)).text()).toMatch(/name="show" value="0" checked/);

    const back = await press(t, { op: 'mascot', show: '1', bubble: 'Back again!' });
    expect(back.status).toBe(200);
    expect((await mascotOf(w.postIds[0])).m).toBe(w.mascotId);
    expect(((await mascotOf(w.postIds[0])).image_text as { bubble: string }).bubble).toBe('Back again!');
    expect(await squareGreen(w, 0)).toBeGreaterThan(1500);
  });

  it('says what is wrong when the words are too long', async () => {
    const w = await mascotWeek();
    const t = await token(w, 1);
    const r = await press(t, { op: 'mascot', show: '1', bubble: 'y'.repeat(40) });
    expect(r.html).toContain('Please fix this first');
    expect(r.html).toMatch(/too long/);
  });

  it('does not offer a mascot to a brand that has none', async () => {
    const w = await mascotWeek({ switchOn: false });
    await db.withAdmin((tx) => tx.query("update public.mascots set status = 'archived' where brand_id = $1", [w.brandId]));
    const page = await (await openLink(await token(w, 0))).text();
    expect(page).not.toContain('Your mascot on this post');
  });
});
