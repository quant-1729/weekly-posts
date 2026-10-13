import { describe, expect, it } from "vitest";
import { getOccasions, HOLIDAY_DATA_ATTRIBUTION, SENSITIVE_NAME_RE, slug } from "@/lib/occasions";

const names = (list: Array<{ name: string }>) => list.map((o) => o.name);
const find = (list: ReturnType<typeof getOccasions>, re: RegExp) => list.filter((o) => re.test(o.name));

describe("country results for the week of 2026-11-09", () => {
  it("US-OR has Veterans Day", () => {
    const list = getOccasions({ country: "US", region: "US-OR", weekStart: "2026-11-09", timezone: "America/Los_Angeles" });
    const vd = find(list, /veterans/i);
    expect(vd).toHaveLength(1);
    expect(vd[0]).toMatchObject({ date: "2026-11-11", sensitive: false, source: "holiday", key: "holiday-veterans-day-2026-11-11" });
  });

  it("GB-ENG has Remembrance Sunday (2026-11-08), sensitive", () => {
    // 8 Nov is the Sunday before the week of 9 Nov, so it appears in the week that contains it (2 Nov) ...
    const list = getOccasions({ country: "GB", region: "GB-ENG", weekStart: "2026-11-02", timezone: "Europe/London" });
    const rs = find(list, /remembrance sunday/i);
    expect(rs).toHaveLength(1);
    expect(rs[0]).toMatchObject({ date: "2026-11-08", sensitive: true });
    // ... and not in the week after it (the lookahead only looks forward).
    expect(find(getOccasions({ country: "GB", region: "GB-ENG", weekStart: "2026-11-09" }), /remembrance/i)).toHaveLength(0);
  });

  it("SG has Deepavali once, even though the dataset lists it on two days", () => {
    const week = getOccasions({ country: "SG", weekStart: "2026-11-09", timezone: "Asia/Singapore" });
    expect(find(week, /deepavali/i)).toHaveLength(1);
    expect(find(week, /deepavali/i)[0].date).toBe("2026-11-09");
    const before = getOccasions({ country: "SG", weekStart: "2026-11-02" });
    expect(find(before, /deepavali/i)).toHaveLength(1);
    expect(find(before, /deepavali/i)[0].date).toBe("2026-11-08");
  });

  it("IN-MH has the India festivals in range, and Chhath only for its regions", () => {
    const mh = getOccasions({ country: "IN", region: "IN-MH", weekStart: "2026-11-09", timezone: "Asia/Kolkata" });
    const bhai = find(mh, /bhai dooj/i);
    expect(bhai).toHaveLength(1);
    expect(bhai[0]).toMatchObject({ date: "2026-11-11", source: "holiday" });
    expect(find(mh, /chhath/i)).toHaveLength(0); // Bihar, Jharkhand, Uttar Pradesh only
    expect(find(mh, /govardhan|gujarati new year/i)).toHaveLength(0); // other states
    expect(find(mh, /winter|children/i)).toHaveLength(0); // season and observance types are not used

    const bihar = getOccasions({ country: "IN", region: "IN-BR", weekStart: "2026-11-09" });
    expect(find(bihar, /chhath/i)).toHaveLength(1);
    expect(find(bihar, /chhath/i)[0].date).toBe("2026-11-13");

    const up = getOccasions({ country: "IN", region: "IN-UP", weekStart: "2026-11-09" });
    expect(names(up)).toEqual(expect.arrayContaining(["Bhai Dooj (Bhaubeej)", "Chhath Puja", "Govardhan Puja"]));

    // No region: only pan-india entries.
    const none = getOccasions({ country: "IN", weekStart: "2026-11-09" });
    expect(find(none, /bhai dooj/i)).toHaveLength(1);
    expect(find(none, /chhath|govardhan/i)).toHaveLength(0);
  });

  it("IN festivals are not added for other countries", () => {
    expect(find(getOccasions({ country: "SG", weekStart: "2026-11-02" }), /diwali|dhanteras|bhai dooj/i)).toHaveLength(0);
  });

  it("includes the festival in the week it starts, with Dhanteras and Diwali in the earlier week", () => {
    const list = getOccasions({ country: "IN", region: "IN-MH", weekStart: "2026-11-02" });
    expect(list.map((o) => o.date)).toEqual(expect.arrayContaining(["2026-11-06", "2026-11-08", "2026-11-11"]));
  });

  it("AU-NSW has Remembrance Day on 11 Nov, sensitive", () => {
    const list = getOccasions({ country: "AU", region: "AU-NSW", weekStart: "2026-11-09", timezone: "Australia/Sydney" });
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ name: "Remembrance Day", date: "2026-11-11", sensitive: true });
  });

  it("AU-NSW marks Anzac Day sensitive", () => {
    const list = getOccasions({ country: "AU", region: "AU-NSW", weekStart: "2026-04-20" });
    expect(find(list, /anzac/i).length).toBeGreaterThan(0);
    expect(find(list, /anzac/i).every((o) => o.sensitive)).toBe(true);
    expect(find(list, /earth day/i)).toHaveLength(1);
  });

  it("AE has no holiday that week, and uses English names for its other weeks", () => {
    expect(getOccasions({ country: "AE", weekStart: "2026-11-09", timezone: "Asia/Dubai" })).toEqual([]);
    const march = getOccasions({ country: "AE", weekStart: "2026-03-16" });
    expect(names(march)).toEqual(expect.arrayContaining(["End of Ramadan (Eid al-Fitr)", "Mother's Day"]));
    expect(find(march, /mother/i)[0].date).toBe("2026-03-21");
    for (const o of march) expect(o.name).toMatch(/^[\x20-\x7e]+$/); // no Arabic names for an English product
  });

  it("GB marks Good Friday sensitive and leaves Easter Sunday alone", () => {
    const list = getOccasions({ country: "GB", weekStart: "2026-03-30" });
    expect(find(list, /good friday/i)[0]).toMatchObject({ date: "2026-04-03", sensitive: true });
    expect(find(list, /easter sunday/i)[0]).toMatchObject({ sensitive: false });
  });

  it("CA gets Remembrance Day from the curated list although the dataset only has it as optional", () => {
    const list = getOccasions({ country: "CA", region: "CA-ON", weekStart: "2026-11-09" });
    expect(find(list, /remembrance day/i)).toHaveLength(1);
  });
});

