/**
 * Upcoming occasions for the weekly batch (Req 7): a public holiday dataset by
 * country and region, a curated list of commercial days, the verified India
 * calendar (IN only) and the dates the owner added. Sensitive days (mourning,
 * remembrance) are marked so posts for them are respectful or skipped (PRD §8).
 *
 * No network and no AI: everything is bundled data plus date rules.
 */
import Holidays from "date-holidays";
import type { WeeklyOccasion } from "@/lib/ai/prompts/v2-weekly";
import festivalsData from "@/lib/calendar/festivals.json";
import { addDaysIso, isValidIsoDate, isoFromParts, parseIsoDate } from "./dates";
import { CURATED_OBSERVANCES, observanceDate } from "./rules";

export { weekStartFor, weekDays, localDateIn } from "./dates";
export type { WeeklyOccasion };

/** Shown on the terms and about pages. date-holidays data is CC BY 3.0 and needs attribution. */
export const HOLIDAY_DATA_ATTRIBUTION = "Public holiday data: date-holidays (CC BY 3.0)";

export interface OwnerDateInput {
  /** "YYYY-MM-DD". For a yearly date only the month and day matter. */
  date: string;
  name: string;
  yearly: boolean;
}

export interface GetOccasionsArgs {
  /** ISO 3166-1 alpha-2, e.g. "GB". */
  country: string;
  /** ISO 3166-2, e.g. "US-OR" or "GB-ENG". Unknown regions fall back to the country. */
  region?: string | null;
  /** Local Monday of the week, "YYYY-MM-DD". */
  weekStart: string;
  /**
   * The business's IANA time zone. Holiday dates are already local calendar
   * dates and weekStart is a local date, so it is validated but not needed to
   * place the occasions.
   */
  timezone?: string;
  /** Occasions up to this many days after the week are included so posts can lead into them. */
  lookaheadDays?: number;
  ownerDates?: OwnerDateInput[];
  /** Free-text category or regulated group (health, finance, ...). Only used to drop clearly irrelevant days. */
  category?: string | null;
}

export const SENSITIVE_NAME_RE = /remembrance|memorial|martyr|mourning|ashura|muharram|good friday|holocaust|anzac|yom kippur/i;

const PACKAGE_TYPES = new Set(["public", "bank", "observance"]);
const INDIA_TYPES = new Set(["festival", "national", "shopping"]);

// Priority when two entries describe the same day: owner's name, then curated, then India calendar, then the dataset.
const PRIORITY = { owner: 0, curated: 1, india: 2, dataset: 3 } as const;

interface Candidate {
  names: string[]; // the display name first, then aliases used for matching
  start: string; // first day (YYYY-MM-DD)
  end: string; // last day, same as start for single days
  sensitive: boolean;
  source: "holiday" | "owner";
  priority: number;
}

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

