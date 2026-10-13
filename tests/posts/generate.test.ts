import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Wrap the AI client so tests can see whether it was called. Under vitest AI is
// always in fixture mode: nothing here reaches the network.
const spies = vi.hoisted(() => ({ generateJson: vi.fn(), generateText: vi.fn() }));
vi.mock("@/lib/ai/client", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/ai/client")>();
  spies.generateJson.mockImplementation(real.generateJson);
  spies.generateText.mockImplementation(real.generateText);
  return { ...real, generateJson: spies.generateJson, generateText: spies.generateText };
});

import { aiMode } from "@/lib/ai/client";
import type { GenerateResult } from "@/lib/ai/schemas";
import { encodeWav } from "@/lib/audio/wav";
import type { MockDb } from "@/lib/db/mock";
import { fitWithin } from "@/lib/image/downscale";
import { s } from "@/lib/i18n/strings";
import { saveBrandProfile } from "@/lib/brand/profile";
import { composeShareText } from "@/lib/posts/compose";
import { POST_TRANSCRIPT_FIXTURE, generateFixture, needsInputFixture } from "@/lib/posts/fixtures";
import { flagsFromIssues, generatePost, newPostCode, type GenerateOutcome, type Stage } from "@/lib/posts/generate";
import { getReviewData } from "@/lib/posts/review";
import { samplePhoto } from "@/lib/render/fixtures";
import { createMockStorage } from "@/lib/storage/mock";
import { serveFile } from "@/lib/storage/serve";
import type { Storage } from "@/lib/storage/types";
import { closeTestDb, createBrandFor, createUser, openTestDb, validProfile } from "../brand/helpers";

let db: MockDb;
let root: string;
let storage: Storage;
let owner: string;
let outsider: string;
let brandId: string;

const usageKinds = (id: string) =>
  db
    .withAdmin((tx) => tx.query<{ kind: string }>("select kind::text from public.usage_events where brand_id = $1 order by id", [id]))
    .then((r) => r.map((x) => x.kind));

const adminRows = <T>(sql: string, params: unknown[] = []) => db.withAdmin((tx) => tx.query<T>(sql, params));

const wav = (seconds = 2) => encodeWav(new Int16Array(16000 * seconds));

function ok(o: GenerateOutcome) {
  if (!o.ok) throw new Error(`expected success, got ${o.code}: ${o.message}`);
  return o;
}

async function outputsOf(postId: string) {
  return adminRows<{
    channel: string;
    language: string;
    caption: string;
    cta: string;
    hashtags: string[];
    image_text: { headline: string };
    template_id: string | null;
    image_path: string | null;
    fact_flags: { id: string; text: string; kind: string; regulated: boolean; status: string }[];
    original: { caption: string };
  }>("select channel::text as channel, language::text as language, caption, cta, hashtags, image_text, template_id, image_path, fact_flags, original from public.outputs where post_id = $1 order by channel", [postId]);
}

