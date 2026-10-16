import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const jar = vi.hoisted(() => {
  const store = new Map<string, string>();
  return {
    store,
    api: {
      get: (name: string) => (store.has(name) ? { name, value: store.get(name)! } : undefined),
      set: (name: string, value: string) => void store.set(name, value),
      delete: (name: string) => void store.delete(name),
    },
  };
});
vi.mock('next/headers', () => ({ cookies: async () => jar.api, headers: async () => new Headers() }));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));

import { saveMascotAction } from '@/app/(app)/mascot/actions';
import { setMascotInPostsAction } from '@/app/(app)/brand/actions';
import { SESSION_COOKIE } from "@/lib/auth/session";
import { signSession } from "../helpers/session";
import { BrandAccessError } from '@/lib/brand/current';
import type { MockDb } from '@/lib/db/mock';
import { s } from '@/lib/i18n/strings';
import { describeMascotError, MascotError } from '@/lib/mascot/errors';
import { mascotDownloads, posePngPath, poseSvgPath, sheetPngPath, sheetStoredPath } from '@/lib/mascot/paths';
import { TWEEN_POST_POSES } from '@/lib/mascot/poses';
import { loadMascotById, loadUsableMascot } from '@/lib/mascot/posts';
import { getMascotCard, getMascotScreen, refreshSheetIfStale, saveMascot, setMascotInPosts } from '@/lib/mascot/service';
import { setStorageForTests } from '@/lib/storage';
import { closeTestDb, createUser, openTestDb } from '../brand/helpers';
import { seedWeeklyBrand, tempStorage } from '../weekly/helpers';
import { colorPixels, insertActiveMascot } from './helpers';

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
beforeEach(() => jar.store.clear());

const rows = (sql: string, params: unknown[] = []) => db.withAdmin((tx) => tx.query<Record<string, unknown>>(sql, params));
const brandRow = async () => seedWeeklyBrand(db, { photos: 0, storage: store.storage });
const setColors = (brandId: string, colors: Record<string, string>) =>
  db.withAdmin((tx) => tx.query('update public.brand_memory set colors = $2::jsonb where brand_id = $1', [brandId, JSON.stringify(colors)]));
const inPosts = async (brandId: string) => (await rows('select mascot_in_posts as on from public.brand_memory where brand_id = $1', [brandId]))[0].on;
async function signIn(userId: string) {
  jar.store.set(SESSION_COOKIE, await signSession({ id: userId, email: `${userId.slice(0, 6)}@example.com` }));
}
const file = async (path: string) => (await store.storage.get('mascots', path))?.bytes;

