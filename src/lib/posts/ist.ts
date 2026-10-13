/**
 * Indian Standard Time helpers (UTC+5:30, no daylight saving). Pure, so both
 * server code and client components can use them.
 */

const IST_OFFSET_MS = 330 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Midnight IST at the start of the IST day containing `d`. */
export function istDayStart(d: Date): Date {
  const shifted = d.getTime() + IST_OFFSET_MS;
  return new Date(shifted - (((shifted % DAY_MS) + DAY_MS) % DAY_MS) - IST_OFFSET_MS);
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * DAY_MS);
}

/** Monday 00:00 IST of the week containing `d` (weeks start on Monday, like the weekly plan). */
export function istWeekStart(d: Date): Date {
  const start = istDayStart(d);
  // start + offset is midnight UTC on the IST calendar date, so getUTCDay is the IST weekday.
  const weekday = new Date(start.getTime() + IST_OFFSET_MS).getUTCDay();
  return addDays(start, -((weekday + 6) % 7));
}

/** 00:00 IST on the 1st of the month containing `d`, shifted by `monthsAhead` months. */
export function istMonthStart(d: Date, monthsAhead = 0): Date {
  const shifted = new Date(d.getTime() + IST_OFFSET_MS);
  return new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth() + monthsAhead, 1) - IST_OFFSET_MS);
}

/** "2026-10-13" for the IST calendar date of `d`. */
export function istDateString(d: Date): string {
  return new Date(d.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** Midnight IST at the start of "YYYY-MM-DD", or null if the text is not a real calendar date. */
export function parseIstDate(text: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!m) return null;
  const [y, mo, da] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const utc = new Date(Date.UTC(y, mo - 1, da));
  if (utc.getUTCFullYear() !== y || utc.getUTCMonth() !== mo - 1 || utc.getUTCDate() !== da) return null;
  return new Date(utc.getTime() - IST_OFFSET_MS);
}

const parts = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

/** "13 Oct, 7:42 pm", in IST. Built from parts so the shape does not depend on the ICU version. */
export function formatIstDateTime(d: Date): string {
  const p: Record<string, string> = {};
  for (const x of parts.formatToParts(d)) p[x.type] = x.value;
  return `${p.day} ${p.month}, ${p.hour}:${p.minute} ${(p.dayPeriod ?? "").toLowerCase()}`;
}
