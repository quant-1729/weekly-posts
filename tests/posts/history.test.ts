import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { aiMode } from "@/lib/ai/client";
import { saveBrandProfile } from "@/lib/brand/profile";
import type { MockDb } from "@/lib/db/mock";
import { filenamePart, postDownloads } from "@/lib/posts/download";
import { generatePost } from "@/lib/posts/generate";
import { getReuseSource, listPosts } from "@/lib/posts/history";
import { dateWindow, historyHref, parseHistoryFilters } from "@/lib/posts/history-filters";
import { formatIstDateTime, istDateString, istDayStart, istWeekStart, parseIstDate } from "@/lib/posts/ist";
import { samplePhoto } from "@/lib/render/fixtures";
import { createMockStorage } from "@/lib/storage/mock";
import { serveFile } from "@/lib/storage/serve";
import type { Storage } from "@/lib/storage/types";
import { closeTestDb, createBrandFor, createUser, openTestDb, validProfile } from "../brand/helpers";
import { allChannels, seedPost } from "./seed";

// R13: every created post is stored per brand with date, language and status, and can be found again by date or language.

let db: MockDb;
let root: string;
let storage: Storage;

beforeAll(async () => {
  expect(aiMode()).toBe("fixture");
  db = await openTestDb();
  root = await mkdtemp(path.join(os.tmpdir(), "pm-history-"));
  storage = createMockStorage(root);
});
afterAll(async () => {
  await closeTestDb(db);
  await rm(root, { recursive: true, force: true });
});

async function freshBrand() {
  const user = await createUser(db);
  const brandId = await createBrandFor(db, user.id, "Shri Ram Sweets");
  return { userId: user.id, brandId };
}

const ids = async (p: ReturnType<typeof listPosts>) => (await p).posts.map((x) => x.id);

describe("IST helpers", () => {
  it("finds IST day, week and date text", () => {
    const t = new Date("2026-10-13T14:12:00Z"); // 7:42 pm IST, a Tuesday
    expect(istDayStart(t).toISOString()).toBe("2026-10-12T18:30:00.000Z");
    expect(istWeekStart(t).toISOString()).toBe("2026-10-11T18:30:00.000Z"); // Monday 12 Oct 00:00 IST
    expect(istDateString(new Date("2026-10-13T18:29:00Z"))).toBe("2026-10-13");
    expect(istDateString(new Date("2026-10-13T18:30:00Z"))).toBe("2026-10-14");
    expect(formatIstDateTime(t)).toBe("13 Oct, 7:42 pm");
    expect(formatIstDateTime(new Date("2026-10-13T20:05:00Z"))).toBe("14 Oct, 1:35 am");
  });

  it("parses only real dates", () => {
    expect(parseIstDate("2026-10-13")?.toISOString()).toBe("2026-10-12T18:30:00.000Z");
    expect(parseIstDate("2026-02-30")).toBeNull();
    expect(parseIstDate("13-10-2026")).toBeNull();
  });
});

describe("history filters in the URL", () => {
  it("parses, ignores junk, and round-trips", () => {
    expect(parseHistoryFilters({})).toEqual({ range: "all", date: null, language: null });
    expect(parseHistoryFilters({ range: "week", lang: "hinglish" })).toEqual({ range: "week", date: null, language: "hinglish" });
    expect(parseHistoryFilters({ range: "decade", lang: "fr", date: "nope" })).toEqual({ range: "all", date: null, language: null });
    // A picked date wins over a preset.
    expect(parseHistoryFilters({ range: "today", date: "2026-10-13" })).toEqual({ range: "all", date: "2026-10-13", language: null });
    for (const f of [
      { range: "month" as const, date: null, language: "en" as const },
      { range: "all" as const, date: "2026-10-13", language: "hi" as const },
    ]) {
      const q = Object.fromEntries(new URLSearchParams(historyHref(f).split("?")[1]));
      expect(parseHistoryFilters(q)).toEqual(f);
    }
    expect(historyHref({ range: "all", date: null, language: null })).toBe("/history");
  });

  it("builds IST windows for the presets", () => {
    const now = new Date("2026-10-13T14:12:00Z");
    const w = (range: "today" | "week" | "month") => {
      const { from, to } = dateWindow({ range, date: null, language: null }, now);
      return [from?.toISOString(), to?.toISOString()];
    };
    expect(w("today")).toEqual(["2026-10-12T18:30:00.000Z", "2026-10-13T18:30:00.000Z"]);
    expect(w("week")).toEqual(["2026-10-11T18:30:00.000Z", "2026-10-18T18:30:00.000Z"]);
    expect(w("month")).toEqual(["2026-09-30T18:30:00.000Z", "2026-10-31T18:30:00.000Z"]);
    expect(dateWindow({ range: "all", date: null, language: null }, now)).toEqual({ from: null, to: null });
  });
});