export function slug(name: string): string {
  const s = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/['’`]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  return s || "occasion";
}

const NAME_STOPWORDS = new Set(["day", "the", "of", "and", "a"]);

function nameTokens(name: string): Set<string> {
  const all = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/['’`]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(" ")
    .filter(Boolean);
  const core = all.filter((t) => !NAME_STOPWORDS.has(t));
  return new Set(core.length > 0 ? core : all);
}

function similarTokens(a: Set<string>, b: Set<string>): boolean {
  if (a.size === 0 || b.size === 0) return false;
  let shared = 0;
  for (const t of a) if (b.has(t)) shared += 1;
  if (shared === 0) return false;
  if (shared === a.size || shared === b.size) return true; // equal, or one contains the other
  return shared / (a.size + b.size - shared) >= 0.6;
}

function similarNames(a: string[], b: string[]): boolean {
  const tb = b.map(nameTokens);
  return a.map(nameTokens).some((x) => tb.some((y) => similarTokens(x, y)));
}

// ---------------------------------------------------------------------------
// Category filter (light: only clearly irrelevant days)
// ---------------------------------------------------------------------------

const CATEGORY_GROUPS: Record<string, RegExp> = {
  health: /health|medical|medic|clinic|dental|dentist|doctor|pharmac|hospital|physio|therap/i,
  finance: /financ|bank|insur|loan|invest|mortgage|credit|wealth/i,
};

function categoryGroups(category: string | null | undefined): string[] {
  if (!category) return [];
  return Object.entries(CATEGORY_GROUPS)
    .filter(([, re]) => re.test(category))
    .map(([group]) => group);
}

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

const holidaysCache = new Map<string, Holidays | null>();

/** Maps "US-OR" to the package's state code "OR". Unknown regions give undefined (country-only). */
function packageRegion(hd: Holidays, country: string, region: string | null | undefined): string | undefined {
  if (!region) return undefined;
  let r = region.trim().toUpperCase();
  if (r.startsWith(`${country}-`)) r = r.slice(country.length + 1);
  const states = hd.getStates(country) as Record<string, string> | undefined;
  return states && Object.prototype.hasOwnProperty.call(states, r) ? r : undefined;
}

function getHolidays(country: string, region: string | null | undefined): Holidays | null {
  const cacheKey = `${country}|${region ?? ""}`;
  if (holidaysCache.has(cacheKey)) return holidaysCache.get(cacheKey)!;
  let result: Holidays | null = null;
  try {
    const base = new Holidays(country, { languages: ["en"] });
    const code = packageRegion(base, country, region);
    result = code ? new Holidays(country, code, { languages: ["en"] }) : base;
  } catch {
    result = null;
  }
  holidaysCache.set(cacheKey, result);
  return result;
}

/** Public/bank/observance days from date-holidays, with multi-day runs (same name on consecutive days) merged. */
function datasetCandidates(country: string, region: string | null | undefined, years: number[]): Candidate[] {
  const hd = getHolidays(country, region);
  if (!hd) return [];
  const rows: Array<{ date: string; name: string }> = [];
  for (const year of years) {
    for (const h of hd.getHolidays(year)) {
      if (!PACKAGE_TYPES.has(h.type)) continue;
      rows.push({ date: h.date.slice(0, 10), name: h.name }); // the package's own local date; times ignored
    }
  }
  rows.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));

  const runs: Candidate[] = [];
  for (const row of rows) {
    const sameName = (c: Candidate) => c.names[0].replace(/\s*\([^)]*\)/g, "").toLowerCase() === row.name.replace(/\s*\([^)]*\)/g, "").toLowerCase();
    const open = runs.find((c) => sameName(c) && row.date >= c.start && row.date <= addDaysIso(c.end, 1));
    if (open) {
      if (row.date > open.end) open.end = row.date;
      continue;
    }
    runs.push({
      names: [row.name],
      start: row.date,
      end: row.date,
      sensitive: false,
      source: "holiday",
      priority: PRIORITY.dataset,
    });
  }
  return runs;
}

function curatedCandidates(country: string, years: number[], groups: string[]): Candidate[] {
  const out: Candidate[] = [];
  for (const o of CURATED_OBSERVANCES) {
    if (o.excludeCategories.some((g) => groups.includes(g))) continue;
    for (const year of years) {
      const date = observanceDate(o, country, year);
      if (!date) continue;
      out.push({
        names: [o.name, ...o.aliases],
        start: date,
        end: date,
        sensitive: o.sensitive,
        source: "holiday",
        priority: PRIORITY.curated,
      });
    }
  }
  return out;
}

interface Festival {
  name_en: string;
  date: string;
  end_date: string | null;
  type: string;
  regions: string[];
}

/** The verified India calendar (IN only): pan-india entries, plus entries listing the business's state. */
function indiaCandidates(region: string | null | undefined): Candidate[] {
  const hd = getHolidays("IN", region);
  let stateName: string | undefined;
  if (region) {
    const states = (hd?.getStates("IN") ?? {}) as Record<string, string>;
    let r = region.trim();
    if (r.toUpperCase().startsWith("IN-")) r = r.slice(3);
    stateName = states[r.toUpperCase()] ?? Object.values(states).find((s) => s.toLowerCase() === r.toLowerCase());
  }
  const out: Candidate[] = [];
  for (const f of festivalsData as Festival[]) {
    if (!INDIA_TYPES.has(f.type)) continue;
    const pan = f.regions.some((r) => r.toLowerCase() === "pan-india");
    const stateMatch = stateName !== undefined && f.regions.some((r) => r.toLowerCase() === stateName!.toLowerCase());
    if (!pan && !stateMatch) continue;
    out.push({
      names: [f.name_en],
      start: f.date,
      end: f.end_date && f.end_date > f.date ? f.end_date : f.date,
      sensitive: false,
      source: "holiday",
      priority: PRIORITY.india,
    });
  }
  return out;
}

