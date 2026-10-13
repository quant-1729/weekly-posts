import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { MockDb } from "@/lib/db/mock";
import { recordUsage, type UsageKind } from "@/lib/usage";
import {
  ESTIMATED_CALL_USD,
  NON_BATCH_USD_CAP,
  WEEKLY_BATCH_RUNS,
  WEEKLY_COUNT_CAPS,
  WEEKLY_FACT_CHECKS,
  WEEKLY_MASCOT_RUNS,
  WEEKLY_REVIEW_REPLIES,
  WEEKLY_REWRITES,
  WEEKLY_UPLOAD_EXTRACTS,
  WEEKLY_USD_CAP,
  WEEKLY_WEBSITE_READS,
  WeeklyCapError,
  assertUnderWeeklyCap,
  type WeeklyCapKind,
} from "@/lib/usage/caps";
import { weekCost, weekCounts } from "@/lib/usage/weekly";
import { closeTestDb, openTestDb } from "../brand/helpers";
import { seedWeeklyBrand } from "../weekly/helpers";

let db: MockDb;
beforeAll(async () => {
  db = await openTestDb();
});
afterAll(async () => {
  await closeTestDb(db);
});

async function newBrand(timezone: string): Promise<{ brandId: string; userId: string }> {
  return seedWeeklyBrand(db, { timezone });
}

/** Inserts events at an exact instant. */
async function eventAt(brandId: string, iso: string, kind: UsageKind = "setup", usd = 0, n = 1): Promise<void> {
  for (let i = 0; i < n; i++) {
    await db.withAdmin((tx) =>
      tx.query("insert into public.usage_events (brand_id, kind, usd, created_at) values ($1, $2::public.usage_kind, $3, $4)", [brandId, kind, usd, iso]),
    );
  }
}

const refused = async (brandId: string, kind: WeeklyCapKind, now: Date) => assertUnderWeeklyCap(brandId, kind, { now }).catch((e) => e);

describe("the constants (Req 23)", () => {
  it("are the agreed numbers, in one place", () => {
    expect(WEEKLY_USD_CAP).toBe(0.5);
    expect(NON_BATCH_USD_CAP).toBe(0.4);
    expect(WEEKLY_BATCH_RUNS).toBe(4);
    expect(WEEKLY_REWRITES).toBe(15);
    expect(WEEKLY_WEBSITE_READS).toBe(3);
    expect(WEEKLY_UPLOAD_EXTRACTS).toBe(40);
    expect(WEEKLY_FACT_CHECKS).toBe(30);
    expect(WEEKLY_REVIEW_REPLIES).toBe(20);
  });
});