describe("listPosts", () => {
  it("lists newest first with date, status, title, languages and thumbnail", async () => {
    const { userId, brandId } = await freshBrand();
    const older = await seedPost(db, brandId, userId, {
      createdAt: "2026-10-10 10:00:00+05:30",
      status: "ready",
      outputs: allChannels("hi", "Older caption\nsecond line"),
    });
    const newer = await seedPost(db, brandId, userId, {
      createdAt: "2026-10-13 19:42:00+05:30",
      status: "draft",
      outputs: [
        { channel: "ig_feed", language: "hinglish", caption: "\n  Newer caption  \nline two" },
        { channel: "status", language: "en" },
      ],
    });
    const { posts, nextCursor } = await listPosts(userId, brandId);
    expect(posts.map((p) => p.id)).toEqual([newer, older]);
    expect(nextCursor).toBeNull();

    const [n, o] = posts;
    expect(formatIstDateTime(new Date(n.createdAt))).toBe("13 Oct, 7:42 pm");
    expect(n.status).toBe("draft");
    expect(n.title).toBe("Newer caption");
    expect(n.languages).toEqual(["hinglish", "en"]);
    expect(n.thumbnail?.path).toBe(`renders/${brandId}/${newer}/ig_feed.png`);
    expect(o.status).toBe("ready");
    expect(o.title).toBe("Older caption");
    expect(o.languages).toEqual(["hi"]);
  });

  it("uses the status image when there is no ig_feed image", async () => {
    const { userId, brandId } = await freshBrand();
    const id = await seedPost(db, brandId, userId, {
      createdAt: "2026-10-13 10:00:00+05:30",
      outputs: [
        { channel: "ig_feed", language: "hi", image: false },
        { channel: "status", language: "hi" },
      ],
    });
    const [post] = (await listPosts(userId, brandId)).posts;
    expect(post.thumbnail?.path).toBe(`renders/${brandId}/${id}/status.png`);
  });

  it("lists failed posts with status failed, showing the post language and the input as title", async () => {
    const { userId, brandId } = await freshBrand();
    const failed = await seedPost(db, brandId, userId, {
      createdAt: "2026-10-13 10:00:00+05:30",
      status: "failed",
      language: "hinglish",
      inputText: "aaj ki taazi jalebi\nsecond",
    });
    const { posts } = await listPosts(userId, brandId);
    expect(posts.map((p) => p.id)).toEqual([failed]);
    expect(posts[0]).toMatchObject({ status: "failed", title: "aaj ki taazi jalebi", languages: ["hinglish"], thumbnail: null, outputs: [] });
    expect(await ids(listPosts(userId, brandId, { language: "hinglish" }))).toEqual([failed]);
    expect(await ids(listPosts(userId, brandId, { language: "en" }))).toEqual([]);
  });

  it("filters by date range using IST days: 23:59 IST is that day, 00:00 IST is the next", async () => {
    const { userId, brandId } = await freshBrand();
    const lateNight = await seedPost(db, brandId, userId, { createdAt: "2026-10-13 23:59:00+05:30", outputs: allChannels("hi") });
    const midnight = await seedPost(db, brandId, userId, { createdAt: "2026-10-14 00:00:00+05:30", outputs: allChannels("hi") });
    const earlyMorning = await seedPost(db, brandId, userId, { createdAt: "2026-10-13 00:00:00+05:30", outputs: allChannels("hi") });
    const dayBefore = await seedPost(db, brandId, userId, { createdAt: "2026-10-12 23:59:59+05:30", outputs: allChannels("hi") });

    const day = (date: string) => dateWindow({ range: "all", date, language: null });
    expect(await ids(listPosts(userId, brandId, day("2026-10-13")))).toEqual([lateNight, earlyMorning]);
    expect(await ids(listPosts(userId, brandId, day("2026-10-14")))).toEqual([midnight]);
    expect(await ids(listPosts(userId, brandId, day("2026-10-12")))).toEqual([dayBefore]);

    // "Today" on 13 Oct, 11:59 pm IST (= 18:29 UTC): same boundaries.
    const todayNow = dateWindow({ range: "today", date: null, language: null }, new Date("2026-10-13T18:29:00Z"));
    expect(await ids(listPosts(userId, brandId, todayNow))).toEqual([lateNight, earlyMorning]);
    // This week (Mon 12 Oct to Sun 18 Oct) takes all four; this month too.
    const week = dateWindow({ range: "week", date: null, language: null }, new Date("2026-10-13T18:29:00Z"));
    expect((await listPosts(userId, brandId, week)).posts).toHaveLength(4);
    // The week before only holds nothing here.
    const prevWeek = dateWindow({ range: "week", date: null, language: null }, new Date("2026-10-06T10:00:00Z"));
    expect((await listPosts(userId, brandId, prevWeek)).posts).toHaveLength(0);
    const month = dateWindow({ range: "month", date: null, language: null }, new Date("2026-10-13T18:29:00Z"));
    expect((await listPosts(userId, brandId, month)).posts).toHaveLength(4);
  });

  it("matches the language filter when ANY output is in that language", async () => {
    const { userId, brandId } = await freshBrand();
    const hindiOnly = await seedPost(db, brandId, userId, { createdAt: "2026-10-10 10:00:00+05:30", outputs: allChannels("hi") });
    const mixed = await seedPost(db, brandId, userId, {
      createdAt: "2026-10-11 10:00:00+05:30",
      language: "hi",
      outputs: [
        { channel: "ig_feed", language: "hi" },
        { channel: "status", language: "en" }, // switched one by one
        { channel: "facebook", language: "hi" },
        { channel: "gbp", language: "hi" },
      ],
    });
    const englishOnly = await seedPost(db, brandId, userId, { createdAt: "2026-10-12 10:00:00+05:30", language: "en", outputs: allChannels("en") });

    expect(await ids(listPosts(userId, brandId, { language: "hi" }))).toEqual([mixed, hindiOnly]);
    expect(await ids(listPosts(userId, brandId, { language: "en" }))).toEqual([englishOnly, mixed]);
    expect(await ids(listPosts(userId, brandId, { language: "hinglish" }))).toEqual([]);
    expect(await ids(listPosts(userId, brandId, { language: null }))).toEqual([englishOnly, mixed, hindiOnly]);

    const card = (await listPosts(userId, brandId)).posts.find((p) => p.id === mixed)!;
    expect(card.languages).toEqual(["hi", "en"]);
    // Date and language filters combine.
    expect(
      await ids(listPosts(userId, brandId, { language: "en", ...dateWindow({ range: "all", date: "2026-10-11", language: null }) })),
    ).toEqual([mixed]);
  });

  it("pages with a keyset cursor: every post exactly once, newest first, even with equal timestamps", async () => {
    const { userId, brandId } = await freshBrand();
    const made: string[] = [];
    for (let i = 0; i < 25; i++) {
      // Pairs share a timestamp to exercise the id tie-break.
      const minute = String(Math.floor(i / 2)).padStart(2, "0");
      made.push(await seedPost(db, brandId, userId, { createdAt: `2026-10-13 10:${minute}:00.123456+05:30`, outputs: allChannels("hi") }));
    }
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const page = await listPosts(userId, brandId, { limit: 10, cursor });
      expect(page.posts.length).toBeLessThanOrEqual(10);
      seen.push(...page.posts.map((p) => p.id));
      cursor = page.nextCursor;
      pages += 1;
    } while (cursor && pages < 10);
    expect(pages).toBe(3);
    expect(seen).toHaveLength(25);
    expect(new Set(seen).size).toBe(25);
    expect([...seen].sort()).toEqual([...made].sort());

    // Newest first.
    const all = (await listPosts(userId, brandId, { limit: 50 })).posts;
    expect(all.map((p) => p.id)).toEqual(seen);
    const times = all.map((p) => p.createdAt);
    expect([...times].sort().reverse()).toEqual(times);

    // Default page size is 20.
    const first = await listPosts(userId, brandId);
    expect(first.posts).toHaveLength(20);
    expect(first.nextCursor).not.toBeNull();
    const rest = await listPosts(userId, brandId, { cursor: first.nextCursor });
    expect(rest.posts).toHaveLength(5);
    expect(rest.nextCursor).toBeNull();
  });

  it("is not thrown off by a post arriving between pages", async () => {
    const { userId, brandId } = await freshBrand();
    for (let i = 0; i < 4; i++) await seedPost(db, brandId, userId, { createdAt: `2026-10-13 10:0${i}:00+05:30` });
    const first = await listPosts(userId, brandId, { limit: 2 });
    await seedPost(db, brandId, userId, { createdAt: "2026-10-13 12:00:00+05:30" });
    const second = await listPosts(userId, brandId, { limit: 2, cursor: first.nextCursor });
    expect(second.posts).toHaveLength(2);
    expect(second.posts.map((p) => p.id).filter((id) => first.posts.some((f) => f.id === id))).toEqual([]);
  });

  it("rejects a malformed cursor", async () => {
    const { userId, brandId } = await freshBrand();
    await expect(listPosts(userId, brandId, { cursor: "1'; drop table posts;--" })).rejects.toThrow("Invalid cursor");
  });

  it("uses one query for the whole page (no query per post)", async () => {
    const { userId, brandId } = await freshBrand();
    for (let i = 0; i < 5; i++) await seedPost(db, brandId, userId, { createdAt: `2026-10-13 10:0${i}:00+05:30`, outputs: allChannels("hi") });
    let queries = 0;
    const original = db.withUser.bind(db);
    db.withUser = ((uid: string, fn: Parameters<MockDb["withUser"]>[1]) =>
      original(uid, (tx) => fn({ query: (...a: Parameters<typeof tx.query>) => (queries++, tx.query(...a)) }))) as MockDb["withUser"];
    try {
      expect((await listPosts(userId, brandId)).posts).toHaveLength(5);
    } finally {
      db.withUser = original;
    }
    expect(queries).toBe(1);
  });
});

