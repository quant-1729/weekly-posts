import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkDateRange, daysLeft, isExpired, isIsoDate, todayIn } from "@/lib/briefs/dates";
import { createBrief, updateBrief } from "@/lib/briefs/service";
import type { MockDb } from "@/lib/db/mock";
import { closeDb, makeOwner, openDb, type Owner } from "../helpers/details";

// 2026-10-14 12:00 UTC is already 15 October (01:00) in Auckland (UTC+13 in summer time)
// and still 14 October (05:00) in Los Angeles (UTC-7).
const NOON_UTC = new Date("2026-10-14T12:00:00Z");

describe("todayIn", () => {
  it("is the date in the brand's zone, not the server's", () => {
    expect(todayIn(NOON_UTC, "Pacific/Auckland")).toBe("2026-10-15");
    expect(todayIn(NOON_UTC, "America/Los_Angeles")).toBe("2026-10-14");
    expect(todayIn(NOON_UTC, "UTC")).toBe("2026-10-14");
    expect(todayIn(NOON_UTC, "Not/AZone")).toBe("2026-10-14");
    expect(todayIn(NOON_UTC, null)).toBe("2026-10-14");
  });

  it("flips at local midnight", () => {
    expect(todayIn(new Date("2026-10-15T06:59:00Z"), "America/Los_Angeles")).toBe("2026-10-14"); // 23:59 PDT
    expect(todayIn(new Date("2026-10-15T07:01:00Z"), "America/Los_Angeles")).toBe("2026-10-15"); // 00:01 PDT
    expect(todayIn(new Date("2026-10-13T10:59:00Z"), "Pacific/Auckland")).toBe("2026-10-13"); // 23:59 NZDT
    expect(todayIn(new Date("2026-10-13T11:01:00Z"), "Pacific/Auckland")).toBe("2026-10-14"); // 00:01 NZDT
  });
});

describe("isExpired and daysLeft", () => {
  it("a brief with no end date never expires", () => {
    expect(isExpired({ endsOn: null, timezone: "UTC" }, NOON_UTC)).toBe(false);
    expect(daysLeft({ endsOn: null, timezone: "UTC" }, NOON_UTC)).toBeNull();
  });

  it("is good through the whole end date in its own zone", () => {
    const brief = (timezone: string) => ({ endsOn: "2026-10-14", timezone });
    expect(isExpired(brief("America/Los_Angeles"), NOON_UTC)).toBe(false);
    expect(isExpired(brief("Pacific/Auckland"), NOON_UTC)).toBe(true); // already the 15th there
    expect(isExpired(brief("America/Los_Angeles"), new Date("2026-10-15T06:59:00Z"))).toBe(false);
    expect(isExpired(brief("America/Los_Angeles"), new Date("2026-10-15T07:01:00Z"))).toBe(true);
  });

  it("counts whole days in the brief's zone", () => {
    expect(daysLeft({ endsOn: "2026-10-14", timezone: "America/Los_Angeles" }, NOON_UTC)).toBe(0);
    expect(daysLeft({ endsOn: "2026-10-14", timezone: "Pacific/Auckland" }, NOON_UTC)).toBe(-1);
    expect(daysLeft({ endsOn: "2026-10-20", timezone: "America/Los_Angeles" }, NOON_UTC)).toBe(6);
    expect(daysLeft({ endsOn: "2026-11-01", timezone: "UTC" }, NOON_UTC)).toBe(18);
  });
});