describe("weekCost and weekCounts use the brand's local week", () => {
  it("Europe/London: Monday 00:00 to the next Monday 00:00", async () => {
    const { brandId } = await newBrand("Europe/London");
    await eventAt(brandId, "2026-12-20T23:59:59Z", "rewrite", 0.1); // Sunday night: last week
    await eventAt(brandId, "2026-12-21T00:00:00Z", "rewrite", 0.01); // Monday 00:00: this week
    await eventAt(brandId, "2026-12-27T23:59:59Z", "fact_check", 0.02); // Sunday 23:59:59: this week
    await eventAt(brandId, "2026-12-28T00:00:00Z", "rewrite", 0.4); // next Monday: next week
    expect(await weekCost(brandId, "2026-12-21")).toBeCloseTo(0.03, 6);
    expect(await weekCounts(brandId, "2026-12-21")).toEqual({ rewrite: 1, fact_check: 1 });
    expect(await weekCost(brandId, "2026-12-14")).toBeCloseTo(0.1, 6);
    expect(await weekCost(brandId, "2026-12-28")).toBeCloseTo(0.4, 6);
  });

  it("Asia/Kolkata: the week starts 5 h 30 min before UTC midnight", async () => {
    const { brandId } = await newBrand("Asia/Kolkata");
    await eventAt(brandId, "2026-12-20T18:29:59Z", "rewrite", 0.1); // 23:59:59 IST Sunday: last week
    await eventAt(brandId, "2026-12-20T18:30:00Z", "rewrite", 0.01); // 00:00 IST Monday: this week
    await eventAt(brandId, "2026-12-27T18:29:59Z", "rewrite", 0.02); // 23:59:59 IST Sunday: this week
    await eventAt(brandId, "2026-12-27T18:30:00Z", "rewrite", 0.4); // next week
    expect(await weekCost(brandId, "2026-12-21")).toBeCloseTo(0.03, 6);
    expect(await weekCounts(brandId, "2026-12-21")).toEqual({ rewrite: 2 });
  });

  it("America/New_York: a week that holds the clocks-forward change is still Monday to Monday", async () => {
    const { brandId } = await newBrand("America/New_York");
    // Monday 2 Mar 2026 00:00 EST = 05:00Z. Monday 9 Mar 2026 00:00 EDT = 04:00Z (clocks went forward on Sunday 8 Mar).
    await eventAt(brandId, "2026-03-02T04:59:59Z", "rewrite", 0.1); // last week
    await eventAt(brandId, "2026-03-02T05:00:00Z", "rewrite", 0.01); // this week
    await eventAt(brandId, "2026-03-09T03:59:59Z", "rewrite", 0.02); // this week (still Sunday EDT)
    await eventAt(brandId, "2026-03-09T04:00:00Z", "rewrite", 0.4); // next week
    expect(await weekCost(brandId, "2026-03-02")).toBeCloseTo(0.03, 6);
  });

  it("counts only the brand's own events, and rejects a week start that is not a Monday", async () => {
    const a = await newBrand("Europe/London");
    const b = await newBrand("Europe/London");
    await eventAt(a.brandId, "2026-12-22T10:00:00Z", "rewrite", 0.2);
    expect(await weekCost(b.brandId, "2026-12-21")).toBe(0);
    expect(await weekCounts(b.brandId, "2026-12-21")).toEqual({});
    await expect(weekCost(a.brandId, "2026-12-22")).rejects.toThrow(/Monday/);
  });

  it("a brand with no memory row is counted in UTC", async () => {
    const { brandId } = await newBrand("Europe/London");
    await db.withAdmin((tx) => tx.query("delete from public.brand_memory where brand_id = $1", [brandId]));
    await eventAt(brandId, "2026-12-21T00:00:00Z", "rewrite", 0.05);
    expect(await weekCost(brandId, "2026-12-21")).toBeCloseTo(0.05, 6);
  });
});

describe("count caps", () => {
  const NOW = new Date("2026-12-23T10:00:00Z"); // Wednesday; the week is 21 Dec to 28 Dec (London)
  const cases: Array<[WeeklyCapKind, number]> = [
    ["weekly_batch", WEEKLY_BATCH_RUNS],
    ["rewrite", WEEKLY_REWRITES],
    ["website_read", WEEKLY_WEBSITE_READS],
    ["upload_extract", WEEKLY_UPLOAD_EXTRACTS],
    ["fact_check", WEEKLY_FACT_CHECKS],
    ["review_reply", WEEKLY_REVIEW_REPLIES],
    ["mascot", WEEKLY_MASCOT_RUNS],
  ];

  it.each(cases)("%s: allowed up to %i calls in the week, then refused", async (kind, cap) => {
    const { brandId } = await newBrand("Europe/London");
    await eventAt(brandId, "2026-12-22T09:00:00Z", kind, 0, cap - 1);
    await expect(assertUnderWeeklyCap(brandId, kind, { now: NOW })).resolves.toBeUndefined();
    await eventAt(brandId, "2026-12-22T09:00:00Z", kind);
    const err = await refused(brandId, kind, NOW);
    expect(err).toBeInstanceOf(WeeklyCapError);
    expect(err).toMatchObject({ kind, reason: "count", resetsOn: "2026-12-28" });
  });

  it.each(cases)("%s: last week's calls do not count", async (kind, cap) => {
    const { brandId } = await newBrand("Europe/London");
    await eventAt(brandId, "2026-12-20T23:59:00Z", kind, 0, cap);
    await expect(assertUnderWeeklyCap(brandId, kind, { now: NOW })).resolves.toBeUndefined();
  });

  it("one kind being used up does not block another", async () => {
    const { brandId } = await newBrand("Europe/London");
    await eventAt(brandId, "2026-12-22T09:00:00Z", "rewrite", 0, WEEKLY_REWRITES);
    expect(await refused(brandId, "rewrite", NOW)).toBeInstanceOf(WeeklyCapError);
    await expect(assertUnderWeeklyCap(brandId, "website_read", { now: NOW })).resolves.toBeUndefined();
    await expect(assertUnderWeeklyCap(brandId, "weekly_batch", { now: NOW })).resolves.toBeUndefined();
  });

  it("the cap table has one entry per kind", () => {
    expect(Object.keys(WEEKLY_COUNT_CAPS).sort()).toEqual(["fact_check", "mascot", "review_reply", "rewrite", "upload_extract", "website_read", "weekly_batch"]);
  });
});

