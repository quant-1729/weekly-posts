import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DateTimePicker } from "@/components/ui/date-time-picker";
import { firstDayOfWeek, firstEnabledDate, fromInstant, isDayDisabled, isTimeDisabled, makeLimits, monthGrid, shiftMonth, timeSteps, timesFor, toInstant, weekdayHeaders } from "@/components/ui/date-time-utils";

/** Thursday 15 Oct 2026, noon UTC: 13:00 in London (BST). */
const NOW = new Date("2026-10-15T12:00:00Z");
const London = "Europe/London";
const limits = (over: Partial<Parameters<typeof makeLimits>[0]> = {}) => makeLimits({ now: NOW, timezone: London, ...over });

describe("week start per locale", () => {
  it("follows the locale", () => {
    expect(firstDayOfWeek("en-GB")).toBe(1);
    expect(firstDayOfWeek("de-DE")).toBe(1);
    expect(firstDayOfWeek("en-US")).toBe(0);
    expect(firstDayOfWeek("hi-IN")).toBe(0);
    expect(firstDayOfWeek("ar-EG")).toBe(6);
    expect(firstDayOfWeek("not a locale")).toBe(1);
  });

  it("orders the weekday headers from the first day", () => {
    expect(weekdayHeaders("en-GB", 1).map((w) => w.short)).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
    expect(weekdayHeaders("en-US", 0).map((w) => w.long)[0]).toBe("Sunday");
  });
});

describe("the month grid", () => {
  it("October 2026 (starts on a Thursday) with Monday first: 5 weeks, from 28 Sep to 1 Nov", () => {
    const g = monthGrid(2026, 10, 1);
    expect(g).toHaveLength(5);
    expect(g.every((w) => w.length === 7)).toBe(true);
    expect(g[0][0]).toEqual({ date: "2026-09-28", inMonth: false });
    expect(g[0][3]).toEqual({ date: "2026-10-01", inMonth: true });
    expect(g[4][6]).toEqual({ date: "2026-11-01", inMonth: false });
    expect(g.flat().filter((d) => d.inMonth)).toHaveLength(31);
  });

  it("with Sunday first the same month starts on 27 Sep", () => {
    const g = monthGrid(2026, 10, 0);
    expect(g[0][0].date).toBe("2026-09-27");
    expect(g.flat().filter((d) => d.inMonth)).toHaveLength(31);
  });

  it("a month that fits exactly in four weeks has four rows; a long one can need six", () => {
    expect(monthGrid(2027, 2, 1)).toHaveLength(4); // 1 Feb 2027 is a Monday, 28 days
    expect(monthGrid(2026, 8, 1)).toHaveLength(6); // 1 Aug 2026 is a Saturday, 31 days
  });

  it("moves between months over a year end", () => {
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-10", 0)).toBe("2026-10");
  });
});

