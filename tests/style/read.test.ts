import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { BrandAccessError } from "@/lib/brand/current";
import type { MockDb } from "@/lib/db/mock";
import { createMockStorage } from "@/lib/storage/mock";
import type { Storage } from "@/lib/storage/types";
import { MAX_STYLE_IMAGES, collectStyleSamples, type SampleDeps } from "@/lib/style/samples";
import { fixtureStyleRead, readStyle } from "@/lib/style/read";
import { styleCopy } from "@/lib/style/copy";
import { WEEKLY_STYLE_READS, WeeklyCapError } from "@/lib/usage/caps";
import { closeTestDb, createBrandFor, createUser, openTestDb } from "../brand/helpers";
import { clearBrand, jpeg } from "./helpers";

let db: MockDb;
let root: string;
let storage: Storage;
let owner: string;
let outsider: string;
let brand: string;

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "pm-style-"));
  storage = createMockStorage(root);
  db = await openTestDb();
  owner = (await createUser(db)).id;
  outsider = (await createUser(db)).id;
  brand = await createBrandFor(db, owner, "Corner Bakery");
});
afterAll(async () => {
  await closeTestDb(db);
  await rm(root, { recursive: true, force: true });
});
beforeEach(async () => {
  await clearBrand(db, brand);
  await db.withAdmin((tx) => tx.query("update public.brand_memory set colors = '{}'::jsonb, kit = '{}'::jsonb, category = 'bakery' where brand_id = $1", [brand]));
});

/** n Instagram pictures already in the photo library. */
async function addLibraryPhotos(n: number, source: "instagram" | "upload" = "instagram") {
  for (let i = 0; i < n; i++) {
    const id = crypto.randomUUID();
    await storage.put("photos", `${brand}/${id}.jpg`, await jpeg(`#${(i * 20 + 30).toString(16).padStart(2, "0")}8040`), "image/jpeg");
    await db.withAdmin((tx) =>
      tx.query(
        `insert into public.photos (id, brand_id, kind, storage_path, source, source_id, source_posted_at)
         values ($1, $2, 'photo', $3, $4, $5, now() - ($6 || ' days')::interval)`,
        [id, brand, `photos/${brand}/${id}.jpg`, source, source === "instagram" ? `ig${i}` : null, String(i)],
      ),
    );
  }
}

/** n pictures still in the Instagram list (not in the library). */
const listed = (n: number): SampleDeps => ({
  storage,
  listInstagram: async () => Array.from({ length: n }, (_, i) => ({ mediaId: `m${i}`, previewUrl: `data:test/${i}`, added: false })),
  download: async () => ({ bytes: await jpeg("#c0392b"), mimeType: "image/jpeg" }),
  themeColor: async () => null,
});

const usage = () =>
  db.withAdmin((tx) => tx.query<{ kind: string; usd: string }>("select kind::text as kind, usd from public.usage_events where brand_id = $1 order by created_at", [brand]));

