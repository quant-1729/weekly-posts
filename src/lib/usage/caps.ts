// Weekly limits on AI use per account (Req 23, AC 23, PRD section 8 "cost spike from heavy editing").
// All the numbers are here, in one place.
//
// Image generation: PostMitra uses no AI image generation (D5 / Req 9; images are SVG templates
// drawn by code). The "image generation per week" limit is therefore met trivially: there is no
// image call to count or cap.

import { ESTIMATED_BACKGROUND_USD } from "@/lib/ai/imagen-price";
import { s } from "@/lib/i18n/strings";
import { addDaysIso, weekStartFor } from "@/lib/occasions/dates";
import { demoCapsFor } from "./demo";
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
/** "Describe your post" runs (C-08): typed or spoken words turned into a brief. */
export const WEEKLY_BRIEF_FROM_TEXT = 30;
/** Post copy runs (C-16): the headline, captions and mascot line for one brief. The words are written once per brief. */
export const WEEKLY_POST_COPY = 40;
/** "Keep my look" style reads (C-17). */
export const WEEKLY_STYLE_READS = 3;
/** New Imagen backgrounds (C-18): each is generated once and then reused, so this only limits new ones. */
export const WEEKLY_NEW_BACKGROUNDS = 6;

/**
 * The call kinds a weekly limit applies to. They are `usage_kind` values.
 *
 * `auto_rewrite` (the weekly pipeline's own repeat/avoid-word rewrites, H-1) is deliberately not
 * here: it has no count cap of its own, because the batch run limit already bounds it, and it
 * does not use up the owner's WEEKLY_REWRITES. Its cost is still in the week's USD total
 * (`weekCost` sums every usage event).
 */
export type WeeklyCapKind = "weekly_batch" | "rewrite" | "website_read" | "upload_extract" | "fact_check" | "review_reply" | "brief_from_text" | "post_copy" | "style_read" | "image";

export const WEEKLY_COUNT_CAPS: Record<WeeklyCapKind, number> = {
  weekly_batch: WEEKLY_BATCH_RUNS,
  rewrite: WEEKLY_REWRITES,
  website_read: WEEKLY_WEBSITE_READS,
  upload_extract: WEEKLY_UPLOAD_EXTRACTS,
  fact_check: WEEKLY_FACT_CHECKS,
  review_reply: WEEKLY_REVIEW_REPLIES,
  brief_from_text: WEEKLY_BRIEF_FROM_TEXT,
  post_copy: WEEKLY_POST_COPY,
  style_read: WEEKLY_STYLE_READS,
  image: WEEKLY_NEW_BACKGROUNDS,
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
  review_reply: 0.005,
  brief_from_text: 0.005, // one short Gemini call, about 0.002 expected
  post_copy: 0.01, // one Gemini call with captions for up to 6 channels
  style_read: 0.02, // 12 shrunk images in one call, about 0.01 measured
  image: ESTIMATED_BACKGROUND_USD, // one Imagen image (price in imagen-price.ts) plus the text check
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
  // The demo account's brands (DEMO_WEEKLY_USD_CAP) get a bigger cap; the part kept for the batch scales with it.
  const cap = (await demoCapsFor(brandId))?.weeklyUsd ?? WEEKLY_USD_CAP;
  const nonBatchCap = cap === WEEKLY_USD_CAP ? NON_BATCH_USD_CAP : cap * (NON_BATCH_USD_CAP / WEEKLY_USD_CAP);
  if (kind === "weekly_batch") {
    if (spent >= micro(cap)) throw new WeeklyCapError(kind, "usd", resetsOn);
    return;
  }
  if (spent + micro(ESTIMATED_CALL_USD[kind]) > micro(nonBatchCap)) throw new WeeklyCapError(kind, "usd", resetsOn);
}

