import { z } from "zod";
import { isHexColor, normalizeHex } from "@/lib/brand/colors";
import { setupSchema, urlField } from "@/lib/setup/schema";

/**
 * Validation for the brand memory page (Req 5): facts and settings. Safe to import in the
 * browser. The rules for settings are the setup v2 rules (src/lib/setup/schema.ts); region
 * needs the holiday dataset, so the server checks it (settings.ts). Error messages are codes;
 * the UI maps them to text (s.brandV2.facts.errors, s.setupV2.errors).
 */

// ---------------------------------------------------------------------------
// Facts
// ---------------------------------------------------------------------------

export const FACT_KINDS = ["product", "price", "offer", "hours", "address", "phone", "email", "differentiator", "claim", "other"] as const;
export type FactKind = (typeof FACT_KINDS)[number];

export const FACT_LIMITS = { value: 1000, label: 120 } as const;
/** A brand cannot hold more than this many active facts (keeps the prompt and the page small). */
export const MAX_ACTIVE_FACTS = 300;

export const FACT_SOURCES = ["website", "setup", "upload", "owner"] as const;
export type FactSource = (typeof FACT_SOURCES)[number];

export const factInputSchema = z.object({
  kind: z.enum(FACT_KINDS, "invalid_kind"),
  label: z.string().trim().max(FACT_LIMITS.label, "label_too_long"),
  value: z.string().trim().min(1, "value_required").max(FACT_LIMITS.value, "value_too_long"),
});
export type FactInput = z.input<typeof factInputSchema>;
export type FactFieldErrors = Partial<Record<keyof FactInput, string>>;

/** Same code mapping as setup: our own codes are lower_snake, anything else is zod's wording for a wrong type. */
function codeOf(message: string): string {
  return /^[a-z_]+$/.test(message) ? message : "invalid";
}

export type ParsedFact = { ok: true; data: z.output<typeof factInputSchema> } | { ok: false; fieldErrors: FactFieldErrors };

export function parseFact(raw: unknown): ParsedFact {
  const r = factInputSchema.safeParse(raw);
  if (r.success) return { ok: true, data: r.data };
  const fieldErrors: FactFieldErrors = {};
  for (const issue of r.error.issues) {
    const key = issue.path[0] as keyof FactInput | undefined;
    if (key && !(key in fieldErrors)) fieldErrors[key] = codeOf(issue.message);
  }
  return { ok: false, fieldErrors };
}

/** The groups the page shows. Address, phone and email share "contact". */
export const FACT_GROUPS = ["product", "price", "offer", "hours", "contact", "differentiator", "claim", "other"] as const;
export type FactGroup = (typeof FACT_GROUPS)[number];

export function groupOfKind(kind: FactKind): FactGroup {
  if (kind === "address" || kind === "phone" || kind === "email") return "contact";
  return kind;
}

/** One active fact, ready to show. */
export interface FactView {
  id: string;
  kind: FactKind;
  label: string | null;
  value: string;
  sourceType: FactSource;
  /** A page URL for website facts, a setup question key, an upload id, or (owner edits) the id of the fact that was edited. */
  sourceRef: string | null;
  sourceQuote: string | null;
  outcomePromise: boolean;
  /** Set when the owner edited a fact from elsewhere: where the original came from. */
  editedFrom: FactSource | null;
}

/** http(s) links only: a website fact's source_ref is a page URL, never a script. */
export function safePageUrl(ref: string | null | undefined): string | null {
  if (!ref) return null;
  try {
    const u = new URL(ref);
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export const REGULATED_CHOICES = ["none", "health", "finance", "alcohol", "legal", "other"] as const;
export type RegulatedChoice = (typeof REGULATED_CHOICES)[number];

/** Setup's answers without the website (the Facts section reads and changes that), plus where links go and the regulated choice. */
export const settingsSchema = setupSchema.omit({ website_url: true }).extend({
  /** Empty means "use the website". */
  link_destination: urlField,
  /** null = automatic (detected from what the business sells). */
  regulated: z.enum(REGULATED_CHOICES, "invalid_regulated").nullable(),
});

export type SettingsValues = z.output<typeof settingsSchema>;
export type SettingsFieldErrors = Partial<Record<keyof SettingsValues, string>>;
export type ParsedSettings = { ok: true; data: SettingsValues } | { ok: false; fieldErrors: SettingsFieldErrors };

export function parseSettings(raw: unknown): ParsedSettings {
  const r = settingsSchema.safeParse(raw);
  if (r.success) return { ok: true, data: r.data };
  const fieldErrors: SettingsFieldErrors = {};
  for (const issue of r.error.issues) {
    const key = issue.path[0];
    if (typeof key === "string" && !(key in fieldErrors)) fieldErrors[key as keyof SettingsValues] = codeOf(issue.message);
  }
  return { ok: false, fieldErrors };
}

/** The form's strings turned into what the schema expects (numbers, null for automatic). */
export function settingsFromForm(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const r = raw as Record<string, unknown>;
  const minutes = typeof r.minutes_per_post === "string" ? (r.minutes_per_post.trim() === "" ? undefined : Number(r.minutes_per_post)) : r.minutes_per_post;
  const weekday = typeof r.schedule_weekday === "string" ? Number(r.schedule_weekday) : r.schedule_weekday;
  return {
    ...r,
    minutes_per_post: minutes,
    schedule_weekday: weekday,
    regulated: r.regulated === "" || r.regulated === undefined ? null : r.regulated,
  };
}

/** True when posts need the stricter wording: the owner's choice wins, else what we detected. */
export function isRegulatedBrand(chosen: RegulatedChoice | null, detected: string): boolean {
  return chosen !== null ? chosen !== "none" : detected !== "none";
}

// ---------------------------------------------------------------------------
// Colours
// ---------------------------------------------------------------------------

const hex = z
  .string()
  .trim()
  .refine(isHexColor, "invalid_color")
  .transform(normalizeHex);
export const colorsSchema = z.object({ primary: hex, secondary: hex, accent: hex });
export type ColorsInput = z.input<typeof colorsSchema>;

/** A page's theme-color as "#RRGGBB", or null when it is not a plain hex colour (#RGB is expanded). */
export function normalizeThemeColor(raw: string | null | undefined): string | null {
  const v = (raw ?? "").trim();
  const m3 = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(v);
  if (m3) return `#${m3[1]}${m3[1]}${m3[2]}${m3[2]}${m3[3]}${m3[3]}`.toUpperCase();
  return isHexColor(v) ? normalizeHex(v) : null;
}
