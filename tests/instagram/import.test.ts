import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { BrandAccessError } from "@/lib/brand/current";
import type { MockDb } from "@/lib/db/mock";
import type { DiscoveryResult, InstagramMedia } from "@/lib/instagram/discovery";
import {
  addInstagramPhotos,
  clearInstagramCache,
  downloadInstagramImage,
  getInstagramState,
  importInstagram,
  listInstagramImages,
  removeInstagramPosts,
  rememberInstagramFromWebsite,
  saveInstagramHandle,
} from "@/lib/instagram/import";
import { MAX_IMPORTED_POSTS } from "@/lib/instagram/limits";
import { createMockStorage } from "@/lib/storage/mock";
import type { Storage } from "@/lib/storage/types";
import { UploadError } from "@/lib/uploads/errors";
import { MAX_PHOTOS, PHOTO_MAX_BYTES } from "@/lib/uploads/limits";
import { addPastPostText, listPastPosts, updatePastPostText } from "@/lib/uploads/past-posts";
import { listPhotos } from "@/lib/uploads/photos";
import { getVoice, refreshVoice } from "@/lib/uploads/voice";
import { closeTestDb, createBrandFor, createUser, openTestDb } from "../brand/helpers";

let db: MockDb;
let root: string;
let storage: Storage;
let owner: string;
let outsider: string;
let brand: string;

beforeAll(async () => {
  vi.stubEnv("INSTAGRAM_MODE", "fixture");
  root = await mkdtemp(path.join(os.tmpdir(), "pm-instagram-"));
  storage = createMockStorage(root);
  db = await openTestDb();
  owner = (await createUser(db)).id;
  outsider = (await createUser(db)).id;
  brand = await createBrandFor(db, owner, "Corner Bakery");
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await closeTestDb(db);
  await rm(root, { recursive: true, force: true });
});
beforeEach(async () => {
  vi.stubEnv("INSTAGRAM_MODE", "fixture");
  clearInstagramCache();
  await db.withAdmin(async (tx) => {
    await tx.query("delete from public.photos where brand_id = $1", [brand]);
    await tx.query("delete from public.usage_events where brand_id = $1", [brand]);
    await tx.query(
      `update public.brand_memory set instagram_handle = null, instagram_handle_source = null, instagram_status = null,
              instagram_checked_at = null, voice_description = null, example_phrases = '{}', voice_edited_at = null where brand_id = $1`,
      [brand],
    );
  });
  await rm(path.join(root, "photos"), { recursive: true, force: true });
});
afterEach(() => {
  vi.restoreAllMocks();
});

const changed = () => vi.fn<(userId: string, brandId: string) => void>();

function media(n: number, over: (i: number) => Partial<InstagramMedia> = () => ({}), idPrefix = "9000"): InstagramMedia[] {
  return Array.from({ length: n }, (_, i) => {
    const id = `${idPrefix}${String(i).padStart(3, "0")}`;
    return {
      id,
      caption: `Caption number ${i} about fresh bread`,
      mediaType: "IMAGE" as const,
      permalink: `https://www.instagram.com/p/${id}/`,
      // newest first, like Instagram
      postedAt: new Date(Date.UTC(2026, 9, 14 - i, 9, 0)).toISOString(),
      imageUrl: `https://scontent.cdninstagram.com/${id}.jpg`,
      ...over(i),
    };
  });
}
const found = (m: InstagramMedia[]): (() => Promise<DiscoveryResult>) => async () => ({
  ok: true,
  account: { username: "cornerbakery", name: "Corner Bakery", followers: 1, mediaCount: m.length },
  media: m,
});
const failed = (reason: Extract<DiscoveryResult, { ok: false }>["reason"]) => async (): Promise<DiscoveryResult> => ({ ok: false, reason });

const igRows = () =>
  db.withAdmin((tx) =>
    tx.query<{
      id: string;
      kind: string;
      extracted_text: string | null;
      source: string;
      source_id: string | null;
      source_url: string | null;
      source_posted_at: string | Date | null;
      storage_path: string | null;
    }>(
      "select id, kind, extracted_text, source, source_id, source_url, source_posted_at, storage_path from public.photos where brand_id = $1 and source = 'instagram' order by source_posted_at desc nulls last",
      [brand],
    ),
  );