describe("collecting samples", () => {
  it("takes Instagram photos from the library and the rest from the Instagram list, 12 at most", async () => {
    await addLibraryPhotos(5);
    const s = await collectStyleSamples({ userId: owner, brandId: brand }, listed(20));
    expect(s.fromPhotos).toBe(5);
    expect(s.fromInstagram).toBe(MAX_STYLE_IMAGES - 5);
    expect(s.images).toHaveLength(12);
    expect(s.colorsOnly).toBe(false);
    for (const img of s.images) expect(img.mimeType).toBe("image/jpeg");
  });

  it("does not use plain uploads, and skips list pictures that are already in the library", async () => {
    await addLibraryPhotos(4, "upload");
    const deps = listed(2);
    deps.listInstagram = async () => [
      { mediaId: "a", previewUrl: "data:test/a", added: true },
      { mediaId: "b", previewUrl: "data:test/b", added: false },
    ];
    const s = await collectStyleSamples({ userId: owner, brandId: brand }, deps);
    expect(s.fromPhotos).toBe(0);
    expect(s.fromInstagram).toBe(1);
  });

  it("skips a picture that will not download or is not an image, and keeps going", async () => {
    let n = 0;
    const deps = listed(5);
    deps.download = async () => {
      n++;
      if (n === 1) throw new Error("gone");
      if (n === 2) return { bytes: new Uint8Array([1, 2, 3]), mimeType: "image/jpeg" };
      return { bytes: await jpeg("#2980b9"), mimeType: "image/jpeg" };
    };
    const s = await collectStyleSamples({ userId: owner, brandId: brand }, deps);
    expect(s.fromInstagram).toBe(3);
  });

  it("shrinks pictures for the model", async () => {
    const big = await jpeg("#c0392b", 2000);
    const deps = listed(1);
    deps.download = async () => ({ bytes: big, mimeType: "image/jpeg" });
    const s = await collectStyleSamples({ userId: owner, brandId: brand }, deps);
    const meta = await sharp(s.images[0].data).metadata();
    expect(Math.max(meta.width!, meta.height!)).toBeLessThanOrEqual(768);
  });

  it("flags colours-only when there are fewer than 3 pictures, and reports the website colour", async () => {
    const deps = listed(2);
    deps.themeColor = async () => "#e4572e";
    const s = await collectStyleSamples({ userId: owner, brandId: brand }, deps);
    expect(s.images).toHaveLength(2);
    expect(s.colorsOnly).toBe(true);
    expect(s.websiteColors).toEqual(["#E4572E"]);
  });

  it("carries on when Instagram cannot be read", async () => {
    const deps = listed(0);
    deps.listInstagram = async () => {
      throw new Error("rate limited");
    };
    const s = await collectStyleSamples({ userId: owner, brandId: brand }, deps);
    expect(s.images).toHaveLength(0);
  });

  it("refuses someone who is not a member", async () => {
    await expect(collectStyleSamples({ userId: outsider, brandId: brand }, listed(3))).rejects.toBeInstanceOf(BrandAccessError);
  });
});

describe("readStyle", () => {
  it("reads from fixtures: suggestion, source, and a style_read usage row", async () => {
    const r = await readStyle({ userId: owner, brandId: brand }, { samples: listed(6) });
    expect(r.status).toBe("ok");
    expect(r.source).toBe("instagram");
    expect(r.counts.images).toBe(6);
    expect(r.suggestion?.clear).toBe(true);
    expect(r.suggestion?.kit.source).toBe("instagram");
    const rows = await usage();
    expect(rows.map((x) => x.kind)).toEqual(["style_read"]);
  });

  it("calls the source 'mixed' when the website colour was used too", async () => {
    const deps = listed(4);
    deps.themeColor = async () => "#1f4e9c";
    const r = await readStyle({ userId: owner, brandId: brand }, { samples: deps });
    expect(r.source).toBe("mixed");
    expect(r.suggestion?.kit.source).toBe("mixed");
  });

  it("with fewer than 3 pictures uses the website colour only, says so, and makes no model call", async () => {
    const deps = listed(2);
    deps.themeColor = async () => "#1f4e9c";
    const r = await readStyle({ userId: owner, brandId: brand }, { samples: deps });
    expect(r.status).toBe("colors_only");
    expect(r.source).toBe("website");
    expect(r.note).toBe(styleCopy.coloursOnly);
    expect(r.suggestion?.kit.colors.primary).toBe("#1F4E9C");
    expect(r.suggestion?.kit.source).toBe("website");
    expect(await usage()).toEqual([]);
  });

  it("says there is nothing to learn from when there are no pictures and no website colour", async () => {
    const r = await readStyle({ userId: owner, brandId: brand }, { samples: listed(0) });
    expect(r.status).toBe("nothing");
    expect(r.suggestion).toBeNull();
    expect(r.note).toBe(styleCopy.nothing);
  });

  it("returns the current kit and the 'pick a theme' message when the read is not confident", async () => {
    const r = await readStyle({ userId: owner, brandId: brand }, { samples: listed(5), fixture: { ...fixtureStyleRead([]), confidence: 0.2 } });
    expect(r.status).toBe("ok");
    expect(r.suggestion?.clear).toBe(false);
    expect(r.note).toBe("We couldn't find one clear look; pick a theme instead.");
  });

  it("limits reads to 3 a week", async () => {
    for (let i = 0; i < WEEKLY_STYLE_READS; i++) await readStyle({ userId: owner, brandId: brand }, { samples: listed(4) });
    await expect(readStyle({ userId: owner, brandId: brand }, { samples: listed(4) })).rejects.toBeInstanceOf(WeeklyCapError);
    expect((await usage()).length).toBe(WEEKLY_STYLE_READS);
  });
});
