// How slots are shown to the owner: always in the BRAND's time zone ("Thu 16 Oct, 10:00").

import { localDateOf, localTimeOf } from './slots';

/** "Thu 16 Oct" for an instant, in a time zone. */
export function formatSlotDay(at: Date | string, timezone: string): string {
  const d = typeof at === 'string' ? new Date(at) : at;
  return new Intl.DateTimeFormat('en-GB', { timeZone: timezone, weekday: 'short', day: 'numeric', month: 'short' }).format(d).replace(',', '');
}

/** "Thu 16 Oct, 10:00". */
export function formatSlot(at: Date | string, timezone: string): string {
  const d = typeof at === 'string' ? new Date(at) : at;
  return `${formatSlotDay(d, timezone)}, ${localTimeOf(d, timezone)}`;
}

/** The local date ("YYYY-MM-DD") and time ("HH:MM") of an instant, for grouping by day. */
export function slotParts(at: Date | string, timezone: string): { date: string; time: string } {
  const d = typeof at === 'string' ? new Date(at) : at;
  return { date: localDateOf(d, timezone), time: localTimeOf(d, timezone) };
}
