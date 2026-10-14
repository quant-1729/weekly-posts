import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { buildExport } from "@/lib/account/export";
import { deleteAccount } from "@/lib/account/delete";
import { createMockDb, setMockDbForTests, type MockDb } from "@/lib/db/mock";
import { addInstagramPhotos, importInstagram } from "@/lib/instagram/import";
import type { Storage } from "@/lib/storage";
import { createMockStorage } from "@/lib/storage/mock";
import { accountRowCounts } from "../account/helpers";
import { filesUnder, seedAccount } from "../account/seed";
import { collect, parseZip } from "../account/zip-read";

let db: MockDb;
let root: string;
let storage: Storage;

beforeAll(async () => {
  vi.stubEnv("INSTAGRAM_MODE", "fixture");
  db = await createMockDb();
  setMockDbForTests(db);
});
afterAll(async () => {
  vi.unstubAllEnvs();
  setMockDbForTests(null);
  await db.close();
});
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "pm-instagram-account-"));
  storage = createMockStorage(root);
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** A seeded account plus 12 imported Instagram posts (the photos are added by each test). */
async function accountWithInstagram() {
  const a = await seedAccount(db, storage);
  await importInstagram({ userId: a.userId, brandId: a.brandId, handle: "sample.bakery", source: "owner", onPostsChanged: () => undefined });
  return a;
}

describe("account delete and export with Instagram rows", () => {
  it("deleting the account removes the imported posts, the Instagram photos and their files, and touches nobody else", async () => {
    const a = await accountWithInstagram();
    const b = await seedAccount(db, storage);
    await importInstagram({ userId: b.userId, brandId: b.brandId, handle: "other.shop", source: "owner", onPostsChanged: () => undefined });
    const imported = await db.withAdmin((tx) => tx.query<{ n: number }>("select count(*)::int as n from public.photos where brand_id = $1 and source = 'instagram'", [a.brandId]));
    expect(imported[0].n).toBe(12);

    // An Instagram photo with a stored file, the way addInstagramPhotos leaves it.
    const jpeg = await sharp({ create: { width: 20, height: 20, channels: 3, background: "#336699" } }).jpeg().toBuffer();
    const got = await addInstagramPhotos({
      userId: a.userId,
      brandId: a.brandId,
      mediaIds: await firstMediaIds(a.userId, a.brandId),
      storage,
      download: async () => ({ bytes: new Uint8Array(jpeg), mimeType: "image/jpeg" }),
    });
    expect(got.added).toHaveLength(2);
    expect((await filesUnder(storage, a.brandId)).length).toBe(a.files.length + 2);

    const beforeB = await accountRowCounts(db, b);
    const result = await deleteAccount(a.userId, { storage });
    expect(result.deleted).toBe(true);
    expect(result.objectsRemoved).toBe(a.files.length + 2);

    expect(await filesUnder(storage, a.brandId)).toEqual([]);
    const left = await db.withAdmin((tx) => tx.query<{ n: number }>("select count(*)::int as n from public.photos where brand_id = $1", [a.brandId]));
    expect(left[0].n).toBe(0);
    const mem = await db.withAdmin((tx) => tx.query("select 1 from public.brand_memory where brand_id = $1", [a.brandId]));
    expect(mem).toHaveLength(0);
    expect(await accountRowCounts(db, b)).toEqual(beforeB);
  });

  it("the export lists past posts and photos from Instagram with the link to the original post", async () => {
    const a = await accountWithInstagram();
    const jpeg = await sharp({ create: { width: 20, height: 20, channels: 3, background: "#996633" } }).jpeg().toBuffer();
    const ids = await firstMediaIds(a.userId, a.brandId);
    await addInstagramPhotos({ userId: a.userId, brandId: a.brandId, mediaIds: ids, storage, download: async () => ({ bytes: new Uint8Array(jpeg), mimeType: "image/jpeg" }) });

    const zip = parseZip(await collect(await buildExport(a.userId, { storage, now: new Date("2026-10-14T09:00:00Z") })));
    const photos = JSON.parse(new TextDecoder().decode(zip.files.get("photos.json"))) as Array<Record<string, unknown>>;
    const posts = photos.filter((p) => p.kind === "past_post" && p.source === "instagram");
    expect(posts).toHaveLength(12);
    for (const p of posts) {
      expect(p.source_url).toMatch(/^https:\/\/www\.instagram\.com\//);
      expect(typeof p.source_id).toBe("string");
      expect(typeof p.extracted_text).toBe("string");
      expect(p.file).toBeNull(); // captions only: no file for an imported past post
    }
    const pics = photos.filter((p) => p.kind === "photo" && p.source === "instagram");
    expect(pics).toHaveLength(2);
    for (const p of pics) {
      expect(p.source_url).toMatch(/^https:\/\/www\.instagram\.com\//);
      expect(zip.names).toContain(p.file as string); // the picture itself is in the ZIP
    }
    const readme = new TextDecoder().decode(zip.files.get("README.txt"));
    expect(readme).toContain("source_url");
    // The handle travels with the brand's details.
    const brand = JSON.parse(new TextDecoder().decode(zip.files.get("brand.json")));
    expect(brand.brand_memory).toMatchObject({ instagram_handle: "sample.bakery", instagram_status: "imported" });
  });
});

async function firstMediaIds(userId: string, brandId: string): Promise<string[]> {
  const { listInstagramImages } = await import("@/lib/instagram/import");
  const r = await listInstagramImages({ userId, brandId });
  if (!r.ok) throw new Error("no pictures");
  return r.images.slice(0, 2).map((i) => i.mediaId);
}
