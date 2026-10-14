"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { getCurrentBrand } from "@/lib/brand/current";
import { s } from "@/lib/i18n/strings";
import { describeMascotError, type MascotFailure } from "@/lib/mascot/errors";
import { saveMascot, type MascotView } from "@/lib/mascot/service";

export type SaveActionResult = { ok: true; mascot: MascotView } | ({ ok: false } & MascotFailure);

const signedOut: MascotFailure = { code: "generic", message: s.errors.signedOut };

/**
 * Saves Tween's name and scarf colour for the current brand (and creates the mascot when there is none).
 * `scarf`: a hex colour from the swatches, `null` for the brand's own colour, `undefined` to keep it.
 * Draws the character sheet again. The name is checked on the server against the blocklist.
 */
export async function saveMascotAction(input: { name?: string; scarf?: string | null; tryAnyway?: boolean }): Promise<SaveActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, ...signedOut };
  try {
    const brand = await getCurrentBrand(user.id);
    if (!brand) return { ok: false, ...signedOut };
    const mascot = await saveMascot({
      userId: user.id,
      brandId: brand.id,
      name: typeof input?.name === "string" ? input.name : undefined,
      scarf: input?.scarf === null ? null : typeof input?.scarf === "string" ? input.scarf : undefined,
      tryAnyway: input?.tryAnyway === true,
    });
    revalidatePath("/mascot");
    revalidatePath("/brand");
    return { ok: true, mascot };
  } catch (e) {
    return { ok: false, ...describeMascotError(e) };
  }
}
