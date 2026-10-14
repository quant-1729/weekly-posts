/** The patch the Look section sends: any part of the kit the owner can edit. `mascot` and `source` are not editable here. */
import { z } from "zod";
import { isHexColor, normalizeHex } from "@/lib/brand/colors";
import { FONT_CHOICES, THEME_IDS } from "@/lib/design/types";

const hex = z
  .string()
  .trim()
  .refine(isHexColor, "invalid_color")
  .transform(normalizeHex);

export const kitPatchSchema = z
  .object({
    colors: z.object({ primary: hex, secondary: hex, accent: hex, background: hex }).partial().strict(),
    fonts: z.object({ headline: z.enum(FONT_CHOICES), body: z.enum(FONT_CHOICES) }).partial().strict(),
    style: z
      .object({ corners: z.enum(["rounded", "sharp"]), mode: z.enum(["light", "dark"]), energy: z.enum(["calm", "bold"]) })
      .partial()
      .strict(),
    themeId: z.enum(THEME_IDS),
    textLogo: z.boolean(),
  })
  .partial()
  .strict();

export type KitPatch = z.input<typeof kitPatchSchema>;

export class KitValidationError extends Error {
  constructor(public readonly fieldErrors: Record<string, string>) {
    super("Brand kit is invalid");
    this.name = "KitValidationError";
  }
}