describe("the money cap and the reserve for the weekly batch", () => {
  const NOW = new Date("2026-12-23T10:00:00Z");

  async function brandSpending(usd: number) {
    const { brandId } = await newBrand("Europe/London");
    await eventAt(brandId, "2026-12-22T09:00:00Z", "setup", usd);
    return brandId;
  }

  it("a rewrite is refused once $0.40 is spent", async () => {
    const brandId = await brandSpending(0.4);
    const err = await refused(brandId, "rewrite", NOW);
    expect(err).toBeInstanceOf(WeeklyCapError);
    expect(err).toMatchObject({ kind: "rewrite", reason: "usd" });
  });

  it("a rewrite that would pass $0.40 with its own estimated cost is refused; one that fits is allowed", async () => {
    const est = ESTIMATED_CALL_USD.rewrite;
    await expect(assertUnderWeeklyCap(await brandSpending(0.4 - est), "rewrite", { now: NOW })).resolves.toBeUndefined();
    expect(await refused(await brandSpending(0.4 - est + 0.001), "rewrite", NOW)).toBeInstanceOf(WeeklyCapError);
  });

  it("the website read and an upload are held to the same $0.40", async () => {
    expect(await refused(await brandSpending(0.39), "website_read", NOW)).toMatchObject({ reason: "usd" });
    expect(await refused(await brandSpending(0.398), "upload_extract", NOW)).toMatchObject({ reason: "usd" });
    await expect(assertUnderWeeklyCap(await brandSpending(0.3), "website_read", { now: NOW })).resolves.toBeUndefined();
  });

  it("the weekly batch is allowed at $0.45 and refused at $0.50", async () => {
    await expect(assertUnderWeeklyCap(await brandSpending(0.45), "weekly_batch", { now: NOW })).resolves.toBeUndefined();
    await expect(assertUnderWeeklyCap(await brandSpending(0.499), "weekly_batch", { now: NOW })).resolves.toBeUndefined();
    const err = await refused(await brandSpending(0.5), "weekly_batch", NOW);
    expect(err).toBeInstanceOf(WeeklyCapError);
    expect(err).toMatchObject({ kind: "weekly_batch", reason: "usd" });
    expect(await refused(await brandSpending(0.62), "weekly_batch", NOW)).toBeInstanceOf(WeeklyCapError);
  });

  it("so at $0.45 the batch still runs while a rewrite does not", async () => {
    const brandId = await brandSpending(0.45);
    await expect(assertUnderWeeklyCap(brandId, "weekly_batch", { now: NOW })).resolves.toBeUndefined();
    expect(await refused(brandId, "rewrite", NOW)).toBeInstanceOf(WeeklyCapError);
  });

  it("a fact check is count-only: it is allowed even when the week's money is used up", async () => {
    await expect(assertUnderWeeklyCap(await brandSpending(0.9), "fact_check", { now: NOW })).resolves.toBeUndefined();
  });

  it("last week's spending does not count, and the new week starts at local Monday 00:00", async () => {
    const { brandId } = await newBrand("Europe/London");
    await eventAt(brandId, "2026-12-20T22:00:00Z", "setup", 0.6);
    expect(await refused(brandId, "rewrite", new Date("2026-12-20T23:00:00Z"))).toBeInstanceOf(WeeklyCapError); // still the old week
    await expect(assertUnderWeeklyCap(brandId, "rewrite", { now: new Date("2026-12-21T00:00:00Z") })).resolves.toBeUndefined();
  });

  it("uses the brand's time zone for 'this week' (Kolkata: Monday starts at Sunday 18:30 UTC)", async () => {
    const { brandId } = await newBrand("Asia/Kolkata");
    await eventAt(brandId, "2026-12-27T10:00:00Z", "setup", 0.6); // Sunday afternoon IST: the old week
    expect(await refused(brandId, "rewrite", new Date("2026-12-27T18:00:00Z"))).toBeInstanceOf(WeeklyCapError);
    await expect(assertUnderWeeklyCap(brandId, "rewrite", { now: new Date("2026-12-27T18:31:00Z") })).resolves.toBeUndefined();
  });
});

