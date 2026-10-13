import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// H-2: a model call that answered but whose output was unusable (or a step after it failed) still cost
// money. The model calls here throw an AiError that carries the stats of the attempts that answered,
// the way the real client does, and every call site must record that cost.
const plan = vi.hoisted(() => ({
  /** zod schema of the call that fails -> the stats its error carries; null = nothing fails */
  failing: null as { schema: unknown; stats: Array<{ usd: number }>; times: number } | null,
}));
vi.mock("@/lib/ai/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/client")>();
  return {
    ...actual,
    generateJson: async (args: Parameters<typeof actual.generateJson>[0]) => {
      const f = plan.failing;
      if (f && args.zodSchema === f.schema && f.times > 0) {
        f.times -= 1;
        throw new actual.AiError(
          "invalid_output",
          "Model output did not match schema",
          f.stats.map((s) => ({ model: "test", ms: 1, inputTokens: 1, outputTokens: 1, usd: s.usd })),
        );
      }
      const res = await actual.generateJson(args);
      return { ...res, stats: { model: "test", ms: 1, inputTokens: 1, outputTokens: 1, usd: 0.001 } };
    },
  };
});

import { mascotConceptsSchema } from "@/lib/ai/schemas";
import { photoDescribeSchema, rewriteSchema, reviewReplySchema, v2FactCheckSchema, weeklyBatchSchema } from "@/lib/ai/schemas-v2";
import { rewritePost } from "@/lib/approvals/ops";
import type { MockDb } from "@/lib/db/mock";
import { createMockDb, setMockDbForTests } from "@/lib/db/mock";
import { generateMascotConcepts } from "@/lib/mascot/service";
import { samplePhoto } from "@/lib/render/fixtures";
import { ReviewReplyAiError, draftReviewReply } from "@/lib/reviews/reply";
import { addPhoto } from "@/lib/uploads/photos";
import { failedCallUsd } from "@/lib/usage";
import { generateWeek } from "@/lib/weekly/generate";
import { dashActor, freshWeek, refOf, type FreshWeek } from "../approvals/helpers";
import { seedWeeklyBrand, tempStorage } from "../weekly/helpers";

const WEEK = "2026-12-21";
const NOW = new Date("2026-12-21T08:00:00Z");

let db: MockDb;
let store: Awaited<ReturnType<typeof tempStorage>>;
beforeAll(async () => {
  db = await createMockDb();
  setMockDbForTests(db);
  store = await tempStorage();
}, 120_000);
afterAll(async () => {
  setMockDbForTests(null);
  await db.close();
  await store.cleanup();
});
beforeEach(() => {
  plan.failing = null;
});

const fail = (schema: unknown, usds: number[], times = 99) => {
  plan.failing = { schema, stats: usds.map((usd) => ({ usd })), times };
};
const events = async (brandId: string) =>
  (await db.withAdmin((tx) => tx.query<{ kind: string; usd: string }>("select kind::text as kind, usd from public.usage_events where brand_id = $1 order by id", [brandId]))).map(
    (e) => ({ kind: e.kind, usd: Number(e.usd) }),
  );
const batchUsd = async (batchId: string) => Number((await db.withAdmin((tx) => tx.query<{ usd: string }>("select usd from public.weekly_batches where id = $1", [batchId])))[0].usd);

describe("failedCallUsd", () => {
  it("sums the attempts that answered, and is 0 for any other error", async () => {
    const { AiError } = await import("@/lib/ai/client");
    const stat = (usd: number) => ({ model: "m", ms: 1, inputTokens: 1, outputTokens: 1, usd });
    expect(failedCallUsd(new AiError("invalid_output", "x", [stat(0.004), stat(0.006)]))).toBeCloseTo(0.01, 9);
    expect(failedCallUsd(new AiError("call_failed", "x"))).toBe(0);
    expect(failedCallUsd(new Error("x"))).toBe(0);
    expect(failedCallUsd("x")).toBe(0);
  });
});

