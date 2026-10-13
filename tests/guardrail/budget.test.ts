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

import type { MockDb } from "@/lib/db/mock";
import { checkPostsAi, runGuardrail } from "@/lib/guardrail";
import { fixtureFactCheck } from "@/lib/weekly/fixtures";
import { closeTestDb, openTestDb } from "../brand/helpers";
import { seedWeeklyBrand } from "../weekly/helpers";

let db: MockDb;
let ids: { brandId: string; userId: string };
beforeAll(async () => {
  db = await openTestDb();
  ids = await seedWeeklyBrand(db);
});
afterAll(async () => {
  await closeTestDb(db);
});

const post = { channel: "instagram" as const, caption: "Fresh bread every morning.", cta: "Message us", hashtags: ["#bread"], image_text: { headline: "Fresh bread", subline: "" } };
const aiFixture = () => fixtureFactCheck([post]);

describe("time limits for the AI check (V-16 needs them)", () => {
  it("runGuardrail passes aiTimeoutMs and aiBudgetMs down to the model call", async () => {
    seen.calls.length = 0;
    const res = await runGuardrail({ ...ids, posts: [post], weekStart: "2026-12-21", aiFixture, aiTimeoutMs: 4321, aiBudgetMs: 6789 });
    expect(res[0].aiChecked).toBe(true);
    expect(seen.calls).toHaveLength(1);
    expect(seen.calls[0]).toMatchObject({ timeoutMs: 4321, budgetMs: 6789 });
  });

  it("the defaults are the old 25 s and 40 s", async () => {
    seen.calls.length = 0;
    await runGuardrail({ ...ids, posts: [post], weekStart: "2026-12-21", aiFixture });
    expect(seen.calls[0]).toMatchObject({ timeoutMs: 25_000, budgetMs: 40_000 });
  });

  it("checkPostsAi takes the same two limits, and logs the brand", async () => {
    seen.calls.length = 0;
    await checkPostsAi({ facts: [], confirmed: [], posts: [{ index: 1, caption: post.caption, cta: post.cta, image_text: post.image_text }], aiTimeoutMs: 1000, aiBudgetMs: 1500, fixture: { facts: [] } });
    expect(seen.calls[0]).toMatchObject({ timeoutMs: 1000, budgetMs: 1500 });
    seen.calls.length = 0;
    await checkPostsAi({ facts: [], confirmed: [], posts: [{ index: 1, caption: post.caption, cta: post.cta, image_text: post.image_text }], usage: { brandId: ids.brandId, userId: ids.userId }, fixture: { facts: [] } });
    expect(seen.calls[0]).toMatchObject({ timeoutMs: 25_000, budgetMs: 40_000, logContext: { brandId: ids.brandId } });
  });

  it("reports the cost of the AI check to the caller", async () => {
    const usd: number[] = [];
    await runGuardrail({ ...ids, posts: [post], weekStart: "2026-12-21", aiFixture, onAiUsd: (x) => usd.push(x) });
    expect(usd).toEqual([0]); // fixture mode: no cost
  });
});
