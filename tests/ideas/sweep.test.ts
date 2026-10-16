import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { MockDb } from "@/lib/db/mock";
import { saveResearchSettings } from "@/lib/ideas/competitors";
import { runResearchSweep } from "@/lib/ideas/sweep";
import { NOW, baseDeps, closeDb, groundedAnswer, makeShop, openDb, rows, scriptedAi, simpleCard } from "./helpers";
import { seedRun } from "./seed";

let db: MockDb;
beforeAll(async () => {
  db = await openDb();
});
afterAll(async () => {
  await closeDb(db);
});

const web = (q: string) => ({ q, source: "web" as const, why: "trend" });
const script = () =>
  scriptedAi({
    plan: [web("autumn bakes")],
    grounded: (q) => groundedAnswer(`Trend for ${q}`, `Note about ${q}.`, "2026-10-12", `https://news.example.com/${encodeURIComponent(q)}`),
    cards: (findings) => findings.slice(0, 1).map((f) => simpleCard([f.id])),
  });
const runsOf = (brandId: string) => rows<{ trigger: string; status: string }>(db, "select trigger, status from public.research_runs where brand_id = $1 order by started_at", [brandId]);

describe("the weekly research sweep (R-7)", () => {
  it("runs the brands that have research on and setup done, and skips the others", async () => {
    const on = await makeShop(db);
    const off = await makeShop(db);
    const unfinished = await makeShop(db);
    await saveResearchSettings(off.userId, off.brandId, { focus: null, on: false });
    await rows(db, "update public.brand_memory set setup_completed_at = null where brand_id = $1", [unfinished.brandId]);
    // Keep only these three as candidates by making sure no other brand is in the database.
    const { ai, rec } = script();
    const summary = await runResearchSweep({ now: NOW, deps: baseDeps(ai) });

    expect(summary).toMatchObject({ eligible: 1, alreadyRan: 0, started: 1, done: 1, failed: 0, capped: 0, deferred: 0 });
    expect(rec.planCalls).toBe(1);
    expect(await runsOf(on.brandId)).toEqual([{ trigger: "weekly", status: "done" }]);
    expect(await runsOf(off.brandId)).toEqual([]);
    expect(await runsOf(unfinished.brandId)).toEqual([]);
    // Cards were saved but no post, brief or queue item was made.
    const [c] = await rows<{ cards: number; briefs: number; posts: number; items: number }>(
      db,
      `select (select count(*)::int from public.trend_cards where brand_id = $1) as cards, (select count(*)::int from public.post_briefs where brand_id = $1) as briefs,
              (select count(*)::int from public.posts where brand_id = $1) as posts, (select count(*)::int from public.queue_items where brand_id = $1) as items`,
      [on.brandId],
    );
    expect(c).toEqual({ cards: 1, briefs: 0, posts: 0, items: 0 });
  });

  it("is idempotent: a repeated or late call the same week runs nothing again and spends nothing", async () => {
    const shop = await makeShop(db);
    const { ai, rec } = script();
    const first = await runResearchSweep({ now: NOW, deps: baseDeps(ai) });
    expect(first.items.map((i) => i.brandId)).toContain(shop.brandId);
    const planned = rec.planCalls;
    const second = await runResearchSweep({ now: new Date(NOW.getTime() + 3 * 86_400_000), deps: baseDeps(ai) });
    expect(second.started).toBe(0);
    expect(second.alreadyRan).toBeGreaterThanOrEqual(1);
    expect(rec.planCalls).toBe(planned);
    expect((await runsOf(shop.brandId)).filter((r) => r.trigger === "weekly")).toHaveLength(1);
    // The next week it runs again.
    const next = await runResearchSweep({ now: new Date(NOW.getTime() + 7 * 86_400_000), deps: baseDeps(ai) });
    expect(next.started).toBeGreaterThanOrEqual(1);
    expect((await runsOf(shop.brandId)).filter((r) => r.trigger === "weekly")).toHaveLength(2);
  });

  it("does not retry a brand whose weekly run was capped this week, but does retry one that failed", async () => {
    const capped = await makeShop(db);
    const failed = await makeShop(db);
    await seedRun(db, capped.brandId, { trigger: "weekly", status: "capped", error: "research_cap", costUsd: 0, startedAt: new Date(NOW.getTime() - 3_600_000) });
    await seedRun(db, failed.brandId, { trigger: "weekly", status: "failed", error: "ai_timeout", costUsd: 0, startedAt: new Date(NOW.getTime() - 3_600_000) });
    const run = vi.fn(async () => null);
    const summary = await runResearchSweep({ now: NOW, run: run as never });
    const called = (run.mock.calls as unknown as Array<[{ brandId: string; trigger: string; service: boolean }]>).map((c) => c[0]);
    expect(called.map((c) => c.brandId)).toContain(failed.brandId);
    expect(called.map((c) => c.brandId)).not.toContain(capped.brandId);
    expect(called.every((c) => c.trigger === "weekly" && c.service === true)).toBe(true);
    expect(summary.alreadyRan).toBeGreaterThanOrEqual(1);
  });

  it("keeps to the batch limit and the time budget; the brands left over are deferred", async () => {
    for (let i = 0; i < 3; i++) await makeShop(db);
    const run = vi.fn(async () => ({ status: "done", error: null }));
    const limited = await runResearchSweep({ now: NOW, limit: 2, concurrency: 1, run: run as never });
    expect(limited.started).toBe(2);
    expect(limited.deferred).toBeGreaterThanOrEqual(1);

    const none = vi.fn(async () => ({ status: "done", error: null }));
    const timed = await runResearchSweep({ now: NOW, budgetMs: 0, run: none as never });
    expect(none).not.toHaveBeenCalled();
    expect(timed.started).toBe(0);
    expect(timed.deferred).toBeGreaterThanOrEqual(1);
  });

  it("one brand failing does not stop the others, and the summary holds no owner text", async () => {
    let calls = 0;
    const run = vi.fn(async (a: { brandId: string }) => {
      if (calls++ === 0) throw new Error("Corner Bakery secret focus text");
      return { status: calls === 2 ? "failed" : "capped", error: calls === 2 ? "ai_timeout" : "research_cap", brandId: a.brandId };
    });
    const summary = await runResearchSweep({ now: new Date(NOW.getTime() + 21 * 86_400_000), concurrency: 1, limit: 3, run: run as never });
    expect(summary.started).toBe(3);
    expect(summary.failed).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(summary)).not.toContain("secret focus text");
    expect(summary.items.map((i) => i.outcome)).toContain("error");
  });
});
