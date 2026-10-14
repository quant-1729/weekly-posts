// Date ranges and expiry for post briefs (PRD v3 B-4 date range, change C-11). All dates are
// "YYYY-MM-DD" in the brand's time zone; "today" is today's date there, not on the server.
// Pure; safe in the browser.

import type { Brief } from './types';

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isIsoDate(v: unknown): v is string {
  if (typeof v !== 'string') return false;
  const m = ISO.exec(v);
  if (!m) return false;
  const t = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return t.getUTCFullYear() === Number(m[1]) && t.getUTCMonth() === Number(m[2]) - 1 && t.getUTCDate() === Number(m[3]);
}

/** Today's date in `timezone` (an IANA zone; UTC when it is missing or unknown). */
export function todayIn(now: Date, timezone: string | null | undefined): string {
  const zones = [timezone, 'UTC'];
  for (const tz of zones) {
    if (!tz) continue;
    try {
      return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
    } catch {
      // unknown zone: try the next
    }
  }
  return now.toISOString().slice(0, 10);
}

const dayNumber = (iso: string) => {
  const m = ISO.exec(iso)!;
  return Math.round(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86_400_000);
};

export type DateError = 'invalid_date' | 'dates_order' | 'end_in_past';

/**
 * Checks a date range: real dates, start on or before end, and (when `requireEndNotPast`) an end
 * that is not before today in `timezone`. Returns the error code or null.
 */
export function checkDateRange(
  r: { startsOn: string | null; endsOn: string | null },
  o: { timezone: string | null; now: Date; requireEndNotPast: boolean },
): DateError | null {
  if ((r.startsOn !== null && !isIsoDate(r.startsOn)) || (r.endsOn !== null && !isIsoDate(r.endsOn))) return 'invalid_date';
  if (r.startsOn && r.endsOn && r.startsOn > r.endsOn) return 'dates_order';
  if (o.requireEndNotPast && r.endsOn && r.endsOn < todayIn(o.now, o.timezone)) return 'end_in_past';
  return null;
}

/**
 * True once the end date has passed in the brief's time zone (the post is still good all through
 * the end date). A brief with no end date never expires. Expired posts must never be delivered or published.
 */
export function isExpired(brief: Pick<Brief, 'endsOn' | 'timezone'>, now: Date = new Date()): boolean {
  return !!brief.endsOn && brief.endsOn < todayIn(now, brief.timezone);
}

/**
 * Whole days from today (in the brief's time zone) to the end date: 0 on the last day, negative
 * once expired, null when there is no end date.
 */
export function daysLeft(brief: Pick<Brief, 'endsOn' | 'timezone'>, now: Date = new Date()): number | null {
  if (!brief.endsOn) return null;
  return dayNumber(brief.endsOn) - dayNumber(todayIn(now, brief.timezone));
}
