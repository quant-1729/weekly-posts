// When weekly generation runs (Req 7). The hourly cron sweep asks `dueBrands(now)` which brands'
// local time has passed their chosen weekday and time. All wall-clock maths is done on local
// date/time strings from Intl, so a daylight-saving change cannot move a brand's slot.

import { addDaysIso, isValidIsoDate, weekStartFor, weekdayOf, localDateIn } from '@/lib/occasions/dates';
import { getDb } from '@/lib/db';
import { BATCH_STATE_COLUMNS, MAX_CRON_ATTEMPTS, RETRY_WINDOW_MS, STALE_GENERATING_MS, readBatchState, toDate } from './meta';

/** ISO weekday: 1 = Monday ... 7 = Sunday, of a "YYYY-MM-DD" date. */
export function isoWeekday(date: string): number {
  return ((weekdayOf(date) + 6) % 7) + 1;
}

/**
 * The Monday of the week the posts are for, given the local date of the scheduled run: that
 * date itself when it is a Monday, else the next Monday. (A Friday run prepares next week.)
 * Accepts "YYYY-MM-DD" or a longer local timestamp that starts with the date.
 */
export function targetWeekStart(scheduledLocal: string): string {
  const date = scheduledLocal.slice(0, 10);
  if (!isValidIsoDate(date)) throw new Error(`Invalid date: ${scheduledLocal}`);
  const wd = isoWeekday(date);
  return wd === 1 ? date : addDaysIso(date, 8 - wd);
}

/**
 * The week the "Generate now" button prepares: the current local week while it is still
 * Monday to Wednesday, else the next week.
 */
export function buttonWeekStart(now: Date, timezone: string): string {
  const local = localDateIn(now, timezone);
  const monday = weekStartFor(now, timezone);
  return isoWeekday(local) <= 3 ? monday : addDaysIso(monday, 7);
}

/** Local date ("YYYY-MM-DD") and time ("HH:MM:SS") of an instant in a time zone. */
export function localClock(now: Date, timezone: string): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  return { date: localDateIn(now, timezone), time: `${get('hour')}:${get('minute')}:${get('second')}` };
}

function normTime(t: string): string {
  const [h = '00', m = '00', s = '00'] = t.split(':');
  return `${h.padStart(2, '0')}:${m.padStart(2, '0')}:${s.slice(0, 2).padStart(2, '0')}`;
}

export interface DueBrand {
  brandId: string;
  /** Monday the posts are for. */
  weekStart: string;
  /** Number of the attempt this run will be (1 for a first run). */
  attempt: number;
  reason: 'scheduled' | 'retry' | 'stale';
}

interface BrandRow {
  brand_id: string;
  timezone: string;
  weekday: number;
  time: string;
  paused_until: string | null;
}
interface BatchRow {
  brand_id: string;
  week_start: string;
  status: string;
  error: string | null;
  attempts: number;
  regens: number;
  claimed_at: Date | string | null;
  created_at: Date | string;
}

/**
 * Brands whose weekly posts should be generated now (service role).
 *
 * Eligible: setup finished, not unsubscribed, not paused (email_paused_until is the day the
 * pause ends; before that local date the brand is paused). Due: the local clock has passed the
 * brand's weekday and time in the current local week, and the target week has no batch that is
 * `ready` or live `generating`. Also due: a `failed` batch under 24 h old with fewer than 3
 * attempts, and a `generating` batch whose run died (older than 10 minutes).
 */
export async function dueBrands(now: Date = new Date()): Promise<DueBrand[]> {
  const lo = addDaysIso(now.toISOString().slice(0, 10), -10);
  const hi = addDaysIso(now.toISOString().slice(0, 10), 10);
  const { brands, batches } = await getDb().withService(async (tx) => ({
    brands: await tx.query<BrandRow>(
      `select m.brand_id::text as brand_id, m.timezone, m.schedule_weekday::int as weekday,
              m.schedule_time::text as time, m.email_paused_until::text as paused_until
         from public.brand_memory m
        where m.setup_completed_at is not null and m.email_unsubscribed_at is null
        order by m.brand_id`,
    ),
    batches: await tx.query<BatchRow>(
      `select brand_id::text as brand_id, week_start::text as week_start, status::text as status, ${BATCH_STATE_COLUMNS}, created_at
         from public.weekly_batches where week_start >= $1::date and week_start <= $2::date`,
      [lo, hi],
    ),
  }));
  const byKey = new Map(batches.map((b) => [`${b.brand_id}|${b.week_start}`, b]));

  const due: DueBrand[] = [];
  for (const b of brands) {
    let clock: { date: string; time: string };
    let monday: string;
    try {
      clock = localClock(now, b.timezone);
      monday = weekStartFor(now, b.timezone);
    } catch {
      console.warn(`[weekly] brand ${b.brand_id} has an unknown time zone "${b.timezone}"; skipped`);
      continue;
    }
    if (b.paused_until && clock.date < b.paused_until) continue;

    const scheduledDate = addDaysIso(monday, Math.min(7, Math.max(1, b.weekday)) - 1);
    const passed = `${clock.date}T${clock.time}` >= `${scheduledDate}T${normTime(b.time)}`;
    if (!passed) continue;

    const weekStart = targetWeekStart(scheduledDate);
    const batch = byKey.get(`${b.brand_id}|${weekStart}`);
    if (!batch) {
      due.push({ brandId: b.brand_id, weekStart, attempt: 1, reason: 'scheduled' });
      continue;
    }
    const meta = readBatchState(batch);
    if (batch.status === 'failed') {
      const attempts = Math.max(1, meta.attempts);
      const young = now.getTime() - toDate(batch.created_at).getTime() < RETRY_WINDOW_MS;
      if (young && attempts < MAX_CRON_ATTEMPTS) due.push({ brandId: b.brand_id, weekStart, attempt: attempts + 1, reason: 'retry' });
    } else if (batch.status === 'generating') {
      const since = meta.claimedAt ? new Date(meta.claimedAt) : toDate(batch.created_at);
      if (now.getTime() - since.getTime() > STALE_GENERATING_MS && meta.attempts < MAX_CRON_ATTEMPTS) {
        due.push({ brandId: b.brand_id, weekStart, attempt: meta.attempts + 1, reason: 'stale' });
      }
    }
  }
  return due;
}

/** A brand's IANA time zone (service role). Null when the brand has no memory row. */
export async function brandTimezone(brandId: string): Promise<string | null> {
  const [row] = await getDb().withService((tx) =>
    tx.query<{ timezone: string }>('select timezone from public.brand_memory where brand_id = $1', [brandId]),
  );
  return row?.timezone ?? null;
}