describe("which days and times can be picked", () => {
  it("past days are disabled; today is not; the end date cuts off the rest", () => {
    const l = limits({ endsOn: "2026-10-20" });
    expect(isDayDisabled("2026-10-14", l)).toBe(true);
    expect(isDayDisabled("2026-10-15", l)).toBe(false);
    expect(isDayDisabled("2026-10-20", l)).toBe(false);
    expect(isDayDisabled("2026-10-21", l)).toBe(true);
    expect(firstEnabledDate(l)).toBe("2026-10-15");
  });

  it("'today' is the day in the brand's zone, not in UTC", () => {
    const lateUtc = new Date("2026-10-15T23:30:00Z"); // 16 Oct 00:30 in London
    expect(isDayDisabled("2026-10-15", makeLimits({ now: lateUtc, timezone: London }))).toBe(true);
    expect(isDayDisabled("2026-10-16", makeLimits({ now: lateUtc, timezone: London }))).toBe(false);
    const kolkata = makeLimits({ now: new Date("2026-10-15T20:00:00Z"), timezone: "Asia/Kolkata" }); // 16 Oct 01:30
    expect(isDayDisabled("2026-10-15", kolkata)).toBe(true);
  });

  it("an offer that ended leaves nothing to pick", () => {
    expect(firstEnabledDate(limits({ endsOn: "2026-10-10" }))).toBeNull();
  });

  it("times are every 15 minutes; on today the ones less than the queue's lead time away are disabled", () => {
    const steps = timeSteps(15);
    expect(steps).toHaveLength(96);
    expect(steps[0]).toBe("00:00");
    expect(steps[5]).toBe("01:15");
    expect(steps.at(-1)).toBe("23:45");
    expect(timesFor("2026-10-16", limits())).toEqual(steps);
    const l = limits(); // 13:00 local now, 10 minutes of lead
    expect(isTimeDisabled("2026-10-15", "09:00", l)).toBe(true);
    expect(isTimeDisabled("2026-10-15", "13:00", l)).toBe(true);
    expect(isTimeDisabled("2026-10-15", "13:15", l)).toBe(false);
    expect(isTimeDisabled("2026-10-16", "00:00", l)).toBe(false);
    expect(isTimeDisabled("2026-10-14", "12:00", l)).toBe(true);
  });

  it("with an allowed list only those instants can be picked, and each day lists its own times", () => {
    const allowed = ["2026-10-16T09:00:00.000Z", "2026-10-16T14:30:00.000Z", "2026-10-19T09:00:00.000Z"];
    const l = limits({ allowed });
    expect(isDayDisabled("2026-10-16", l)).toBe(false);
    expect(isDayDisabled("2026-10-17", l)).toBe(true);
    expect(isDayDisabled("2026-10-19", l)).toBe(false);
    expect(timesFor("2026-10-16", l)).toEqual(["10:00", "15:30"]); // BST: UTC+1
    expect(isTimeDisabled("2026-10-16", "10:00", l)).toBe(false);
    expect(isTimeDisabled("2026-10-16", "10:15", l)).toBe(true);
    expect(firstEnabledDate(l)).toBe("2026-10-16");
  });
});

describe("time zones: what is shown in the brand's zone is stored as the right instant", () => {
  it.each([
    ["Europe/London", "2026-10-16", "10:00", "2026-10-16T09:00:00.000Z"], // BST
    ["Europe/London", "2026-10-26", "10:00", "2026-10-26T10:00:00.000Z"], // GMT after the clocks went back
    ["Asia/Kolkata", "2026-10-16", "10:00", "2026-10-16T04:30:00.000Z"],
    ["America/New_York", "2026-10-16", "10:00", "2026-10-16T14:00:00.000Z"], // EDT
    ["Australia/Sydney", "2026-10-16", "10:00", "2026-10-15T23:00:00.000Z"], // the day before in UTC
  ])("%s %s %s", (zone, date, time, iso) => {
    expect(toInstant(date, time, zone)).toBe(iso);
    expect(fromInstant(iso, zone)).toEqual({ date, time });
  });

  it("an invalid instant is not a value", () => {
    expect(fromInstant("not a date", London)).toBeNull();
  });
});

