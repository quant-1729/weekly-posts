import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import type { MockDb } from "@/lib/db/mock";
import { BrandAccessError } from "@/lib/brand/current";
import { s } from "@/lib/i18n/strings";
import { createMockStorage } from "@/lib/storage/mock";
import { serveFile } from "@/lib/storage/serve";
import { BUCKETS, type Storage } from "@/lib/storage/types";
import { describeUploadError, UploadError } from "@/lib/uploads/errors";
import { MAX_PAST_POSTS, MAX_PHOTOS, PHOTO_MAX_BYTES } from "@/lib/uploads/limits";
import {
  addPastPostScreenshot,
  addPastPostText,
  listPastPosts,
  removePastPost,
  updatePastPostText,
} from "@/lib/uploads/past-posts";
import { addPhoto, listPhotos, removePhoto, setHasPeople } from "@/lib/uploads/photos";
import { addWordToAvoid, getVoice, keepVerbatimPhrases, refreshVoice, updateVoice } from "@/lib/uploads/voice";
import { closeTestDb, createBrandFor, createUser, openTestDb } from "../brand/helpers";

let db: MockDb;
let root: string;
let storage: Storage;
let owner: string;
let outsider: string;
let brand: string;

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "pm-uploads-"));
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
  await db.withAdmin(async (tx) => {
    await tx.query("delete from public.photos where brand_id = $1", [brand]);
    await tx.query("delete from public.usage_events where brand_id = $1", [brand]);
    await tx.query(
      "update public.brand_memory set voice_description = null, example_phrases = '{}', words_to_avoid = '{}', tone = null where brand_id = $1",
      [brand],
    );
  });
  await rm(path.join(root, "photos"), { recursive: true, force: true });
});

async function jpeg(width = 200, height = 100, color = "#cc3333"): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: color } }).jpeg().toBuffer();
}

async function storedFiles(): Promise<string[]> {
  try {
    return await readdir(path.join(root, "photos", brand));
  } catch {
    return [];
  }
}

const usageCount = async (kind = "upload_extract") =>
  (
    await db.withAdmin((tx) =>
      tx.query<{ n: number }>("select count(*)::int as n from public.usage_events where brand_id = $1 and kind = $2::public.usage_kind", [brand, kind]),
    )
  )[0].n;

const photoArgs = async (extra: Record<string, unknown> = {}) => ({
  userId: owner,
  brandId: brand,
  bytes: await jpeg(),
  mimeType: "image/jpeg",
  storage,
  ...extra,
});

describe("buckets and the files route", () => {
  it("has a photos bucket", () => {
    expect(BUCKETS).toContain("photos");
  });

  it("serves photos to members only", async () => {
    const { photo } = await addPhoto(await photoArgs());
    expect(photo.storagePath).toBe(`photos/${brand}/${photo.id}.jpg`);
    const segments = [brand, `${photo.id}.jpg`];
    const ok = await serveFile({ userId: owner, bucket: "photos", segments, storage });
    expect(ok.status).toBe(200);
    expect(ok.headers.get("Content-Type")).toBe("image/jpeg");
    expect((await serveFile({ userId: outsider, bucket: "photos", segments, storage })).status).toBe(404);
    expect((await serveFile({ userId: null, bucket: "photos", segments, storage })).status).toBe(401);
  });
});

