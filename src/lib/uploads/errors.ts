import { AiError } from "@/lib/ai/client";
import { BrandAccessError } from "@/lib/brand/current";
import { fill, s } from "@/lib/i18n/strings";
import { DailyCapError } from "@/lib/usage";
import { WeeklyCapError } from "@/lib/usage/caps";

export type UploadErrorCode =
  | "bad_type"
  | "too_large"
  | "unreadable"
  | "empty"
  | "photo_limit"
  | "past_post_limit"
  | "text_too_short"
  | "text_too_long"
  | "not_a_post"
  | "not_found";

export class UploadError extends Error {
  constructor(public readonly code: UploadErrorCode) {
    super(code);
    this.name = "UploadError";
  }
}

/** What the UI is told when an upload call fails: a code to branch on and plain words to show. */
export interface UploadFailure {
  code: UploadErrorCode | "cap" | "ai_failed" | "signed_out" | "generic";
  message: string;
}

export function describeUploadError(e: unknown): UploadFailure {
  if (e instanceof UploadError) {
    const e2 = s.uploads.errors;
    const message = {
      bad_type: e2.badType,
      too_large: e2.tooLarge,
      unreadable: e2.unreadable,
      empty: e2.empty,
      photo_limit: e2.photoLimit,
      past_post_limit: e2.pastPostLimit,
      text_too_short: e2.textTooShort,
      text_too_long: e2.textTooLong,
      not_a_post: e2.notAPost,
      not_found: e2.notFound,
    }[e.code];
    return { code: e.code, message };
  }
  if (e instanceof DailyCapError) return { code: "cap", message: fill(s.errors.dailyCap, { cap: e.cap }) };
  if (e instanceof WeeklyCapError) return { code: "cap", message: e.message };
  if (e instanceof BrandAccessError) return { code: "not_found", message: s.uploads.errors.notFound };
  if (e instanceof AiError) return { code: "ai_failed", message: s.errors.aiFailed };
  console.error("[uploads]", e);
  return { code: "generic", message: s.errors.generic };
}

export function failureStatus(f: UploadFailure): number {
  switch (f.code) {
    case "signed_out":
      return 401;
    case "not_found":
      return 404;
    case "too_large":
      return 413;
    case "generic":
      return 500;
    case "ai_failed":
      return 502;
    default:
      return 400;
  }
}
