// Pure helpers of the date-time picker (src/components/ui/date-time-picker.tsx): the month grid, which days and times may be
// picked, and the conversion between the wall clock in a time zone and the stored instant. No React, no date library.
//
// Dates are local calendar dates ("YYYY-MM-DD") and times are "HH:MM" wall-clock times in the BRAND's time zone; the picked
// value is stored as a UTC instant (an ISO string), the same as queue_items.slot_at, using the queue's own `zonedToUtc`.

import { addDaysIso, isoFromParts, weekdayOf } from "@/lib/occasions/dates";
import { MIN_LEAD_MS, localDateOf, localTimeOf, zonedToUtc } from "@/lib/queue/slots";

/** Regions whose weeks start on Sunday, for browsers that cannot tell us (Intl.Locale weekInfo). */
const SUNDAY_REGIONS = new Set(["US", "CA", "MX", "BR", "JP", "IN", "IL", "ZA", "PH", "AU", "KR", "TW", "HK", "SA", "PE", "CO", "VE", "TH", "PK", "BD", "NP", "ID", "ET", "KE", "DO", "GT", "HN", "NI", "PA", "PR", "SV", "TT", "ZW"]);
/** Regions whose weeks start on Saturday. */
const SATURDAY_REGIONS = new Set(["AE", "AF", "BH", "DJ", "DZ", "EG", "IQ", "IR", "JO", "KW", "LY", "OM", "QA", "SD", "SY"]);

/** First day of the week for a locale: 0 = Sunday ... 6 = Saturday. */
export function firstDayOfWeek(locale: string): number {
  try {
    const loc = new Intl.Locale(locale) as Intl.Locale & { getWeekInfo?: () => { firstDay: number }; weekInfo?: { firstDay: number } };
    const info = typeof loc.getWeekInfo === "function" ? loc.getWeekInfo() : loc.weekInfo;
    if (info && typeof info.firstDay === "number") return info.firstDay % 7; // Intl: 1 = Monday ... 7 = Sunday
    const region = loc.maximize().region ?? "";
    if (SATURDAY_REGIONS.has(region)) return 6;
    if (SUNDAY_REGIONS.has(region)) return 0;
  } catch {
    // An unknown locale: Monday.
  }
  return 1;
}

export interface GridDay {
  date: string;
  /** False for the days of the neighbouring months that fill the first and last week. */
  inMonth: boolean;
}

/** The weeks of a month (month 1-12) as rows of 7 days starting on `weekStart` (0 = Sunday); 5 or 6 rows. */
export function monthGrid(year: number, month: number, weekStart: number): GridDay[][] {
  const first = isoFromParts(year, month, 1);
  const lead = (weekdayOf(first) - weekStart + 7) % 7;
  const start = addDaysIso(first, -lead);
  const monthKey = first.slice(0, 7);
  const rows: GridDay[][] = [];
  for (let r = 0; r < 6; r++) {
    const row: GridDay[] = [];
    for (let c = 0; c < 7; c++) {
      const date = addDaysIso(start, r * 7 + c);
      row.push({ date, inMonth: date.startsWith(monthKey) });
    }
    if (r >= 4 && !row.some((d) => d.inMonth)) break; // no empty trailing week
    rows.push(row);
  }
  return rows;
}