describe("downloads and reuse of real posts", () => {
  it("every listed post has working download paths, and Use again pre-fills the input", async () => {
    const { userId, brandId } = await freshBrand();
    await saveBrandProfile(userId, brandId, validProfile(), { completeSetup: { transcript: "t" } });

    const textPost = await generatePost({ userId, brandId, storage, input: { type: "text", text: "आज ताज़ी काजू कतली आई है, 600 रुपये किलो" } });
    const photoPost = await generatePost({ userId, brandId, storage, input: { type: "photo", bytes: await samplePhoto(1200, 900), caption: "ताज़ी काजू कतली" } });
    if (!textPost.ok || !photoPost.ok) throw new Error("fixture generation failed");

    const { posts } = await listPosts(userId, brandId);
    expect(posts.map((p) => p.id).sort()).toEqual([textPost.postId, photoPost.postId].sort());

    for (const post of posts) {
      expect(post.status).toBe("draft");
      expect(post.thumbnail).not.toBeNull();
      expect(post.languages).toEqual(["hi"]);
      const downloads = postDownloads({
        brandName: "Shri Ram Sweets",
        createdAt: new Date(post.createdAt),
        outputs: post.outputs.map((o) => ({ channel: o.channel, imagePath: o.imagePath })),
      });
      expect(downloads.map((d) => d.channel)).toEqual(["ig_feed", "status", "facebook"]);
      expect(new Set(downloads.map((d) => d.filename)).size).toBe(3);
      for (const d of downloads) {
        expect(d.href.startsWith("/api/files/renders/")).toBe(true);
        expect(d.filename).toBe(`Shri-Ram-Sweets-${istDateString(new Date(post.createdAt))}-${d.channel}.png`);
        const res = await serveFile({ userId, bucket: "renders", segments: d.href.replace("/api/files/renders/", "").split("/"), storage });
        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toBe("image/png");
      }
      // Someone outside the brand cannot fetch them.
      const outsider = await createUser(db);
      const blocked = await serveFile({ userId: outsider.id, bucket: "renders", segments: downloads[0].href.replace("/api/files/renders/", "").split("/"), storage });
      expect(blocked.status).toBe(404);
    }

    // Use again: text post pre-fills the text; photo post pre-fills the caption and offers the old photo.
    const text = await getReuseSource(userId, brandId, textPost.postId);
    expect(text).toEqual({ postId: textPost.postId, text: "आज ताज़ी काजू कतली आई है, 600 रुपये किलो", photoPath: null });
    const photo = await getReuseSource(userId, brandId, photoPost.postId);
    expect(photo?.text).toBe("ताज़ी काजू कतली");
    expect(photo?.photoPath).toBe(`inputs/${brandId}/posts/${photoPost.postId}/photo.jpg`);
    const file = await serveFile({ userId, bucket: "inputs", segments: photo!.photoPath!.replace("inputs/", "").split("/"), storage });
    expect(file.status).toBe(200);
    expect(file.headers.get("content-type")).toBe("image/jpeg");
  });

  it("does not offer another brand's post (or a stranger's) for reuse", async () => {
    const a = await freshBrand();
    const b = await freshBrand();
    const postA = await seedPost(db, a.brandId, a.userId, { createdAt: "2026-10-13 10:00:00+05:30", inputText: "secret" });
    expect(await getReuseSource(a.userId, a.brandId, postA)).toMatchObject({ text: "secret" });
    expect(await getReuseSource(a.userId, b.brandId, postA)).toBeNull(); // wrong (current) brand
    expect(await getReuseSource(b.userId, b.brandId, postA)).toBeNull(); // not a member
    expect(await getReuseSource(a.userId, a.brandId, "not-a-uuid")).toBeNull();
  });

  it("names download files after the brand, even for non-Latin names", () => {
    expect(filenamePart("Shri Ram Sweets")).toBe("Shri-Ram-Sweets");
    expect(filenamePart("श्री राम स्वीट्स")).toBe("श्री-राम-स्वीट्स");
    expect(filenamePart("  ///  ")).toBe("post");
    const none = postDownloads({ brandName: "X", createdAt: new Date(), outputs: [{ channel: "gbp", imagePath: null }] });
    expect(none).toEqual([]);
  });
});