describe('turning the mascot on makes Tween (no AI call)', () => {
  it('creates the active mascot with the default spec and name, draws the files, and switches posts on', async () => {
    const { userId, brandId } = await brandRow();
    await setColors(brandId, { primary: '#c8283a', secondary: '#f6e7c8', accent: '#f2b100' });
    expect((await getMascotCard(userId, brandId)).active).toBeNull();

    await expect(setMascotInPosts(userId, brandId, true, { storage: store.storage })).resolves.toBe(true);
    expect(await inPosts(brandId)).toBe(true);

    const [m] = await rows("select id::text as id, name, status::text as status, spec, concept, sheet_path from public.mascots where brand_id = $1", [brandId]);
    expect(m).toMatchObject({ name: 'Tween', status: 'active', spec: { v: 2, base: 'tween', scarf: null }, sheet_path: sheetStoredPath(brandId, m.id as string) });
    expect(await rows('select 1 from public.usage_events where brand_id = $1', [brandId])).toHaveLength(0);

    // The sheet and every post pose are in storage at the usual paths.
    const mascotId = m.id as string;
    expect((await file(sheetPngPath(brandId, mascotId)))!.length).toBeGreaterThan(1000);
    for (const pose of TWEEN_POST_POSES) {
      expect(await file(poseSvgPath(brandId, mascotId, pose)), pose).toBeDefined();
      expect(await file(posePngPath(brandId, mascotId, pose)), pose).toBeDefined();
    }
    expect(mascotDownloads(brandId, mascotId, 'Tween')).toHaveLength(1 + 2 * TWEEN_POST_POSES.length);

    // The pose PNGs are transparent and in the brand's scarf colour.
    const png = Buffer.from((await file(posePngPath(brandId, mascotId, 'wave')))!);
    const meta = await sharp(png).metadata();
    expect([meta.width, meta.height, meta.hasAlpha]).toEqual([800, 800, true]);
    const { data } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    expect(data[3]).toBe(0); // the corner is clear
    expect(await colorPixels(png, '#c8283a')).toBeGreaterThan(2000);

    // The card now has it, and turning it off keeps it.
    expect((await getMascotCard(userId, brandId)).active).toMatchObject({ name: 'Tween' });
    await setMascotInPosts(userId, brandId, false);
    expect((await getMascotCard(userId, brandId))).toMatchObject({ inPosts: false, active: { name: 'Tween' } });
    await setMascotInPosts(userId, brandId, true, { storage: store.storage });
    expect(await rows('select 1 from public.mascots where brand_id = $1', [brandId])).toHaveLength(1);
  });

  it('a regulated brand never gets one, and a formal one must confirm Try anyway', async () => {
    const reg = await seedWeeklyBrand(db, { photos: 0, storage: store.storage, regulated: 'health' });
    await expect(setMascotInPosts(reg.userId, reg.brandId, true, { tryAnyway: true, storage: store.storage })).rejects.toMatchObject({ code: 'not_eligible' });
    await expect(saveMascot({ userId: reg.userId, brandId: reg.brandId, tryAnyway: true, storage: store.storage })).rejects.toMatchObject({ code: 'not_eligible' });
    expect(await rows('select 1 from public.mascots where brand_id = $1', [reg.brandId])).toHaveLength(0);

    const formal = await brandRow();
    await db.withAdmin((tx) => tx.query("update public.brand_memory set tone = 'professional' where brand_id = $1", [formal.brandId]));
    await expect(setMascotInPosts(formal.userId, formal.brandId, true, { storage: store.storage })).rejects.toMatchObject({ code: 'formal_needs_confirm' });
    expect(await inPosts(formal.brandId)).toBe(false);
    await expect(setMascotInPosts(formal.userId, formal.brandId, true, { tryAnyway: true, storage: store.storage })).resolves.toBe(true);
    // Once it has one, the owner can switch it off and on without confirming again.
    await setMascotInPosts(formal.userId, formal.brandId, false);
    await expect(setMascotInPosts(formal.userId, formal.brandId, true, { storage: store.storage })).resolves.toBe(true);
  });

  it('is refused for someone who is not a member of the brand', async () => {
    const { brandId } = await brandRow();
    await expect(setMascotInPosts(outsider, brandId, true, { storage: store.storage })).rejects.toBeInstanceOf(BrandAccessError);
    await expect(saveMascot({ userId: outsider, brandId, storage: store.storage })).rejects.toBeInstanceOf(BrandAccessError);
  });
});

