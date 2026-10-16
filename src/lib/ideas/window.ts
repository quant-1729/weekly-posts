// The research date window (R-2). Set in code, never by the model: the last RESEARCH_WINDOW_DAYS days up to
// today, where "today" is the date in the brand's own time zone.

import { addDaysIso, isValidIsoDate, localDateIn } from "@/lib/occasions/dates";
import { RESEARCH_WINDOW_DAYS } from "./types";

export interface ResearchWindow {
  /** YYYY-MM-DD, inclusive. */
  start: string;
  /** YYYY-MM-DD, inclusive. This is "today" in the brand's time zone. */
  end: string;
}

export function researchWindow(now: Date, timezone: string): ResearchWindow {
  let tz = timezone || "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
  } catch {
    tz = "UTC";
  }
  const end = localDateIn(now, tz);
  return { start: addDaysIso(end, -RESEARCH_WINDOW_DAYS), end };
}

/** A source date is usable only when it is a real YYYY-MM-DD date inside the window. */
export function inWindow(date: string | null | undefined, w: ResearchWindow): boolean {
  if (typeof date !== "string" || !isValidIsoDate(date)) return false;
  return date >= w.start && date <= w.end;
}

/** Whole days from `date` to the window end (0 = today). */
export function ageDays(date: string, w: ResearchWindow): number {
  const a = Date.parse(`${date}T00:00:00Z`);
  const b = Date.parse(`${w.end}T00:00:00Z`);
  return Math.max(0, Math.round((b - a) / 86_400_000));
}
