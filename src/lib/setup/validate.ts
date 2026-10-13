import { isIsoCountry } from "./countries";
import { isValidRegion } from "./regions";
import { parseSetup, type ParsedSetup, type SetupFieldErrors } from "./schema";

/**
 * Server-side check of the setup answers: the zod schema plus the region check, which
 * needs the holiday dataset. Use this, never parseSetup alone, before saving.
 */
export function validateSetup(raw: unknown): ParsedSetup {
  const parsed = parseSetup(raw);
  const fieldErrors: SetupFieldErrors = parsed.ok ? {} : { ...parsed.fieldErrors };

  const input = (raw ?? {}) as { country?: unknown; region?: unknown };
  const region = typeof input.region === "string" ? input.region.trim() : "";
  if (!("region" in fieldErrors) && region !== "") {
    // Without a valid country no region can be valid either.
    if (!isIsoCountry(input.country) || !isValidRegion(input.country, region)) fieldErrors.region = "invalid_region";
  }

  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };
  return parsed;
}
