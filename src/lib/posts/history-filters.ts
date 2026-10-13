import type { ContentLanguage } from "@/lib/ai/schemas";
import { addDays, istDayStart, istMonthStart, istWeekStart, parseIstDate } from "./ist";

/**
 * History filters as they live in the page URL: `?range=today|week|month`,
 * `?date=YYYY-MM-DD` (a single IST day, wins over range) and `?lang=hi|hinglish|en`.
 * Pure, so the page, the "Load more" action and the tests share one parser.
 */

export const RANGE_PRESETS = ["all", "today", "week", "month"] as const;
export type RangePreset = (typeof RANGE_PRESETS)[number];
export const HISTORY_LANGUAGES: readonly ContentLanguage[] = ["hi", "hinglish", "en"];

export interface HistoryFilters {
  range: RangePreset;
  /** A single IST day, "YYYY-MM-DD". When set, `range` is "all". */
  date: string | null;
  language: ContentLanguage | null;
}

type SearchParams = Record<string, string | string[] | undefined>;

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export function parseHistoryFilters(sp: SearchParams): HistoryFilters {
  const lang = first(sp.lang);
  const language = HISTORY_LANGUAGES.find((l) => l === lang) ?? null;
  const dateText = first(sp.date);
  if (dateText && parseIstDate(dateText)) return { range: "all", date: dateText, language };
  const range = RANGE_PRESETS.find((r) => r === first(sp.range)) ?? "all";
  return { range, date: null, language };
}

/** The time window for the filters, as [from, to) in UTC instants. Null means open-ended. */
export function dateWindow(filters: HistoryFilters, now: Date = new Date()): { from: Date | null; to: Date | null } {
  if (filters.date) {
    const from = parseIstDate(filters.date);
    return from ? { from, to: addDays(from, 1) } : { from: null, to: null };
  }
  switch (filters.range) {
    case "today": {
      const from = istDayStart(now);
      return { from, to: addDays(from, 1) };
    }
    case "week": {
      const from = istWeekStart(now);
      return { from, to: addDays(from, 7) };
    }
    case "month":
      return { from: istMonthStart(now), to: istMonthStart(now, 1) };
    default:
      return { from: null, to: null };
  }
}

/** URL of the history page for the filters (default values are left out). */
export function historyHref(filters: HistoryFilters): string {
  const q = new URLSearchParams();
  if (filters.date) q.set("date", filters.date);
  else if (filters.range !== "all") q.set("range", filters.range);
  if (filters.language) q.set("lang", filters.language);
  const qs = q.toString();
  return qs ? `/history?${qs}` : "/history";
}
