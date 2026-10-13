import { BrandAccessError } from "@/lib/brand/current";
import { getDb, type Tx } from "@/lib/db";
import type { CheckinAnswer } from "@/lib/links/ops";
import { addDaysIso, isValidIsoDate, weekStartFor, weekdayOf } from "@/lib/occasions/dates";

// The weekly check-in (Req 20). One row per brand per week; answering again changes the same row.
// Used by the email link handler (service role, via 'email_link') and the dashboard (the signed-in
// user, via 'dashboard'), so both write the same row shape.

export type CheckinVia = "email_link" | "dashboard";

export async function upsertCheckinRow(
  tx: Tx,
  brandId: string,
  weekStart: string,
  answer: CheckinAnswer,
  via: CheckinVia,
): Promise<void> {
  await tx.query(
    `insert into public.checkins (brand_id, week_start, answer, via)
     values ($1, $2::date, $3::public.checkin_answer, $4)
     on conflict (brand_id, week_start) do update set answer = excluded.answer, via = excluded.via`,
    [brandId, weekStart, answer, via],
  );
}

/** Monday of the previous week, in the brand's time zone. */
export const lastWeekStartFor = (now: Date, timezone: string): string => addDaysIso(weekStartFor(now, timezone), -7);

export type SaveCheckinResult = { ok: true } | { ok: false; reason: "bad_week" };

/**
 * The dashboard's one-tap save: runs as the signed-in user, so row-level security decides whether
 * they may write this brand's check-in. Only a Monday that is not in the future can be answered.
 */
export async function saveDashboardCheckin(
  userId: string,
  brandId: string,
  weekStart: string,
  answer: CheckinAnswer,
  now: Date = new Date(),
): Promise<SaveCheckinResult> {
  return getDb().withUser(userId, async (tx) => {
    const [m] = await tx.query<{ ok: boolean; timezone: string | null }>(
      `select public.is_brand_member($1::uuid) as ok,
              (select timezone from public.brand_memory where brand_id = $1) as timezone`,
      [brandId],
    );
    if (!m?.ok) throw new BrandAccessError();
    if (!isValidIsoDate(weekStart) || weekdayOf(weekStart) !== 1) return { ok: false as const, reason: "bad_week" as const };
    if (weekStart > weekStartFor(now, m.timezone || "UTC")) return { ok: false as const, reason: "bad_week" as const };
    await upsertCheckinRow(tx, brandId, weekStart, answer, "dashboard");
    return { ok: true as const };
  });
}

export interface CheckinCardState {
  /** Monday of last week, the week the question is about. */
  weekStart: string;
  /** The saved answer, or null. */
  answer: CheckinAnswer | null;
  /** The brand had a weekly batch for that week, so the question makes sense. */
  hadPosts: boolean;
}

/** What the check-in card shows: last week, its saved answer, and whether there were posts. */
export async function loadCheckinCard(userId: string, brandId: string, now: Date = new Date()): Promise<CheckinCardState> {
  return getDb().withUser(userId, async (tx) => {
    const [m] = await tx.query<{ ok: boolean; timezone: string | null }>(
      `select public.is_brand_member($1::uuid) as ok,
              (select timezone from public.brand_memory where brand_id = $1) as timezone`,
      [brandId],
    );
    if (!m?.ok) throw new BrandAccessError();
    const weekStart = lastWeekStartFor(now, m.timezone || "UTC");
    const [c] = await tx.query<{ answer: CheckinAnswer | null; had_posts: boolean }>(
      `select (select answer::text from public.checkins where brand_id = $1 and week_start = $2::date) as answer,
              exists (select 1 from public.posts p join public.weekly_batches b on b.id = p.batch_id
                       where b.brand_id = $1 and b.week_start = $2::date) as had_posts`,
      [brandId, weekStart],
    );
    return { weekStart, answer: c?.answer ?? null, hadPosts: Boolean(c?.had_posts) };
  });
}
