// Slot arithmetic for the queue (PRD v3 S-1, S-2, S-5; change C-24). Pure functions, no database.
//
// A "slot" is a local calendar date from the owner's chosen weekdays plus one time per channel, in the BRAND's
// time zone. It is stored as a UTC instant (queue_items.slot_at) and shown back in the brand's zone. All
// wall-clock maths is done on local "YYYY-MM-DD" strings and "HH:MM" times, so a daylight-saving change never
// moves a post (10:00 stays 10:00 local on both sides of the change).

import { addDaysIso, localDateIn, weekdayOf } from '@/lib/occasions/dates';
import { DEFAULT_TIME, type QueueChannel, type QueueSettings } from './types';

/** Local time minus UTC, in ms, at an instant. */
function offsetMs(utcMs: number, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(utcMs));
  const n = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const asUtc = Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second'));
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

/**
 * The UTC instant at which the wall clock in `timezone` shows `date` + `time`.
 * A time that happens twice (clocks go back) takes the first; a time that does not exist (clocks go
 * forward) moves forward by the length of the gap, as calendars do (01:30 becomes 02:30).
 */
export function zonedToUtc(date: string, time: string, timezone: string): Date {
  const [y, mo, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  const local = Date.UTC(y, mo - 1, d, h, mi);
  const day = 86_400_000;
  const before = offsetMs(local - day, timezone);
  const after = offsetMs(local + day, timezone);
  const c1 = local - before;
  const c2 = local - after;
  const ok1 = offsetMs(c1, timezone) === before;
  const ok2 = offsetMs(c2, timezone) === after;
  if (ok1 && ok2) return new Date(Math.min(c1, c2));
  if (ok1) return new Date(c1);
  if (ok2) return new Date(c2);
  return new Date(c1); // in the gap
}

/** ISO weekday of a local date: 1 = Monday ... 7 = Sunday. */
export function isoWeekdayOf(date: string): number {
  return ((weekdayOf(date) + 6) % 7) + 1;
}

/** The Monday of the ISO week a local date is in. */
export function mondayOf(date: string): string {
  return addDaysIso(date, -(isoWeekdayOf(date) - 1));
}

/** The local date of an instant in a time zone. */
export const localDateOf = (at: Date, timezone: string): string => localDateIn(at, timezone);

/** "HH:MM" local time of an instant. */
export function localTimeOf(at: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hourCycle: 'h23', hour: '2-digit', minute: '2-digit' }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  return `${get('hour')}:${get('minute')}`;
}

/** The brand's chosen time for a channel (HH:MM), else the default. */
export const timeFor = (settings: Pick<QueueSettings, 'times'>, channel: QueueChannel): string => settings.times[channel] ?? DEFAULT_TIME;

/** A slot has to be at least this far ahead; the hourly sweep needs a moment to pick it up. */
export const MIN_LEAD_MS = 10 * 60 * 1000;
/** How far ahead to look for a free slot. */
export const HORIZON_DAYS = 120;

/** What is already in the queue, as far as free-slot search cares. */
export interface Occupied {
  channel: QueueChannel;
  slotAt: Date;
}

export interface SlotContext {
  now: Date;
  timezone: string;
  settings: Pick<QueueSettings, 'days' | 'times' | 'postsPerWeek'>;
  /** Items that hold a slot (everything except skipped and expired). */
  occupied: Occupied[];
  /** Last local date a post may go out (the brief's `ends_on`), or null. */
  endsOn: string | null;
}

export type SlotSearch =
  | { ok: true; date: string; slots: Partial<Record<QueueChannel, Date>> }
  | { ok: false; reason: 'ends_before_slot' | 'no_slot' };

/** Dates (local) that already hold a post, by ISO week (keyed by Monday). */
function datesByWeek(occupied: Occupied[], timezone: string): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const o of occupied) {
    const date = localDateOf(o.slotAt, timezone);
    const week = mondayOf(date);
    const set = out.get(week) ?? new Set<string>();
    set.add(date);
    out.set(week, set);
  }
  return out;
}

/** A slot day is free for these channels when none of them already has a post on that local date. */
function channelBusy(occupied: Occupied[], timezone: string, channel: QueueChannel, date: string): boolean {
  return occupied.some((o) => o.channel === channel && localDateOf(o.slotAt, timezone) === date);
}

/**
 * Every free slot day for a set of channels, earliest first. A day qualifies when:
 *  - its weekday is one the owner chose,
 *  - every channel's time that day is still ahead (at least MIN_LEAD_MS),
 *  - none of the channels already has a post that day (one post per slot per channel),
 *  - the ISO week has fewer than `postsPerWeek` days holding posts (or this day is already one of them),
 *  - it is not after the offer's end date.
 */
export function* freeDays(ctx: SlotContext, channels: readonly QueueChannel[]): Generator<{ date: string; slots: Partial<Record<QueueChannel, Date>> }, 'ends_before_slot' | 'no_slot', void> {
  const { now, timezone, settings, endsOn } = ctx;
  const weeks = datesByWeek(ctx.occupied, timezone);
  const cap = Math.max(1, Math.min(settings.postsPerWeek, settings.days.length));
  const today = localDateOf(now, timezone);
  let endedEarly = false;
  for (let i = 0; i <= HORIZON_DAYS; i++) {
    const date = addDaysIso(today, i);
    if (endsOn && date > endsOn) {
      endedEarly = true;
      break;
    }
    if (!settings.days.includes(isoWeekdayOf(date))) continue;
    const slots: Partial<Record<QueueChannel, Date>> = {};
    let fits = true;
    for (const c of channels) {
      const at = zonedToUtc(date, timeFor(settings, c), timezone);
      if (at.getTime() < now.getTime() + MIN_LEAD_MS || channelBusy(ctx.occupied, timezone, c, date)) {
        fits = false;
        break;
      }
      slots[c] = at;
    }
    if (!fits) continue;
    const held = weeks.get(mondayOf(date));
    if (held && !held.has(date) && held.size >= cap) continue;
    yield { date, slots };
  }
  return endedEarly ? 'ends_before_slot' : 'no_slot';
}

/** The earliest free slot day for the channels of one brief, or why there is none. */
export function findSlot(ctx: SlotContext, channels: readonly QueueChannel[]): SlotSearch {
  const it = freeDays(ctx, channels);
  const first = it.next();
  if (!first.done) return { ok: true, date: first.value.date, slots: first.value.slots };
  return { ok: false, reason: first.value };
}

/** The next `n` free slots for ONE channel (for "Pick another time"). */
export function freeSlotsFor(ctx: SlotContext, channel: QueueChannel, n = 8): Date[] {
  const out: Date[] = [];
  for (const d of freeDays(ctx, [channel])) {
    out.push(d.slots[channel]!);
    if (out.length >= n) break;
  }
  return out;
}

/** True when `endsOn` (local date) is before today: the offer is over. */
export function hasEnded(endsOn: string | null, now: Date, timezone: string): boolean {
  return endsOn !== null && localDateOf(now, timezone) > endsOn;
}
