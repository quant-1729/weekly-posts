import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MASCOT_POSES } from '@/lib/ai/prompts/mascot';
import { BrandAccessError } from '@/lib/brand/current';
import type { MockDb } from '@/lib/db/mock';
import { MascotError } from '@/lib/mascot/errors';
import { FIXTURE_CONCEPTS } from '@/lib/mascot/fixtures';
import { mascotDownloads, posePngPath, poseSvgPath, sheetPngPath, sheetStoredPath } from '@/lib/mascot/paths';
import { generateMascotConcepts, getActiveMascot, getMascotCard, getMascotScreen, pickMascot, setMascotInPosts } from '@/lib/mascot/service';
import { renderSheetPng } from '@/lib/mascot/sheet';
import { serveFile } from '@/lib/storage/serve';
import type { Storage } from '@/lib/storage';
import { closeTestDb, createUser, openTestDb } from '../brand/helpers';
import { seedWeeklyBrand, tempStorage } from '../weekly/helpers';
import { answer, concept } from './helpers';

let db: MockDb;
let store: Awaited<ReturnType<typeof tempStorage>>;
let outsider: string;
beforeAll(async () => {
  db = await openTestDb();
  store = await tempStorage();
  outsider = (await createUser(db)).id;
});
afterAll(async () => {
  await closeTestDb(db);
  await store.cleanup();
});

const rows = (sql: string, params: unknown[] = []) => db.withAdmin((tx) => tx.query<Record<string, unknown>>(sql, params));
const statuses = async (brandId: string) =>
  Object.fromEntries((await rows('select id::text as id, status::text as s from public.mascots where brand_id = $1', [brandId])).map((r) => [r.id as string, r.s as string]));

describe('pick and the character sheet (R15c)', () => {
  it('makes exactly one active mascot, discards the other concepts and writes the 17 files', async () => {
    const { userId, brandId } = await seedWeeklyBrand(db, { name: 'Corner Bakery' });
    const { concepts } = await generateMascotConcepts({ userId, brandId });
    const picked = await pickMascot({ userId, brandId, mascotId: concepts[1].id, storage: store.storage });

    expect(picked).toMatchObject({ id: concepts[1].id, status: 'active', name: 'Jalebi', sheet_path: sheetStoredPath(brandId, concepts[1].id) });
    const st = await statuses(brandId);
    expect(Object.values(st).filter((s) => s === 'active')).toHaveLength(1);
    expect(st[concepts[1].id]).toBe('active');
    expect(st[concepts[0].id]).toBe('discarded');
    expect(st[concepts[2].id]).toBe('discarded');

    // 8 SVGs, 8 transparent PNGs and the sheet exist in the mascots bucket.
    for (const pose of MASCOT_POSES) {
      const svg = await store.storage.get('mascots', poseSvgPath(brandId, picked.id, pose));
      const png = await store.storage.get('mascots', posePngPath(brandId, picked.id, pose));
      expect(Buffer.from(svg!.bytes).toString()).toMatch(/^<svg [^>]*viewBox="0 0 400 400"/);
      const meta = await sharp(Buffer.from(png!.bytes)).metadata();
      expect([meta.width, meta.height, meta.hasAlpha]).toEqual([800, 800, true]);
    }
    const sheet = await store.storage.get('mascots', sheetPngPath(brandId, picked.id));
    const meta = await sharp(Buffer.from(sheet!.bytes)).metadata();
    expect(meta.width).toBe(1740);
    expect(meta.height).toBeGreaterThan(1000);

    // The screen shows the active mascot and no open concepts; the card agrees.
    const screen = await getMascotScreen(userId, brandId);
    expect(screen.active?.id).toBe(picked.id);
    expect(screen.concepts).toHaveLength(0);
    expect((await getActiveMascot(userId, brandId))?.name).toBe('Jalebi');
  });

  it('draws a sheet whose name is in Devanagari without error', async () => {
    const png = await renderSheetPng(FIXTURE_CONCEPTS.concepts[0].spec, { name: 'Laddu', name_local: 'लड्डू' });
    expect((await sharp(png).metadata()).width).toBe(1740);
  });

  it('offers every file for download (sheet, 8 PNG, 8 SVG), each served to members only', async () => {
    const { userId, brandId } = await seedWeeklyBrand(db, { name: 'Corner Bakery' });
    const { concepts } = await generateMascotConcepts({ userId, brandId });
    const picked = await pickMascot({ userId, brandId, mascotId: concepts[0].id, storage: store.storage });
    const files = mascotDownloads(brandId, picked.id, picked.name);
    expect(files).toHaveLength(17);
    expect(files[0]).toMatchObject({ name: 'laddu-sheet.png' });
    expect(new Set(files.map((f) => f.name)).size).toBe(17);
    for (const f of files) {
      const [bucket, ...segments] = f.url.replace('/api/files/', '').split('/');
      const ok = await serveFile({ userId, bucket, segments, storage: store.storage });
      expect(ok.status, f.url).toBe(200);
      const denied = await serveFile({ userId: outsider, bucket, segments, storage: store.storage });
      expect(denied.status, f.url).toBe(404);
      expect((await serveFile({ userId: null, bucket, segments, storage: store.storage })).status).toBe(401);
    }
  });

  it('a non-member cannot pick, read or switch the mascot', async () => {
    const { userId, brandId } = await seedWeeklyBrand(db, { name: 'Corner Bakery' });
    const { concepts } = await generateMascotConcepts({ userId, brandId });
    await expect(pickMascot({ userId: outsider, brandId, mascotId: concepts[0].id, storage: store.storage })).rejects.toBeInstanceOf(BrandAccessError);
    await expect(setMascotInPosts(outsider, brandId, true)).rejects.toBeInstanceOf(BrandAccessError);
    await expect(getMascotCard(outsider, brandId)).rejects.toBeInstanceOf(BrandAccessError);
    expect(Object.values(await statuses(brandId)).every((s) => s === 'concept')).toBe(true);
    // Another brand's concept cannot be picked through my own brand.
    const mine = await seedWeeklyBrand(db, { name: 'Other Shop' });
    await expect(pickMascot({ userId: mine.userId, brandId: mine.brandId, mascotId: concepts[0].id, storage: store.storage })).rejects.toMatchObject({ code: 'not_found' });
  });

  it('a failed export changes nothing', async () => {
    const { userId, brandId } = await seedWeeklyBrand(db, { name: 'Corner Bakery' });
    const { concepts } = await generateMascotConcepts({ userId, brandId });
    const broken: Storage = { ...store.storage, put: async () => { throw new Error('disk full'); } };
    await expect(pickMascot({ userId, brandId, mascotId: concepts[0].id, storage: broken })).rejects.toThrow('disk full');
    expect(Object.values(await statuses(brandId)).every((s) => s === 'concept')).toBe(true);
  });

  it('only a concept can be picked', async () => {
    const { userId, brandId } = await seedWeeklyBrand(db, { name: 'Corner Bakery' });
    const { concepts } = await generateMascotConcepts({ userId, brandId });
    await pickMascot({ userId, brandId, mascotId: concepts[0].id, storage: store.storage });
    await expect(pickMascot({ userId, brandId, mascotId: concepts[1].id, storage: store.storage })).rejects.toBeInstanceOf(MascotError); // discarded
    // Picking the active one again is a no-op.
    await expect(pickMascot({ userId, brandId, mascotId: concepts[0].id, storage: store.storage })).resolves.toMatchObject({ status: 'active' });
  });
});

