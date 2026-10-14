import { describe, expect, it } from "vitest";
import { freeSlotsFor, findSlot, hasEnded, isoWeekdayOf, localTimeOf, mondayOf, zonedToUtc, type SlotContext } from "@/lib/queue/slots";
import { formatSlot } from "@/lib/queue/format";

const iso = (d: Date) => d.toISOString();

describe("zonedToUtc: the same local time on both sides of a clock change", () => {
  it("London: 10:00 stays 10:00 local across the spring change (29 Mar 2026) and the autumn change (25 Oct 2026)", () => {
    expect(iso(zonedToUtc("2026-03-28", "10:00", "Europe/London"))).toBe("2026-03-28T10:00:00.000Z"); // GMT
    expect(iso(zonedToUtc("2026-03-29", "10:00", "Europe/London"))).toBe("2026-03-29T09:00:00.000Z"); // BST
    expect(iso(zonedToUtc("2026-10-24", "10:00", "Europe/London"))).toBe("2026-10-24T09:00:00.000Z"); // BST
    expect(iso(zonedToUtc("2026-10-25", "10:00", "Europe/London"))).toBe("2026-10-25T10:00:00.000Z"); // GMT
  });

  it("Los Angeles: 10:00 across 8 Mar and 1 Nov 2026", () => {
    expect(iso(zonedToUtc("2026-03-07", "10:00", "America/Los_Angeles"))).toBe("2026-03-07T18:00:00.000Z"); // PST
    expect(iso(zonedToUtc("2026-03-08", "10:00", "America/Los_Angeles"))).toBe("2026-03-08T17:00:00.000Z"); // PDT
    expect(iso(zonedToUtc("2026-10-31", "10:00", "America/Los_Angeles"))).toBe("2026-10-31T17:00:00.000Z"); // PDT
    expect(iso(zonedToUtc("2026-11-01", "10:00", "America/Los_Angeles"))).toBe("2026-11-01T18:00:00.000Z"); // PST
  });

  it("Kolkata has no daylight saving: always 04:30 UTC", () => {
    for (const d of ["2026-01-15", "2026-03-29", "2026-07-01", "2026-10-25"]) expect(iso(zonedToUtc(d, "10:00", "Asia/Kolkata"))).toBe(`${d}T04:30:00.000Z`);
  });

  it("Auckland (southern hemisphere): 10:00 across 27 Sep 2026 and 5 Apr 2026", () => {
    expect(iso(zonedToUtc("2026-09-26", "10:00", "Pacific/Auckland"))).toBe("2026-09-25T22:00:00.000Z"); // NZST +12
    expect(iso(zonedToUtc("2026-09-27", "10:00", "Pacific/Auckland"))).toBe("2026-09-26T21:00:00.000Z"); // NZDT +13
    expect(iso(zonedToUtc("2026-04-04", "10:00", "Pacific/Auckland"))).toBe("2026-04-03T21:00:00.000Z"); // NZDT
    expect(iso(zonedToUtc("2026-04-05", "10:00", "Pacific/Auckland"))).toBe("2026-04-04T22:00:00.000Z"); // NZST
  });

  it("a time that does not exist moves forward; a time that happens twice takes the first", () => {
    expect(iso(zonedToUtc("2026-03-29", "01:30", "Europe/London"))).toBe("2026-03-29T01:30:00.000Z"); // 01:30 GMT never shows; this is 02:30 BST
    expect(localTimeOf(zonedToUtc("2026-03-29", "01:30", "Europe/London"), "Europe/London")).toBe("02:30");
    expect(iso(zonedToUtc("2026-10-25", "01:30", "Europe/London"))).toBe("2026-10-25T00:30:00.000Z"); // the BST one
  });

  it("round-trips every quarter hour in four zones over a year", () => {
    for (const tz of ["Europe/London", "America/Los_Angeles", "Asia/Kolkata", "Pacific/Auckland"]) {
      for (const date of ["2026-01-10", "2026-03-29", "2026-04-05", "2026-09-27", "2026-10-25", "2026-11-01"]) {
        for (const time of ["00:15", "06:45", "10:00", "17:30", "23:45"]) {
          const at = zonedToUtc(date, time, tz);
          expect(localTimeOf(at, tz), `${tz} ${date} ${time}`).toBe(time);
        }
      }
    }
  });
});

describe("weekdays and weeks", () => {
  it("ISO weekday and Monday of the week", () => {
    expect(isoWeekdayOf("2026-10-12")).toBe(1); // Monday
    expect(isoWeekdayOf("2026-10-18")).toBe(7); // Sunday
    expect(mondayOf("2026-10-18")).toBe("2026-10-12");
    expect(mondayOf("2026-10-12")).toBe("2026-10-12");
    expect(mondayOf("2026-10-14")).toBe("2026-10-12");
  });
});

const base = (over: Partial<SlotContext> = {}): SlotContext => ({
  now: new Date("2026-10-14T12:00:00Z"), // Wednesday
  timezone: "Europe/London",
  settings: { days: [2, 4, 6], times: {}, postsPerWeek: 3 },
  occupied: [],
  endsOn: null,
  ...over,
});