describe("curated days in the output", () => {
  it("has Mother's Day for GB 2027 (Mothering Sunday) and US 2027", () => {
    const gb = getOccasions({ country: "GB", weekStart: "2027-03-01" });
    expect(find(gb, /mother/i)).toHaveLength(1);
    expect(find(gb, /mother/i)[0].date).toBe("2027-03-07");
    const us = getOccasions({ country: "US", weekStart: "2027-05-03" });
    expect(find(us, /mother/i)).toHaveLength(1);
    expect(find(us, /mother/i)[0].date).toBe("2027-05-09");
  });

  it("has Black Friday on 2026-11-27 once, merged with the dataset's 'Day after Thanksgiving'", () => {
    const us = getOccasions({ country: "US", weekStart: "2026-11-23" });
    expect(find(us, /black friday/i)).toHaveLength(1);
    expect(find(us, /black friday/i)[0].date).toBe("2026-11-27");
    expect(us.filter((o) => o.date === "2026-11-27")).toHaveLength(1);
    expect(find(us, /thanksgiving/i)[0].date).toBe("2026-11-26");
    expect(find(us, /small business/i)[0].date).toBe("2026-11-28");
    expect(find(us, /cyber monday/i)[0].date).toBe("2026-11-30"); // 1 day into the lookahead
  });

  it("is sorted by date", () => {
    const list = getOccasions({ country: "IN", region: "IN-UP", weekStart: "2026-11-02" });
    const dates = list.map((o) => o.date);
    expect(dates).toEqual([...dates].sort());
  });

  it("uses stable keys: source-slug-date", () => {
    const list = getOccasions({ country: "GB", weekStart: "2026-11-02" });
    expect(list[0].key).toBe("holiday-remembrance-sunday-2026-11-08");
    expect(slug("Valentine's Day")).toBe("valentines-day");
    expect(slug("Día de la Madre")).toBe("dia-de-la-madre");
    expect(slug("दीवाली")).not.toBe("occasion");
    expect(slug("!!!")).toBe("occasion");
  });
});

