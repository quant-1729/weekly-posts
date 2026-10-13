/**
 * Date rules for the curated observances (observances.json). Rules are data;
 * the dates are computed here.
 */
import observancesData from "./observances.json";
import { addDaysIso, isoFromParts, weekdayOf } from "./dates";

export type DateRule =
  | { type: "fixed"; month: number; day: number }
  | { type: "nth-weekday"; month: number; weekday: number; n: number }
  | { type: "easter"; offsetDays: number }
  | { type: "after-nth-weekday"; month: number; weekday: number; n: number; offsetDays: number };

export interface CuratedObservance {
  slug: string;
  name: string;
  aliases: string[];
  sensitive: boolean;
  excludeCategories: string[];
  rules: Array<{ countries: string[] | "*"; rule: DateRule }>;
}

export const CURATED_OBSERVANCES: CuratedObservance[] = (
  observancesData as unknown as { observances: CuratedObservance[] }
).observances;

/** Easter Sunday (Gregorian, Western churches) as "YYYY-MM-DD". Anonymous Gregorian algorithm. */
export function easterSunday(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return isoFromParts(year, month, day);
}

/** The nth (1-4) or last (-1) given weekday (0 = Sunday) of a month. */
export function nthWeekdayOfMonth(year: number, month: number, weekday: number, n: number): string {
  if (n === -1) {
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const last = isoFromParts(year, month, lastDay);
    return addDaysIso(last, -((weekdayOf(last) - weekday + 7) % 7));
  }
  const first = isoFromParts(year, month, 1);
  const offset = (weekday - weekdayOf(first) + 7) % 7;
  return addDaysIso(first, offset + (n - 1) * 7);
}

export function computeRule(rule: DateRule, year: number): string {
  switch (rule.type) {
    case "fixed":
      return isoFromParts(year, rule.month, rule.day);
    case "nth-weekday":
      return nthWeekdayOfMonth(year, rule.month, rule.weekday, rule.n);
    case "easter":
      return addDaysIso(easterSunday(year), rule.offsetDays);
    case "after-nth-weekday":
      return addDaysIso(nthWeekdayOfMonth(year, rule.month, rule.weekday, rule.n), rule.offsetDays);
  }
}

/** The date of a curated observance in `year` for `country`, or null if it does not apply there. */
export function observanceDate(o: CuratedObservance, country: string, year: number): string | null {
  const cc = country.toUpperCase();
  const hit = o.rules.find((r) => r.countries === "*" || r.countries.includes(cc));
  return hit ? computeRule(hit.rule, year) : null;
}
