import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Wrap the AI client so tests can see whether it was called. Under vitest AI is
// always in fixture mode: nothing here reaches the network.
const spies = vi.hoisted(() => ({ generateJson: vi.fn() }));
vi.mock("@/lib/ai/client", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/ai/client")>();
  spies.generateJson.mockImplementation(real.generateJson);
  return { ...real, generateJson: spies.generateJson };
});

import { AiError, aiMode } from "@/lib/ai/client";
import type { ChannelOutput, ContentLanguage } from "@/lib/ai/schemas";
import { saveBrandProfile } from "@/lib/brand/profile";
import type { MockDb } from "@/lib/db/mock";
import { s } from "@/lib/i18n/strings";
import { generateFixture, switchFixture } from "@/lib/posts/fixtures";
import { generatePost } from "@/lib/posts/generate";
import { getReviewData } from "@/lib/posts/review";
import { switchOutputLanguage, type SwitchOutcome } from "@/lib/posts/switch-language";
import { samplePhoto } from "@/lib/render/fixtures";
import { createMockStorage } from "@/lib/storage/mock";
import type { Storage } from "@/lib/storage/types";
import { closeTestDb, createBrandFor, createUser, openTestDb, validProfile } from "../brand/helpers";

let db: MockDb;
let root: string;
let storage: Storage;
let owner: string;
let outsider: string;
let brandId: string;

const adminRows = <T>(sql: string, params: unknown[] = []) => db.withAdmin((tx) => tx.query<T>(sql, params));
const usageKinds = (id: string) =>
  adminRows<{ kind: string }>("select kind::text from public.usage_events where brand_id = $1 order by id", [id]).then((r) =>
    r.map((x) => x.kind),
  );

interface Row {
  id: string;
  channel: string;
  language: string;
  caption: string;
  cta: string;
  hashtags: string[];
  image_text: ChannelOutput["image_text"];
  template_id: string | null;
  image_path: string | null;
  fact_flags: { id: string; text: string; kind: string; regulated: boolean; status: string }[];
  original: ChannelOutput;
  edited_at: string | null;
  updated_at: string;
}
const rowsOf = (postId: string) =>
  adminRows<Row>("select id, channel::text as channel, language::text as language, caption, cta, hashtags, image_text, template_id, image_path, fact_flags, original, edited_at, updated_at from public.outputs where post_id = $1 order by channel", [postId]);
const rowOf = async (postId: string, channel: string) => (await rowsOf(postId)).find((r) => r.channel === channel)!;