describe("owner dates", () => {
  it("repeats a yearly date every year and not a one-off", () => {
    const ownerDates = [
      { date: "2020-11-12", name: "Shop anniversary", yearly: true },
      { date: "2025-11-13", name: "Last year only", yearly: false },
      { date: "2026-11-14", name: "Open day", yearly: false },
    ];
    const list = getOccasions({ country: "US", weekStart: "2026-11-09", ownerDates });
    expect(find(list, /anniversary/i)[0]).toMatchObject({
      date: "2026-11-12",
      source: "owner",
      key: "owner-shop-anniversary-2026-11-12",
      sensitive: false,
    });
    expect(find(list, /last year/i)).toHaveLength(0);
    expect(find(list, /open day/i)[0].date).toBe("2026-11-14");
    // the next year
    expect(find(getOccasions({ country: "US", weekStart: "2027-11-08", ownerDates }), /anniversary/i)[0].date).toBe("2027-11-12");
  });

  it("repeats across the new year and for 29 February", () => {
    const ny = getOccasions({ country: "ZA", weekStart: "2026-12-28", ownerDates: [{ date: "2024-01-01", name: "Reopening", yearly: true }] });
    expect(find(ny, /reopening/i)[0].date).toBe("2027-01-01");
    const leap = getOccasions({ country: "ZA", weekStart: "2027-02-22", ownerDates: [{ date: "2024-02-29", name: "Leap sale", yearly: true }] });
    expect(find(leap, /leap/i)[0].date).toBe("2027-02-28");
  });

  it("merges with a same-day holiday, keeping the owner's name", () => {
    const list = getOccasions({
      country: "US",
      region: "US-OR",
      weekStart: "2026-11-09",
      ownerDates: [{ date: "2026-11-11", name: "Our Veterans Day Discount", yearly: false }],
    });
    const on11 = list.filter((o) => o.date === "2026-11-11");
    expect(on11).toHaveLength(1);
    expect(on11[0]).toMatchObject({ name: "Our Veterans Day Discount", source: "owner" });
  });

  it("keeps an owner date and a holiday on the same day when the names differ", () => {
    const list = getOccasions({
      country: "US",
      weekStart: "2026-11-09",
      ownerDates: [{ date: "2026-11-11", name: "Staff party", yearly: false }],
    });
    expect(list.filter((o) => o.date === "2026-11-11").map((o) => o.source).sort()).toEqual(["holiday", "owner"]);
  });

  it("marks an owner date sensitive when its name says so, and the merge keeps the sensitive flag", () => {
    const list = getOccasions({
      country: "GB",
      weekStart: "2026-11-02",
      ownerDates: [
        { date: "2026-11-05", name: "Grandad's memorial", yearly: true },
        { date: "2026-11-08", name: "Remembrance Sunday parade", yearly: false },
      ],
    });
    expect(find(list, /memorial/i)[0].sensitive).toBe(true);
    const rs = list.filter((o) => o.date === "2026-11-08");
    expect(rs).toHaveLength(1);
    expect(rs[0]).toMatchObject({ name: "Remembrance Sunday parade", source: "owner", sensitive: true });
  });

  it("ignores empty names and invalid dates", () => {
    const list = getOccasions({
      country: "ZA",
      weekStart: "2026-11-09",
      ownerDates: [
        { date: "2026-11-10", name: "   ", yearly: false },
        { date: "not a date", name: "Broken", yearly: true },
      ],
    });
    expect(list).toEqual([]);
  });
});