describe('name and scarf colour', () => {
  it('the owner can rename Tween and pick a scarf colour; the pictures follow; the same row is kept', async () => {
    const { userId, brandId } = await brandRow();
    await setColors(brandId, { primary: '#c8283a', secondary: '#f6e7c8', accent: '#f2b100' });
    const first = await saveMascot({ userId, brandId, storage: store.storage });
    const second = await saveMascot({ userId, brandId, name: '  Bun   Bun ', scarf: '#12AB34', storage: store.storage });
    expect(second).toMatchObject({ id: first.id, name: 'Bun Bun', scarf: '#12ab34' });
    expect(await rows('select 1 from public.mascots where brand_id = $1', [brandId])).toHaveLength(1);
    expect(await colorPixels(Buffer.from((await file(posePngPath(brandId, first.id, 'idle')))!), '#12ab34')).toBeGreaterThan(2000);

    // Keeping a field: undefined leaves it; null goes back to the brand's colour; an empty name is Tween.
    expect(await saveMascot({ userId, brandId, name: '', storage: store.storage })).toMatchObject({ name: 'Tween', scarf: '#12ab34' });
    expect(await saveMascot({ userId, brandId, scarf: null, storage: store.storage })).toMatchObject({ name: 'Tween', scarf: null });
  });

  it('refuses a blocked or odd name and a colour that is not a colour, and changes nothing', async () => {
    const { userId, brandId } = await brandRow();
    await saveMascot({ userId, brandId, name: 'Pip', storage: store.storage });
    for (const name of ['Mickey', 'Doraemon', 'Hanuman']) {
      await expect(saveMascot({ userId, brandId, name, storage: store.storage }), name).rejects.toMatchObject({ code: 'blocked_name' });
    }
    for (const name of ['<b>Pip</b>', 'x'.repeat(21), 'Pip; drop table']) {
      await expect(saveMascot({ userId, brandId, name, storage: store.storage }), name).rejects.toMatchObject({ code: 'bad_name' });
    }
    for (const scarf of ['red', '#12', 'javascript:alert(1)', '#12ab3g']) {
      await expect(saveMascot({ userId, brandId, scarf, storage: store.storage }), scarf).rejects.toMatchObject({ code: 'bad_color' });
    }
    expect((await rows('select name from public.mascots where brand_id = $1', [brandId]))[0].name).toBe('Pip');
  });

  it('the business name itself is not a blocked name', async () => {
    const { userId, brandId } = await seedWeeklyBrand(db, { photos: 0, storage: store.storage, name: 'Patel Bakery' });
    await expect(saveMascot({ userId, brandId, name: 'Patel Bakery', storage: store.storage })).resolves.toMatchObject({ name: 'Patel Bakery' });
    await expect(saveMascot({ userId, brandId, name: 'Patel', storage: store.storage })).rejects.toMatchObject({ code: 'blocked_name' }); // a bare blocked word still is
  });

  it('if the files cannot be saved nothing changes', async () => {
    const { userId, brandId } = await brandRow();
    const broken = { ...store.storage, put: async () => Promise.reject(new Error('disk full')) } as typeof store.storage;
    await expect(saveMascot({ userId, brandId, storage: broken })).rejects.toThrow('disk full');
    expect(await rows('select 1 from public.mascots where brand_id = $1', [brandId])).toHaveLength(0);
  });

  it('describes each failure in plain words', () => {
    expect(describeMascotError(new MascotError('blocked_name')).message).toBe(s.mascot.errors.blockedName);
    expect(describeMascotError(new MascotError('bad_name')).message).toBe(s.mascot.errors.badName);
    expect(describeMascotError(new MascotError('bad_color')).message).toBe(s.mascot.errors.badColor);
    expect(describeMascotError(new MascotError('formal_needs_confirm')).message).toBe(s.mascot.errors.formalNeedsConfirm);
    expect(describeMascotError(new MascotError('not_eligible')).message).toBe(s.mascot.errors.notEligible);
  });
});

describe('an older (v1) mascot row', () => {
  const V1 = { body: { shape: 'round', color: '#F2A93B', pattern: 'dots', pattern_color: '#FFD98A' }, head: 'chef_hat', neck: 'none', extra: 'none', accent_color: '#B5121B' };

  it('is drawn as Tween in the brand colours, and the post pipeline can load it', async () => {
    const { userId, brandId } = await brandRow();
    await setColors(brandId, { primary: '#c8283a', secondary: '#f6e7c8', accent: '#f2b100' });
    const id = await insertActiveMascot(db, brandId, { spec: V1, name: 'Laddu' });
    await db.withAdmin((tx) => tx.query('update public.brand_memory set mascot_in_posts = true where brand_id = $1', [brandId]));

    const screen = await getMascotScreen(userId, brandId);
    expect(screen.mascot).toMatchObject({ id, name: 'Laddu', scarf: null });
    expect(screen.colors.scarf).toBe('#c8283a');
    expect(screen.inPosts).toBe(true);

    const usable = await loadUsableMascot(brandId);
    expect(usable).toMatchObject({ id, name: 'Laddu', personality: 'friendly, curious and a little playful' });
    expect(usable!.colors.scarf).toBe('#c8283a');
    expect(await loadMascotById(brandId, id)).toMatchObject({ id });
    expect(await loadMascotById(brandId, '00000000-0000-4000-8000-000000000000')).toBeNull();
  });

  it('gets its files redrawn, as v2, the first time the mascot page is opened', async () => {
    const { userId, brandId } = await brandRow();
    const id = await insertActiveMascot(db, brandId, { spec: V1, name: 'Laddu' });
    expect(await refreshSheetIfStale(userId, brandId, store.storage)).toBe(true);
    expect((await rows('select spec, sheet_path from public.mascots where id = $1', [id]))[0]).toMatchObject({ spec: { v: 2, base: 'tween', scarf: null }, sheet_path: sheetStoredPath(brandId, id) });
    expect(await file(sheetPngPath(brandId, id))).toBeDefined();
    expect(await refreshSheetIfStale(userId, brandId, store.storage)).toBe(false); // nothing changed since
  });
});