describe("addPhoto: cleaning", () => {
  it("strips EXIF and GPS", async () => {
    const withGps = await sharp({ create: { width: 300, height: 200, channels: 3, background: "#336699" } })
      .withMetadata({
        exif: {
          IFD0: { Copyright: "Secret Owner" },
          IFD3: { GPSLatitudeRef: "N", GPSLatitude: "51/1 30/1 0/1", GPSLongitudeRef: "W", GPSLongitude: "0/1 7/1 0/1" },
        },
      })
      .jpeg()
      .toBuffer();
    // The test image really carries EXIF.
    const before = await sharp(withGps).metadata();
    expect(before.exif).toBeDefined();
    expect(withGps.includes(Buffer.from("Secret Owner"))).toBe(true);

    const { photo } = await addPhoto(await photoArgs({ bytes: withGps }));
    const file = await storage.get("photos", `${brand}/${photo.id}.jpg`);
    const after = await sharp(Buffer.from(file!.bytes)).metadata();
    expect(after.exif).toBeUndefined();
    expect(after.icc).toBeUndefined();
    expect(after.xmp).toBeUndefined();
    expect(Buffer.from(file!.bytes).includes(Buffer.from("Exif"))).toBe(false);
    expect(Buffer.from(file!.bytes).includes(Buffer.from("Secret Owner"))).toBe(false);
    expect(after.format).toBe("jpeg");
  });

  it("applies the EXIF rotation", async () => {
    // Stored 200 wide x 100 tall, marked "rotate 90 degrees": it must come out 100 x 200.
    const rotated = await sharp({ create: { width: 200, height: 100, channels: 3, background: "#228833" } })
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer();
    expect((await sharp(rotated).metadata()).orientation).toBe(6);
    const { photo } = await addPhoto(await photoArgs({ bytes: rotated }));
    expect([photo.width, photo.height]).toEqual([100, 200]);
    const file = await storage.get("photos", `${brand}/${photo.id}.jpg`);
    const meta = await sharp(Buffer.from(file!.bytes)).metadata();
    expect([meta.width, meta.height]).toEqual([100, 200]);
    expect(meta.orientation).toBeUndefined();
  });

  it("stores at most 2400 px, as JPEG", async () => {
    const big = await sharp({ create: { width: 3000, height: 1500, channels: 3, background: "#aaaaaa" } }).png().toBuffer();
    const { photo } = await addPhoto(await photoArgs({ bytes: big, mimeType: "image/png" }));
    expect([photo.width, photo.height]).toEqual([2400, 1200]);
  });

  it("accepts PNG and WebP", async () => {
    const png = await sharp({ create: { width: 50, height: 50, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
    const webp = await sharp({ create: { width: 50, height: 50, channels: 3, background: "#ffffff" } }).webp().toBuffer();
    await addPhoto(await photoArgs({ bytes: png, mimeType: "image/png" }));
    await addPhoto(await photoArgs({ bytes: webp, mimeType: "image/webp" }));
    expect(await listPhotos(owner, brand)).toHaveLength(2);
  });
});

describe("addPhoto: limits", () => {
  it("rejects HEIC and other types with a plain message", async () => {
    const heic = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypheic"), Buffer.alloc(40)]);
    const err = await addPhoto(await photoArgs({ bytes: heic, mimeType: "image/heic" })).catch((e) => e);
    expect(err).toBeInstanceOf(UploadError);
    expect(err.code).toBe("bad_type");
    expect(describeUploadError(err).message).toBe("Please upload a JPG or PNG");

    // Same bytes with no declared type are still recognised.
    expect((await addPhoto(await photoArgs({ bytes: heic, mimeType: "" })).catch((e) => e)).code).toBe("bad_type");
    // A GIF, declared as a JPEG.
    const gif = await sharp({ create: { width: 10, height: 10, channels: 3, background: "#fff" } }).gif().toBuffer();
    expect((await addPhoto(await photoArgs({ bytes: gif, mimeType: "image/jpeg" })).catch((e) => e)).code).toBe("bad_type");
    // Text pretending to be an image.
    expect((await addPhoto(await photoArgs({ bytes: Buffer.from("hello"), mimeType: "image/jpeg" })).catch((e) => e)).code).toBe("unreadable");
    expect((await addPhoto(await photoArgs({ bytes: new Uint8Array(0) })).catch((e) => e)).code).toBe("empty");
    expect(await listPhotos(owner, brand)).toHaveLength(0);
    expect(await storedFiles()).toHaveLength(0);
  });

  it("rejects files over 4 MB, accepts exactly 4 MB", async () => {
    const tooBig = new Uint8Array(PHOTO_MAX_BYTES + 1);
    expect((await addPhoto(await photoArgs({ bytes: tooBig })).catch((e) => e)).code).toBe("too_large");
    // Not too large at the limit: it then fails only because the filler is not an image.
    expect((await addPhoto(await photoArgs({ bytes: new Uint8Array(PHOTO_MAX_BYTES) })).catch((e) => e)).code).toBe("unreadable");
  });

  it("allows 30 photos per brand and no more", async () => {
    await db.withAdmin(async (tx) => {
      for (let i = 0; i < MAX_PHOTOS - 1; i++) {
        await tx.query("insert into public.photos (brand_id, kind, storage_path) values ($1, 'photo', $2)", [brand, `photos/${brand}/fake-${i}.jpg`]);
      }
    });
    await addPhoto(await photoArgs()); // the 30th
    expect(await listPhotos(owner, brand)).toHaveLength(MAX_PHOTOS);
    const err = await addPhoto(await photoArgs()).catch((e) => e);
    expect(err.code).toBe("photo_limit");
    expect(await listPhotos(owner, brand)).toHaveLength(MAX_PHOTOS);
    expect(await storedFiles()).toHaveLength(1);
  });
});

describe("addPhoto: description", () => {
  it("saves the description and has_people, and records usage", async () => {
    const { photo, warning } = await addPhoto(
      await photoArgs({ fixture: { description: "Two people at a bakery counter.", has_people: true, usable: true } }),
    );
    expect(warning).toBeNull();
    expect(photo.description).toBe("Two people at a bakery counter.");
    expect(photo.hasPeople).toBe(true);
    const [row] = await listPhotos(owner, brand);
    expect(row.description).toBe("Two people at a bakery counter.");
    expect(await usageCount()).toBe(1);
  });

  it("describes with the built-in fixture when none is given", async () => {
    const { photo } = await addPhoto(await photoArgs());
    expect(photo.description).toMatch(/photo/i);
    expect(photo.hasPeople).toBe(false);
  });

  it("keeps an unusable photo and returns a soft warning", async () => {
    const { photo, warning } = await addPhoto(await photoArgs({ fixture: { description: "A dark blur.", has_people: false, usable: false } }));
    expect(warning).toBe("This photo looks dark or blurry; it may not look good in posts");
    expect(await listPhotos(owner, brand)).toHaveLength(1);
    expect(await storage.get("photos", `${brand}/${photo.id}.jpg`)).not.toBeNull();
  });

  it("keeps the photo with no description when the description call fails", async () => {
    const { photo, warning } = await addPhoto(
      await photoArgs({
        fixture: () => {
          throw new Error("model is down");
        },
      }),
    );
    expect(warning).toBeNull();
    expect(photo.description).toBeNull();
    expect(await listPhotos(owner, brand)).toHaveLength(1);
    expect(await storage.get("photos", `${brand}/${photo.id}.jpg`)).not.toBeNull();
    expect(await usageCount()).toBe(0);
  });

  it("keeps the photo when the daily cap is reached", async () => {
    await db.withAdmin((tx) => tx.query("update public.brands set daily_generation_cap = 0 where id = $1", [brand]));
    try {
      const { photo } = await addPhoto(await photoArgs());
      expect(photo.description).toBeNull();
      expect(await listPhotos(owner, brand)).toHaveLength(1);
    } finally {
      await db.withAdmin((tx) => tx.query("update public.brands set daily_generation_cap = 30 where id = $1", [brand]));
    }
  });
});

describe("photo remove, has_people, members only", () => {
  it("removes the row and the stored file", async () => {
    const { photo } = await addPhoto(await photoArgs());
    expect(await storedFiles()).toHaveLength(1);
    expect(await removePhoto({ userId: owner, brandId: brand, photoId: photo.id, storage })).toBe(true);
    expect(await listPhotos(owner, brand)).toHaveLength(0);
    expect(await storage.get("photos", `${brand}/${photo.id}.jpg`)).toBeNull();
    expect(await storedFiles()).toHaveLength(0);
    expect(await removePhoto({ userId: owner, brandId: brand, photoId: photo.id, storage })).toBe(false);
  });

  it("lets the owner toggle has_people", async () => {
    const { photo } = await addPhoto(await photoArgs());
    expect(await setHasPeople({ userId: owner, brandId: brand, photoId: photo.id, hasPeople: true })).toBe(true);
    expect((await listPhotos(owner, brand))[0].hasPeople).toBe(true);
    await setHasPeople({ userId: owner, brandId: brand, photoId: photo.id, hasPeople: false });
    expect((await listPhotos(owner, brand))[0].hasPeople).toBe(false);
  });

  it("shows the consent note in the strings", () => {
    expect(s.uploads.photos.peopleNote).toBe("Only use photos of people who agreed to be in your posts.");
  });

  it("refuses everything to a non-member (row-level security)", async () => {
    const { photo } = await addPhoto(await photoArgs());
    const post = await addPastPostText({ userId: owner, brandId: brand, text: "A caption from last week." });
    await expect(addPhoto({ ...(await photoArgs()), userId: outsider })).rejects.toBeInstanceOf(BrandAccessError);
    await expect(addPastPostText({ userId: outsider, brandId: brand, text: "Hello there, friends." })).rejects.toBeInstanceOf(BrandAccessError);
    await expect(removePhoto({ userId: outsider, brandId: brand, photoId: photo.id, storage })).rejects.toBeInstanceOf(BrandAccessError);
    await expect(refreshVoice({ userId: outsider, brandId: brand, debounceMs: 0 })).rejects.toBeInstanceOf(BrandAccessError);
    expect(await listPhotos(outsider, brand)).toEqual([]);
    expect(await listPastPosts(outsider, brand)).toEqual([]);
    // Straight to the table as the outsider: nothing visible, nothing deletable.
    const rows = await db.withUser(outsider, (tx) => tx.query("select id from public.photos where brand_id = $1", [brand]));
    expect(rows).toHaveLength(0);
    await db.withUser(outsider, (tx) => tx.query("delete from public.photos where brand_id = $1", [brand]));
    expect(await listPhotos(owner, brand)).toHaveLength(1);
    expect(await listPastPosts(owner, brand)).toHaveLength(1);
    expect(post.id).toBeTruthy();
  });
});

describe("past posts", () => {
  it("adds a pasted text", async () => {
    const post = await addPastPostText({ userId: owner, brandId: brand, text: "  Fresh sourdough every morning!  " });
    expect(post.text).toBe("Fresh sourdough every morning!");
    expect(post.storagePath).toBeNull();
    const [row] = await db.withAdmin((tx) =>
      tx.query<{ kind: string; extracted_text: string; storage_path: string | null }>("select kind::text, extracted_text, storage_path from public.photos where id = $1", [post.id]),
    );
    expect(row).toEqual({ kind: "past_post", extracted_text: "Fresh sourdough every morning!", storage_path: null });
    expect(await usageCount()).toBe(0);
  });

  it("checks the text length (10 to 3000 characters)", async () => {
    const short = await addPastPostText({ userId: owner, brandId: brand, text: "too short" }).catch((e) => e);
    expect(short.code).toBe("text_too_short");
    const long = await addPastPostText({ userId: owner, brandId: brand, text: "x".repeat(3001) }).catch((e) => e);
    expect(long.code).toBe("text_too_long");
    await addPastPostText({ userId: owner, brandId: brand, text: "x".repeat(10) });
    await addPastPostText({ userId: owner, brandId: brand, text: "x".repeat(3000) });
    expect(await listPastPosts(owner, brand)).toHaveLength(2);
  });

  it("reads a screenshot, stores the image and records usage", async () => {
    const post = await addPastPostScreenshot({
      userId: owner,
      brandId: brand,
      bytes: await jpeg(400, 800),
      mimeType: "image/jpeg",
      storage,
      fixture: { is_post: true, text: "Good morning, lovelies!\nToday: cardamom buns." },
    });
    expect(post.text).toBe("Good morning, lovelies!\nToday: cardamom buns.");
    expect(post.storagePath).toBe(`photos/${brand}/${post.id}.jpg`);
    expect(await storage.get("photos", `${brand}/${post.id}.jpg`)).not.toBeNull();
    expect(await usageCount()).toBe(1);
    // It is a past post, not a library photo.
    expect(await listPhotos(owner, brand)).toHaveLength(0);
    expect(await listPastPosts(owner, brand)).toHaveLength(1);
  });

  it("reads a screenshot with the built-in fixture", async () => {
    const post = await addPastPostScreenshot({ userId: owner, brandId: brand, bytes: await jpeg(), mimeType: "image/jpeg", storage });
    expect(post.text.length).toBeGreaterThan(10);
  });

  it("rejects a screenshot that is not a post and deletes the image", async () => {
    const err = await addPastPostScreenshot({
      userId: owner,
      brandId: brand,
      bytes: await jpeg(),
      mimeType: "image/jpeg",
      storage,
      fixture: { is_post: false, text: "Invoice 4411" },
    }).catch((e) => e);
    expect(err.code).toBe("not_a_post");
    expect(describeUploadError(err).message).toBe("We couldn't find a post in that screenshot. Paste the text instead?");
    expect(await storedFiles()).toHaveLength(0);
    expect(await listPastPosts(owner, brand)).toHaveLength(0);

    const empty = await addPastPostScreenshot({
      userId: owner,
      brandId: brand,
      bytes: await jpeg(),
      mimeType: "image/jpeg",
      storage,
      fixture: { is_post: true, text: "   " },
    }).catch((e) => e);
    expect(empty.code).toBe("not_a_post");
    expect(await storedFiles()).toHaveLength(0);
  });

  it("deletes the image when the model call fails", async () => {
    await expect(
      addPastPostScreenshot({
        userId: owner,
        brandId: brand,
        bytes: await jpeg(),
        mimeType: "image/jpeg",
        storage,
        fixture: () => {
          throw new Error("model is down");
        },
      }),
    ).rejects.toThrow("model is down");
    expect(await storedFiles()).toHaveLength(0);
  });

  it("rejects HEIC screenshots", async () => {
    const heic = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypmif1"), Buffer.alloc(40)]);
    const err = await addPastPostScreenshot({ userId: owner, brandId: brand, bytes: heic, mimeType: "image/heif", storage }).catch((e) => e);
    expect(err.code).toBe("bad_type");
  });

  it("allows 10 past posts and no more", async () => {
    for (let i = 0; i < MAX_PAST_POSTS; i++) {
      await addPastPostText({ userId: owner, brandId: brand, text: `Past post number ${i} for the shop` });
    }
    const t = await addPastPostText({ userId: owner, brandId: brand, text: "One more post than allowed" }).catch((e) => e);
    expect(t.code).toBe("past_post_limit");
    const shot = await addPastPostScreenshot({ userId: owner, brandId: brand, bytes: await jpeg(), mimeType: "image/jpeg", storage }).catch((e) => e);
    expect(shot.code).toBe("past_post_limit");
    expect(await storedFiles()).toHaveLength(0);
    expect(await listPastPosts(owner, brand)).toHaveLength(MAX_PAST_POSTS);
  });

  it("edits and removes a post, deleting its screenshot", async () => {
    const post = await addPastPostScreenshot({ userId: owner, brandId: brand, bytes: await jpeg(), mimeType: "image/jpeg", storage });
    const edited = await updatePastPostText({ userId: owner, brandId: brand, postId: post.id, text: "Corrected text of the post" });
    expect(edited.text).toBe("Corrected text of the post");
    expect((await updatePastPostText({ userId: owner, brandId: brand, postId: post.id, text: "no" }).catch((e) => e)).code).toBe("text_too_short");
    expect(await removePastPost({ userId: owner, brandId: brand, postId: post.id, storage })).toBe(true);
    expect(await storedFiles()).toHaveLength(0);
    expect(await removePastPost({ userId: owner, brandId: brand, postId: post.id, storage })).toBe(false);
  });
});

describe("voice", () => {
  const POSTS = [
    "Fresh out of the oven!\nCome in and say hello, the kettle is always on.",
    "Thank you for a lovely week.  See you Saturday!",
  ];

  async function seedPosts(posts = POSTS) {
    for (const text of posts) await addPastPostText({ userId: owner, brandId: brand, text });
  }

  const voiceOf = (overrides: Partial<{ example_phrases: string[]; avoid_suggestions: string[] }>) => () => ({
    voice_description: "Warm and chatty.",
    example_phrases: [],
    avoid_suggestions: [],
    emoji_use: "light" as const,
    typical_length: "short" as const,
    ...overrides,
  });

  it("does nothing with no past posts", async () => {
    let calls = 0;
    const r = await refreshVoice({
      userId: owner,
      brandId: brand,
      debounceMs: 0,
      fixture: () => {
        calls++;
        return voiceOf({})();
      },
    });
    expect(r.status).toBe("skipped");
    expect(calls).toBe(0);
    expect(await usageCount()).toBe(0);
    expect((await getVoice(owner, brand)).voiceDescription).toBeNull();
  });

  it("keeps real phrases, drops invented ones, and records usage", async () => {
    await seedPosts();
    const r = await refreshVoice({
      userId: owner,
      brandId: brand,
      debounceMs: 0,
      fixture: voiceOf({
        example_phrases: [
          "say hello",
          "THE KETTLE   IS ALWAYS ON",
          "See you Saturday",
          "Fresh out of the oven come in", // joined across a sentence: not verbatim
          "artisanal handcrafted goodness", // invented
          "say hello", // duplicate
        ],
      }),
    });
    expect(r.status).toBe("updated");
    const v = await getVoice(owner, brand);
    expect(v.examplePhrases).toEqual(["say hello", "THE KETTLE IS ALWAYS ON", "See you Saturday"]);
    expect(v.voiceDescription).toBe("Warm and chatty.");
    expect(await usageCount()).toBe(1);
  });

  it("uses the built-in fixture, whose phrases come from the posts", async () => {
    await seedPosts();
    const r = await refreshVoice({ userId: owner, brandId: brand, debounceMs: 0 });
    expect(r.status).toBe("updated");
    const v = await getVoice(owner, brand);
    expect(v.examplePhrases.length).toBeGreaterThan(0);
    expect(keepVerbatimPhrases(v.examplePhrases, POSTS)).toEqual(v.examplePhrases);
  });

  it("returns avoid suggestions but does not add them to words_to_avoid", async () => {
    await seedPosts();
    await db.withAdmin((tx) => tx.query("update public.brand_memory set words_to_avoid = '{cheap}' where brand_id = $1", [brand]));
    const r = await refreshVoice({
      userId: owner,
      brandId: brand,
      debounceMs: 0,
      fixture: voiceOf({ avoid_suggestions: ["corporate jargon", "!!!", "cheap"] }),
    });
    expect(r.status === "updated" && r.avoidSuggestions).toEqual(["corporate jargon", "!!!"]); // minus the one already listed
    const v = await getVoice(owner, brand);
    expect(v.wordsToAvoid).toEqual(["cheap"]);
    expect(v.avoidSuggestions).toEqual(["corporate jargon", "!!!"]); // already-listed words are not suggested again

    const list = await addWordToAvoid({ userId: owner, brandId: brand, word: "corporate jargon" });
    expect(list).toEqual(["cheap", "corporate jargon"]);
    expect((await addWordToAvoid({ userId: owner, brandId: brand, word: "Corporate  Jargon" })).length).toBe(2);
    expect((await getVoice(owner, brand)).avoidSuggestions).toEqual(["!!!"]);
  });

  it("keeps the saved voice when the model fails", async () => {
    await seedPosts();
    await refreshVoice({ userId: owner, brandId: brand, debounceMs: 0, fixture: voiceOf({}) });
    const r = await refreshVoice({
      userId: owner,
      brandId: brand,
      debounceMs: 0,
      fixture: () => {
        throw new Error("model is down");
      },
    });
    expect(r.status).toBe("failed");
    expect((await getVoice(owner, brand)).voiceDescription).toBe("Warm and chatty.");
  });

  it("passes the past posts and the picked tone to the model", async () => {
    await seedPosts();
    await db.withAdmin((tx) => tx.query("update public.brand_memory set tone = 'playful' where brand_id = $1", [brand]));
    let seen: string[] = [];
    await refreshVoice({
      userId: owner,
      brandId: brand,
      debounceMs: 0,
      fixture: (posts) => {
        seen = posts;
        return voiceOf({})();
      },
    });
    expect(seen).toEqual(POSTS);
  });

  it("debounces: of two refreshes close together, only the last runs", async () => {
    await seedPosts();
    let calls = 0;
    const fixture = () => {
      calls++;
      return voiceOf({ example_phrases: ["say hello"] })();
    };
    const first = refreshVoice({ userId: owner, brandId: brand, debounceMs: 80, fixture });
    await new Promise((r) => setTimeout(r, 20));
    const second = refreshVoice({ userId: owner, brandId: brand, debounceMs: 80, fixture });
    expect((await first).status).toBe("superseded");
    expect((await second).status).toBe("updated");
    expect(calls).toBe(1);
    expect(await usageCount()).toBe(1);
  });

  it("lets the owner edit every field", async () => {
    await updateVoice({
      userId: owner,
      brandId: brand,
      edit: { voiceDescription: "  Dry and short.  ", examplePhrases: ["a b", "a b", " "], wordsToAvoid: ["cheap", "Cheap"] },
    });
    const v = await getVoice(owner, brand);
    expect(v.voiceDescription).toBe("Dry and short.");
    expect(v.examplePhrases).toEqual(["a b"]);
    expect(v.wordsToAvoid).toEqual(["cheap"]);
  });
});