describe("lookahead", () => {
  const owner = (date: string) => [{ date, name: "Pop-up", yearly: false }];
  const has = (weekStart: string, date: string, lookaheadDays?: number) =>
    find(getOccasions({ country: "ZA", weekStart, lookaheadDays, ownerDates: owner(date) }), /pop-up/i).length === 1;

  it("includes an occasion 2 days after the week and not 5 days after (default 3)", () => {
    // the week of 2026-11-09 ends on 2026-11-15
    expect(has("2026-11-09", "2026-11-17")).toBe(true);
    expect(has("2026-11-09", "2026-11-18")).toBe(true); // exactly 3 after
    expect(has("2026-11-09", "2026-11-19")).toBe(false);
    expect(has("2026-11-09", "2026-11-20")).toBe(false); // 5 after
  });

  it("includes the first and last day of the week and excludes the day before", () => {
    expect(has("2026-11-09", "2026-11-09")).toBe(true);
    expect(has("2026-11-09", "2026-11-15")).toBe(true);
    expect(has("2026-11-09", "2026-11-08")).toBe(false);
  });

  it("honours lookaheadDays", () => {
    expect(has("2026-11-09", "2026-11-17", 0)).toBe(false);
    expect(has("2026-11-09", "2026-11-20", 5)).toBe(true);
  });

  it("applies to holidays too", () => {
    // Black Friday 2026-11-27 is 5 days after the week of 2026-11-16 ends (22 Nov): outside; inside from 11-23.
    expect(find(getOccasions({ country: "GB", weekStart: "2026-11-16" }), /black friday/i)).toHaveLength(0);
    expect(find(getOccasions({ country: "GB", weekStart: "2026-11-16", lookaheadDays: 5 }), /black friday/i)).toHaveLength(1);
  });

  it("rejects bad input", () => {
    expect(() => getOccasions({ country: "GB", weekStart: "2026-02-30" })).toThrow();
    expect(() => getOccasions({ country: "GB", weekStart: "2026-11-09", lookaheadDays: -1 })).toThrow();
    expect(() => getOccasions({ country: "GB", weekStart: "2026-11-09", timezone: "Nowhere/Land" })).toThrow();
  });
});

describe("category filter", () => {
  it("drops Halloween for health and finance businesses, keeps it for others", () => {
    const base = { country: "US", weekStart: "2026-10-26" } as const;
    expect(find(getOccasions(base), /halloween/i)).toHaveLength(1);
    expect(find(getOccasions({ ...base, category: "bakery" }), /halloween/i)).toHaveLength(1);
    expect(find(getOccasions({ ...base, category: "health" }), /halloween/i)).toHaveLength(0);
    expect(find(getOccasions({ ...base, category: "Dental clinic" }), /halloween/i)).toHaveLength(0);
    expect(find(getOccasions({ ...base, category: "finance" }), /halloween/i)).toHaveLength(0);
    expect(find(getOccasions({ ...base, category: "Insurance broker" }), /halloween/i)).toHaveLength(0);
  });

  it("does not drop other days, or the owner's own dates", () => {
    const list = getOccasions({
      country: "US",
      weekStart: "2026-11-09",
      category: "health",
      ownerDates: [{ date: "2026-11-12", name: "Halloween clinic party", yearly: false }],
    });
    expect(find(list, /veterans/i)).toHaveLength(1);
    expect(find(list, /halloween/i)).toHaveLength(1);
  });
});

describe("regions and countries the dataset does not know", () => {
  it("falls back to the country when the region is unknown", () => {
    const withBadRegion = getOccasions({ country: "US", region: "US-ZZ", weekStart: "2026-11-09" });
    const plain = getOccasions({ country: "US", weekStart: "2026-11-09" });
    expect(withBadRegion).toEqual(plain);
    expect(getOccasions({ country: "SG", region: "SG-01", weekStart: "2026-11-09" })).toEqual(
      getOccasions({ country: "SG", weekStart: "2026-11-09" }),
    );
  });

  it("accepts lower-case input and the bare state code", () => {
    expect(getOccasions({ country: "us", region: "us-or", weekStart: "2026-11-09" })).toEqual(
      getOccasions({ country: "US", region: "OR", weekStart: "2026-11-09" }),
    );
  });

  it("still returns the curated days for a country the dataset does not have", () => {
    const list = getOccasions({ country: "ZZ", weekStart: "2026-12-21" });
    expect(names(list)).toEqual(["Christmas Eve"]);
  });
});

describe("sensitive names", () => {
  it.each([
    "Remembrance Day",
    "Memorial Day",
    "Martyrs' Day",
    "Day of Mourning",
    "Ashura",
    "Muharram",
    "Good Friday",
    "Holocaust Remembrance Day",
    "Anzac Day",
    "Yom Kippur",
  ])("flags %s", (name) => expect(SENSITIVE_NAME_RE.test(name)).toBe(true));

  it.each(["Valentine's Day", "Black Friday", "Veterans Day", "Easter Sunday"])("does not flag %s", (name) =>
    expect(SENSITIVE_NAME_RE.test(name)).toBe(false),
  );
});

describe("attribution", () => {
  it("exports the CC BY 3.0 notice", () => {
    expect(HOLIDAY_DATA_ATTRIBUTION).toBe("Public holiday data: date-holidays (CC BY 3.0)");
  });
});