async function bytesOf(imagePath: string) {
  const file = await storage.get("renders", imagePath.replace(/^renders\//, ""));
  expect(file).not.toBeNull();
  return Buffer.from(file!.bytes);
}

async function newPost(extra: Partial<Parameters<typeof generatePost>[0]> = {}, forBrand = brandId) {
  const out = await generatePost({ userId: owner, brandId: forBrand, input: { type: "text", text: "आज ताज़ी काजू कतली आई है" }, storage, ...extra });
  if (!out.ok) throw new Error(`generate failed: ${out.code}`);
  return out.postId;
}

function ok(o: SwitchOutcome) {
  if (!o.ok) throw new Error(`expected success, got ${o.code}: ${o.message}`);
  return o;
}

const doSwitch = (outputId: string, to: ContentLanguage, extra: Partial<Parameters<typeof switchOutputLanguage>[0]> = {}) =>
  switchOutputLanguage({ userId: owner, outputId, to, storage, ...extra });

beforeAll(async () => {
  expect(aiMode()).toBe("fixture");
  db = await openTestDb();
  root = await mkdtemp(path.join(os.tmpdir(), "pm-switch-"));
  storage = createMockStorage(root);
  owner = (await createUser(db)).id;
  outsider = (await createUser(db)).id;
  brandId = await createBrandFor(db, owner);
  await saveBrandProfile(owner, brandId, validProfile(), { completeSetup: { transcript: "t" } });
  // These tests make many calls; the cap itself is tested on its own brand below.
  await adminRows("update public.brands set daily_generation_cap = 1000 where id = $1", [brandId]);
});
afterAll(async () => {
  await closeTestDb(db);
  await rm(root, { recursive: true, force: true });
});
beforeEach(() => {
  spies.generateJson.mockClear();
});

describe("switching one output", () => {
  it("hi -> hinglish -> en updates language, caption and image of that output only", async () => {
    const postId = await newPost();
    const before = await rowsOf(postId);
    const ig = before.find((r) => r.channel === "ig_feed")!;
    const usageBefore = await usageKinds(brandId);
    const imgBefore = await bytesOf(ig.image_path!);
    const versionBefore = (await getReviewData(owner, postId))!.outputs[0].imageVersion;

    const r1 = ok(await doSwitch(ig.id, "hinglish"));
    expect(r1.changed).toBe(true);
    expect(r1.output).toMatchObject({ id: ig.id, channel: "ig_feed", language: "hinglish", caption: switchFixture("ig_feed", "hinglish").caption });
    expect(r1.output.shareText).toContain(switchFixture("ig_feed", "hinglish").cta);

    const mid = await rowsOf(postId);
    const igMid = mid.find((r) => r.channel === "ig_feed")!;
    expect(igMid).toMatchObject({
      language: "hinglish",
      caption: switchFixture("ig_feed", "hinglish").caption,
      cta: switchFixture("ig_feed", "hinglish").cta,
      image_text: switchFixture("ig_feed", "hinglish").image_text,
      template_id: ig.template_id,
      image_path: ig.image_path,
      edited_at: null,
    });
    expect(igMid.original).toEqual(ig.original);
    expect(new Date(igMid.updated_at).getTime()).toBeGreaterThanOrEqual(new Date(ig.updated_at).getTime());
    // The image was redrawn with the new text.
    const imgMid = await bytesOf(igMid.image_path!);
    expect(imgMid.equals(imgBefore)).toBe(false);
    expect(await sharp(imgMid).metadata()).toMatchObject({ width: 1080, height: 1080, format: "png" });
    // The result screen sees a new image version, so the browser reloads the PNG.
    expect(r1.output.imageVersion).not.toBe(versionBefore);

    // Every other output is untouched.
    for (const other of before.filter((r) => r.channel !== "ig_feed")) {
      expect(mid.find((r) => r.id === other.id)).toEqual(other);
    }

    const r2 = ok(await doSwitch(ig.id, "en"));
    expect(r2.output.language).toBe("en");
    const igEnd = await rowOf(postId, "ig_feed");
    expect(igEnd).toMatchObject({ language: "en", caption: switchFixture("ig_feed", "en").caption });
    expect(igEnd.original).toEqual(ig.original);
    expect((await bytesOf(igEnd.image_path!)).equals(imgMid)).toBe(false);

    expect((await usageKinds(brandId)).slice(usageBefore.length)).toEqual(["switch_language", "switch_language"]);
    // The post itself keeps the brand language.
    const [post] = await adminRows<{ language: string }>("select language::text as language from public.posts where id = $1", [postId]);
    expect(post.language).toBe("hi");
    // The review data reflects the switch.
    const review = (await getReviewData(owner, postId))!;
    expect(review.language).toBe("hi");
    expect(review.outputs.map((o) => o.language)).toEqual(["en", "hi", "hi", "hi"]);
  });

  it("switching facebook alone gives it its own image and leaves ig_feed's image alone", async () => {
    const postId = await newPost();
    const before = await rowsOf(postId);
    const ig = before.find((r) => r.channel === "ig_feed")!;
    const fb = before.find((r) => r.channel === "facebook")!;
    expect(fb.image_path).toBe(ig.image_path);
    const igBytes = await bytesOf(ig.image_path!);

    const res = ok(await doSwitch(fb.id, "en"));
    expect(res.output.imagePath).toBe(`renders/${brandId}/${postId}/facebook.png`);

    const after = await rowsOf(postId);
    const fbAfter = after.find((r) => r.channel === "facebook")!;
    expect(fbAfter).toMatchObject({
      language: "en",
      caption: switchFixture("facebook", "en").caption,
      image_path: `renders/${brandId}/${postId}/facebook.png`,
      template_id: ig.template_id, // the square template of ig_feed
    });
    const fbBytes = await bytesOf(fbAfter.image_path!);
    expect(await sharp(fbBytes).metadata()).toMatchObject({ width: 1080, height: 1080, format: "png" });
    // ig_feed: same row, same file, same bytes.
    expect(after.find((r) => r.channel === "ig_feed")).toEqual(ig);
    expect((await bytesOf(ig.image_path!)).equals(igBytes)).toBe(true);
    expect(fbAfter.image_path).not.toBe(ig.image_path);
  });

  it("status keeps its tall template, gbp (text only) gets no image, and a photo post keeps its photo template", async () => {
    const postId = await newPost();
    const rows = await rowsOf(postId);
    const status = rows.find((r) => r.channel === "status")!;
    const gbp = rows.find((r) => r.channel === "gbp")!;

    const st = ok(await doSwitch(status.id, "hinglish"));
    expect(st.output.imagePath).toBe(status.image_path);
    expect(await sharp(await bytesOf(st.output.imagePath!)).metadata()).toMatchObject({ width: 1080, height: 1920 });

    const g = ok(await doSwitch(gbp.id, "en"));
    expect(g.output).toMatchObject({ language: "en", imagePath: null, templateId: null });
    expect(await storage.get("renders", `${brandId}/${postId}/gbp.png`)).toBeNull();

    const photoPost = await newPost({ input: { type: "photo", bytes: await samplePhoto(1200, 900), caption: "ताज़ी काजू कतली" } });
    const ig = await rowOf(photoPost, "ig_feed");
    expect(ig.template_id).toBe("sq-photo-band");
    const sw = ok(await doSwitch(ig.id, "en"));
    expect(sw.output.templateId).toBe("sq-photo-band");
    expect(sw.output.imagePath).toBe(ig.image_path);
  });

  it("switching to the language it already has does nothing and makes no AI call", async () => {
    const postId = await newPost();
    const before = await rowsOf(postId);
    const usageBefore = await usageKinds(brandId);
    spies.generateJson.mockClear();
    const res = ok(await doSwitch(before[0].id, "hi"));
    expect(res.changed).toBe(false);
    expect(res.output.id).toBe(before[0].id);
    expect(spies.generateJson).not.toHaveBeenCalled();
    expect(await usageKinds(brandId)).toEqual(usageBefore);
    expect(await rowsOf(postId)).toEqual(before);
  });

  it("rejects an unknown language and a malformed id before doing anything", async () => {
    const postId = await newPost();
    const [first] = await rowsOf(postId);
    spies.generateJson.mockClear();
    expect(await doSwitch(first.id, "fr" as ContentLanguage)).toMatchObject({ ok: false, code: "invalid_input" });
    expect(await doSwitch("not-an-id", "en")).toMatchObject({ ok: false, code: "not_found" });
    expect(spies.generateJson).not.toHaveBeenCalled();
  });
});

describe("access, cap and failures", () => {
  it("a non-member cannot switch, and the output is unchanged", async () => {
    const postId = await newPost();
    const before = await rowsOf(postId);
    const usageBefore = await usageKinds(brandId);
    spies.generateJson.mockClear();
    const res = await switchOutputLanguage({ userId: outsider, outputId: before[0].id, to: "en", storage });
    expect(res).toMatchObject({ ok: false, code: "not_found", message: s.review.switch.notFound });
    expect(spies.generateJson).not.toHaveBeenCalled();
    expect(await usageKinds(brandId)).toEqual(usageBefore);
    expect(await rowsOf(postId)).toEqual(before);
  });

  it("the daily cap blocks before the AI call", async () => {
    const capped = await createBrandFor(db, owner, "Capped");
    await saveBrandProfile(owner, capped, validProfile(), { completeSetup: { transcript: "t" } });
    const postId = await newPost({}, capped);
    const before = await rowsOf(postId);
    await adminRows("update public.brands set daily_generation_cap = (select count(*) from public.usage_events where brand_id = $1) where id = $1", [capped]);
    const usageBefore = await usageKinds(capped);
    spies.generateJson.mockClear();

    const res = await doSwitch(before[0].id, "en");
    expect(res).toMatchObject({ ok: false, code: "cap" });
    expect(!res.ok && res.message).toContain("AI requests");
    expect(spies.generateJson).not.toHaveBeenCalled();
    expect(await usageKinds(capped)).toEqual(usageBefore);
    expect(await rowsOf(postId)).toEqual(before);
  });

  it("an AI failure keeps the old content, counts the attempt and says so in plain words", async () => {
    const postId = await newPost();
    const before = await rowsOf(postId);
    const usageBefore = await usageKinds(brandId);
    spies.generateJson.mockRejectedValueOnce(new AiError("call_failed", "boom"));
    const res = await doSwitch(before[0].id, "en");
    expect(res).toMatchObject({ ok: false, code: "ai_failed", message: s.review.switch.failed });
    expect(await rowsOf(postId)).toEqual(before);
    expect((await usageKinds(brandId)).slice(usageBefore.length)).toEqual(["switch_language"]);
    expect(await bytesOf(before[0].image_path!)).toBeTruthy();
  });
});

describe("facts (R8)", () => {
  /** A post whose ig_feed caption has a price (450) the owner never gave, so it starts with one open flag. */
  async function postWithStrayPrice() {
    const fx = generateFixture("hi");
    fx.outputs.ig_feed.caption += "\nआज का ऑफ़र सिर्फ़ ₹450 में।";
    const postId = await newPost({ fixtures: { generate: fx } });
    const ig = await rowOf(postId, "ig_feed");
    expect(ig.fact_flags.map((f) => [f.kind, f.text, f.status])).toEqual([["price", "450", "open"]]);
    return { postId, ig };
  }

  it("a price in the new text that is not in the sources or the old output becomes an open flag", async () => {
    const postId = await newPost();
    const ig = await rowOf(postId, "ig_feed");
    expect(ig.fact_flags).toEqual([]);
    const result = switchFixture("ig_feed", "hinglish");
    result.caption += "\nAaj sirf ₹777 mein.";
    const res = ok(await doSwitch(ig.id, "hinglish", { fixtures: { result } }));
    expect(res.openFlags).toBe(1);
    expect(res.output.flags).toHaveLength(1);
    expect(res.output.flags[0]).toMatchObject({ kind: "price", text: "777", status: "open", regulated: false });
    expect((await rowOf(postId, "ig_feed")).fact_flags).toEqual(res.output.flags);
    // The text is saved as written; flagging does not rewrite it.
    expect(res.output.caption).toContain("₹777");
  });

  it("a price carried over from the old output is not flagged again, and its open flag stays", async () => {
    const { postId, ig } = await postWithStrayPrice();
    const result = switchFixture("ig_feed", "hinglish");
    result.caption += "\nAaj ka offer sirf ₹450 mein.";
    const res = ok(await doSwitch(ig.id, "hinglish", { fixtures: { result } }));
    expect(res.output.flags).toEqual(ig.fact_flags); // same flag, same id, no duplicate
    expect((await rowOf(postId, "ig_feed")).fact_flags).toEqual(ig.fact_flags);
  });

  it("an open flag whose text is gone is dropped", async () => {
    const { ig } = await postWithStrayPrice();
    const res = ok(await doSwitch(ig.id, "hinglish")); // default fixture has no 450
    expect(res.output.flags).toEqual([]);
    expect(res.openFlags).toBe(0);
  });

  it("confirmed and removed flags survive a switch, whether or not the text is still there", async () => {
    const { postId, ig } = await postWithStrayPrice();
    const flags = [
      { ...ig.fact_flags[0], status: "confirmed" },
      { id: "11111111-1111-4111-8111-111111111111", text: "free delivery", kind: "claim", regulated: false, status: "removed" },
    ];
    await adminRows("update public.outputs set fact_flags = $2::jsonb where id = $1", [ig.id, JSON.stringify(flags)]);

    // Text still mentions 450: confirmed, so it is a known fact and nothing new opens.
    const keeps = switchFixture("ig_feed", "hinglish");
    keeps.caption += "\nAaj sirf ₹450 mein.";
    const r1 = ok(await doSwitch(ig.id, "hinglish", { fixtures: { result: keeps } }));
    expect(r1.output.flags).toEqual(flags);

    // Text no longer mentions it: both flags are still there.
    const r2 = ok(await doSwitch(ig.id, "en"));
    expect(r2.output.flags).toEqual(flags);
    expect((await rowOf(postId, "ig_feed")).fact_flags).toEqual(flags);
    expect(r2.openFlags).toBe(0);
  });

  it("a claim or phone number the old text did not have is flagged", async () => {
    const postId = await newPost();
    const gbp = await rowOf(postId, "gbp");
    const result = switchFixture("gbp", "en");
    result.caption += " Free delivery. Call 98765 43210.";
    const res = ok(await doSwitch(gbp.id, "en", { fixtures: { result } }));
    const kinds = res.output.flags.map((f) => f.kind);
    expect(kinds).toContain("claim");
    expect(kinds).toContain("phone");
  });
});

describe("retry", () => {
  it("wrong_script triggers exactly one retry and records usage for each call", async () => {
    const postId = await newPost();
    const ig = await rowOf(postId, "ig_feed");
    const usageBefore = await usageKinds(brandId);
    const calls: number[] = [];
    const res = ok(
      await doSwitch(ig.id, "hinglish", {
        fixtures: { result: (attempt) => (calls.push(attempt), attempt === 0 ? switchFixture("ig_feed", "hi") : switchFixture("ig_feed", "hinglish")) },
      }),
    );
    expect(calls).toEqual([0, 1]);
    expect(res.output.caption).toBe(switchFixture("ig_feed", "hinglish").caption);
    expect((await usageKinds(brandId)).slice(usageBefore.length)).toEqual(["switch_language", "switch_language"]);
  });

  it("does not retry a second time when the problem remains", async () => {
    const postId = await newPost();
    const ig = await rowOf(postId, "ig_feed");
    const usageBefore = await usageKinds(brandId);
    spies.generateJson.mockClear();
    const res = ok(await doSwitch(ig.id, "hinglish", { fixtures: { result: switchFixture("ig_feed", "hi") } }));
    expect(spies.generateJson).toHaveBeenCalledTimes(2);
    expect(res.changed).toBe(true);
    expect((await usageKinds(brandId)).slice(usageBefore.length)).toEqual(["switch_language", "switch_language"]);
  });

  it("English words left in a Hindi result are caught even though the old English text is a source", async () => {
    const postId = await newPost();
    const ig = await rowOf(postId, "ig_feed");
    ok(await doSwitch(ig.id, "en"));
    const calls: number[] = [];
    ok(await doSwitch(ig.id, "hi", { fixtures: { result: (a) => (calls.push(a), switchFixture("ig_feed", a === 0 ? "en" : "hi")) } }));
    expect(calls).toEqual([0, 1]);
    expect((await rowOf(postId, "ig_feed")).caption).toBe(switchFixture("ig_feed", "hi").caption);
  });

  it("too_long also triggers a retry", async () => {
    const postId = await newPost();
    const status = await rowOf(postId, "status");
    const long = switchFixture("status", "hinglish");
    long.caption = "Fresh kaju katli ".repeat(20);
    const calls: number[] = [];
    ok(await doSwitch(status.id, "hinglish", { fixtures: { result: (a) => (calls.push(a), a === 0 ? long : switchFixture("status", "hinglish")) } }));
    expect(calls).toEqual([0, 1]);
  });
});

describe("speed", () => {
  it("logs the pipeline time and stays well under 10 seconds in fixture mode", async () => {
    const postId = await newPost();
    const ig = await rowOf(postId, "ig_feed");
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const res = ok(await doSwitch(ig.id, "hinglish"));
    const line = info.mock.calls.map((c) => String(c[0])).find((l) => l.startsWith("[posts] switch ok"));
    info.mockRestore();
    expect(line).toContain(`output=${ig.id}`);
    expect(line).toMatch(/hi->hinglish .*ai=\d+ms render=\d+ms total=\d+ms/);
    console.log("switch timings (fixture mode)", JSON.stringify(res.timings));
    expect(res.timings.totalMs).toBeLessThan(10_000);
    expect(res.timings.totalMs).toBeGreaterThanOrEqual(res.timings.renderMs);
  });
});
