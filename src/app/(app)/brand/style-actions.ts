"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { THEME_IDS, brandKitSchema, type BrandKit } from "@/lib/design/types";
import { s } from "@/lib/i18n/strings";
import { describeMemoryError, type MemoryFailure } from "@/lib/memory/errors";
import { backgroundPalette, generateBackground, type BackgroundFailure } from "@/lib/style/backgrounds";
import { styleCopy } from "@/lib/style/copy";
import { readStyle, type StyleResult } from "@/lib/style/read";
import { loadCurrentKit, saveKit } from "@/lib/style/store";

/**
 * Server actions for "Keep my look" (C-17) and Imagen backgrounds (C-18). Explicit actions only: nothing here
 * runs on page load. Each checks the signed-in user; the library functions check brand membership.
 */

export type StyleActionResult<T = object> = ({ ok: true } & T) | MemoryFailure;

const signedOut: MemoryFailure = { ok: false, code: "generic", message: s.errors.signedOut };
const str = (v: unknown) => (typeof v === "string" ? v : "");

/** Reads the owner's look. One model call (about 1 cent); limited to 3 a week. */
export async function readLookAction(brandId: string): Promise<StyleActionResult<{ result: StyleResult }>> {
  const user = await getCurrentUser();
  if (!user) return signedOut;
  try {
    return { ok: true, result: await readStyle({ userId: user.id, brandId: str(brandId) }) };
  } catch (e) {
    return describeMemoryError(e);
  }
}

/** Saves the kit the owner agreed to ("Keep my look"). The kit is validated again on the server. */
export async function keepLookAction(brandId: string, kit: unknown): Promise<StyleActionResult<{ kit: BrandKit }>> {
  const user = await getCurrentUser();
  if (!user) return signedOut;
  const parsed = brandKitSchema.safeParse(kit);
  if (!parsed.success) return { ok: false, code: "validation", message: styleCopy.card.saveFailed };
  try {
    const saved = await saveKit(user.id, str(brandId), parsed.data);
    revalidatePath("/brand");
    return { ok: true, kit: saved };
  } catch (e) {
    return describeMemoryError(e);
  }
}

/** Makes (or finds) the Imagen background for one theme in the brand's current kit. About 4 cents when new. */
export async function makeBackgroundAction(
  brandId: string,
  themeId: string,
): Promise<StyleActionResult<{ cached: boolean; failure: BackgroundFailure | null }>> {
  const user = await getCurrentUser();
  if (!user) return signedOut;
  if (!(THEME_IDS as readonly string[]).includes(themeId)) return { ok: false, code: "validation", message: s.errors.generic };
  try {
    const { kit } = await loadCurrentKit(user.id, str(brandId));
    const { colors, mode } = backgroundPalette(kit);
    const res = await generateBackground({ userId: user.id, brandId: str(brandId), themeId, palette: colors, mode });
    return res.ok ? { ok: true, cached: res.cached, failure: null } : { ok: true, cached: false, failure: res.reason };
  } catch (e) {
    return describeMemoryError(e);
  }
}
