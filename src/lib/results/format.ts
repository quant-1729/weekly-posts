import { fill, s } from "@/lib/i18n/strings";

// Plain-language wording for the results (Req 21). Pure functions, no database.

const r = s.results;

export const postsPhrase = (n: number): string => (n === 1 ? r.postOne : fill(r.postMany, { n }));

/** "at least 23 clicks": clicks are best-effort, so the number is a floor. */
export const clicksPhrase = (n: number): string => (n === 1 ? r.clicksAtLeastOne : fill(r.clicksAtLeast, { n }));

/** "about 3 hours", "about 1.5 hours", "about 40 minutes". Null when there is nothing to show. */
export function timeSavedPhrase(totalMinutes: number): string | null {
  if (!Number.isFinite(totalMinutes) || totalMinutes <= 0) return null;
  let text: string;
  if (totalMinutes < 60) {
    const m = Math.round(totalMinutes);
    text = m === 1 ? r.minutesOne : fill(r.minutesMany, { n: m });
  } else {
    const hours = Math.round(totalMinutes / 30) / 2; // nearest half hour
    text = hours === 1 ? r.hourOne : fill(r.hoursMany, { n: hours });
  }
  return fill(r.timeAbout, { time: text });
}

/** English month name of a "YYYY-MM-DD" date, e.g. "September". */
export function monthName(date: string): string {
  return new Intl.DateTimeFormat("en-GB", { month: "long", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
}

function offsetMs(instant: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? "0");
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/** The instant at which local midnight of "YYYY-MM-DD" happens in an IANA time zone. */
export function zonedMidnight(date: string, timezone: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const wall = Date.UTC(y, m - 1, d);
  let t = wall;
  for (let i = 0; i < 3; i++) {
    const next = wall - offsetMs(new Date(t), timezone);
    if (next === t) break;
    t = next;
  }
  return new Date(t);
}

/** "YYYY-MM-01" of the month containing a "YYYY-MM-DD" date, shifted by `delta` months. */
export function monthStartOf(date: string, delta = 0): string {
  const [y, m] = date.split("-").map(Number);
  const idx = y * 12 + (m - 1) + delta;
  const year = Math.floor(idx / 12);
  const month = (idx % 12) + 1;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-01`;
}