async function imageSize(imagePath: string) {
  const file = await storage.get("renders", imagePath.replace(/^renders\//, ""));
  expect(file).not.toBeNull();
  const meta = await sharp(Buffer.from(file!.bytes)).metadata();
  return { width: meta.width, height: meta.height, format: meta.format };
}

beforeAll(async () => {
  expect(aiMode()).toBe("fixture");
  db = await openTestDb();
  root = await mkdtemp(path.join(os.tmpdir(), "pm-posts-"));
  storage = createMockStorage(root);
  owner = (await createUser(db)).id;
  outsider = (await createUser(db)).id;
  brandId = await createBrandFor(db, owner);
  await saveBrandProfile(owner, brandId, validProfile(), { completeSetup: { transcript: "t" } });
});
afterAll(async () => {
  await closeTestDb(db);
  await rm(root, { recursive: true, force: true });
});
beforeEach(() => {
  spies.generateJson.mockClear();
  spies.generateText.mockClear();
});

const run = (input: Parameters<typeof generatePost>[0]["input"], extra: Partial<Parameters<typeof generatePost>[0]> = {}) =>
  generatePost({ userId: owner, brandId, input, storage, ...extra });

describe("text input", () => {
  it("makes 1 post and 4 outputs with the right image sizes", async () => {
    const stages: Stage[] = [];
    const before = await usageKinds(brandId);
    const out = ok(await run({ type: "text", text: "आज ताज़ी काजू कतली आई है, 600 रुपये किलो" }, { onStage: (st) => stages.push(st) }));

    expect(stages).toEqual(["understanding", "writing", "designing"]);
    expect(out.postCode).toMatch(/^[a-z0-9]{7}$/);

    const posts = await adminRows<{ status: string; source: string; input_type: string; language: string; input_text: string; post_code: string; created_by: string }>(
      "select status::text as status, source::text as source, input_type::text as input_type, language::text as language, input_text, post_code, created_by from public.posts where id = $1",
      [out.postId],
    );
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({ status: "draft", source: "web", input_type: "text", language: "hi", post_code: out.postCode, created_by: owner });
    expect(posts[0].input_text).toContain("काजू कतली");

    const outs = await outputsOf(out.postId);
    expect(outs.map((o) => o.channel).sort()).toEqual(["facebook", "gbp", "ig_feed", "status"]);
    const by = Object.fromEntries(outs.map((o) => [o.channel, o]));
    for (const o of outs) {
      expect(o.language).toBe("hi");
      expect(o.caption.length).toBeGreaterThan(0);
      expect(o.cta.length).toBeGreaterThan(0);
      expect(o.original.caption).toBe(o.caption);
    }
    expect(await imageSize(by.ig_feed.image_path!)).toMatchObject({ width: 1080, height: 1080, format: "png" });
    expect(await imageSize(by.facebook.image_path!)).toMatchObject({ width: 1080, height: 1080 });
    expect(await imageSize(by.status.image_path!)).toMatchObject({ width: 1080, height: 1920 });
    expect(by.facebook.image_path).toBe(by.ig_feed.image_path);
    expect(by.gbp.image_path).toBeNull();
    expect(by.gbp.template_id).toBeNull();
    // No photo: text templates.
    expect(by.ig_feed.template_id).toBe("sq-text");
    expect(by.facebook.template_id).toBe("sq-text");
    expect(by.status.template_id).toBe("tl-text");
    expect(by.ig_feed.image_path).toBe(`renders/${brandId}/${out.postId}/ig_feed.png`);
    expect(by.status.image_path).toBe(`renders/${brandId}/${out.postId}/status.png`);
    // Everything in the fixture is in the owner's sources.
    expect(outs.flatMap((o) => o.fact_flags)).toEqual([]);

    // Original input kept for text posts: nothing in storage, none needed.
    const after = await usageKinds(brandId);
    expect(after.slice(before.length)).toEqual(["generate"]);
    expect(spies.generateText).not.toHaveBeenCalled();
  });

  it("logs a timing breakdown and stays well under 60 seconds", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const out = ok(await run({ type: "text", text: "ताज़ी जलेबी आज सुबह से" }));
    const line = info.mock.calls.map((c) => String(c[0])).find((l) => l.startsWith("[posts] ok"));
    info.mockRestore();
    expect(line).toContain(`post=${out.postId}`);
    expect(line).toMatch(/transcribe=\d+ms generate=\d+ms render=\d+ms total=\d+ms/);
    console.log("timings (fixture mode)", JSON.stringify(out.timings));
    expect(out.timings.totalMs).toBeLessThan(60_000);
    expect(out.timings.totalMs).toBeGreaterThanOrEqual(out.timings.renderMs);
  });

  it("follows the brand's default language", async () => {
    const other = await createBrandFor(db, owner, "English shop");
    await saveBrandProfile(owner, other, validProfile({ default_language: "en", languages: ["en"] }), { completeSetup: { transcript: "t" } });
    const out = ok(await generatePost({ userId: owner, brandId: other, input: { type: "text", text: "Fresh kaju katli today" }, storage }));
    const outs = await outputsOf(out.postId);
    expect(outs.every((o) => o.language === "en")).toBe(true);
    expect(/[ऀ-ॿ]/.test(outs.map((o) => o.caption).join(""))).toBe(false);
  });

  it("rejects empty text before creating a post", async () => {
    const before = await adminRows("select 1 from public.posts where brand_id = $1", [brandId]);
    const out = await run({ type: "text", text: "   " });
    expect(out).toMatchObject({ ok: false, code: "invalid_input", postId: null });
    expect(await adminRows("select 1 from public.posts where brand_id = $1", [brandId])).toHaveLength(before.length);
    expect(spies.generateJson).not.toHaveBeenCalled();
  });
});

describe("photo input", () => {
  it("uses the photo templates, stores the photo and sends a small copy to the model", async () => {
    const big = await samplePhoto(3200, 2400);
    const out = ok(await run({ type: "photo", bytes: big, caption: "ताज़ी काजू कतली" }));

    const [post] = await adminRows<{ input_type: string; input_text: string; input_media_path: string; photo_path: string; status: string }>(
      "select input_type::text as input_type, input_text, input_media_path, photo_path, status::text as status from public.posts where id = $1",
      [out.postId],
    );
    expect(post).toMatchObject({ input_type: "photo", status: "draft", input_text: "ताज़ी काजू कतली" });
    expect(post.input_media_path).toBe(`inputs/${brandId}/posts/${out.postId}/original.jpg`);
    expect(post.photo_path).toBe(`inputs/${brandId}/posts/${out.postId}/photo.jpg`);

    const original = await storage.get("inputs", `${brandId}/posts/${out.postId}/original.jpg`);
    expect(original).not.toBeNull();
    const stored = await storage.get("inputs", `${brandId}/posts/${out.postId}/photo.jpg`);
    const meta = await sharp(Buffer.from(stored!.bytes)).metadata();
    expect(meta.format).toBe("jpeg");
    expect(Math.max(meta.width!, meta.height!)).toBe(2048);

    const outs = Object.fromEntries((await outputsOf(out.postId)).map((o) => [o.channel, o]));
    expect(outs.ig_feed.template_id).toBe("sq-photo-band");
    expect(outs.facebook.template_id).toBe("sq-photo-band");
    expect(outs.status.template_id).toBe("tl-photo-top");
    expect(await imageSize(outs.ig_feed.image_path!)).toMatchObject({ width: 1080, height: 1080 });
    expect(await imageSize(outs.status.image_path!)).toMatchObject({ width: 1080, height: 1920 });

    // The model gets one JPEG, longest side 1024.
    const call = spies.generateJson.mock.calls[0][0] as { media: { mimeType: string; data: Buffer }[]; user: string };
    expect(call.media).toHaveLength(1);
    expect(call.media[0].mimeType).toBe("image/jpeg");
    const sent = await sharp(call.media[0].data).metadata();
    expect(Math.max(sent.width!, sent.height!)).toBe(1024);
    expect(call.user).toContain("The owner photo is attached");
  });

  it("rotates by EXIF and never enlarges small photos", async () => {
    const small = await sharp({ create: { width: 600, height: 300, channels: 3, background: "#336699" } })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();
    const out = ok(await run({ type: "photo", bytes: small }));
    const stored = await storage.get("inputs", `${brandId}/posts/${out.postId}/photo.jpg`);
    const meta = await sharp(Buffer.from(stored!.bytes)).metadata();
    expect({ w: meta.width, h: meta.height }).toEqual({ w: 300, h: 600 });
  });

  it("rejects a file that is not an image", async () => {
    const out = await run({ type: "photo", bytes: new TextEncoder().encode("not an image") });
    expect(out).toMatchObject({ ok: false, code: "invalid_input", postId: null, message: s.create.errors.invalidPhoto });
    expect(spies.generateJson).not.toHaveBeenCalled();
  });

  it("fitWithin downscales the longest side to 2048 and never enlarges", () => {
    expect(fitWithin(4000, 3000)).toEqual({ width: 2048, height: 1536 });
    expect(fitWithin(3000, 4000)).toEqual({ width: 1536, height: 2048 });
    expect(fitWithin(1000, 800)).toEqual({ width: 1000, height: 800 });
  });
});

describe("voice input", () => {
  it("transcribes, records usage and generates from a usable transcript", async () => {
    const before = await usageKinds(brandId);
    const out = ok(await run({ type: "voice", bytes: wav() }));
    const [post] = await adminRows<{ input_type: string; input_text: string; input_media_path: string }>(
      "select input_type::text as input_type, input_text, input_media_path from public.posts where id = $1",
      [out.postId],
    );
    expect(post.input_type).toBe("voice");
    expect(post.input_text).toBe(POST_TRANSCRIPT_FIXTURE);
    expect(post.input_media_path).toBe(`inputs/${brandId}/posts/${out.postId}/original.wav`);
    expect(await storage.get("inputs", `${brandId}/posts/${out.postId}/original.wav`)).not.toBeNull();
    expect((await usageKinds(brandId)).slice(before.length)).toEqual(["transcribe", "generate"]);
    expect(spies.generateText).toHaveBeenCalledTimes(1);
  });

  it("an unusable transcript ends failed with no generate call", async () => {
    for (const transcript of ["[no speech]", "", "[unclear] [unclear] kuch [unclear]"]) {
      spies.generateJson.mockClear();
      const before = await usageKinds(brandId);
      const out = await run({ type: "voice", bytes: wav() }, { fixtures: { transcript } });
      expect(out).toMatchObject({ ok: false, code: "unusable_transcript", message: s.create.errors.unusableVoice });
      expect(spies.generateJson).not.toHaveBeenCalled();
      const [post] = await adminRows<{ status: string }>("select status::text as status from public.posts where id = $1", [out.postId!]);
      expect(post.status).toBe("failed");
      expect(await outputsOf(out.postId!)).toHaveLength(0);
      expect((await usageKinds(brandId)).slice(before.length)).toEqual(["transcribe"]);
    }
  });

  it("rejects audio that is not a 16 kHz WAV before spending anything", async () => {
    const out = await run({ type: "voice", bytes: new Uint8Array(500) });
    expect(out).toMatchObject({ ok: false, code: "invalid_input", postId: null });
    expect(spies.generateText).not.toHaveBeenCalled();
  });
});

describe("model results", () => {
  it("needs_input ends failed and returns the owner message", async () => {
    const before = await usageKinds(brandId);
    const out = await run({ type: "text", text: "kuch bhi" }, { fixtures: { generate: needsInputFixture() } });
    expect(out).toMatchObject({ ok: false, code: "needs_input", message: needsInputFixture().message_to_owner });
    const [post] = await adminRows<{ status: string }>("select status::text as status from public.posts where id = $1", [out.postId!]);
    expect(post.status).toBe("failed");
    expect(await outputsOf(out.postId!)).toHaveLength(0);
    expect((await usageKinds(brandId)).slice(before.length)).toEqual(["generate"]);
    expect(spies.generateJson).toHaveBeenCalledTimes(1);
  });

  it("a price that is not in the owner's sources becomes an open fact flag", async () => {
    const fx = generateFixture("hi");
    fx.outputs.ig_feed.caption += "\nआज का ऑफ़र सिर्फ़ ₹450 में।";
    fx.outputs.gbp.caption += " हमारा नंबर 98765 43210 है।";
    const out = ok(await run({ type: "text", text: "ताज़ी काजू कतली" }, { fixtures: { generate: fx } }));
    expect(out.openFlags).toBeGreaterThanOrEqual(2);
    const by = Object.fromEntries((await outputsOf(out.postId)).map((o) => [o.channel, o]));
    const price = by.ig_feed.fact_flags.find((f) => f.text === "450");
    expect(price).toMatchObject({ kind: "price", regulated: false, status: "open" });
    expect(price!.id).toBeTruthy();
    expect(by.gbp.fact_flags.some((f) => f.kind === "phone")).toBe(true);
    expect(by.status.fact_flags).toEqual([]);
    // The text is stored as generated; flagging does not rewrite it.
    expect(by.ig_feed.caption).toContain("₹450");
  });

  it("an unsupported phrase becomes a claim flag", async () => {
    const fx = generateFixture("hinglish");
    fx.outputs.facebook.caption += " Limited stock hai, jaldi karein.";
    const out = ok(await run({ type: "text", text: "kaju katli" }, { fixtures: { generate: fx } }));
    const flags = (await outputsOf(out.postId)).flatMap((o) => o.fact_flags);
    expect(flags.some((f) => f.kind === "claim")).toBe(true);
  });

  it("wrong_script triggers exactly one regenerate, and the better result is kept", async () => {
    const before = await usageKinds(brandId);
    const calls: number[] = [];
    const out = ok(
      await run(
        { type: "text", text: "ताज़ी काजू कतली" },
        {
          fixtures: {
            generate: (attempt) => {
              calls.push(attempt);
              return attempt === 0 ? generateFixture("hinglish") : generateFixture("hi");
            },
          },
        },
      ),
    );
    expect(calls).toEqual([0, 1]);
    expect((await usageKinds(brandId)).slice(before.length)).toEqual(["generate", "regenerate"]);
    const outs = await outputsOf(out.postId);
    expect(outs.find((o) => o.channel === "ig_feed")!.caption).toContain("काजू कतली");
  });

  it("does not regenerate a second time when the problem remains", async () => {
    const before = await usageKinds(brandId);
    const out = ok(await run({ type: "text", text: "ताज़ी काजू कतली" }, { fixtures: { generate: generateFixture("en") } }));
    expect((await usageKinds(brandId)).slice(before.length)).toEqual(["generate", "regenerate"]);
    expect(spies.generateJson).toHaveBeenCalledTimes(2);
    expect((await outputsOf(out.postId))).toHaveLength(4);
  });

  it("too_long also triggers a regenerate", async () => {
    const fx = generateFixture("hi");
    fx.outputs.status.caption = "काजू कतली ".repeat(40);
    const calls: number[] = [];
    ok(await run({ type: "text", text: "x काजू कतली" }, { fixtures: { generate: (a) => (calls.push(a), a === 0 ? fx : generateFixture("hi")) } }));
    expect(calls).toEqual([0, 1]);
  });

  it("an AI failure marks the post failed with a plain message", async () => {
    spies.generateJson.mockRejectedValueOnce(new (await import("@/lib/ai/client")).AiError("call_failed", "boom"));
    const out = await run({ type: "text", text: "ताज़ी काजू कतली" });
    expect(out).toMatchObject({ ok: false, code: "ai_failed", message: s.errors.aiFailed });
    const [post] = await adminRows<{ status: string }>("select status::text as status from public.posts where id = $1", [out.postId!]);
    expect(post.status).toBe("failed");
  });
});

describe("daily cap", () => {
  it("blocks before any AI call and creates no post", async () => {
    const capped = await createBrandFor(db, owner, "Capped");
    await saveBrandProfile(owner, capped, validProfile(), { completeSetup: { transcript: "t" } });
    await adminRows("update public.brands set daily_generation_cap = 0 where id = $1", [capped]);
    const out = await generatePost({ userId: owner, brandId: capped, input: { type: "voice", bytes: wav() }, storage });
    expect(out).toMatchObject({ ok: false, code: "cap", postId: null });
    expect(out.ok === false && out.message).toContain("0");
    expect(spies.generateText).not.toHaveBeenCalled();
    expect(spies.generateJson).not.toHaveBeenCalled();
    expect(await adminRows("select 1 from public.posts where brand_id = $1", [capped])).toHaveLength(0);
    expect(await usageKinds(capped)).toEqual([]);
  });
});

describe("access", () => {
  let postId: string;
  beforeAll(async () => {
    postId = ok(await run({ type: "text", text: "ताज़ी काजू कतली" })).postId;
  });

  it("another user cannot read the post or its outputs, and the review page logic finds nothing", async () => {
    const seen = await db.withUser(outsider, async (tx) => ({
      posts: await tx.query("select id from public.posts where id = $1", [postId]),
      outputs: await tx.query("select id from public.outputs where post_id = $1", [postId]),
    }));
    expect(seen.posts).toHaveLength(0);
    expect(seen.outputs).toHaveLength(0);

    expect(await getReviewData(outsider, postId)).toBeNull();
    expect(await getReviewData(owner, "not-a-uuid")).toBeNull();
    expect(await getReviewData(owner, "00000000-0000-4000-8000-000000000000")).toBeNull();

    const mine = await getReviewData(owner, postId);
    expect(mine).not.toBeNull();
    expect(mine!.language).toBe("hi");
    expect(mine!.outputs.map((o) => o.channel)).toEqual(["ig_feed", "status", "facebook", "gbp"]);
    expect(mine!.outputs[0].shareText).toContain(`/r/${mine!.postCode}`);
  });

  it("an outsider cannot start a post in someone else's brand", async () => {
    const out = await generatePost({ userId: outsider, brandId, input: { type: "text", text: "hello" }, storage });
    expect(out).toMatchObject({ ok: false, code: "no_brand", postId: null });
  });

  it("an outsider gets a 404 for the rendered images", async () => {
    const data = (await getReviewData(owner, postId))!;
    const segments = data.outputs[0].imagePath!.split("/");
    const bucket = segments.shift()!;
    const own = await serveFile({ userId: owner, bucket, segments, storage });
    expect(own.status).toBe(200);
    expect(own.headers.get("Content-Type")).toBe("image/png");
    const other = await serveFile({ userId: outsider, bucket, segments, storage });
    expect(other.status).toBe(404);
  });
});

describe("helpers", () => {
  it("newPostCode is 7 characters from a-z0-9", () => {
    for (let i = 0; i < 200; i++) expect(newPostCode()).toMatch(/^[a-z0-9]{7}$/);
    expect(new Set(Array.from({ length: 50 }, newPostCode)).size).toBe(50);
  });

  it("flagsFromIssues maps number, phrase and contact issues for the right channel", () => {
    const issues = [
      { channel: "ig_feed", field: "caption", code: "unsupported_number", detail: "450" },
      { channel: "ig_feed", field: "image_text.subline", code: "unsupported_number", detail: "450" },
      { channel: "ig_feed", field: "caption", code: "unsupported_phrase", detail: "guarantee" },
      { channel: "ig_feed", field: "caption", code: "contact_detail", detail: "98765 43210" },
      { channel: "ig_feed", field: "caption", code: "too_long", detail: "700 > 600" },
      { channel: "gbp", field: "caption", code: "unsupported_number", detail: "99" },
    ] as const;
    const flags = flagsFromIssues([...issues], "ig_feed", true);
    expect(flags.map((f) => [f.kind, f.text])).toEqual([
      ["price", "450"],
      ["claim", "guarantee"],
      ["phone", "98765 43210"],
    ]);
    expect(flags.every((f) => f.regulated && f.status === "open")).toBe(true);
  });
});

describe("composeShareText", () => {
  const out = { caption: "ताज़ी काजू कतली 🍬", cta: "ऑर्डर के लिए WhatsApp करें", hashtags: ["#IndoreSweets", "#KajuKatli"] };

  it("joins caption, CTA with the short link, and hashtags", () => {
    expect(composeShareText(out, "abc1234", "https://postmitra.app")).toBe(
      "ताज़ी काजू कतली 🍬\n\nऑर्डर के लिए WhatsApp करें https://postmitra.app/r/abc1234\n\n#IndoreSweets #KajuKatli",
    );
  });

  it("leaves out the hashtag block when there are none", () => {
    expect(composeShareText({ ...out, hashtags: [] }, "abc1234", "https://postmitra.app/")).toBe(
      "ताज़ी काजू कतली 🍬\n\nऑर्डर के लिए WhatsApp करें https://postmitra.app/r/abc1234",
    );
  });

  it("uses NEXT_PUBLIC_APP_URL by default", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://example.test");
    expect(composeShareText(out, "zzz9999")).toContain("https://example.test/r/zzz9999");
    vi.unstubAllEnvs();
  });
});

describe("generate result contract", () => {
  it("the fixtures are valid for every language", async () => {
    const { generateResultSchema } = await import("@/lib/ai/schemas");
    for (const l of ["hi", "hinglish", "en"] as const) {
      const r: GenerateResult = generateFixture(l);
      expect(generateResultSchema.safeParse(r).success).toBe(true);
    }
  });
});
