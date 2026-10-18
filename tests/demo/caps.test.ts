// The demo account's AI budget (docs/15-demo-login.md "AI budget"): DEMO_WEEKLY_USD_CAP and DEMO_DAILY_CALL_CAP
// replace the normal caps for the brands owned by DEMO_LOGIN_EMAIL, and only for those. No session is involved.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createMockDb, setMockDbForTests, type MockDb } from "@/lib/db/mock";
import { DailyCapError, assertUnderDailyCap } from "@/lib/usage";
import { WeeklyCapError, assertUnderWeeklyCap } from "@/lib/usage/caps";
import { demoCapsFor } from "@/lib/usage/demo";
import { makeOwner } from "../helpers/details";
import { DEMO_EMAIL, makeDemoOwner } from "./helpers";

let db: MockDb;
let demo: { userId: string; brandId: string };
let other: { userId: string; brandId: string };

beforeAll(async () => {
  db = await createMockDb();
  setMockDbForTests(db);
  demo = await makeDemoOwner(db);
  other = await makeOwner(db, { name: "Other Shop" });
});
afterAll(async () => {
  setMockDbForTests(null);
  await db.close();
});
beforeEach(async () => {
  vi.stubEnv("DEMO_LOGIN_EMAIL", DEMO_EMAIL);
  await db.withAdmin((tx) => tx.query("delete from public.usage_events"));
  await db.withAdmin((tx) => tx.query("update public.brands set daily_generation_cap = 4"));
});
afterEach(() => {
  vi.unstubAllEnvs();
});

const spend = (brandId: string, usd: number, kind = "rewrite", n = 1) =>
  db.withAdmin(async (tx) => {
    for (let i = 0; i < n; i++) {
      await tx.query("insert into public.usage_events (brand_id, kind, usd) values ($1, $2::public.usage_kind, $3)", [brandId, kind, usd]);
    }
  });

describe("weekly dollar cap", () => {
  it("is the normal $0.50 / $0.40 for everyone when DEMO_WEEKLY_USD_CAP is unset", async () => {
    await spend(demo.brandId, 0.45);
    await spend(other.brandId, 0.45);
    for (const brandId of [demo.brandId, other.brandId]) {
      await expect(assertUnderWeeklyCap(brandId, "rewrite")).rejects.toBeInstanceOf(WeeklyCapError); // 0.45 + estimate > 0.40
      await expect(assertUnderWeeklyCap(brandId, "weekly_batch")).resolves.toBeUndefined(); // the batch only needs < 0.50
    }
  });

  it("is DEMO_WEEKLY_USD_CAP for the demo user's brand only", async () => {
    vi.stubEnv("DEMO_WEEKLY_USD_CAP", "5");
    await spend(demo.brandId, 0.6);
    await spend(other.brandId, 0.6);
    await expect(assertUnderWeeklyCap(other.brandId, "rewrite")).rejects.toMatchObject({ reason: "usd" });
    await expect(assertUnderWeeklyCap(other.brandId, "weekly_batch")).rejects.toMatchObject({ reason: "usd" });
    await expect(assertUnderWeeklyCap(demo.brandId, "rewrite")).resolves.toBeUndefined();
    await expect(assertUnderWeeklyCap(demo.brandId, "weekly_batch")).resolves.toBeUndefined();
  });

  it("still stops the demo brand at its own cap, keeping the same share for the batch", async () => {
    vi.stubEnv("DEMO_WEEKLY_USD_CAP", "5");
    await spend(demo.brandId, 4.1); // over 80% of $5 ($4.00)
    await expect(assertUnderWeeklyCap(demo.brandId, "rewrite")).rejects.toMatchObject({ reason: "usd" });
    await expect(assertUnderWeeklyCap(demo.brandId, "weekly_batch")).resolves.toBeUndefined(); // under $5
    await spend(demo.brandId, 1);
    await expect(assertUnderWeeklyCap(demo.brandId, "weekly_batch")).rejects.toMatchObject({ reason: "usd" });
  });

  it("ignores a setting that is not a positive number", async () => {
    for (const bad of ["abc", "0", "-3", ""]) {
      vi.stubEnv("DEMO_WEEKLY_USD_CAP", bad);
      expect(await demoCapsFor(demo.brandId)).toBeNull();
    }
  });

  it("does not apply when DEMO_LOGIN_EMAIL is empty or names someone else", async () => {
    vi.stubEnv("DEMO_WEEKLY_USD_CAP", "5");
    await spend(demo.brandId, 0.6);
    vi.stubEnv("DEMO_LOGIN_EMAIL", "");
    await expect(assertUnderWeeklyCap(demo.brandId, "weekly_batch")).rejects.toBeInstanceOf(WeeklyCapError);
    vi.stubEnv("DEMO_LOGIN_EMAIL", "someone.else@example.com");
    await expect(assertUnderWeeklyCap(demo.brandId, "weekly_batch")).rejects.toBeInstanceOf(WeeklyCapError);
  });
});

describe("daily call cap", () => {
  it("is the brand's own cap when DEMO_DAILY_CALL_CAP is unset", async () => {
    await spend(demo.brandId, 0, "rewrite", 4);
    await expect(assertUnderDailyCap(demo.brandId)).rejects.toMatchObject({ cap: 4, used: 4 });
  });

  it("is DEMO_DAILY_CALL_CAP for the demo user's brand only", async () => {
    vi.stubEnv("DEMO_DAILY_CALL_CAP", "10");
    await spend(demo.brandId, 0, "rewrite", 4);
    await spend(other.brandId, 0, "rewrite", 4);
    await expect(assertUnderDailyCap(other.brandId)).rejects.toBeInstanceOf(DailyCapError);
    await expect(assertUnderDailyCap(demo.brandId)).resolves.toBeUndefined();
    await spend(demo.brandId, 0, "rewrite", 6);
    await expect(assertUnderDailyCap(demo.brandId)).rejects.toMatchObject({ cap: 10, used: 10 });
  });

  it("makes no extra query when no demo cap is set", async () => {
    expect(await demoCapsFor(demo.brandId)).toBeNull();
    vi.stubEnv("DEMO_DAILY_CALL_CAP", "10");
    expect(await demoCapsFor(demo.brandId)).toEqual({ weeklyUsd: undefined, dailyCalls: 10 });
    expect(await demoCapsFor(other.brandId)).toBeNull();
  });
});
