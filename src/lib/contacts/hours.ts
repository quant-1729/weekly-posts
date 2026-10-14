// Opening hours (PRD v3 B-4): per-day ranges and the short text a post shows. Pure; safe in the browser.

import { DAY_KEYS, type DayKey, type HoursDays, type TimeRange } from './types';

const DAY_LABEL: Record<DayKey, string> = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$|^24:00$/;
export const MAX_RANGES_PER_DAY = 3;
export const DISPLAY_MAX = 120;

export function emptyHours(): HoursDays {
  return { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] };
}

const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

export type HoursResult = { ok: true; days: HoursDays } | { ok: false; error: 'invalid_hours' | 'hours_time' | 'hours_overlap' | 'hours_none_open' };

/** Checks and tidies hours: valid times, open before close, no overlaps (sorted), at least one open day. */
export function parseHours(raw: unknown): HoursResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'invalid_hours' };
  const src = raw as Record<string, unknown>;
  const days = emptyHours();
  for (const d of DAY_KEYS) {
    const v = src[d];
    if (v === undefined || v === null) continue;
    if (!Array.isArray(v) || v.length > MAX_RANGES_PER_DAY) return { ok: false, error: 'invalid_hours' };
    const ranges: TimeRange[] = [];
    for (const r of v) {
      const o = (r && typeof r === 'object' ? r : {}) as Record<string, unknown>;
      if (typeof o.open !== 'string' || typeof o.close !== 'string' || !TIME_RE.test(o.open) || !TIME_RE.test(o.close) || o.open === '24:00') {
        return { ok: false, error: 'hours_time' };
      }
      if (minutes(o.open) >= minutes(o.close)) return { ok: false, error: 'hours_time' };
      ranges.push({ open: o.open, close: o.close });
    }
    ranges.sort((a, b) => minutes(a.open) - minutes(b.open));
    for (let i = 1; i < ranges.length; i++) {
      if (minutes(ranges[i].open) < minutes(ranges[i - 1].close)) return { ok: false, error: 'hours_overlap' };
    }
    days[d] = ranges;
  }
  if (DAY_KEYS.every((d) => days[d].length === 0)) return { ok: false, error: 'hours_none_open' };
  return { ok: true, days };
}

/** "09:00" -> "9:00". */
function shortTime(t: string): string {
  return `${Number(t.slice(0, 2))}:${t.slice(3, 5)}`;
}

function rangesText(ranges: TimeRange[]): string {
  return ranges.map((r) => `${shortTime(r.open)}-${shortTime(r.close)}`).join(' & ');
}

/**
 * The text a post shows: "Mon-Sat 9:00-18:00, Sun closed". Days in a row with the same hours are
 * joined; the same hours all week read "Daily 9:00-21:00". At most 120 characters.
 */
export function formatHours(days: HoursDays): string {
  const sig = DAY_KEYS.map((d) => (days[d].length === 0 ? 'closed' : rangesText(days[d])));
  const parts: string[] = [];
  let i = 0;
  while (i < DAY_KEYS.length) {
    let j = i;
    while (j + 1 < DAY_KEYS.length && sig[j + 1] === sig[i]) j++;
    const label = i === 0 && j === DAY_KEYS.length - 1 ? 'Daily' : i === j ? DAY_LABEL[DAY_KEYS[i]] : `${DAY_LABEL[DAY_KEYS[i]]}-${DAY_LABEL[DAY_KEYS[j]]}`;
    parts.push(`${label} ${sig[i]}`);
    i = j + 1;
  }
  const text = parts.join(', ');
  return text.length <= DISPLAY_MAX ? text : `${text.slice(0, DISPLAY_MAX - 1)}…`;
}
