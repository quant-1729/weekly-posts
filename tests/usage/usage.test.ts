import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { MockDb } from "@/lib/db/mock";
import { DailyCapError, assertUnderDailyCap, countUsageToday, recordUsage } from "@/lib/usage";
import { closeTestDb, createBrandFor, createUser, openTestDb } from "../brand/helpers";

let db: MockDb;
let userId: string;

beforeAll(async () => {
  db = await openTestDb();
  userId = (await createUser(db)).id;
});
afterAll(async () => {
  await closeTestDb(db);
});

async function newBrand(cap: number, timezone = "UTC"): Promise<string> {
  const id = await createBrandFor(db, userId);
  await db.withAdmin((tx) => tx.query("update public.brands set daily_generation_cap = $2 where id = $1", [id, cap]));
  await db.withAdmin((tx) => tx.query("update public.brand_memory set timezone = $2 where brand_id = $1", [id, timezone]));
  return id;
}

/** Inserts an event at an exact instant (the service role cannot choose created_at through recordUsage). */
function eventAt(brandId: string, iso: string) {
  return db.withAdmin((tx) =>
    tx.query("insert into public.usage_events (brand_id, user_id, kind, created_at) values ($1, $2, 'setup', $3)", [
      brandId,
      userId,
      iso,
    ]),
  );
}

describe("the brand's own day", () => {
  it("counts the day in the brand's time zone", async () => {
    const brand = await newBrand(9, "America/Los_Angeles");
    const now = new Date("2026-10-13T05:00:00Z"); // 22:00 on 12 Oct in Los Angeles (PDT)
    await eventAt(brand, "2026-10-12T06:59:59Z"); // 23:59:59 on 11 Oct: yesterday
    expect(await countUsageToday(brand, now)).toBe(0);
    await eventAt(brand, "2026-10-12T07:00:00Z"); // 00:00 on 12 Oct: today
    await eventAt(brand, "2026-10-13T06:59:59Z"); // 23:59:59 on 12 Oct: today
    await eventAt(brand, "2026-10-13T07:00:00Z"); // 00:00 on 13 Oct: tomorrow
    expect(await countUsageToday(brand, now)).toBe(2);
  });

  it("falls back to UTC when the brand has no time zone on file", async () => {
    const brand = await newBrand(9);
    await db.withAdmin((tx) => tx.query("delete from public.brand_memory where brand_id = $1", [brand]));
    const now = new Date("2026-10-12T20:00:00Z");
    await eventAt(brand, "2026-10-11T23:59:59Z");
    await eventAt(brand, "2026-10-12T00:00:00Z");
    expect(await countUsageToday(brand, now)).toBe(1);
  });

  it("a day with a clock change is 25 hours long", async () => {
    const brand = await newBrand(9, "Europe/London");
    const now = new Date("2026-10-25T12:00:00Z"); // clocks go back at 01:00 UTC
    await eventAt(brand, "2026-10-24T22:59:59Z"); // 23:59:59 BST on 24 Oct
    await eventAt(brand, "2026-10-24T23:00:00Z"); // 00:00 BST on 25 Oct
    await eventAt(brand, "2026-10-25T23:59:59Z"); // 23:59:59 GMT on 25 Oct
    await eventAt(brand, "2026-10-26T00:00:00Z"); // 00:00 GMT on 26 Oct
    expect(await countUsageToday(brand, now)).toBe(2);
  });
});

describe("recordUsage and the daily cap", () => {
  it("records an event for the brand and user", async () => {
    const brand = await newBrand(5);
    await recordUsage(brand, userId, "transcribe");
    await recordUsage(brand, userId, "setup");
    const rows = await db.withAdmin((tx) =>
      tx.query<{ kind: string; user_id: string }>("select kind::text, user_id from public.usage_events where brand_id = $1 order by id", [brand]),
    );
    expect(rows.map((r) => r.kind)).toEqual(["transcribe", "setup"]);
    expect(rows.every((r) => r.user_id === userId)).toBe(true);
    expect(await countUsageToday(brand)).toBe(2);
  });

  it("allows calls below the cap and blocks at the cap", async () => {
    const brand = await newBrand(2);
    await expect(assertUnderDailyCap(brand)).resolves.toBeUndefined();
    await recordUsage(brand, userId, "setup");
    await expect(assertUnderDailyCap(brand)).resolves.toBeUndefined();
    await recordUsage(brand, userId, "transcribe");
    const err = await assertUnderDailyCap(brand).catch((e) => e);
    expect(err).toBeInstanceOf(DailyCapError);
    expect(err.cap).toBe(2);
    expect(err.used).toBe(2);
  });

  it("a cap of 0 blocks everything", async () => {
    const brand = await newBrand(0);
    await expect(assertUnderDailyCap(brand)).rejects.toBeInstanceOf(DailyCapError);
  });

  it("counts the brand's day (India here), not the UTC day", async () => {
    const brand = await newBrand(2, "Asia/Kolkata");
    // "Now" is 01:30 IST on 13 Oct (20:00 UTC on 12 Oct).
    const now = new Date("2026-10-12T20:00:00Z");
    await eventAt(brand, "2026-10-12T18:00:00Z"); // 23:30 IST on 12 Oct: yesterday in IST, same UTC day as now
    await eventAt(brand, "2026-10-12T18:29:59Z"); // 23:59:59 IST on 12 Oct: still yesterday
    expect(await countUsageToday(brand, now)).toBe(0);
    await expect(assertUnderDailyCap(brand, now)).resolves.toBeUndefined();

    await eventAt(brand, "2026-10-12T18:30:00Z"); // 00:00:00 IST on 13 Oct: today
    await eventAt(brand, "2026-10-12T19:00:00Z"); // 00:30 IST
    expect(await countUsageToday(brand, now)).toBe(2);
    await expect(assertUnderDailyCap(brand, now)).rejects.toBeInstanceOf(DailyCapError);
  });

  it("resets at the brand's midnight", async () => {
    const brand = await newBrand(1, "Asia/Kolkata");
    await eventAt(brand, "2026-10-12T10:00:00Z"); // 15:30 IST on 12 Oct
    await expect(assertUnderDailyCap(brand, new Date("2026-10-12T12:00:00Z"))).rejects.toBeInstanceOf(DailyCapError);
    // Just past IST midnight (18:30 UTC): a new day.
    await expect(assertUnderDailyCap(brand, new Date("2026-10-12T18:31:00Z"))).resolves.toBeUndefined();
  });

  it("only counts the brand's own events", async () => {
    const a = await newBrand(1);
    const b = await newBrand(1);
    await recordUsage(a, userId, "setup");
    await expect(assertUnderDailyCap(a)).rejects.toBeInstanceOf(DailyCapError);
    await expect(assertUnderDailyCap(b)).resolves.toBeUndefined();
  });
});
