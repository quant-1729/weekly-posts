import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Records every model call, then calls the real function (fixture mode).
const seen = vi.hoisted(() => ({ calls: [] as Array<Record<string, unknown>> }));
vi.mock("@/lib/ai/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/client")>();
  return {
    ...actual,
    generateJson: (args: Record<string, unknown>) => {
      seen.calls.push(args);
      return (actual.generateJson as (a: unknown) => unknown)(args);
    },
  };
});

import { rewritePost } from "@/lib/approvals/ops";
import type { MockDb } from "@/lib/db/mock";
import { AI_UNCHECKED_TEXT, runGuardrail } from "@/lib/guardrail";
import { describeMemoryError } from "@/lib/memory/errors";
import { samplePhoto } from "@/lib/render/fixtures";
import { describeUploadError } from "@/lib/uploads/errors";
import { addPastPostScreenshot, addPastPostText } from "@/lib/uploads/past-posts";
import { addPhoto } from "@/lib/uploads/photos";
import { refreshVoice } from "@/lib/uploads/voice";
import type { UsageKind } from "@/lib/usage";
import { NON_BATCH_USD_CAP, WEEKLY_BATCH_RUNS, WEEKLY_FACT_CHECKS, WEEKLY_REWRITES, WEEKLY_UPLOAD_EXTRACTS, WEEKLY_WEBSITE_READS, WeeklyCapError } from "@/lib/usage/caps";
import { readWebsiteFacts } from "@/lib/website/extract";
import { fixtureFactCheck } from "@/lib/weekly/fixtures";
import { generateWeek } from "@/lib/weekly/generate";
import { freshWeek } from "../approvals/helpers";
import { closeTestDb, openTestDb } from "../brand/helpers";
import { LOCAL_ENV, serveSite, type TestServer } from "../website/site-server";
import { seedWeeklyBrand, tempStorage } from "../weekly/helpers";

const WEEK = "2026-12-21";
const NOW = new Date("2026-12-22T10:00:00Z"); // Tuesday of the London week of 21 Dec

let db: MockDb;
let store: Awaited<ReturnType<typeof tempStorage>>;
beforeAll(async () => {
  db = await openTestDb();
  store = await tempStorage();
}, 120_000);
afterAll(async () => {
  await closeTestDb(db);
  await store.cleanup();
});

async function eventAt(brandId: string, kind: UsageKind, usd = 0, n = 1): Promise<void> {
  for (let i = 0; i < n; i++) {
    await db.withAdmin((tx) =>
      tx.query("insert into public.usage_events (brand_id, kind, usd, created_at) values ($1, $2::public.usage_kind, $3, '2026-12-22T09:00:00Z')", [brandId, kind, usd]),
    );
  }
}
const modelCalls = () => seen.calls.length;

describe("the weekly batch (scheduled and regenerated)", () => {
  it("is refused when the week already has 4 batch runs, and the failure says so", async () => {
    const { brandId } = await seedWeeklyBrand(db, { photos: 1, storage: store.storage });
    await eventAt(brandId, "weekly_batch", 0, WEEKLY_BATCH_RUNS);
    seen.calls.length = 0;
    const res = await generateWeek({ brandId, weekStart: WEEK, trigger: "cron" }, { now: NOW, storage: store.storage });
    expect(res.status).toBe("failed");
    if (res.status === "failed") expect(res.error).toBe("You've used this week's post sets. They reset on Monday.");
    expect(modelCalls()).toBe(0);
  });

  it("runs at $0.45 (the reserve is for it) but not at $0.50", async () => {
    const a = await seedWeeklyBrand(db, { photos: 1, storage: store.storage });
    await eventAt(a.brandId, "setup", 0.45);
    expect((await generateWeek({ brandId: a.brandId, weekStart: WEEK, trigger: "cron" }, { now: NOW, storage: store.storage })).status).toBe("ready");

    const b = await seedWeeklyBrand(db, { photos: 1, storage: store.storage });
    await eventAt(b.brandId, "setup", 0.5);
    const res = await generateWeek({ brandId: b.brandId, weekStart: WEEK, trigger: "cron" }, { now: NOW, storage: store.storage });
    expect(res.status).toBe("failed");
    if (res.status === "failed") expect(res.error).toBe("You've reached this week's limit for AI help. It resets on Monday.");
  });

  it("its own fact check still runs when the week's money is almost used (count only)", async () => {
    const { brandId } = await seedWeeklyBrand(db, { photos: 1, storage: store.storage });
    await eventAt(brandId, "setup", 0.49);
    const res = await generateWeek({ brandId, weekStart: WEEK, trigger: "cron" }, { now: NOW, storage: store.storage });
    expect(res.status).toBe("ready");
    if (res.status !== "ready") return;
    const flags = res.posts.flatMap((p) => p.flags);
    expect(flags.some((f) => f.text === AI_UNCHECKED_TEXT)).toBe(false); // the AI check ran
  });
});

