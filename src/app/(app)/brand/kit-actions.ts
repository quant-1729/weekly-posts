"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import type { BrandKit } from "@/lib/design/types";
import { s } from "@/lib/i18n/strings";
import { kitCopy } from "@/lib/kit/copy";
import { KitValidationError } from "@/lib/kit/schema";
import { saveBrandKit } from "@/lib/kit/service";
import { chooseLogoVariant, LogoVariantError, type LogoVariant } from "@/lib/logo/store";
import { describeMemoryError, type MemoryFailure } from "@/lib/memory/errors";

/**
 * Server actions for the Look section (colours, fonts, style, default theme, logo version). Each one
 * checks the signed-in user first; the library functions then check brand membership and validate.
 */

export type KitResult<T = object> = ({ ok: true } & T) | MemoryFailure;

const signedOut: MemoryFailure = { ok: false, code: "generic", message: s.errors.signedOut };
const str = (v: unknown) => (typeof v === "string" ? v : "");

async function run<T extends object>(fn: (userId: string) => Promise<T>): Promise<KitResult<T>> {
  const user = await getCurrentUser();
  if (!user) return signedOut;
  try {
    const done = await fn(user.id);
    revalidatePath("/brand");
    return { ok: true, ...done };
  } catch (e) {
    if (e instanceof KitValidationError) return { ok: false, code: "validation", message: kitCopy.failed, fieldErrors: e.fieldErrors };
    if (e instanceof LogoVariantError) return { ok: false, code: "not_found", message: kitCopy.logo.failed };
    return describeMemoryError(e);
  }
}

/** Saves any part of the kit (the owner's edit, so its source becomes "owner"). */
export async function saveKitAction(brandId: string, patch: unknown): Promise<KitResult<{ kit: BrandKit }>> {
  return run(async (userId) => ({ kit: await saveBrandKit(userId, str(brandId), patch) }));
}

/** "Use with background" / "Use without background". */
export async function chooseLogoVariantAction(brandId: string, variant: string): Promise<KitResult<{ active: LogoVariant }>> {
  return run(async (userId) => {
    if (variant !== "with_background" && variant !== "without_background") throw new LogoVariantError();
    const done = await chooseLogoVariant({ userId, brandId: str(brandId), variant });
    return { active: done.active };
  });
}
