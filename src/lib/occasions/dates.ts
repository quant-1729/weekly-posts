/**
 * Calendar-date helpers for weekly generation. Dates are plain "YYYY-MM-DD"
 * strings (a local calendar date, no time zone). Arithmetic runs on UTC
 * midnight of that date, so daylight-saving changes cannot shift a day.
 */

export const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Parses "YYYY-MM-DD" to UTC midnight, or null if it is not a real calendar date. */
export function parseIsoDate(text: string): Date | null {
  const m = DATE_RE.exec(text);
  if (!m) return null;
  const [y, mo, da] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const d = new Date(Date.UTC(y, mo - 1, da));
  if (d.getUTCFullYear() !== y || d.getUTCMonth() !== mo - 1 || d.getUTCDate() !== da) return null;
  return d;
}

export function isValidIsoDate(text: string): boolean {
  return parseIsoDate(text) !== null;
}

export function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Builds "YYYY-MM-DD" from numeric parts (month 1-12). Years below 1000 are not supported. */
export function isoFromParts(year: number, month: number, day: number): string {
  return toIsoDate(new Date(Date.UTC(year, month - 1, day)));
}

export function addDaysIso(date: string, days: number): string {
  const d = parseIsoDate(date);
  if (!d) throw new Error(`Invalid date: ${date}`);
  return toIsoDate(new Date(d.getTime() + days * 86_400_000));
}

/** 0 = Sunday ... 6 = Saturday for a "YYYY-MM-DD" date. */
export function weekdayOf(date: string): number {
  const d = parseIsoDate(date);
  if (!d) throw new Error(`Invalid date: ${date}`);
  return d.getUTCDay();
}

function assertTimeZone(timezone: string): void {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
  } catch {
    throw new RangeError(`Unknown time zone: ${timezone}`);
  }
}

/** The calendar date ("YYYY-MM-DD") of an instant in an IANA time zone. */
export function localDateIn(now: Date, timezone: string): string {
  assertTimeZone(timezone);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year").padStart(4, "0")}-${get("month")}-${get("day")}`;
}

/**
 * The local Monday ("YYYY-MM-DD") of the week containing `now` in `timezone`.
 * Weeks start on Monday, as in the weekly email.
 */
export function weekStartFor(now: Date, timezone: string): string {
  const local = localDateIn(now, timezone);
  const weekday = weekdayOf(local);
  return addDaysIso(local, -((weekday + 6) % 7));
}

/** The 7 days of the week starting at `weekStart`, e.g. { date: "2026-11-09", weekday: "Monday" }. */
export function weekDays(weekStart: string): Array<{ date: string; weekday: string }> {
  if (!isValidIsoDate(weekStart)) throw new Error(`Invalid week start: ${weekStart}`);
  return Array.from({ length: 7 }, (_, i) => {
    const date = addDaysIso(weekStart, i);
    return { date, weekday: WEEKDAY_NAMES[weekdayOf(date)] };
  });
}
