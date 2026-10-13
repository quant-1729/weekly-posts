// Weekly limits on AI use per account (Req 23, AC 23, PRD section 8 "cost spike from heavy editing").
// All the numbers are here, in one place.
//
// Image generation: PostMitra uses no AI image generation (D5 / Req 9; images are SVG templates
// drawn by code). The "image generation per week" limit is therefore met trivially: there is no
// image call to count or cap.

import { s } from "@/lib/i18n/strings";
import { addDaysIso, weekStartFor } from "@/lib/occasions/dates";
import { brandTimezone, weekCost, weekCounts } from "./weekly";

/** Most an account may spend on AI in one week, in USD (AC 23 target: under $0.50). */
export const WEEKLY_USD_CAP = 0.5;
/** Part of the cap that anything other than the scheduled weekly batch may use. The rest is kept for the batch. */
export const NON_BATCH_USD_CAP = 0.4;
/** Batch runs: the scheduled one plus 3 regenerations (V-10 limits the button to 3). */
export const WEEKLY_BATCH_RUNS = 4;
export const WEEKLY_REWRITES = 15;
export const WEEKLY_WEBSITE_READS = 3;
/** Photo descriptions, screenshot reads and voice refreshes. */
export const WEEKLY_UPLOAD_EXTRACTS = 40;
export const WEEKLY_FACT_CHECKS = 30;
/** Review replies (Req 26, stretch). */
export const WEEKLY_REVIEW_REPLIES = 20;
/** Mascot idea runs (V-25): one run is up to two model calls and counts as one. */
export const WEEKLY_MASCOT_RUNS = 3;

/**
 * The call kinds a weekly limit applies to. They are `usage_kind` values.
 *
 * `auto_rewrite` (the weekly pipeline's own repeat/avoid-word rewrites, H-1) is deliberately not
 * here: it has no count cap of its own, because the batch run limit already bounds it, and it
 * does not use up the owner's WEEKLY_REWRITES. Its cost is still in the week's USD total
 * (`weekCost` sums every usage event).
 */
export type WeeklyCapKind = "weekly_batch" | "rewrite" | "website_read" | "upload_extract" | "fact_check" | "mascot" | "review_reply";

export const WEEKLY_COUNT_CAPS: Record<WeeklyCapKind, number> = {
  weekly_batch: WEEKLY_BATCH_RUNS,
  rewrite: WEEKLY_REWRITES,
  website_read: WEEKLY_WEBSITE_READS,
  upload_extract: WEEKLY_UPLOAD_EXTRACTS,
  fact_check: WEEKLY_FACT_CHECKS,
  mascot: WEEKLY_MASCOT_RUNS,
  review_reply: WEEKLY_REVIEW_REPLIES,
};

/**
 * Cost estimate for one call, in USD, added to the week's spend before the call is allowed.
 * Set a little above the live costs measured so far (weekly batch ~0.012, fact check ~0.005,
 * rewrite ~0.002, website read ~0.0075, photo describe ~0.001, review reply ~0.002). The weekly batch and the fact
 * check are not estimated: the batch only needs the week to be under the cap, and the fact check
 * is count-only because it runs inside the batch or a rewrite that was already allowed.
 */
export const ESTIMATED_CALL_USD: Record<Exclude<WeeklyCapKind, "weekly_batch" | "fact_check">, number> = {
  rewrite: 0.005,
  website_read: 0.015,
  upload_extract: 0.005,
  // A mascot run is one or two calls at about 0.004 each.
  mascot: 0.015,
  review_reply: 0.005,
};

/** Thrown when a weekly limit is reached. `message` is plain words for the owner and says when it resets. */
export class WeeklyCapError extends Error {
  constructor(
    public readonly kind: WeeklyCapKind,
    /** "count": the number of calls of this kind is used up. "usd": the week's spend limit is reached. */
    public readonly reason: "count" | "usd",
    /** The Monday ("YYYY-MM-DD", local) on which the limit resets. */
    public readonly resetsOn: string,
  ) {
    super(reason === "usd" ? s.errors.weeklyCap.money : s.errors.weeklyCap[kind]);
    this.name = "WeeklyCapError";
  }
}

const micro = (usd: number) => Math.round(usd * 1_000_000);

/**
 * Throws WeeklyCapError when a weekly limit stops this call. Call it next to assertUnderDailyCap,
 * before the AI call.
 *
 * - Count: the week already has the most calls of this kind.
 * - Money: weekCost + the estimate for this call would pass $0.40 (any call except the weekly
 *   batch), so the scheduled batch (about $0.01-0.03) always fits. The batch itself is allowed
 *   while the week's cost is under $0.50.
 * - fact_check is count-only: it runs inside the batch or a rewrite that was already allowed.
 */
export async function assertUnderWeeklyCap(brandId: string, kind: WeeklyCapKind, opts: { now?: Date } = {}): Promise<void> {
  const now = opts.now ?? new Date();
  const timezone = await brandTimezone(brandId);
  const weekStart = weekStartFor(now, timezone);
  const resetsOn = addDaysIso(weekStart, 7);

  const counts = await weekCounts(brandId, weekStart, timezone);
  if ((counts[kind] ?? 0) >= WEEKLY_COUNT_CAPS[kind]) throw new WeeklyCapError(kind, "count", resetsOn);
  if (kind === "fact_check") return;

  const spent = micro(await weekCost(brandId, weekStart, timezone));
  if (kind === "weekly_batch") {
    if (spent >= micro(WEEKLY_USD_CAP)) throw new WeeklyCapError(kind, "usd", resetsOn);
    return;
  }
  if (spent + micro(ESTIMATED_CALL_USD[kind]) > micro(NON_BATCH_USD_CAP)) throw new WeeklyCapError(kind, "usd", resetsOn);
}

