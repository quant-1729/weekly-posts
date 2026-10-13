import { BrandAccessError } from "@/lib/brand/current";
import { fill, s } from "@/lib/i18n/strings";
import { OwnerDateValidationError } from "@/lib/occasions/owner-dates";
import { MascotError, describeMascotError } from "@/lib/mascot/errors";
import { DailyCapError } from "@/lib/usage";
import { WeeklyCapError } from "@/lib/usage/caps";
import { FactLimitError, FactNotFoundError, FactValidationError } from "./facts";
import { ColorsValidationError, WebsiteLogoError } from "./look";
import { SettingsValidationError } from "./settings";
import { WebsiteUrlError } from "./website";

/** What the brand page is told when a save fails: plain words to show, and the fields to mark. */
export interface MemoryFailure {
  ok: false;
  code: "validation" | "not_found" | "cap" | "generic";
  message: string;
  fieldErrors?: Record<string, string>;
}

export function describeMemoryError(e: unknown): MemoryFailure {
  const b = s.brandV2;
  if (e instanceof FactValidationError) return { ok: false, code: "validation", message: b.saveFailed, fieldErrors: e.fieldErrors as Record<string, string> };
  if (e instanceof SettingsValidationError) return { ok: false, code: "validation", message: b.saveFailed, fieldErrors: e.fieldErrors as Record<string, string> };
  if (e instanceof ColorsValidationError) return { ok: false, code: "validation", message: b.saveFailed };
  if (e instanceof FactLimitError) return { ok: false, code: "validation", message: b.facts.errors.too_many };
  if (e instanceof FactNotFoundError) return { ok: false, code: "not_found", message: b.facts.errors.not_found };
  if (e instanceof BrandAccessError) return { ok: false, code: "not_found", message: b.notFound };
  if (e instanceof OwnerDateValidationError) {
    return { ok: false, code: "validation", message: b.dates.errors[e.field], fieldErrors: { [e.field]: e.field } };
  }
  if (e instanceof WebsiteUrlError) return { ok: false, code: "validation", message: b.facts.reread.invalidUrl, fieldErrors: { website_url: "invalid_url" } };
  if (e instanceof WebsiteLogoError) return { ok: false, code: "generic", message: b.look.offerFailed };
  if (e instanceof MascotError) return { ok: false, code: "validation", message: describeMascotError(e).message };
  if (e instanceof DailyCapError) return { ok: false, code: "cap", message: fill(s.errors.dailyCap, { cap: e.cap }) };
  if (e instanceof WeeklyCapError) return { ok: false, code: "cap", message: e.message };
  console.error("[brand]", e);
  return { ok: false, code: "generic", message: s.errors.generic };
}