describe("the picker's markup", () => {
  const render = (props: Record<string, unknown> = {}) =>
    renderToString(
      createElement(DateTimePicker, { value: null, onChange: () => undefined, timezone: London, label: "Time for Instagram", now: NOW, locale: "en-GB", defaultOpen: true, ...props } as never),
    );

  it("a labelled button opens a labelled dialog with a month grid; today is marked, past days and days after the end date are disabled", () => {
    const html = render({ endsOn: "2026-10-20" });
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('aria-label="Time for Instagram: Choose date and time"');
    expect(html).toMatch(/role="dialog"[^>]*aria-label="Time for Instagram"/);
    expect(html).toContain('role="grid"');
    expect(html).toContain("October 2026");
    expect(html).toMatch(/data-date="2026-10-15"[^>]*data-today/);
    expect(html).toMatch(/data-date="2026-10-15"[^>]*aria-current="date"/);
    expect(html).toMatch(/data-date="2026-10-14"[^>]*aria-disabled="true"/);
    expect(html).toMatch(/data-date="2026-10-15"[^>]*aria-disabled="false"/);
    expect(html).toMatch(/data-date="2026-10-20"[^>]*aria-disabled="false"/);
    expect(html).toMatch(/data-date="2026-10-21"[^>]*aria-disabled="true"/);
    // Exactly one day can be reached with Tab (roving tabindex).
    expect(html.match(/data-date="[^"]+"[^>]*tabindex="0"/g)).toHaveLength(1);
    expect(html).toContain("Choose a day first.");
    expect(html).toContain("Times are in Europe/London.");
  });

  it("the week starts where the locale says", () => {
    expect(render({ locale: "en-GB" })).toMatch(/<th[^>]*abbr="Monday"[^>]*>Mo<\/th>/);
    expect(render({ locale: "en-US" })).toMatch(/<th[^>]*abbr="Sunday"[^>]*>Su<\/th>/);
    const mon = render({ locale: "en-GB" });
    expect(mon.indexOf('abbr="Monday"')).toBeLessThan(mon.indexOf('abbr="Sunday"'));
  });

  it("a picked value is shown in the brand's zone and lists the times of its day with the pick selected", () => {
    const html = render({ value: "2026-10-16T09:00:00.000Z" });
    expect(html).toContain("10:00");
    expect(html).toMatch(/data-date="2026-10-16"[^>]*data-selected/);
    expect(html).toContain('role="listbox"');
    expect((html.match(/role="option"/g) ?? []).length).toBe(96);
    expect(html).toMatch(/data-time="10:00"[^>]*aria-selected="true"/);
    expect(html).toMatch(/data-time="10:15"[^>]*aria-selected="false"/);
    expect(html).toContain("Fri 16 Oct, 10:00"); // trigger text, in the brand's zone
  });

  it("with an allowed list the list holds only the offered times, and other days are disabled", () => {
    const html = render({ allowed: ["2026-10-16T09:00:00.000Z", "2026-10-19T09:00:00.000Z"], value: "2026-10-16T09:00:00.000Z" });
    expect((html.match(/role="option"/g) ?? []).length).toBe(1);
    expect(html).toMatch(/data-date="2026-10-17"[^>]*aria-disabled="true"/);
    expect(html).toMatch(/data-date="2026-10-19"[^>]*aria-disabled="false"/);
  });

  it("closed, the popover is hidden and the button says it is collapsed", () => {
    const html = render({ defaultOpen: false });
    expect(html).toContain('aria-expanded="false"');
    expect(html).toMatch(/<div[^>]*role="dialog"[^>]*hidden=""/);
  });
});

describe("suggestions", () => {
  const suggested = ["2026-10-16T09:00:00.000Z", "2026-10-19T09:00:00.000Z"];

  it("suggested days and times are marked, but every other day and 15-minute time can still be picked", () => {
    const l = limits({ suggested, endsOn: "2026-10-31" });
    expect(l.suggestedDays.has("2026-10-16")).toBe(true);
    expect(l.suggestedTimes.has("2026-10-16 10:00")).toBe(true);
    expect(isDayDisabled("2026-10-17", l)).toBe(false);
    expect(timesFor("2026-10-17", l)).toHaveLength(96);
    expect(isTimeDisabled("2026-10-16", "10:15", l)).toBe(false);
  });

  it("the markup shows Suggested on those days and times only", () => {
    const html = renderToString(
      createElement(DateTimePicker, { value: "2026-10-16T09:00:00.000Z", onChange: () => undefined, timezone: London, label: "Time", now: NOW, locale: "en-GB", defaultOpen: true, suggested } as never),
    );
    expect(html).toMatch(/data-date="2026-10-16"[^>]*data-suggested/);
    expect(html).toMatch(/data-date="2026-10-19"[^>]*data-suggested/);
    expect(html).not.toMatch(/data-date="2026-10-17"[^>]*data-suggested/);
    expect(html).toMatch(/aria-label="[^"]*16 October 2026, Suggested"/);
    expect((html.match(/>Suggested</g) ?? []).length).toBe(1); // the 10:00 row of the 16th
    expect((html.match(/role="option"/g) ?? []).length).toBe(96);
  });
});
