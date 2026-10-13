"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { getCurrentBrand } from "@/lib/brand/current";
import { s } from "@/lib/i18n/strings";
import { describeMascotError, type MascotFailure } from "@/lib/mascot/errors";
import { generateMascotConcepts, pickMascot, type MascotView } from "@/lib/mascot/service";

// Concepts call the AI (up to a few seconds, two calls at most).
export type ConceptsActionResult = { ok: true; concepts: MascotView[]; fewer: boolean } | ({ ok: false } & MascotFailure);
export type PickActionResult = { ok: true } | ({ ok: false } & MascotFailure);

const signedOut: MascotFailure = { code: "generic", message: s.errors.signedOut };

/** Makes up to 3 concepts for the current brand. The hint is checked on the server before any AI call. */
export async function generateConceptsAction(hint: string, tryAnyway: boolean): Promise<ConceptsActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, ...signedOut };
  try {
    const brand = await getCurrentBrand(user.id);
    if (!brand) return { ok: false, ...signedOut };
    const r = await generateMascotConcepts({
      userId: user.id,
      brandId: brand.id,
      hint: typeof hint === "string" ? hint : "",
      tryAnyway: tryAnyway === true,
    });
    return { ok: true, concepts: r.concepts, fewer: r.fewer };
  } catch (e) {
    return { ok: false, ...describeMascotError(e) };
  }
}

/** Picks a concept: draws the character sheet and makes it the active mascot. */
export async function pickMascotAction(mascotId: string): Promise<PickActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, ...signedOut };
  try {
    const brand = await getCurrentBrand(user.id);
    if (!brand) return { ok: false, ...signedOut };
    await pickMascot({ userId: user.id, brandId: brand.id, mascotId: String(mascotId) });
    revalidatePath("/mascot");
    return { ok: true };
  } catch (e) {
    return { ok: false, ...describeMascotError(e) };
  }
}