describe("rewrite", () => {
  it("is refused with the weekly message after 15 rewrites, before any model call, and nothing changes", async () => {
    const w = await freshWeek(db, store.storage);
    await eventAt(w.brandId, "rewrite", 0, WEEKLY_REWRITES);
    seen.calls.length = 0;
    const r = await rewritePost({ brandId: w.brandId, postId: w.postIds[0], actor: { via: "dashboard", userId: w.userId }, instruction: "Shorter please" }, { storage: store.storage, now: NOW });
    expect(r).toMatchObject({ ok: false, code: "cap", message: "You've used this week's rewrites. They reset on Monday." });
    expect(modelCalls()).toBe(0);
  });

  it("is refused once $0.40 is spent, and the week's last rewrite still goes through just under it", async () => {
    const w = await freshWeek(db, store.storage);
    const ref = { brandId: w.brandId, postId: w.postIds[0], actor: { via: "dashboard" as const, userId: w.userId }, instruction: "Shorter please" };
    await eventAt(w.brandId, "setup", NON_BATCH_USD_CAP - 0.02);
    expect((await rewritePost(ref, { storage: store.storage, now: NOW })).ok).toBe(true);
    await eventAt(w.brandId, "setup", 0.02);
    expect(await rewritePost(ref, { storage: store.storage, now: NOW })).toMatchObject({
      ok: false,
      code: "cap",
      message: "You've reached this week's limit for AI help. It resets on Monday.",
    });
  });
});

describe("guardrail fact check", () => {
  it("counts against 30 a week; past that the posts get the 'facts not checked' flag, never a silent pass", async () => {
    const { brandId, userId } = await seedWeeklyBrand(db, { photos: 0 });
    const post = { channel: "instagram" as const, caption: "Fresh bread every morning.", cta: "Message us", hashtags: ["#bread"], image_text: { headline: "Fresh bread", subline: "" } };
    const ok = await runGuardrail({ userId, brandId, posts: [post], now: NOW, weekStart: WEEK, aiFixture: () => fixtureFactCheck([post]) });
    expect(ok[0].aiChecked).toBe(true);
    await eventAt(brandId, "fact_check", 0, WEEKLY_FACT_CHECKS);
    const blocked = await runGuardrail({ userId, brandId, posts: [post], now: NOW, weekStart: WEEK, aiFixture: () => fixtureFactCheck([post]) });
    expect(blocked[0].aiChecked).toBe(false);
    expect(blocked[0].flags.some((f) => f.text === AI_UNCHECKED_TEXT && f.status === "open")).toBe(true);
  });
});

describe("website read and uploads", () => {
  let server: TestServer;
  beforeAll(async () => {
    server = await serveSite("corner-bakery");
  });
  afterAll(async () => {
    await server.close();
  });

  it("the 4th website read of a week is refused with a plain message, and the model is not called", async () => {
    const { brandId, userId } = await seedWeeklyBrand(db, { photos: 0 });
    await eventAt(brandId, "website_read", 0, WEEKLY_WEBSITE_READS);
    seen.calls.length = 0;
    // The real clock is "now" for the site read; the events are placed in the week of the real clock.
    await db.withAdmin((tx) => tx.query("update public.usage_events set created_at = now() where brand_id = $1", [brandId]));
    const err = await readWebsiteFacts({ userId, brandId, url: `${server.origin}/`, options: { fetch: LOCAL_ENV } }).catch((e) => e);
    expect(err).toBeInstanceOf(WeeklyCapError);
    expect(err.message).toBe("You've used this week's website reads. They reset on Monday.");
    expect(modelCalls()).toBe(0);
    expect(describeMemoryError(err)).toMatchObject({ ok: false, code: "cap", message: err.message });
  });

  it("uploads: a photo is kept without a description, a screenshot is refused, and the voice refresh keeps the saved voice", async () => {
    const { brandId, userId } = await seedWeeklyBrand(db, { photos: 0 });
    await db.withAdmin((tx) => tx.query("update public.brands set daily_generation_cap = 1000 where id = $1", [brandId])); // the daily limit is not under test
    await eventAt(brandId, "upload_extract", 0, WEEKLY_UPLOAD_EXTRACTS);
    await db.withAdmin((tx) => tx.query("update public.usage_events set created_at = now() where brand_id = $1", [brandId]));
    seen.calls.length = 0;

    const { photo } = await addPhoto({ userId, brandId, bytes: await samplePhoto(800, 600), mimeType: "image/jpeg", storage: store.storage });
    expect(photo.description).toBeNull();

    const err = await addPastPostScreenshot({ userId, brandId, bytes: await samplePhoto(500, 500), mimeType: "image/jpeg", storage: store.storage }).catch((e) => e);
    expect(err).toBeInstanceOf(WeeklyCapError);
    expect(describeUploadError(err)).toEqual({ code: "cap", message: "You've used this week's photo and screenshot reads. They reset on Monday." });

    await addPastPostText({ userId, brandId, text: "Fresh sourdough from our oven every morning, come and say hello." });
    expect(await refreshVoice({ userId, brandId, debounceMs: 0 })).toMatchObject({ status: "failed" });
    expect(modelCalls()).toBe(0);
  });
});