const memory = async () =>
  (
    await db.withAdmin((tx) =>
      tx.query<{
        instagram_handle: string | null;
        instagram_handle_source: string | null;
        instagram_status: string | null;
        instagram_checked_at: string | Date | null;
      }>("select instagram_handle, instagram_handle_source, instagram_status, instagram_checked_at from public.brand_memory where brand_id = $1", [brand]),
    )
  )[0];

describe("importInstagram", () => {
  it("keeps the 12 newest posts with a usable caption and records everything about each", async () => {
    const spy = changed();
    const out = await importInstagram({ userId: owner, brandId: brand, handle: "@CornerBakery".slice(1), source: "owner", onPostsChanged: spy });
    expect(out).toMatchObject({ status: "imported", handle: "cornerbakery", added: MAX_IMPORTED_POSTS, total: MAX_IMPORTED_POSTS });

    const rows = (await igRows()).filter((r) => r.kind === "past_post");
    expect(rows).toHaveLength(12);
    for (const r of rows) {
      expect(r.source_id).toMatch(/^\d+$/);
      expect(r.source_url).toMatch(/^https:\/\/www\.instagram\.com\/p\//);
      expect(r.source_posted_at).not.toBeNull();
      expect(r.extracted_text!.length).toBeGreaterThanOrEqual(10);
      expect(r.storage_path).toBeNull(); // no image is stored for a past post
    }
    // The fixture has 16 posts: one with no caption, one with a too-short caption, so 14 qualify; 12 are kept.
    expect(new Set(rows.map((r) => r.source_id)).size).toBe(12);

    const m = await memory();
    expect(m).toMatchObject({ instagram_handle: "cornerbakery", instagram_handle_source: "owner", instagram_status: "imported" });
    expect(m.instagram_checked_at).not.toBeNull();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(owner, brand);
  });

  it("applies the past-post length rules to captions (10 to 3000 characters)", async () => {
    const lengths = [9, 10, 3000, 3001];
    const m = media(5, (i) => ({ caption: i < 4 ? "x".repeat(lengths[i]) : null }));
    const out = await importInstagram({ userId: owner, brandId: brand, handle: "cornerbakery", source: "owner", discover: found(m), onPostsChanged: changed() });
    expect(out.added).toBe(2);
    const texts = (await listPastPosts(owner, brand)).map((p) => p.text.length).sort((a, b) => a - b);
    expect(texts).toEqual([10, 3000]);
  });

  it("never adds a duplicate on re-import and does not overwrite the owner's edits", async () => {
    const first = changed();
    const m = media(14);
    await importInstagram({ userId: owner, brandId: brand, handle: "cornerbakery", source: "owner", discover: found(m), onPostsChanged: first });
    const [one] = await listPastPosts(owner, brand);
    await updatePastPostText({ userId: owner, brandId: brand, postId: one.id, text: "My own corrected caption" });

    const second = changed();
    const again = await importInstagram({ userId: owner, brandId: brand, handle: "cornerbakery", source: "owner", discover: found(m), onPostsChanged: second });
    expect(again).toMatchObject({ status: "imported", added: 0, total: 12 });
    expect((await listPastPosts(owner, brand)).map((p) => p.text)).toContain("My own corrected caption");
    expect(await igRows()).toHaveLength(12);
    expect(second).not.toHaveBeenCalled(); // nothing changed, so the voice is not re-read
  });

  it("brings back a post the owner deleted only on a refresh (documented rule), and rolls the oldest off when newer posts arrive", async () => {
    const m = media(12);
    await importInstagram({ userId: owner, brandId: brand, handle: "cornerbakery", source: "owner", discover: found(m), onPostsChanged: changed() });
    const [first] = await listPastPosts(owner, brand);
    await db.withAdmin((tx) => tx.query("delete from public.photos where id = $1", [first.id]));
    expect(await listPastPosts(owner, brand)).toHaveLength(11);

    const back = await importInstagram({ userId: owner, brandId: brand, handle: "cornerbakery", source: "owner", discover: found(m), onPostsChanged: changed() });
    expect(back.added).toBe(1);
    expect(await listPastPosts(owner, brand)).toHaveLength(12);

    // Two newer posts appear: the two oldest roll off, the total stays 12.
    const newer = media(2, (i) => ({ postedAt: new Date(Date.UTC(2026, 9, 20 + i)).toISOString() }), "8000");
    const spy = changed();
    const out = await importInstagram({ userId: owner, brandId: brand, handle: "cornerbakery", source: "owner", discover: found([...newer, ...m]), onPostsChanged: spy });
    expect(out).toMatchObject({ added: 2, total: 12 });
    const ids = (await igRows()).map((r) => r.source_id);
    expect(ids).toEqual(expect.arrayContaining(["8000000", "8000001"]));
    expect(ids).not.toContain("9000011");
    expect(ids).not.toContain("9000010");
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("changing the handle removes the old account's posts but keeps photos the owner picked", async () => {
    await importInstagram({ userId: owner, brandId: brand, handle: "cornerbakery", source: "owner", discover: found(media(5)), onPostsChanged: changed() });
    const download = async () => ({ bytes: new Uint8Array(await sharp({ create: { width: 50, height: 50, channels: 3, background: "#336699" } }).jpeg().toBuffer()), mimeType: "image/jpeg" });
    const add = await addInstagramPhotos({ userId: owner, brandId: brand, mediaIds: ["9000000"], storage, download });
    expect(add.added).toHaveLength(1);

    const spy = changed();
    const out = await importInstagram({ userId: owner, brandId: brand, handle: "otherbakery", source: "owner", discover: found(media(3, () => ({}), "7000")), onPostsChanged: spy });
    expect(out.total).toBe(3);
    const rows = await igRows();
    expect(rows.filter((r) => r.kind === "past_post").map((r) => r.source_id).sort()).toEqual(["7000000", "7000001", "7000002"]);
    expect(rows.filter((r) => r.kind === "photo")).toHaveLength(1);
    expect(spy).toHaveBeenCalled();
  });

  it.each([
    ["not_business", "not_business"],
    ["not_found", "not_found"],
    ["rate_limited", "failed"],
    ["token_problem", "failed"],
    ["network", "failed"],
  ] as const)("records %s as status %s and adds nothing", async (reason, status) => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const spy = changed();
    const out = await importInstagram({ userId: owner, brandId: brand, handle: "cornerbakery", source: "owner", discover: failed(reason), onPostsChanged: spy });
    expect(out).toMatchObject({ status, added: 0, total: 0, images: [] });
    const m = await memory();
    expect(m.instagram_status).toBe(status);
    expect(m.instagram_handle).toBe("cornerbakery"); // the handle is kept so the owner can try again
    expect(m.instagram_checked_at).not.toBeNull();
    expect(await igRows()).toHaveLength(0);
    expect(spy).not.toHaveBeenCalled();
  });

  it("works end to end against the fixture accounts, with the reasons Meta gives", async () => {
    const run = (handle: string) => importInstagram({ userId: owner, brandId: brand, handle, source: "owner", onPostsChanged: changed() });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect((await run("personal.shop")).status).toBe("not_business");
    expect((await run("missing.shop")).status).toBe("not_found");
    expect((await run("limited.shop")).status).toBe("failed");
    expect((await run("badtoken.shop")).status).toBe("failed");
    const empty = await run("empty.shop");
    expect(empty).toMatchObject({ status: "imported", added: 0, total: 0 });
  });

  it("does not use up the owner's own ten pasted posts, and the cap still applies to pasted posts", async () => {
    await importInstagram({ userId: owner, brandId: brand, handle: "cornerbakery", source: "owner", discover: found(media(12)), onPostsChanged: changed() });
    for (let i = 0; i < 10; i++) await addPastPostText({ userId: owner, brandId: brand, text: `My own pasted post number ${i}` });
    await expect(addPastPostText({ userId: owner, brandId: brand, text: "One too many pasted posts" })).rejects.toMatchObject({ code: "past_post_limit" });
    expect(await listPastPosts(owner, brand)).toHaveLength(22);
  });

  it("feeds the voice read: the existing refresh takes all 12 posts and keeps only phrases that really appear", async () => {
    await importInstagram({ userId: owner, brandId: brand, handle: "cornerbakery", source: "owner", onPostsChanged: changed() });
    let seen: string[] = [];
    const r = await refreshVoice({
      userId: owner,
      brandId: brand,
      debounceMs: 0,
      fixture: (posts) => {
        seen = posts;
        return { voice_description: "Warm and short.", example_phrases: [posts[0].split(/\s+/).slice(0, 3).join(" "), "a phrase nobody wrote"], avoid_suggestions: [], emoji_use: "light", typical_length: "short" };
      },
    });
    expect(seen).toHaveLength(12);
    expect(r.status).toBe("updated");
    const v = await getVoice(owner, brand);
    expect(v.voiceDescription).toBe("Warm and short.");
    expect(v.examplePhrases).toHaveLength(1);
  });

  it("rejects an unusable handle and a stranger", async () => {
    await expect(importInstagram({ userId: owner, brandId: brand, handle: "https://www.instagram.com/p/abc/", source: "owner" })).rejects.toBeInstanceOf(UploadError);
    await expect(importInstagram({ userId: outsider, brandId: brand, handle: "cornerbakery", source: "owner", discover: found(media(3)) })).rejects.toBeInstanceOf(BrandAccessError);
    expect(await igRows()).toHaveLength(0);
  });

  it("stops at the daily cap like other uploads, before calling Instagram", async () => {
    await db.withAdmin((tx) => tx.query("update public.brands set daily_generation_cap = 1 where id = $1", [brand]));
    await db.withAdmin((tx) => tx.query("insert into public.usage_events (brand_id, user_id, kind, usd) values ($1, $2, 'upload_extract', 0)", [brand, owner]));
    const discover = vi.fn(found(media(3)));
    try {
      await expect(importInstagram({ userId: owner, brandId: brand, handle: "cornerbakery", source: "owner", discover, onPostsChanged: changed() })).rejects.toMatchObject({ name: "DailyCapError" });
      expect(discover).not.toHaveBeenCalled();
    } finally {
      await db.withAdmin((tx) => tx.query("update public.brands set daily_generation_cap = 30 where id = $1", [brand]));
    }
  });
});

describe("unavailable mode (no Meta settings)", () => {
  beforeEach(() => {
    vi.stubEnv("INSTAGRAM_MODE", "");
    vi.stubEnv("INSTAGRAM_LOOKUP_USER_ID", "");
    vi.stubEnv("INSTAGRAM_LOOKUP_TOKEN", "");
  });

  it("still saves the handle, marks the status unavailable, and never calls Instagram", async () => {
    const discover = vi.fn(found(media(3)));
    const out = await importInstagram({ userId: owner, brandId: brand, handle: "cornerbakery", source: "owner", discover, onPostsChanged: changed() });
    expect(out).toMatchObject({ status: "unavailable", added: 0, images: [] });
    expect(discover).not.toHaveBeenCalled();
    expect(await memory()).toMatchObject({ instagram_handle: "cornerbakery", instagram_handle_source: "owner", instagram_status: "unavailable" });
    const state = await getInstagramState(owner, brand);
    expect(state).toMatchObject({ available: false, handle: "cornerbakery", status: "unavailable", importedPosts: 0 });
  });

  it("offers no pictures", async () => {
    await saveInstagramHandle({ userId: owner, brandId: brand, handle: "cornerbakery", source: "owner" });
    expect(await listInstagramImages({ userId: owner, brandId: brand })).toEqual({ ok: false, reason: "unavailable" });
    const r = await addInstagramPhotos({ userId: owner, brandId: brand, mediaIds: ["9000000"], storage });
    expect(r.added).toEqual([]);
    expect(r.failed).toEqual([{ mediaId: "9000000", code: "not_found" }]);
  });
});

describe("pictures", () => {
  const mixed = () =>
    media(6, (i) =>
      i === 1
        ? { mediaType: "VIDEO" as const, imageUrl: "https://scontent.cdninstagram.com/thumb1.jpg" }
        : i === 2
          ? { mediaType: "CAROUSEL_ALBUM" as const, imageUrl: "https://scontent.cdninstagram.com/first-child.jpg" }
          : i === 3
            ? { imageUrl: null }
            : i === 4
              ? { caption: null }
              : {},
    );

  async function jpeg(bytes = 0): Promise<Uint8Array> {
    const img = await sharp({ create: { width: 300, height: 300, channels: 3, background: "#cc3333" } }).jpeg().toBuffer();
    return bytes > img.length ? new Uint8Array(Buffer.concat([img, Buffer.alloc(bytes - img.length)])) : new Uint8Array(img);
  }

  it("lists the candidate pictures (posts with no picture are left out, posts with no caption stay) and never adds any by itself", async () => {
    // The pictures live on Instagram's hosts, so this uses live-style addresses with the read injected.
    vi.stubEnv("INSTAGRAM_LOOKUP_USER_ID", "17841400000000001");
    vi.stubEnv("INSTAGRAM_LOOKUP_TOKEN", "tok");
    vi.stubEnv("INSTAGRAM_MODE", "");
    await importInstagram({ userId: owner, brandId: brand, handle: "cornerbakery", source: "owner", discover: found(mixed()), onPostsChanged: changed() });
    expect(await listPhotos(owner, brand)).toHaveLength(0);

    const r = await listInstagramImages({ userId: owner, brandId: brand });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.images.map((i) => i.mediaId)).toEqual(["9000000", "9000001", "9000002", "9000004", "9000005"]);
    expect(r.images.find((i) => i.mediaId === "9000001")!.previewUrl).toContain("thumb1");
    expect(r.images.find((i) => i.mediaId === "9000002")!.previewUrl).toContain("first-child");
    expect(r.images.find((i) => i.mediaId === "9000004")!.caption).toBeNull();
    expect(r.images.every((i) => !i.added)).toBe(true);
  });

  it("stores only the chosen pictures, with their source, through the photo pipeline", async () => {
    vi.stubEnv("INSTAGRAM_LOOKUP_USER_ID", "17841400000000001");
    vi.stubEnv("INSTAGRAM_LOOKUP_TOKEN", "tok");
    vi.stubEnv("INSTAGRAM_MODE", "");
    const discover = vi.fn(found(mixed()));
    await importInstagram({ userId: owner, brandId: brand, handle: "cornerbakery", source: "owner", discover, onPostsChanged: changed() });
    const download = vi.fn<(url: string) => Promise<{ bytes: Uint8Array; mimeType: string }>>(async () => ({ bytes: await jpeg(), mimeType: "image/jpeg" }));

    const r = await addInstagramPhotos({ userId: owner, brandId: brand, mediaIds: ["9000000", "9000002"], storage, download, discover });
    expect(r.added.map((a) => a.mediaId)).toEqual(["9000000", "9000002"]);
    expect(r.failed).toEqual([]);
    expect(download.mock.calls.map((c) => c[0])).toEqual(["https://scontent.cdninstagram.com/9000000.jpg", "https://scontent.cdninstagram.com/first-child.jpg"]);
    expect(discover).toHaveBeenCalledTimes(1); // the pictures came from the cached read, no second call

    const photos = await listPhotos(owner, brand);
    expect(photos).toHaveLength(2);
    for (const p of photos) {
      expect(p.source).toBe("instagram");
      expect(p.sourceUrl).toMatch(/^https:\/\/www\.instagram\.com\/p\//);
      expect(p.description).not.toBeNull(); // described by the normal pipeline (fixture model)
      expect(p.usable).toBe(true);
      expect(await storage.get("photos", `${brand}/${p.id}.jpg`)).not.toBeNull();
    }
    const rows = await db.withAdmin((tx) =>
      tx.query<{ source_id: string; source: string; kind: string }>("select source_id, source, kind from public.photos where brand_id = $1 and kind = 'photo'", [brand]),
    );
    expect(rows.map((x) => x.source_id).sort()).toEqual(["9000000", "9000002"]);
    expect((await readdir(path.join(root, "photos", brand))).length).toBe(2); // nothing else was stored

    // Picking the same one again adds nothing; the grid marks it as added.
    const again = await addInstagramPhotos({ userId: owner, brandId: brand, mediaIds: ["9000000"], storage, download });
    expect(again).toMatchObject({ added: [], alreadyAdded: ["9000000"], failed: [] });
    const list = await listInstagramImages({ userId: owner, brandId: brand });
    expect(list.ok && list.images.filter((i) => i.added).map((i) => i.mediaId)).toEqual(["9000000", "9000002"]);
  });

  it("refuses ids we did not read (the picture address always comes from our own read), and a picture over the size limit", async () => {
    vi.stubEnv("INSTAGRAM_LOOKUP_USER_ID", "17841400000000001");
    vi.stubEnv("INSTAGRAM_LOOKUP_TOKEN", "tok");
    vi.stubEnv("INSTAGRAM_MODE", "");
    await importInstagram({ userId: owner, brandId: brand, handle: "cornerbakery", source: "owner", discover: found(mixed()), onPostsChanged: changed() });
    const big = await jpeg(PHOTO_MAX_BYTES + 1000);
    const ok = await jpeg();
    const download = vi.fn(async (url: string) =>
      url.includes("9000000") ? { bytes: big, mimeType: "image/jpeg" } : { bytes: ok, mimeType: "image/jpeg" },
    );
    const r = await addInstagramPhotos({ userId: owner, brandId: brand, mediaIds: ["https://evil.example/x.jpg", "../../etc", "123", "9000000", "9000005"], storage, download });
    expect(r.failed).toEqual(
      expect.arrayContaining([
        { mediaId: "https://evil.example/x.jpg", code: "not_found" },
        { mediaId: "../../etc", code: "not_found" },
        { mediaId: "123", code: "not_found" },
        { mediaId: "9000000", code: "too_large" },
      ]),
    );
    expect(r.added.map((a) => a.mediaId)).toEqual(["9000005"]);
    expect(download.mock.calls.map((c) => c[0]).some((u) => u.includes("evil"))).toBe(false);
    expect(await listPhotos(owner, brand)).toHaveLength(1);
    expect((await readdir(path.join(root, "photos", brand))).length).toBe(1); // the too-large one left no file behind
  });

  it("stops at the 30-photo limit", async () => {
    vi.stubEnv("INSTAGRAM_LOOKUP_USER_ID", "17841400000000001");
    vi.stubEnv("INSTAGRAM_LOOKUP_TOKEN", "tok");
    vi.stubEnv("INSTAGRAM_MODE", "");
    await importInstagram({ userId: owner, brandId: brand, handle: "cornerbakery", source: "owner", discover: found(media(3)), onPostsChanged: changed() });
    await db.withAdmin(async (tx) => {
      for (let i = 0; i < MAX_PHOTOS; i++) {
        await tx.query("insert into public.photos (brand_id, kind, storage_path, created_by) values ($1, 'photo', $2, $3)", [brand, `photos/${brand}/x${i}.jpg`, owner]);
      }
    });
    const download = vi.fn(async () => ({ bytes: await jpeg(), mimeType: "image/jpeg" }));
    const r = await addInstagramPhotos({ userId: owner, brandId: brand, mediaIds: ["9000000", "9000001"], storage, download });
    expect(r.added).toEqual([]);
    expect(r.failed.map((f) => f.code)).toEqual(["photo_limit", "photo_limit"]);
  });

  it("downloads only from Instagram's own hosts, and in fixture mode turns the sample picture into a JPEG", async () => {
    vi.stubEnv("INSTAGRAM_LOOKUP_USER_ID", "17841400000000001");
    vi.stubEnv("INSTAGRAM_LOOKUP_TOKEN", "tok");
    vi.stubEnv("INSTAGRAM_MODE", "");
    for (const bad of ["https://evil.example/a.jpg", "http://scontent.cdninstagram.com/a.jpg", "https://169.254.169.254/a.jpg", "data:image/svg+xml;utf8,%3Csvg%2F%3E"]) {
      await expect(downloadInstagramImage(bad)).rejects.toMatchObject({ code: "bad_type" });
    }
    vi.stubEnv("INSTAGRAM_LOOKUP_USER_ID", "");
    vi.stubEnv("INSTAGRAM_LOOKUP_TOKEN", "");
    vi.stubEnv("INSTAGRAM_MODE", "fixture");
    const svg = `data:image/svg+xml;utf8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="#336699"/></svg>')}`;
    const file = await downloadInstagramImage(svg);
    expect(file.mimeType).toBe("image/jpeg");
    expect((await sharp(Buffer.from(file.bytes)).metadata()).format).toBe("jpeg");
  });

  it("works through the fixture account too: pick two sample pictures and they are stored", async () => {
    const out = await importInstagram({ userId: owner, brandId: brand, handle: "sample.bakery", source: "owner", onPostsChanged: changed() });
    expect(out.images.length).toBeGreaterThan(5);
    expect(out.images[0].previewUrl.startsWith("data:image/svg+xml")).toBe(true);
    const ids = out.images.slice(0, 2).map((i) => i.mediaId);
    const r = await addInstagramPhotos({ userId: owner, brandId: brand, mediaIds: ids, storage });
    expect(r.added).toHaveLength(2);
    expect(r.failed).toEqual([]);
  });

  it("makes at most one Instagram call across import, listing and picking; a forced listing calls again", async () => {
    vi.stubEnv("INSTAGRAM_LOOKUP_USER_ID", "17841400000000001");
    vi.stubEnv("INSTAGRAM_LOOKUP_TOKEN", "tok");
    vi.stubEnv("INSTAGRAM_MODE", "");
    const discover = vi.fn(found(media(4)));
    await importInstagram({ userId: owner, brandId: brand, handle: "cornerbakery", source: "owner", discover, onPostsChanged: changed() });
    await listInstagramImages({ userId: owner, brandId: brand, discover });
    await listInstagramImages({ userId: owner, brandId: brand, discover });
    expect(discover).toHaveBeenCalledTimes(1);
    await listInstagramImages({ userId: owner, brandId: brand, discover, force: true });
    expect(discover).toHaveBeenCalledTimes(2);
    clearInstagramCache(); // a different server process: one more call, still only because the owner clicked
    await listInstagramImages({ userId: owner, brandId: brand, discover });
    expect(discover).toHaveBeenCalledTimes(3);
  });
});

describe("removeInstagramPosts", () => {
  it("deletes the imported posts, keeps the handle and the photos, and re-reads the voice", async () => {
    await importInstagram({ userId: owner, brandId: brand, handle: "cornerbakery", source: "owner", discover: found(media(4)), onPostsChanged: changed() });
    await addPastPostText({ userId: owner, brandId: brand, text: "A post I pasted myself" });
    const spy = changed();
    expect(await removeInstagramPosts({ userId: owner, brandId: brand, onPostsChanged: spy })).toBe(4);
    expect((await listPastPosts(owner, brand)).map((p) => p.text)).toEqual(["A post I pasted myself"]);
    expect(await memory()).toMatchObject({ instagram_handle: "cornerbakery", instagram_status: "found" });
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe("rememberInstagramFromWebsite", () => {
  const page = (h: string) => `<html><body><footer><a href="https://www.instagram.com/${h}/">Instagram</a></footer></body></html>`;

  it("saves the first profile link as the handle (source website) and starts the import", async () => {
    const spy = changed();
    const r = await rememberInstagramFromWebsite(brand, [page("first.shop"), page("second.shop")], owner, { discover: found(media(4)), onPostsChanged: spy });
    expect(r?.handle).toBe("first.shop");
    await r!.done;
    expect(await memory()).toMatchObject({ instagram_handle: "first.shop", instagram_handle_source: "website", instagram_status: "imported" });
    expect((await listPastPosts(owner, brand)).length).toBe(4);
    expect(spy).toHaveBeenCalled();
  });

  it("leaves a handle the brand already has, and does nothing when the pages have no profile link", async () => {
    await saveInstagramHandle({ userId: owner, brandId: brand, handle: "ownerchoice", source: "owner" });
    const discover = vi.fn(found(media(2)));
    expect(await rememberInstagramFromWebsite(brand, page("other.shop"), owner, { discover })).toBeNull();
    expect(await memory()).toMatchObject({ instagram_handle: "ownerchoice", instagram_handle_source: "owner" });
    await db.withAdmin((tx) => tx.query("update public.brand_memory set instagram_handle = null, instagram_handle_source = null where brand_id = $1", [brand]));
    expect(await rememberInstagramFromWebsite(brand, ["<p>no links</p>", `<a href="https://www.instagram.com/p/Cx1/">post</a>`], owner, { discover })).toBeNull();
    expect(discover).not.toHaveBeenCalled();
    expect((await memory()).instagram_handle).toBeNull();
  });

  it("never throws, even for a stranger or a failing read", async () => {
    expect(await rememberInstagramFromWebsite(brand, page("shop.one"), outsider)).toBeNull();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const boom = async (): Promise<DiscoveryResult> => {
      throw new Error("boom");
    };
    const r = await rememberInstagramFromWebsite(brand, page("shop.two"), owner, { discover: boom, onPostsChanged: changed() });
    await expect(r!.done).resolves.toBeUndefined();
    expect((await memory()).instagram_status).toBe("failed");
  });
});

describe("row-level security", () => {
  it("another brand's owner cannot see or change the imported rows or the Instagram fields", async () => {
    await importInstagram({ userId: owner, brandId: brand, handle: "cornerbakery", source: "owner", discover: found(media(3)), onPostsChanged: changed() });
    const otherBrand = await createBrandFor(db, outsider, "Other Shop");

    const seen = await db.withUser(outsider, (tx) => tx.query("select id from public.photos where source = 'instagram'"));
    expect(seen).toHaveLength(0);
    const mem = await db.withUser(outsider, (tx) => tx.query("select instagram_handle from public.brand_memory where brand_id = $1", [brand]));
    expect(mem).toHaveLength(0);
    await db.withUser(outsider, (tx) => tx.query("update public.brand_memory set instagram_handle = 'hijacked' where brand_id = $1", [brand]));
    await db.withUser(outsider, (tx) => tx.query("delete from public.photos where brand_id = $1", [brand]));
    expect(await igRows()).toHaveLength(3);
    expect((await memory()).instagram_handle).toBe("cornerbakery");

    // The state function shows the stranger nothing about someone else's brand.
    expect(await getInstagramState(outsider, brand)).toMatchObject({ handle: null, status: null, importedPosts: 0 });
    // And the owner of the other brand sees only their own.
    expect(await getInstagramState(outsider, otherBrand)).toMatchObject({ handle: null, importedPosts: 0 });
    await expect(removeInstagramPosts({ userId: outsider, brandId: brand })).rejects.toBeInstanceOf(BrandAccessError);
    await expect(addInstagramPhotos({ userId: outsider, brandId: brand, mediaIds: ["9000000"], storage })).rejects.toBeInstanceOf(BrandAccessError);
    await expect(listInstagramImages({ userId: outsider, brandId: brand })).rejects.toBeInstanceOf(BrandAccessError);
  });

  it("the database refuses a second row for the same Instagram post and kind in one brand", async () => {
    await importInstagram({ userId: owner, brandId: brand, handle: "cornerbakery", source: "owner", discover: found(media(2)), onPostsChanged: changed() });
    await expect(
      db.withAdmin((tx) =>
        tx.query("insert into public.photos (brand_id, kind, extracted_text, source, source_id) values ($1, 'past_post', 'a duplicate caption', 'instagram', '9000000')", [brand]),
      ),
    ).rejects.toThrow();
  });
});
