import { describe, expect, it } from "vitest";
import { addDaysIso, isValidIsoDate, weekDays, weekStartFor } from "@/lib/occasions/dates";

const at = (iso: string) => new Date(iso);

describe("weekStartFor", () => {
  it("returns the local Monday for a midweek instant", () => {
    expect(weekStartFor(at("2026-11-11T12:00:00Z"), "UTC")).toBe("2026-11-09");
    expect(weekStartFor(at("2026-11-09T00:00:00Z"), "UTC")).toBe("2026-11-09"); // Monday itself
    expect(weekStartFor(at("2026-11-15T23:59:00Z"), "UTC")).toBe("2026-11-09"); // Sunday
  });

  it("uses the local date, not the UTC date (same instant, different zones)", () => {
    // 20:00 UTC on Sunday 8 Nov is already Monday 9 Nov in Kolkata, still Sunday in London and New York.
    const instant = at("2026-11-08T20:00:00Z");
    expect(weekStartFor(instant, "Europe/London")).toBe("2026-11-02");
    expect(weekStartFor(instant, "America/New_York")).toBe("2026-11-02");
    expect(weekStartFor(instant, "Asia/Kolkata")).toBe("2026-11-09");
  });

  it("handles the +05:30 offset at midnight (Asia/Kolkata)", () => {
    expect(weekStartFor(at("2026-11-08T18:29:00Z"), "Asia/Kolkata")).toBe("2026-11-02"); // 23:59 Sunday
    expect(weekStartFor(at("2026-11-08T18:30:00Z"), "Asia/Kolkata")).toBe("2026-11-09"); // 00:00 Monday
  });

  it("handles Pacific/Auckland, including its daylight-saving start", () => {
    // NZDT is UTC+13 in November.
    expect(weekStartFor(at("2026-11-08T10:59:00Z"), "Pacific/Auckland")).toBe("2026-11-02");
    expect(weekStartFor(at("2026-11-08T11:00:00Z"), "Pacific/Auckland")).toBe("2026-11-09");
    // DST starts Sunday 27 Sep 2026 (02:00 NZST -> 03:00 NZDT); Monday 28 Sep begins at 11:00 UTC on the 27th.
    expect(weekStartFor(at("2026-09-27T10:59:00Z"), "Pacific/Auckland")).toBe("2026-09-21");
    expect(weekStartFor(at("2026-09-27T11:00:00Z"), "Pacific/Auckland")).toBe("2026-09-28");
  });

  it("is correct around the Europe/London change in late March (BST starts 29 Mar 2026)", () => {
    expect(weekStartFor(at("2026-03-29T00:30:00Z"), "Europe/London")).toBe("2026-03-23"); // 00:30 GMT Sunday
    expect(weekStartFor(at("2026-03-29T22:59:00Z"), "Europe/London")).toBe("2026-03-23"); // 23:59 BST Sunday
    expect(weekStartFor(at("2026-03-29T23:00:00Z"), "Europe/London")).toBe("2026-03-30"); // 00:00 BST Monday
    expect(weekStartFor(at("2026-03-30T08:00:00Z"), "Europe/London")).toBe("2026-03-30");
  });

  it("is correct around the Europe/London change in late October (GMT returns 25 Oct 2026)", () => {
    expect(weekStartFor(at("2026-10-25T23:30:00Z"), "Europe/London")).toBe("2026-10-19"); // 23:30 GMT Sunday
    expect(weekStartFor(at("2026-10-26T00:00:00Z"), "Europe/London")).toBe("2026-10-26"); // 00:00 GMT Monday
    expect(weekStartFor(at("2026-10-24T23:30:00Z"), "Europe/London")).toBe("2026-10-19"); // 00:30 BST Sunday
  });

  it("is correct around the America/New_York changes (8 Mar and 1 Nov 2026)", () => {
    expect(weekStartFor(at("2026-03-09T03:30:00Z"), "America/New_York")).toBe("2026-03-02"); // 23:30 EDT Sunday
    expect(weekStartFor(at("2026-03-09T04:00:00Z"), "America/New_York")).toBe("2026-03-09"); // 00:00 EDT Monday
    expect(weekStartFor(at("2026-11-02T04:30:00Z"), "America/New_York")).toBe("2026-10-26"); // 23:30 EST Sunday
    expect(weekStartFor(at("2026-11-02T05:00:00Z"), "America/New_York")).toBe("2026-11-02"); // 00:00 EST Monday
  });

  it("rejects an unknown time zone", () => {
    expect(() => weekStartFor(new Date(), "Mars/Olympus")).toThrow(/time zone/i);
  });
});

describe("weekDays", () => {
  it("returns 7 days from Monday with weekday names", () => {
    const days = weekDays("2026-11-09");
    expect(days).toHaveLength(7);
    expect(days[0]).toEqual({ date: "2026-11-09", weekday: "Monday" });
    expect(days[6]).toEqual({ date: "2026-11-15", weekday: "Sunday" });
    expect(days.map((d) => d.weekday)).toEqual(["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]);
  });

  it("crosses month, year and DST boundaries without skipping or repeating a date", () => {
    expect(weekDays("2026-12-28").map((d) => d.date)).toEqual([
      "2026-12-28", "2026-12-29", "2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02", "2027-01-03",
    ]);
    expect(weekDays("2026-03-23").map((d) => d.date)).toEqual([
      "2026-03-23", "2026-03-24", "2026-03-25", "2026-03-26", "2026-03-27", "2026-03-28", "2026-03-29",
    ]);
    expect(weekDays("2026-10-26").map((d) => d.date).at(-1)).toBe("2026-11-01");
  });

  it("rejects an invalid week start", () => {
    expect(() => weekDays("2026-13-01")).toThrow();
  });
});

describe("date helpers", () => {
  it("adds and subtracts days", () => {
    expect(addDaysIso("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDaysIso("2028-02-28", 1)).toBe("2028-02-29");
  });
  it("validates real dates only", () => {
    expect(isValidIsoDate("2026-02-29")).toBe(false);
    expect(isValidIsoDate("2028-02-29")).toBe(true);
    expect(isValidIsoDate("11/09/2026")).toBe(false);
  });
});
