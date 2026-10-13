/**
 * "Your dates" and what is coming up (Req 7). Owner dates are the v1 module
 * (src/lib/occasions/owner-dates.ts); the upcoming list is read-only and shows the next 8 weeks
 * of occasions week by week, from the same getOccasions the weekly batch uses, so the owner sees
 * what posts may reference, including the sensitive days.
 */
import { BrandAccessError, requireBrandMember } from "@/lib/brand/current";
import { getDb } from "@/lib/db";
import { addDaysIso, localDateIn, parseIsoDate, weekStartFor } from "@/lib/occasions/dates";
import { getOccasions, type WeeklyOccasion } from "@/lib/occasions";
import { listOwnerDates, type OwnerDate } from "@/lib/occasions/owner-dates";

export const UPCOMING_WEEKS = 8;

export interface UpcomingWeek {
  /** The Monday, "YYYY-MM-DD". */
  weekStart: string;
  occasions: WeeklyOccasion[];
}

/** Pure: the next `weeks` weeks (this week first), occasions from today on, grouped by week. */
export function upcomingWeeks(args: {
  country: string | null;
  region: string | null;
  timezone: string;
  category: string | null;
  ownerDates: Array<Pick<OwnerDate, "date" | "name" | "yearly">>;
  now: Date;
  weeks?: number;
}): UpcomingWeek[] {
  const weeks = args.weeks ?? UPCOMING_WEEKS;
  const first = weekStartFor(args.now, args.timezone);
  const today = localDateIn(args.now, args.timezone);
  const all = getOccasions({
    country: args.country ?? "",
    region: args.region,
    weekStart: first,
    timezone: args.timezone,
    // The window is the week plus this many days, so 8 weeks in all.
    lookaheadDays: weeks * 7 - 7,
    ownerDates: args.ownerDates,
    category: args.category,
  }).filter((o) => o.date >= today);

  const start = parseIsoDate(first)!.getTime();
  const out: UpcomingWeek[] = Array.from({ length: weeks }, (_, i) => ({ weekStart: addDaysIso(first, i * 7), occasions: [] }));
  for (const o of all) {
    const day = parseIsoDate(o.date);
    if (!day) continue;
    const index = Math.floor((day.getTime() - start) / (7 * 86_400_000));
    if (index >= 0 && index < weeks) out[index].occasions.push(o);
  }
  return out;
}

/** The brand's upcoming occasions for the next 8 weeks. Throws BrandAccessError for non-members. */
export async function getUpcoming(userId: string, brandId: string, now: Date = new Date()): Promise<UpcomingWeek[]> {
  await requireBrandMember(userId, brandId);
  const [m] = await getDb().withUser(userId, (tx) =>
    tx.query<{ country: string | null; region: string | null; timezone: string; category: string | null }>(
      "select country, region, timezone, category from public.brand_memory where brand_id = $1",
      [brandId],
    ),
  );
  if (!m) throw new BrandAccessError();
  const ownerDates = await listOwnerDates(userId, brandId);
  return upcomingWeeks({ ...m, ownerDates, now });
}