describe('the files follow the brand colours', () => {
  it('are redrawn when the brand colours change, and not otherwise', async () => {
    const { userId, brandId } = await brandRow();
    await setColors(brandId, { primary: '#c8283a', secondary: '#f6e7c8', accent: '#f2b100' });
    const m = await saveMascot({ userId, brandId, storage: store.storage });
    expect(await refreshSheetIfStale(userId, brandId, store.storage)).toBe(false);
    await setColors(brandId, { primary: '#12ab34', secondary: '#f6e7c8', accent: '#f2b100' });
    expect(await refreshSheetIfStale(userId, brandId, store.storage)).toBe(true);
    expect(await colorPixels(Buffer.from((await file(posePngPath(brandId, m.id, 'wave')))!), '#12ab34')).toBeGreaterThan(2000);
    expect(await refreshSheetIfStale(userId, brandId, store.storage)).toBe(false);
  });

  it('there is nothing to redraw before a mascot exists', async () => {
    const { userId, brandId } = await brandRow();
    expect(await refreshSheetIfStale(userId, brandId, store.storage)).toBe(false);
  });
});

describe('the mascot page actions', () => {
  it('saveMascotAction saves for the signed-in user and reports a blocked name in plain words', async () => {
    const { userId, brandId } = await brandRow();
    await signIn(userId);
    const ok = await saveMascotAction({ name: 'Zuzu', scarf: '#12ab34' });
    expect(ok).toMatchObject({ ok: true, mascot: { name: 'Zuzu', scarf: '#12ab34' } });
    expect((await rows('select name from public.mascots where brand_id = $1', [brandId]))[0].name).toBe('Zuzu');

    expect(await saveMascotAction({ name: 'Mickey' })).toMatchObject({ ok: false, code: 'blocked_name', message: s.mascot.errors.blockedName });
    expect(await saveMascotAction({ scarf: 'nope' })).toMatchObject({ ok: false, code: 'bad_color' });
    expect((await rows('select name from public.mascots where brand_id = $1', [brandId]))[0].name).toBe('Zuzu');
  });

  it('saveMascotAction needs a signed-in user', async () => {
    expect(await saveMascotAction({ name: 'Zuzu' })).toMatchObject({ ok: false, message: s.errors.signedOut });
  });

  it('the switch action turns Tween on from the brand page, and a regulated brand is told no', async () => {
    const { userId, brandId } = await brandRow();
    await signIn(userId);
    expect(await setMascotInPostsAction(brandId, true)).toMatchObject({ ok: true, on: true });
    expect(await inPosts(brandId)).toBe(true);
    expect(await rows('select 1 from public.mascots where brand_id = $1', [brandId])).toHaveLength(1);

    const reg = await seedWeeklyBrand(db, { photos: 0, storage: store.storage, regulated: 'finance' });
    await signIn(reg.userId);
    expect(await setMascotInPostsAction(reg.brandId, true, true)).toMatchObject({ ok: false });
    expect(await inPosts(reg.brandId)).toBe(false);
  });
});