describe('regenerate (R15e): the old mascot is archived only after a new pick', () => {
  it('keeps the active mascot while new concepts are open, archives it on the new pick', async () => {
    const { userId, brandId } = await seedWeeklyBrand(db, { name: 'Corner Bakery' });
    const first = await generateMascotConcepts({ userId, brandId });
    const a = await pickMascot({ userId, brandId, mascotId: first.concepts[0].id, storage: store.storage });

    const fresh = await generateMascotConcepts({ userId, brandId }, { fixture: () => answer(concept('Bun'), concept('Pip'), concept('Zuzu')) });
    let st = await statuses(brandId);
    expect(st[a.id]).toBe('active'); // not archived yet
    expect(Object.values(st).filter((s) => s === 'concept')).toHaveLength(3);
    expect((await getActiveMascot(userId, brandId))?.id).toBe(a.id);

    const b = await pickMascot({ userId, brandId, mascotId: fresh.concepts[2].id, storage: store.storage });
    st = await statuses(brandId);
    expect(st[a.id]).toBe('archived');
    expect(st[b.id]).toBe('active');
    expect(Object.values(st).filter((s) => s === 'active')).toHaveLength(1);
    expect(Object.values(st).filter((s) => s === 'concept')).toHaveLength(0);
    // The old mascot's files stay (the owner owns them).
    expect(await store.storage.get('mascots', posePngPath(brandId, a.id, 'wave'))).not.toBeNull();
  });
});

describe('"Use my mascot in posts" (the brand switch)', () => {
  it('needs an active mascot to turn on, and turns off always', async () => {
    const { userId, brandId } = await seedWeeklyBrand(db, { name: 'Corner Bakery' });
    await expect(setMascotInPosts(userId, brandId, true)).rejects.toMatchObject({ code: 'none' });
    expect((await getMascotCard(userId, brandId)).inPosts).toBe(false);

    const { concepts } = await generateMascotConcepts({ userId, brandId });
    await pickMascot({ userId, brandId, mascotId: concepts[0].id, storage: store.storage });
    await expect(setMascotInPosts(userId, brandId, true)).resolves.toBe(true);
    const card = await getMascotCard(userId, brandId);
    expect(card).toMatchObject({ inPosts: true, active: { name: 'Laddu' } });
    expect(card.eligibility.reason).toBe('ok');
    await expect(setMascotInPosts(userId, brandId, false)).resolves.toBe(false);
    expect((await getMascotCard(userId, brandId)).inPosts).toBe(false);
  });

  it('a regulated brand cannot turn it on, and the card reports it off', async () => {
    const { userId, brandId } = await seedWeeklyBrand(db, { name: 'Corner Bakery' });
    const { concepts } = await generateMascotConcepts({ userId, brandId });
    await pickMascot({ userId, brandId, mascotId: concepts[0].id, storage: store.storage });
    await setMascotInPosts(userId, brandId, true);
    await db.withAdmin((tx) => tx.query("update public.brand_memory set regulated = 'finance' where brand_id = $1", [brandId]));
    expect((await getMascotCard(userId, brandId)).inPosts).toBe(false);
    await expect(setMascotInPosts(userId, brandId, true)).rejects.toMatchObject({ code: 'not_eligible' });
  });
});