/** The month after (or before, with a negative `by`) a "YYYY-MM" key. */
export function shiftMonth(key: string, by: number): string {
  const [y, m] = key.split("-").map(Number);
  const idx = y * 12 + (m - 1) + by;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`;
}

/** Times of a day at `stepMinutes` steps ("00:00", "00:15", ...). */
export function timeSteps(stepMinutes = 15): string[] {
  const out: string[] = [];
  for (let m = 0; m < 24 * 60; m += stepMinutes) out.push(`${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`);
  return out;
}

/** Short weekday names, in column order for a week starting on `weekStart`, with the long names for screen readers. */
export function weekdayHeaders(locale: string, weekStart: number): { short: string; long: string }[] {
  const short = new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" });
  const long = new Intl.DateTimeFormat(locale, { weekday: "long", timeZone: "UTC" });
  // 2024-01-07 was a Sunday.
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(Date.UTC(2024, 0, 7 + ((weekStart + i) % 7)));
    return { short: short.format(d), long: long.format(d) };
  });
}

export interface PickerInput {
  now: Date;
  timezone: string;
  /** Last local date that may be picked (an offer's end date), or null. */
  endsOn?: string | null;
  /** When given, only these instants may be picked (the free slots the queue offers). */
  allowed?: readonly string[] | null;
  /** Instants to mark as suggestions; every day and time that passes the other rules can still be picked. */
  suggested?: readonly string[] | null;
}

/** `PickerInput` with the expensive parts worked out once (today in the zone, the allowed instants as local date + time). */
export interface PickerLimits {
  now: Date;
  timezone: string;
  endsOn: string | null;
  today: string;
  /** Null = free mode. */
  parts: { date: string; time: string; at: number }[] | null;
  /** Suggested days ("YYYY-MM-DD") and times ("YYYY-MM-DD HH:MM"). */
  suggestedDays: Set<string>;
  suggestedTimes: Set<string>;
}

/** The local date and wall-clock time of a stored instant, in the brand's time zone. */
export function fromInstant(iso: string, timezone: string): { date: string; time: string } | null {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  return { date: localDateOf(at, timezone), time: localTimeOf(at, timezone) };
}

/** The instant (ISO string) at which the wall clock in `timezone` shows `date` and `time`: the value that is stored. */
export function toInstant(date: string, time: string, timezone: string): string {
  return zonedToUtc(date, time, timezone).toISOString();
}

/** Today's date in the brand's time zone. */
export const todayIn = (now: Date, timezone: string): string => localDateOf(now, timezone);

/** Works out what the checks below need, once per render. */
export function makeLimits(input: PickerInput): PickerLimits {
  const parts = input.allowed
    ? input.allowed.flatMap((iso) => {
        const p = fromInstant(iso, input.timezone);
        return p ? [{ ...p, at: new Date(iso).getTime() }] : [];
      })
    : null;
  const sug = (input.suggested ?? []).flatMap((iso) => {
    const p = fromInstant(iso, input.timezone);
    return p ? [p] : [];
  });
  return {
    now: input.now,
    timezone: input.timezone,
    endsOn: input.endsOn ?? null,
    today: todayIn(input.now, input.timezone),
    parts,
    suggestedDays: new Set(sug.map((p) => p.date)),
    suggestedTimes: new Set(sug.map((p) => `${p.date} ${p.time}`)),
  };
}

const soonest = (limits: PickerLimits) => limits.now.getTime() + MIN_LEAD_MS;

/** A day cannot be picked when it is in the past, after the end date, or (with an allowed list) holds no allowed time that is still ahead. */
export function isDayDisabled(date: string, limits: PickerLimits): boolean {
  if (date < limits.today) return true;
  if (limits.endsOn && date > limits.endsOn) return true;
  if (limits.parts) return !limits.parts.some((p) => p.date === date && p.at >= soonest(limits));
  // Today with the last step already gone: nothing left to pick.
  return date === limits.today && zonedToUtc(date, "23:45", limits.timezone).getTime() < soonest(limits);
}

/** The times offered on a day: every step in free mode, only the allowed ones otherwise. */
export function timesFor(date: string, limits: PickerLimits, stepMinutes = 15): string[] {
  if (limits.parts) return limits.parts.filter((p) => p.date === date).map((p) => p.time);
  return timeSteps(stepMinutes);
}

/** A time cannot be picked when that moment is less than the queue's lead time from now (or past, on today), or not on the allowed list. */
export function isTimeDisabled(date: string, time: string, limits: PickerLimits): boolean {
  if (isDayDisabled(date, limits)) return true;
  if (limits.parts) {
    const hit = limits.parts.find((p) => p.date === date && p.time === time);
    return !hit || hit.at < soonest(limits);
  }
  // Only today (and, around midnight, tomorrow) can have a time that is too soon: no need to work out the instant for later days.
  if (date > addDaysIso(limits.today, 1)) return false;
  return zonedToUtc(date, time, limits.timezone).getTime() < soonest(limits);
}

/** The first date that may be picked, searching forward from today (null when none in the next 400 days). */
export function firstEnabledDate(limits: PickerLimits): string | null {
  for (let i = 0; i < 400; i++) {
    const d = addDaysIso(limits.today, i);
    if (limits.endsOn && d > limits.endsOn) return null;
    if (!isDayDisabled(d, limits)) return d;
  }
  return null;
}
