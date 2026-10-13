import { z } from "zod";
import { isIsoCountry } from "./countries";
import { BCP47_RE } from "./languages";
import { isValidTimezone } from "./timezones";

/**
 * The setup v2 answers (Req 2, 7): one shape for the wizard and the server-side save.
 * Safe to import in the browser. Region needs the holiday dataset, so it is checked by
 * validate.ts on the server. Error messages are codes; the UI maps them to text
 * (s.setupV2.errors).
 */

export const GOALS = ["enquiries", "footfall", "awareness"] as const;
export type Goal = (typeof GOALS)[number];

export const TONES = ["friendly", "professional", "playful", "like_past_posts"] as const;
export type Tone = (typeof TONES)[number];

export const LIMITS = { name: 100, sell: 200, customers: 200, city: 100, url: 2000 } as const;

/** Types "example.com" or " https://example.com ": adds https:// when there is no scheme. */
export function normalizeWebsiteInput(input: string): string {
  const t = input.trim();
  if (t === "") return "";
  return /^[a-z][a-z0-9+.-]*:/i.test(t) && !/^[^/]+:\d+(\/|$)/.test(t) ? t : `https://${t.replace(/^\/\//, "")}`;
}

export const urlField = z
  .string()
  .max(LIMITS.url, "too_long")
  .transform((v, ctx) => {
    const t = normalizeWebsiteInput(v);
    if (t === "") return "";
    try {
      const u = new URL(t);
      if ((u.protocol === "http:" || u.protocol === "https:") && u.hostname.includes(".")) return u.href;
    } catch {
      // fall through
    }
    ctx.addIssue({ code: "custom", message: "invalid_url" });
    return z.NEVER;
  });

const line = (max: number) => z.string().trim().min(1, "required").max(max, "too_long");

export const setupSchema = z.object({
  business_name: line(LIMITS.name),
  what_sell: line(LIMITS.sell),
  customers: line(LIMITS.customers),
  country: z.string().refine(isIsoCountry, "invalid_country"),
  /** ISO 3166-2 ("US-OR") or empty. Checked against the country in validate.ts. */
  region: z.string().trim().max(10, "invalid_region"),
  city: z.string().trim().max(LIMITS.city, "too_long"),
  timezone: z.string().refine(isValidTimezone, "invalid_timezone"),
  goal: z.enum(GOALS, "required"),
  tone: z.enum(TONES, "required"),
  post_language: z.string().regex(BCP47_RE, "invalid_language"),
  minutes_per_post: z.number("required").int("invalid_minutes").min(1, "invalid_minutes").max(600, "invalid_minutes"),
  website_url: urlField,
  schedule_weekday: z.number("required").int("invalid_weekday").min(1, "invalid_weekday").max(7, "invalid_weekday"),
  schedule_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "invalid_time"),
});

export type SetupAnswers = z.infer<typeof setupSchema>;
export type SetupInput = z.input<typeof setupSchema>;
export type SetupFieldErrors = Partial<Record<keyof SetupAnswers, string>>;

export type ParsedSetup = { ok: true; data: SetupAnswers } | { ok: false; fieldErrors: SetupFieldErrors };

export function parseSetup(raw: unknown): ParsedSetup {
  const parsed = setupSchema.safeParse(raw);
  if (parsed.success) return { ok: true, data: parsed.data };
  const fieldErrors: SetupFieldErrors = {};
  for (const issue of parsed.error.issues) {
    const key = issue.path[0];
    // Our own codes are lower_snake; anything else is zod's wording for a wrong type.
    const code = /^[a-z_]+$/.test(issue.message) ? issue.message : "invalid";
    if (typeof key === "string" && !(key in fieldErrors)) fieldErrors[key as keyof SetupAnswers] = code;
  }
  return { ok: false, fieldErrors };
}

/** Checks one field on its own (the wizard uses this to enable "Next"). Returns the error code or null. */
export function fieldError<K extends keyof SetupAnswers>(key: K, value: unknown): string | null {
  const shape = setupSchema.shape[key] as z.ZodType;
  const r = shape.safeParse(value);
  if (r.success) return null;
  const message = r.error.issues[0]?.message ?? "invalid";
  return /^[a-z_]+$/.test(message) ? message : "invalid";
}

/** ISO weekdays: 1 = Monday ... 7 = Sunday (brand_memory.schedule_weekday). */
export const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;

export const DEFAULT_WEEKDAY = 1;
export const DEFAULT_TIME = "08:00";
