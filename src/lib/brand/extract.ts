import { SETUP_QUESTIONS } from "@/lib/ai/prompts/setup-questions";
import type { SetupExtract } from "@/lib/ai/schemas";
import type { ProfileDraft } from "./schema";

/**
 * Pure helpers around the AI profile extraction (no server dependencies, safe
 * in the browser).
 */

export type SetupAnswers = Partial<Record<(typeof SETUP_QUESTIONS)[number]["key"], string>>;

/** The fields the AI fills in. Tone, languages, colours and WhatsApp are tap choices, never extracted. */
export type ExtractedFields = Pick<
  ProfileDraft,
  "business_name" | "category" | "city" | "products" | "audience" | "notes"
>;

export function draftFromExtract(e: SetupExtract): ExtractedFields {
  return {
    business_name: e.business_name.trim(),
    category: e.category.trim(),
    city: e.city.trim(),
    products: e.products.map((p) => ({
      name: p.name.trim(),
      price: p.price.trim(),
      unit: p.unit.trim(),
      note: p.note.trim(),
    })),
    audience: e.audience.trim(),
    notes: e.notes.trim(),
  };
}

/** Chat answers as readable text, kept in brand_memory.setup_transcript for audit. */
export function answersToTranscript(answers: SetupAnswers): string {
  return SETUP_QUESTIONS.map((q) => `Q: ${q.en}\nA: ${answers[q.key]?.trim() || "(no answer)"}`).join("\n\n");
}

export function hasAnyAnswer(answers: SetupAnswers): boolean {
  return SETUP_QUESTIONS.some((q) => (answers[q.key] ?? "").trim().length > 0);
}

const FIELD_HINTS: [field: keyof ExtractedFields, pattern: RegExp][] = [
  ["business_name", /business name|shop name|store name|name of (the )?(business|shop|store)/],
  ["category", /category|type of business|business type/],
  ["city", /\bcity\b|\barea\b|location|locality/],
  ["audience", /audience|customer/],
  ["notes", /timing|hours|address|offer|deliver|\bnotes?\b|\bopen\b|\bclose|discount/],
  ["products", /product|price|rate\b|\bitems?\b|service|menu|per kg|quantity/],
];

/**
 * Finds which parts of the profile the AI's "unclear" notes point at, so the
 * review screen can highlight them. Notes are free text, so this is a best
 * effort: every note is still shown in a list, whether or not it matches.
 */
export function matchUnclear(
  unclear: string[],
  draft: Pick<ProfileDraft, "products">,
): { fields: (keyof ExtractedFields)[]; productRows: number[] } {
  const fields = new Set<keyof ExtractedFields>();
  const rows = new Set<number>();
  for (const raw of unclear) {
    const note = raw.toLowerCase();
    for (const [field, pattern] of FIELD_HINTS) if (pattern.test(note)) fields.add(field);
    draft.products.forEach((p, i) => {
      const name = p.name.trim().toLowerCase();
      if (name && note.includes(name)) {
        rows.add(i);
        fields.add("products");
      }
    });
  }
  return { fields: [...fields], productRows: [...rows].sort((a, b) => a - b) };
}
