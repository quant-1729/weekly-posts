import { AiError } from "@/lib/ai/client";
import { fill, s } from "@/lib/i18n/strings";
import { DailyCapError } from "@/lib/usage";
import { BrandAccessError } from "./current";
import { LogoError } from "./logo";
import { ProfileValidationError, SetupAlreadyCompletedError } from "./profile";
import { SetupError } from "./setup";

/** What the UI is told when a setup or profile call fails: a code to branch on and plain words to show. */
export interface UserFacingError {
  code:
    | "cap"
    | "invalid_audio"
    | "audio_too_large"
    | "unusable_transcript"
    | "no_answers"
    | "logo"
    | "ai_failed"
    | "not_found"
    | "validation"
    | "already_done"
    | "generic";
  message: string;
  fieldErrors?: Record<string, string>;
}

export function describeError(e: unknown): UserFacingError {
  if (e instanceof DailyCapError) return { code: "cap", message: fill(s.errors.dailyCap, { cap: e.cap }) };
  if (e instanceof ProfileValidationError) {
    return { code: "validation", message: s.brand.saveFailed, fieldErrors: e.fieldErrors };
  }
  if (e instanceof BrandAccessError) return { code: "not_found", message: s.brand.noBrand };
  if (e instanceof SetupAlreadyCompletedError) return { code: "already_done", message: s.errors.generic };
  if (e instanceof SetupError) {
    switch (e.code) {
      case "invalid_audio":
        return { code: "invalid_audio", message: s.errors.invalidAudio };
      case "audio_too_large":
        return { code: "audio_too_large", message: s.errors.audioTooLarge };
      case "unusable_transcript":
        return { code: "unusable_transcript", message: s.setup.unusableBody };
      case "no_answers":
        return { code: "no_answers", message: s.setup.noAnswers };
    }
  }
  if (e instanceof LogoError) {
    const message = {
      empty: s.errors.logoEmpty,
      too_large: s.errors.logoTooLarge,
      unsupported_type: s.errors.logoUnsupported,
      invalid_image: s.errors.logoInvalid,
    }[e.code];
    return { code: "logo", message };
  }
  if (e instanceof AiError) return { code: "ai_failed", message: s.errors.aiFailed };
  console.error("[brand]", e);
  return { code: "generic", message: s.errors.generic };
}
