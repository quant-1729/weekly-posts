"use server";

import { getCurrentUser } from "@/lib/auth";
import { BrandAccessError, getCurrentBrand } from "@/lib/brand/current";
import { fill, s } from "@/lib/i18n/strings";
import { ReviewReplyAiError, ReviewReplyInputError, draftReviewReply, type ReviewReplyResult } from "@/lib/reviews/reply";
import { DailyCapError } from "@/lib/usage";
import { WeeklyCapError } from "@/lib/usage/caps";

export type ReviewReplyActionResult =
  | { ok: true; reply: string; needsAttention: boolean; attentionReason: string; flags: ReviewReplyResult["flags"] }
  | { ok: false; message: string };

const e = s.reviews.errors;
const inputMessage = { too_short: e.tooShort, too_long: e.tooLong, bad_language: e.badLanguage } as const;

/** "Write a reply" and "Try again": one review in, one reply out. Nothing is stored except the usage count. */
export async function writeReviewReplyAction(review: string, replyLanguage: string): Promise<ReviewReplyActionResult> {
  try {
    const user = await getCurrentUser();
    if (!user) return { ok: false, message: e.signedOut };
    const brand = await getCurrentBrand(user.id);
    if (!brand) return { ok: false, message: e.noBrand };
    // The arguments come from the browser.
    if (typeof review !== "string" || typeof replyLanguage !== "string") return { ok: false, message: e.generic };
    const res = await draftReviewReply({ userId: user.id, brandId: brand.id, review, replyLanguage });
    return { ok: true, reply: res.reply, needsAttention: res.needsAttention, attentionReason: res.attentionReason, flags: res.flags };
  } catch (err) {
    if (err instanceof ReviewReplyInputError) return { ok: false, message: inputMessage[err.code] };
    if (err instanceof DailyCapError) return { ok: false, message: fill(s.errors.dailyCap, { cap: err.cap }) };
    if (err instanceof WeeklyCapError) return { ok: false, message: err.message };
    if (err instanceof ReviewReplyAiError) return { ok: false, message: e.aiFailed };
    if (!(err instanceof BrandAccessError)) console.error("[reviews] writeReviewReplyAction failed", err instanceof Error ? err.message : "error");
    return { ok: false, message: e.generic };
  }
}