describe("weekly generation costs the calls that answered but failed", () => {
  it("a run whose two batch calls both fail validation records one weekly_batch event with the sum", async () => {
    const { brandId } = await seedWeeklyBrand(db, { photos: 1, storage: store.storage });
    fail(weeklyBatchSchema, [0.004, 0.006]); // each call: two answers, 0.01
    const res = await generateWeek({ brandId, weekStart: WEEK, trigger: "cron" }, { now: NOW, storage: store.storage });
    expect(res.status).toBe("failed");
    if (res.status !== "failed") return;
    // One event for the run (it counts as one batch run against the weekly limit), with all four answers.
    const all = await events(brandId);
    expect(all).toHaveLength(1);
    expect(all[0].kind).toBe("weekly_batch");
    expect(all[0].usd).toBeCloseTo(0.02, 9);
    expect(res.usd).toBeCloseTo(0.02, 9);
    expect(await batchUsd(res.batchId)).toBeCloseTo(0.02, 9);
  });

  it("a failed first call plus a good second call is one event: the lost cost plus the good call", async () => {
    const { brandId } = await seedWeeklyBrand(db, { photos: 1, storage: store.storage });
    fail(weeklyBatchSchema, [0.01], 1);
    const res = await generateWeek({ brandId, weekStart: WEEK, trigger: "cron" }, { now: NOW, storage: store.storage });
    expect(res.status).toBe("ready");
    const batchEvents = (await events(brandId)).filter((e) => e.kind === "weekly_batch");
    expect(batchEvents).toHaveLength(1);
    expect(batchEvents[0].usd).toBeCloseTo(0.011, 9);
  });

  it("a failed fact check is recorded as a fact_check event with its stats", async () => {
    const { brandId } = await seedWeeklyBrand(db, { photos: 1, storage: store.storage });
    fail(v2FactCheckSchema, [0.003, 0.002]);
    await generateWeek({ brandId, weekStart: WEEK, trigger: "cron" }, { now: NOW, storage: store.storage });
    const lost = (await events(brandId)).filter((e) => e.kind === "fact_check");
    expect(lost.length).toBeGreaterThan(0);
    expect(lost[0].usd).toBeCloseTo(0.005, 9);
  });

  it("a failed automatic rewrite is recorded as auto_rewrite with its stats, and the week still finishes", async () => {
    const { brandId } = await seedWeeklyBrand(db, { photos: 1, storage: store.storage, wordsToAvoid: ["tasting"] });
    fail(rewriteSchema, [0.002, 0.003]);
    const res = await generateWeek({ brandId, weekStart: WEEK, trigger: "cron" }, { now: NOW, storage: store.storage });
    expect(res.status).toBe("ready");
    const all = await events(brandId);
    expect(all.filter((e) => e.kind === "rewrite")).toEqual([]);
    expect(all.filter((e) => e.kind === "auto_rewrite").map((e) => e.usd)).toEqual([0.005]);
  });
});

describe("other call sites record the stats of a failed call", () => {
  it("an owner rewrite that fails is recorded as rewrite and added to the batch", async () => {
    const w: FreshWeek = await freshWeek(db, store.storage);
    const [before] = await db.withAdmin((tx) => tx.query<{ usd: string; id: string }>("select b.usd, b.id::text as id from public.weekly_batches b join public.posts p on p.batch_id = b.id where p.id = $1", [w.postIds[0]]));
    const eventsBefore = (await events(w.brandId)).length;
    fail(rewriteSchema, [0.004, 0.006]);
    const r = await rewritePost({ ...refOf(w, 0, dashActor(w.userId)), instruction: "Shorter please" }, { storage: store.storage, now: NOW });
    expect(r.ok).toBe(false);
    const added = (await events(w.brandId)).slice(eventsBefore);
    expect(added).toHaveLength(1);
    expect(added[0].kind).toBe("rewrite");
    expect(added[0].usd).toBeCloseTo(0.01, 9);
    expect(await batchUsd(before.id)).toBeCloseTo(Number(before.usd) + 0.01, 9);
  });

  it("a review reply that fails is recorded as review_reply", async () => {
    const { userId, brandId } = await seedWeeklyBrand(db, {});
    fail(reviewReplySchema, [0.002, 0.002]);
    await expect(draftReviewReply({ userId, brandId, review: "Lovely bread, friendly staff." })).rejects.toBeInstanceOf(ReviewReplyAiError);
    const all = await events(brandId);
    expect(all).toHaveLength(1);
    expect(all[0].kind).toBe("review_reply");
    expect(all[0].usd).toBeCloseTo(0.004, 9);
  });

  it("a photo description that fails is recorded as upload_extract and the photo is kept", async () => {
    const { userId, brandId } = await seedWeeklyBrand(db, {});
    fail(photoDescribeSchema, [0.001, 0.002]);
    await addPhoto({ userId, brandId, bytes: await samplePhoto(800, 600), mimeType: "image/jpeg", storage: store.storage });
    const all = await events(brandId);
    expect(all).toHaveLength(1);
    expect(all[0].kind).toBe("upload_extract");
    expect(all[0].usd).toBeCloseTo(0.003, 9);
    expect(await db.withAdmin((tx) => tx.query("select 1 from public.photos where brand_id = $1 and kind = 'photo'", [brandId]))).toHaveLength(1);
  });

  it("a mascot run whose calls fail is recorded as one mascot event with the sum", async () => {
    const { userId, brandId } = await seedWeeklyBrand(db, {});
    fail(mascotConceptsSchema, [0.003, 0.004]);
    await expect(generateMascotConcepts({ userId, brandId })).rejects.toBeTruthy();
    const all = await events(brandId);
    expect(all).toHaveLength(1);
    expect(all[0].kind).toBe("mascot");
    expect(all[0].usd).toBeCloseTo(0.007, 9);
  });
});