function ownerCandidates(dates: OwnerDateInput[], years: number[]): Candidate[] {
  const out: Candidate[] = [];
  for (const d of dates) {
    const name = d.name.trim();
    const parsed = parseIsoDate(d.date);
    if (!name || !parsed) continue;
    const add = (date: string) =>
      out.push({ names: [name], start: date, end: date, sensitive: false, source: "owner", priority: PRIORITY.owner });
    if (!d.yearly) {
      add(d.date);
      continue;
    }
    const month = parsed.getUTCMonth() + 1;
    const day = parsed.getUTCDate();
    for (const year of years) {
      // 29 Feb falls back to 28 Feb in years without one.
      const date = isoFromParts(year, month, day);
      add(date.slice(5, 7) === String(month).padStart(2, "0") ? date : isoFromParts(year, 2, 28));
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// getOccasions
// ---------------------------------------------------------------------------

export function getOccasions(args: GetOccasionsArgs): WeeklyOccasion[] {
  const { weekStart } = args;
  if (!isValidIsoDate(weekStart)) throw new Error(`Invalid week start: ${weekStart}`);
  const lookahead = args.lookaheadDays ?? 3;
  if (!Number.isInteger(lookahead) || lookahead < 0) throw new RangeError("lookaheadDays must be a whole number, 0 or more");
  if (args.timezone) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: args.timezone });
    } catch {
      throw new RangeError(`Unknown time zone: ${args.timezone}`);
    }
  }

  const country = args.country.trim().toUpperCase();
  const windowStart = weekStart;
  const windowEnd = addDaysIso(weekStart, 6 + lookahead);
  const y0 = Number(windowStart.slice(0, 4));
  const y1 = Number(windowEnd.slice(0, 4));
  const years = y0 === y1 ? [y0] : [y0, y1];
  const groups = categoryGroups(args.category);

  let candidates: Candidate[] = [
    ...ownerCandidates(args.ownerDates ?? [], years),
    ...curatedCandidates(country, years, groups),
    ...(country === "IN" ? indiaCandidates(args.region) : []),
    ...datasetCandidates(country, args.region, years),
  ];

  // Drop days the category rules out (e.g. Halloween for health), whichever source names them.
  if (groups.length > 0) {
    const excluded = CURATED_OBSERVANCES.filter((o) => o.excludeCategories.some((g) => groups.includes(g))).map((o) => [
      o.name,
      ...o.aliases,
    ]);
    candidates = candidates.filter((c) => c.source === "owner" || !excluded.some((names) => similarNames(c.names, names)));
  }

  // Keep what overlaps the window; a multi-day run that began earlier starts at the window.
  const inWindow = candidates
    .filter((c) => c.end >= windowStart && c.start <= windowEnd)
    .map((c) => ({
      ...c,
      date: c.start < windowStart ? windowStart : c.start,
      sensitive: c.sensitive || c.names.some((n) => SENSITIVE_NAME_RE.test(n)),
    }));

  // Merge: same date and the same or a very similar name is one entry; higher priority supplies the name.
  inWindow.sort((a, b) => a.priority - b.priority);
  const merged: Array<(typeof inWindow)[number]> = [];
  for (const c of inWindow) {
    const same = merged.find((m) => m.date === c.date && similarNames(m.names, c.names));
    if (same) {
      same.sensitive = same.sensitive || c.sensitive;
      continue;
    }
    merged.push({ ...c });
  }

  return merged
    .map((c) => {
      const name = c.names[0];
      return {
        key: `${c.source}-${slug(name)}-${c.date}`,
        name,
        date: c.date,
        sensitive: c.sensitive,
        source: c.source,
      } satisfies WeeklyOccasion;
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.source.localeCompare(b.source) || a.name.localeCompare(b.name));
}