describe("messages", () => {
  const NOW = new Date("2026-12-23T10:00:00Z");

  it("say plainly what was used up and that it resets on Monday", async () => {
    const { brandId } = await newBrand("Europe/London");
    await eventAt(brandId, "2026-12-22T09:00:00Z", "rewrite", 0, WEEKLY_REWRITES);
    expect((await refused(brandId, "rewrite", NOW)).message).toBe("You've used this week's rewrites. They reset on Monday.");
  });

  it("each kind has its own wording, all with the reset day", async () => {
    const seen = new Set<string>();
    for (const [kind, cap] of Object.entries(WEEKLY_COUNT_CAPS) as Array<[WeeklyCapKind, number]>) {
      const { brandId } = await newBrand("Europe/London");
      await eventAt(brandId, "2026-12-22T09:00:00Z", kind, 0, cap);
      const err = await refused(brandId, kind, NOW);
      expect(err).toBeInstanceOf(WeeklyCapError);
      expect(err.message).toMatch(/reset on Monday\.$/);
      expect(err.message).toMatch(/^You've used this week's /);
      seen.add(err.message);
    }
    expect(seen.size).toBe(7);
  });

  it("the money limit has its own wording and the reset day", async () => {
    const { brandId } = await newBrand("Europe/London");
    await eventAt(brandId, "2026-12-22T09:00:00Z", "setup", 0.45);
    const err = await refused(brandId, "rewrite", NOW);
    expect(err.message).toBe("You've reached this week's limit for AI help. It resets on Monday.");
    expect(err.resetsOn).toBe("2026-12-28");
  });
});

describe("AC 23: a heavy owner week stays under $0.50", () => {
  // Live per-call costs measured so far.
  const COST = { batch: 0.012, factCheck: 0.005, rewrite: 0.002, websiteRead: 0.0075, photo: 0.001 };
  const NOW = new Date("2026-12-23T10:00:00Z");

  it("1 batch + 2 regenerations + 15 rewrites + 1 website re-read + 10 uploads: every call is allowed and the week costs far less than the cap", async () => {
    const { brandId, userId } = await newBrand("Europe/London");
    const allow = (kind: WeeklyCapKind) => expect(assertUnderWeeklyCap(brandId, kind, { now: NOW })).resolves.toBeUndefined();
    // recordUsage stamps the real clock; move the events into the test week before each check.
    const intoTestWeek = () =>
      db.withAdmin((tx) => tx.query("update public.usage_events set created_at = $2 where brand_id = $1", [brandId, "2026-12-22T09:00:00Z"]));
    for (let run = 0; run < 3; run++) {
      await intoTestWeek();
      await allow("weekly_batch");
      await recordUsage(brandId, userId, "weekly_batch", COST.batch);
      await intoTestWeek();
      await allow("fact_check");
      await recordUsage(brandId, userId, "fact_check", COST.factCheck);
    }
    await intoTestWeek();
    await allow("website_read");
    await recordUsage(brandId, userId, "website_read", COST.websiteRead);
    for (let i = 0; i < 10; i++) {
      await intoTestWeek();
      await allow("upload_extract");
      await recordUsage(brandId, userId, "upload_extract", COST.photo);
    }
    for (let i = 0; i < 15; i++) {
      await intoTestWeek();
      await allow("rewrite");
      await recordUsage(brandId, userId, "rewrite", COST.rewrite);
      await intoTestWeek();
      await allow("fact_check");
      await recordUsage(brandId, userId, "fact_check", COST.factCheck);
    }
    await intoTestWeek();

    const expected = 3 * (COST.batch + COST.factCheck) + COST.websiteRead + 10 * COST.photo + 15 * (COST.rewrite + COST.factCheck);
    const spent = await weekCost(brandId, "2026-12-21");
    console.info(`[AC 23] heavy week: $${spent.toFixed(4)} (cap $${WEEKLY_USD_CAP.toFixed(2)})`);
    expect(spent).toBeCloseTo(expected, 5);
    expect(spent).toBeLessThan(WEEKLY_USD_CAP);
    expect(spent).toBeLessThan(0.25);
    expect(await weekCounts(brandId, "2026-12-21")).toEqual({ weekly_batch: 3, fact_check: 18, website_read: 1, upload_extract: 10, rewrite: 15 });
  });

  it("even with every count limit used in full, the week stays under $0.50 at the measured costs", () => {
    const worst =
      WEEKLY_BATCH_RUNS * COST.batch +
      WEEKLY_FACT_CHECKS * COST.factCheck +
      WEEKLY_REWRITES * COST.rewrite +
      WEEKLY_WEBSITE_READS * COST.websiteRead +
      WEEKLY_UPLOAD_EXTRACTS * COST.photo;
    console.info(`[AC 23] all count limits used: $${worst.toFixed(4)}`);
    expect(worst).toBeLessThan(WEEKLY_USD_CAP);
  });
});
