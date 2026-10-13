import { getDb } from "@/lib/db";
import { upsertCheckinRow } from "@/lib/results/checkin";

/** Database writes shared by the link pages, the one-click route and the email sender (service role). */

export const PAUSED_FOREVER = "2099-12-31";

export type CheckinAnswer = "none" | "few" | "many";
export const CHECKIN_ANSWERS: readonly CheckinAnswer[] = ["none", "few", "many"];

export const isCheckinAnswer = (v: unknown): v is CheckinAnswer => CHECKIN_ANSWERS.includes(v as CheckinAnswer);

export async function setEmailPausedUntil(brandId: string, until: string | null): Promise<void> {
  await getDb().withService((tx) =>
    tx.query("update public.brand_memory set email_paused_until = $2::date where brand_id = $1", [brandId, until]),
  );
}

export async function setEmailUnsubscribed(brandId: string, unsubscribed: boolean): Promise<void> {
  await getDb().withService((tx) =>
    tx.query(
      `update public.brand_memory
          set email_unsubscribed_at = case when $2::boolean then coalesce(email_unsubscribed_at, now()) else null end
        where brand_id = $1`,
      [brandId, unsubscribed],
    ),
  );
}

export async function upsertCheckin(brandId: string, weekStart: string, answer: CheckinAnswer): Promise<void> {
  // V-19: the row is written by the function shared with the dashboard check-in.
  await getDb().withService((tx) => upsertCheckinRow(tx, brandId, weekStart, answer, "email_link"));
}
