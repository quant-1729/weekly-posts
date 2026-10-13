import { describe, expect, it } from "vitest";
import { CURATED_OBSERVANCES, easterSunday, nthWeekdayOfMonth, observanceDate } from "@/lib/occasions/rules";

const bySlug = (slug: string) => {
  const o = CURATED_OBSERVANCES.find((x) => x.slug === slug);
  if (!o) throw new Error(`no observance ${slug}`);
  return o;
};

// [slug, country, 2026 date, 2027 date], from a printed calendar.
const EXPECTED: Array<[string, string, string, string]> = [
  ["valentines-day", "US", "2026-02-14", "2027-02-14"],
  ["valentines-day", "IN", "2026-02-14", "2027-02-14"],
  ["mothers-day", "US", "2026-05-10", "2027-05-09"],
  ["mothers-day", "CA", "2026-05-10", "2027-05-09"],
  ["mothers-day", "AU", "2026-05-10", "2027-05-09"],
  ["mothers-day", "IN", "2026-05-10", "2027-05-09"],
  ["mothers-day", "SG", "2026-05-10", "2027-05-09"],
  ["mothers-day", "ZA", "2026-05-10", "2027-05-09"],
  ["mothers-day", "GB", "2026-03-15", "2027-03-07"], // Mothering Sunday: Easter minus 21 days
  ["mothers-day", "AE", "2026-03-21", "2027-03-21"],
  ["fathers-day", "US", "2026-06-21", "2027-06-20"],
  ["fathers-day", "GB", "2026-06-21", "2027-06-20"],
  ["fathers-day", "IN", "2026-06-21", "2027-06-20"],
  ["fathers-day", "AU", "2026-09-06", "2027-09-05"],
  ["halloween", "US", "2026-10-31", "2027-10-31"],
  ["halloween", "CA", "2026-10-31", "2027-10-31"],
  ["halloween", "GB", "2026-10-31", "2027-10-31"],
  ["halloween", "AU", "2026-10-31", "2027-10-31"],
  ["halloween", "IE", "2026-10-31", "2027-10-31"],
  ["black-friday", "US", "2026-11-27", "2027-11-26"],
  ["black-friday", "GB", "2026-11-27", "2027-11-26"],
  ["black-friday", "IN", "2026-11-27", "2027-11-26"],
  ["small-business-saturday", "US", "2026-11-28", "2027-11-27"],
  ["small-business-saturday", "GB", "2026-12-05", "2027-12-04"],
  ["cyber-monday", "US", "2026-11-30", "2027-11-29"],
  ["christmas-eve", "SG", "2026-12-24", "2027-12-24"],
  ["new-years-eve", "ZA", "2026-12-31", "2027-12-31"],
  ["international-womens-day", "AE", "2026-03-08", "2027-03-08"],
  ["earth-day", "US", "2026-04-22", "2027-04-22"],
  ["world-environment-day", "IN", "2026-06-05", "2027-06-05"],
  ["remembrance-sunday", "GB", "2026-11-08", "2027-11-14"],
  ["remembrance-day", "CA", "2026-11-11", "2027-11-11"],
  ["remembrance-day", "AU", "2026-11-11", "2027-11-11"],
];

describe("curated observance rules", () => {
  it.each(EXPECTED)("%s in %s", (slug, country, d2026, d2027) => {
    const o = bySlug(slug);
    expect(observanceDate(o, country, 2026)).toBe(d2026);
    expect(observanceDate(o, country, 2027)).toBe(d2027);
  });

  it("does not apply country-specific days elsewhere", () => {
    expect(observanceDate(bySlug("halloween"), "IN", 2026)).toBeNull();
    expect(observanceDate(bySlug("remembrance-sunday"), "US", 2026)).toBeNull();
    expect(observanceDate(bySlug("remembrance-day"), "GB", 2026)).toBeNull();
    expect(observanceDate(bySlug("small-business-saturday"), "AU", 2026)).toBeNull();
  });

  it("is case-insensitive on the country code", () => {
    expect(observanceDate(bySlug("mothers-day"), "gb", 2027)).toBe("2027-03-07");
  });

  it("marks only the remembrance days as sensitive", () => {
    expect(CURATED_OBSERVANCES.filter((o) => o.sensitive).map((o) => o.slug).sort()).toEqual([
      "remembrance-day",
      "remembrance-sunday",
    ]);
  });

  it("has unique slugs and at least one rule each", () => {
    const slugs = CURATED_OBSERVANCES.map((o) => o.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const o of CURATED_OBSERVANCES) expect(o.rules.length).toBeGreaterThan(0);
  });
});

describe("date arithmetic", () => {
  it("computes Easter Sunday", () => {
    expect(easterSunday(2024)).toBe("2024-03-31");
    expect(easterSunday(2025)).toBe("2025-04-20");
    expect(easterSunday(2026)).toBe("2026-04-05");
    expect(easterSunday(2027)).toBe("2027-03-28");
  });

  it("finds the nth and last weekday of a month", () => {
    expect(nthWeekdayOfMonth(2026, 11, 4, 4)).toBe("2026-11-26"); // US Thanksgiving
    expect(nthWeekdayOfMonth(2027, 11, 4, 4)).toBe("2027-11-25");
    expect(nthWeekdayOfMonth(2026, 5, 1, -1)).toBe("2026-05-25"); // last Monday of May
    expect(nthWeekdayOfMonth(2027, 5, 1, -1)).toBe("2027-05-31");
  });
});