describe("finding a slot", () => {
  it("takes the next chosen weekday at the channel's time, in the brand's zone", () => {
    const r = findSlot(base(), ["instagram"]);
    expect(r).toMatchObject({ ok: true, date: "2026-10-15" }); // Thursday
    expect(r.ok && iso(r.slots.instagram!)).toBe("2026-10-15T09:00:00.000Z"); // 10:00 BST
  });

  it("uses each channel's own time on the same day", () => {
    const r = findSlot(base({ settings: { days: [4], times: { instagram: "09:00", whatsapp: "18:30" }, postsPerWeek: 3 } }), ["instagram", "whatsapp"]);
    expect(r.ok && iso(r.slots.instagram!)).toBe("2026-10-15T08:00:00.000Z");
    expect(r.ok && iso(r.slots.whatsapp!)).toBe("2026-10-15T17:30:00.000Z");
  });

  it("skips today when the time has passed or is less than 10 minutes away", () => {
    const ctx = base({ now: new Date("2026-10-15T08:55:00Z"), settings: { days: [4, 6], times: {}, postsPerWeek: 3 } }); // Thu 09:55 local; slot 10:00
    const r = findSlot(ctx, ["instagram"]);
    expect(r).toMatchObject({ ok: true, date: "2026-10-17" });
    const earlier = findSlot(base({ now: new Date("2026-10-15T08:30:00Z"), settings: { days: [4, 6], times: {}, postsPerWeek: 3 } }), ["instagram"]);
    expect(earlier).toMatchObject({ ok: true, date: "2026-10-15" });
  });

  it("one post per slot per channel: a taken day goes to the next", () => {
    const occupied = [{ channel: "instagram" as const, slotAt: new Date("2026-10-15T09:00:00Z") }];
    expect(findSlot(base({ occupied }), ["instagram"])).toMatchObject({ ok: true, date: "2026-10-17" });
    // Another channel can share the day.
    expect(findSlot(base({ occupied }), ["facebook"])).toMatchObject({ ok: true, date: "2026-10-15" });
  });

  it("at most postsPerWeek slot days per ISO week; a day already holding a post can be shared by another channel", () => {
    const week = (d: string) => ({ channel: "instagram" as const, slotAt: zonedToUtc(d, "10:00", "Europe/London") });
    const full = base({ settings: { days: [1, 2, 3, 4, 5, 6, 7], times: {}, postsPerWeek: 2 }, occupied: [week("2026-10-15"), week("2026-10-16")] });
    // Thursday and Friday hold posts; Saturday would be the third day of the week: next free is Monday 19 Oct.
    expect(findSlot(full, ["instagram"])).toMatchObject({ ok: true, date: "2026-10-19" });
    // Facebook can still use Thursday: that day already counts.
    expect(findSlot(full, ["facebook"])).toMatchObject({ ok: true, date: "2026-10-15" });
  });

  it("the cap is also limited by the number of chosen days", () => {
    const ctx = base({ settings: { days: [4], times: {}, postsPerWeek: 5 }, occupied: [{ channel: "instagram", slotAt: new Date("2026-10-15T09:00:00Z") }] });
    expect(findSlot(ctx, ["instagram"])).toMatchObject({ ok: true, date: "2026-10-22" });
  });

  it("never after the offer's end date: asks for post now instead", () => {
    expect(findSlot(base({ endsOn: "2026-10-14" }), ["instagram"])).toEqual({ ok: false, reason: "ends_before_slot" });
    expect(findSlot(base({ endsOn: "2026-10-16" }), ["instagram"])).toMatchObject({ ok: true, date: "2026-10-15" });
    // The end day itself is allowed.
    expect(findSlot(base({ endsOn: "2026-10-15" }), ["instagram"])).toMatchObject({ ok: true, date: "2026-10-15" });
    // Taken until after the end date: no slot.
    const taken = base({ endsOn: "2026-10-16", occupied: [{ channel: "instagram", slotAt: new Date("2026-10-15T09:00:00Z") }] });
    expect(findSlot(taken, ["instagram"])).toEqual({ ok: false, reason: "ends_before_slot" });
  });

  it("the end date is the brand's local date: an Auckland brand's Thursday is already Wednesday evening in UTC", () => {
    const now = new Date("2026-10-14T05:00:00Z"); // Wed 18:00 in Auckland
    const ctx = base({ now, timezone: "Pacific/Auckland", settings: { days: [4], times: {}, postsPerWeek: 3 }, endsOn: "2026-10-15" });
    const r = findSlot(ctx, ["instagram"]);
    expect(r.ok && iso(r.slots.instagram!)).toBe("2026-10-14T21:00:00.000Z"); // Thu 15 Oct 10:00 NZDT
    expect(hasEnded("2026-10-14", now, "Pacific/Auckland")).toBe(false);
    expect(hasEnded("2026-10-14", new Date("2026-10-14T12:30:00Z"), "Pacific/Auckland")).toBe(true); // Thu 01:30 in Auckland
  });

  it("lists the next free slots for one channel, earliest first", () => {
    const list = freeSlotsFor(base(), "instagram", 4).map(iso);
    expect(list).toEqual(["2026-10-15T09:00:00.000Z", "2026-10-17T09:00:00.000Z", "2026-10-20T09:00:00.000Z", "2026-10-22T09:00:00.000Z"]);
  });

  it("slots keep their local time across a clock change", () => {
    // Saturday 24 Oct 2026 is BST, Tuesday 27 Oct is GMT: both 10:00 local.
    const list = freeSlotsFor(base({ now: new Date("2026-10-23T12:00:00Z") }), "instagram", 2);
    expect(list.map(iso)).toEqual(["2026-10-24T09:00:00.000Z", "2026-10-27T10:00:00.000Z"]);
    expect(list.map((d) => formatSlot(d, "Europe/London"))).toEqual(["Sat 24 Oct, 10:00", "Tue 27 Oct, 10:00"]);
  });
});
