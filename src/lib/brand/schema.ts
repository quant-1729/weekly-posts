import { z } from "zod";
import { CONTENT_LANGUAGES, type ContentLanguage } from "@/lib/ai/schemas";
import { normalizePhone } from "@/lib/auth/phone";
import { strings } from "@/lib/i18n/strings";
import { normalizeHex, type Palette } from "./colors";

/**
 * The editable brand profile (R2): one shape for the setup review screen, the
 * /brand page and the server-side save. Safe to import in the browser.
 * Error messages are codes; the UI maps them to text (s.brand.errors).
 */

/** Stored tone values (English). The four tap choices in setup. */
export const TONE_OPTIONS = strings.en.brand.tones;

export const MAX_PRODUCTS = 30;

export const PRODUCT_LIMITS = { name: 100, price: 10, unit: 30, note: 200 } as const;

const text = (max: number) => z.string().trim().max(max, "too_long");

const productSchema = z.object({
  name: text(PRODUCT_LIMITS.name).min(1, "required"),
  // Digits only (the prompt tells the model the same). Blank = "price on request".
  price: z
    .string()
    .trim()
    .max(PRODUCT_LIMITS.price, "too_long")
    .regex(/^(\d+(\.\d{1,2})?)?$/, "invalid_price"),
  unit: text(PRODUCT_LIMITS.unit),
  note: text(PRODUCT_LIMITS.note),
});

const hex = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, "invalid_color")
  .transform(normalizeHex);

const whatsapp = z
  .string()
  .trim()
  .transform((v, ctx) => {
    const n = normalizePhone(v);
    if (!n) {
      ctx.addIssue({ code: "custom", message: "invalid_phone" });
      return z.NEVER;
    }
    return n;
  });

export const profileSchema = z
  .object({
    business_name: text(100).min(1, "required"),
    category: text(100),
    city: text(100),
    products: z.array(productSchema).max(MAX_PRODUCTS, "too_many_products"),
    audience: text(300),
    tone: text(100),
    languages: z.array(z.enum(CONTENT_LANGUAGES)).min(1, "pick_language"),
    default_language: z.enum(CONTENT_LANGUAGES, "pick_language"),
    colors: z.object({ primary: hex, secondary: hex, accent: hex }),
    whatsapp_number: whatsapp,
    notes: text(1500),
  })
  .superRefine((v, ctx) => {
    if (!v.languages.includes(v.default_language)) {
      ctx.addIssue({ code: "custom", path: ["default_language"], message: "default_not_selected" });
    }
  });

/** Validated, normalised profile (upper-case hex, +91 phone, trimmed text). */
export type ProfileInput = z.output<typeof profileSchema>;

/** What a form holds while editing: same fields, nothing validated yet. */
export interface ProfileDraft {
  business_name: string;
  category: string;
  city: string;
  products: { name: string; price: string; unit: string; note: string }[];
  audience: string;
  tone: string;
  languages: ContentLanguage[];
  default_language: ContentLanguage | "";
  colors: Palette;
  whatsapp_number: string;
  notes: string;
}

export function emptyDraft(): ProfileDraft {
  return {
    business_name: "",
    category: "",
    city: "",
    products: [],
    audience: "",
    tone: "",
    languages: [],
    default_language: "",
    colors: { primary: "", secondary: "", accent: "" },
    whatsapp_number: "",
    notes: "",
  };
}

export type FieldErrors = Record<string, string>;

export type ParsedProfile =
  | { ok: true; data: ProfileInput }
  | { ok: false; fieldErrors: FieldErrors };

/** Rows left completely blank in the form are dropped; anything else is validated. */
function dropBlankProducts(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const r = raw as { products?: unknown };
  if (!Array.isArray(r.products)) return raw;
  const products = r.products.filter((p) => {
    if (!p || typeof p !== "object") return true;
    return Object.values(p as Record<string, unknown>).some((v) => typeof v !== "string" || v.trim() !== "");
  });
  return { ...r, products };
}

/** Validates a profile. Errors are keyed by field path, e.g. "business_name" or "products.2.price". */
export function parseProfile(raw: unknown): ParsedProfile {
  const res = profileSchema.safeParse(dropBlankProducts(raw));
  if (res.success) return { ok: true, data: res.data };
  const fieldErrors: FieldErrors = {};
  for (const issue of res.error.issues) {
    const key = issue.path.join(".") || "form";
    if (!(key in fieldErrors)) fieldErrors[key] = issue.message.includes(" ") ? "invalid" : issue.message;
  }
  return { ok: false, fieldErrors };
}