describe("checkDateRange", () => {
  const o = { timezone: "UTC", now: NOON_UTC, requireEndNotPast: true };
  it("checks real dates, order and the end date not in the past", () => {
    expect(checkDateRange({ startsOn: "2026-10-15", endsOn: "2026-10-20" }, o)).toBeNull();
    expect(checkDateRange({ startsOn: "2026-10-14", endsOn: "2026-10-14" }, o)).toBeNull();
    expect(checkDateRange({ startsOn: null, endsOn: null }, o)).toBeNull();
    expect(checkDateRange({ startsOn: "2026-10-21", endsOn: "2026-10-20" }, o)).toBe("dates_order");
    expect(checkDateRange({ startsOn: null, endsOn: "2026-10-13" }, o)).toBe("end_in_past");
    expect(checkDateRange({ startsOn: null, endsOn: "2026-10-13" }, { ...o, requireEndNotPast: false })).toBeNull();
    expect(checkDateRange({ startsOn: "2026-02-30", endsOn: null }, o)).toBe("invalid_date");
    expect(checkDateRange({ startsOn: null, endsOn: "tomorrow" }, o)).toBe("invalid_date");
    expect(isIsoDate("2028-02-29")).toBe(true);
    expect(isIsoDate("2026-02-29")).toBe(false);
  });
});

describe("dates on a saved brief", () => {
  let db: MockDb;
  let nz: Owner;
  let la: Owner;

  beforeAll(async () => {
    db = await openDb();
    nz = await makeOwner(db, { name: "Kiwi Cafe", country: "NZ", timezone: "Pacific/Auckland" });
    la = await makeOwner(db, { name: "LA Cafe", country: "US", timezone: "America/Los_Angeles" });
  });
  afterAll(() => closeDb(db));

  it("accepts an end date of 'today' in Los Angeles but not in Auckland at the same instant", async () => {
    const ok = await createBrief(la.userId, la.brandId, { postType: "offer", endsOn: "2026-10-14" }, { now: NOON_UTC });
    expect(ok).toMatchObject({ endsOn: "2026-10-14", timezone: "America/Los_Angeles" });
    await expect(createBrief(nz.userId, nz.brandId, { postType: "offer", endsOn: "2026-10-14" }, { now: NOON_UTC })).rejects.toMatchObject({
      fieldErrors: { endsOn: "end_in_past" },
    });
    const kiwi = await createBrief(nz.userId, nz.brandId, { postType: "offer", endsOn: "2026-10-15" }, { now: NOON_UTC });
    expect(kiwi.timezone).toBe("Pacific/Auckland");
  });

  it("flips around local midnight", async () => {
    const lateEvening = new Date("2026-10-15T06:59:00Z"); // 23:59 on the 14th in Los Angeles
    const justAfter = new Date("2026-10-15T07:01:00Z");
    await expect(createBrief(la.userId, la.brandId, { postType: "offer", endsOn: "2026-10-14" }, { now: lateEvening })).resolves.toMatchObject({ endsOn: "2026-10-14" });
    await expect(createBrief(la.userId, la.brandId, { postType: "offer", endsOn: "2026-10-14" }, { now: justAfter })).rejects.toMatchObject({ fieldErrors: { endsOn: "end_in_past" } });
  });

  it("rejects start after end and bad dates; leaves an unchanged past end date alone on later saves", async () => {
    await expect(createBrief(la.userId, la.brandId, { postType: "event", startsOn: "2026-10-21", endsOn: "2026-10-20" }, { now: NOON_UTC })).rejects.toMatchObject({ fieldErrors: { startsOn: "dates_order" } });
    await expect(createBrief(la.userId, la.brandId, { postType: "event", startsOn: "2026-13-01" }, { now: NOON_UTC })).rejects.toMatchObject({ fieldErrors: { startsOn: "invalid_date" } });

    const brief = await createBrief(la.userId, la.brandId, { postType: "offer", endsOn: "2026-10-16" }, { now: NOON_UTC });
    const later = new Date("2026-10-30T12:00:00Z"); // the offer is over
    const noted = await updateBrief(la.userId, la.brandId, brief.id, { notes: "history" }, { now: later });
    expect(noted.endsOn).toBe("2026-10-16");
    expect(isExpired(noted, later)).toBe(true);
    await expect(updateBrief(la.userId, la.brandId, brief.id, { endsOn: "2026-10-17" }, { now: later })).rejects.toMatchObject({ fieldErrors: { endsOn: "end_in_past" } });
    expect((await updateBrief(la.userId, la.brandId, brief.id, { endsOn: null }, { now: later })).endsOn).toBeNull();
  });
});
