import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Every model call answers with a cost of $0.001 (the fixture answer is still used), and is counted.
const fake = vi.hoisted(() => ({ calls: 0, logged: [] as Array<unknown> }));
vi.mock("@/lib/ai/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/client")>();
  const stats = { model: "test", ms: 1, inputTokens: 1, outputTokens: 1, usd: 0.001 };
  return {
    ...actual,
    generateJson: async (args: Parameters<typeof actual.generateJson>[0]) => {
      fake.calls += 1;
      fake.logged.push(args.logContext);
      return { ...(await actual.generateJson(args)), stats };
    },
    generateText: async (args: Parameters<typeof actual.generateText>[0]) => {
      fake.calls += 1;
      fake.logged.push(args.logContext);
      return { ...(await actual.generateText(args)), stats };
    },
  };
});

import { rewritePost } from "@/lib/approvals/ops";
import type { MockDb } from "@/lib/db/mock";
import { samplePhoto } from "@/lib/render/fixtures";
import { addPastPostScreenshot, addPastPostText } from "@/lib/uploads/past-posts";
import { addPhoto } from "@/lib/uploads/photos";
import { refreshVoice } from "@/lib/uploads/voice";
import { readWebsiteFacts } from "@/lib/website/extract";
import { generateWeek } from "@/lib/weekly/generate";
import { closeTestDb, openTestDb } from "../brand/helpers";
import { LOCAL_ENV, serveSite, type TestServer } from "../website/site-server";
import { seedWeeklyBrand, tempStorage } from "../weekly/helpers";

const WEEK = "2026-12-21";
const NOW = new Date("2026-12-21T08:00:00Z");

let db: MockDb;
let store: Awaited<ReturnType<typeof tempStorage>>;
let server: TestServer;
beforeAll(async () => {
  db = await openTestDb();
  store = await tempStorage();
  server = await serveSite("corner-bakery");
}, 120_000);
afterAll(async () => {
  await server.close();
  await closeTestDb(db);
  await store.cleanup();
});

const events = (brandId: string) =>
  db.withAdmin((tx) => tx.query<{ kind: string; usd: string }>("select kind::text as kind, usd from public.usage_events where brand_id = $1 order by id", [brandId]));
const batchUsd = async (batchId: string) => Number((await db.withAdmin((tx) => tx.query<{ usd: string }>("select usd from public.weekly_batches where id = $1", [batchId])))[0].usd);

describe("every AI call site records the cost it was given (Req 23, AC 23)", () => {
  it("generate, rewrite, website read and uploads: each usage event has usd 0.001 and the sum is right", async () => {
    const { brandId, userId } = await seedWeeklyBrand(db, { photos: 1, storage: store.storage });
    fake.calls = 0;
    fake.logged.length = 0;

    // 1. The weekly batch: the batch call and its fact check. The cost lands on the batch.
    const week = await generateWeek({ brandId, weekStart: WEEK, trigger: "cron" }, { now: NOW, storage: store.storage });
    if (week.status !== "ready") throw new Error("expected ready");
    expect((await events(brandId)).map((e) => e.kind)).toEqual(["weekly_batch", "fact_check"]);
    expect(await batchUsd(week.batchId)).toBeCloseTo(0.002, 6);

    // 2. An owner rewrite: the rewrite call and its fact check. Their cost is added to the post's batch.
    const rw = await rewritePost(
      { brandId, postId: week.posts[0].id, actor: { via: "dashboard", userId }, instruction: "Shorter please" },
      { storage: store.storage, now: NOW },
    );
    expect(rw.ok).toBe(true);
    expect(await batchUsd(week.batchId)).toBeCloseTo(0.004, 6);

    // 3. A website read.
    await readWebsiteFacts({ userId, brandId, url: `${server.origin}/`, options: { fetch: LOCAL_ENV } });

    // 4. Uploads: a photo description, a screenshot, and a voice refresh from the past posts.
    await addPhoto({ userId, brandId, bytes: await samplePhoto(800, 600), mimeType: "image/jpeg", storage: store.storage });
    await addPastPostScreenshot({ userId, brandId, bytes: await samplePhoto(500, 500), mimeType: "image/jpeg", storage: store.storage });
    await addPastPostText({ userId, brandId, text: "Fresh sourdough from our oven every morning, come and say hello." });
    expect(await refreshVoice({ userId, brandId, debounceMs: 0 })).toMatchObject({ status: "updated" });

    const all = await events(brandId);
    expect(all.map((e) => e.kind)).toEqual([
      "weekly_batch",
      "fact_check",
      "rewrite",
      "fact_check",
      "website_read",
      "upload_extract", // photo description
      "upload_extract", // screenshot
      "upload_extract", // voice refresh
    ]);
    // One event per model call, none at zero, and the sum is what the calls cost.
    expect(all).toHaveLength(fake.calls);
    expect(all.every((e) => Number(e.usd) === 0.001)).toBe(true);
    const [sum] = await db.withAdmin((tx) => tx.query<{ usd: string }>("select sum(usd) as usd from public.usage_events where brand_id = $1", [brandId]));
    expect(Number(sum.usd)).toBeCloseTo(0.001 * fake.calls, 9);

    // Every call carries the brand in its log context (no other fields).
    expect(fake.logged.every((c) => (c as { brandId?: string } | undefined)?.brandId === brandId)).toBe(true);
  });

  it("the batch shows the full cost: the batch, its fact check and each later rewrite with its fact check", async () => {
    const { brandId, userId } = await seedWeeklyBrand(db, { photos: 1, storage: store.storage });
    const week = await generateWeek({ brandId, weekStart: WEEK, trigger: "cron" }, { now: NOW, storage: store.storage });
    if (week.status !== "ready") throw new Error("expected ready");
    for (const [i, expected] of [0.004, 0.006].entries()) {
      const r = await rewritePost(
        { brandId, postId: week.posts[i].id, actor: { via: "dashboard", userId }, instruction: "Warmer please" },
        { storage: store.storage, now: NOW },
      );
      expect(r.ok).toBe(true);
      expect(await batchUsd(week.batchId)).toBeCloseTo(expected, 6);
    }
  });
});
