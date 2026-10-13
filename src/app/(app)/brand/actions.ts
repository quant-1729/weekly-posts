"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { s } from "@/lib/i18n/strings";
import { describeMemoryError, type MemoryFailure } from "@/lib/memory/errors";
import { addFact, editFact, FactNotFoundError, removeFact } from "@/lib/memory/facts";
import { saveColors, adoptWebsiteLogo } from "@/lib/memory/look";
import type { FactView } from "@/lib/memory/schema";
import { setMascotInPosts } from "@/lib/mascot/service";
import { saveSettings } from "@/lib/memory/settings";
import { rereadWebsite, type RereadOutcome } from "@/lib/memory/website";
import { addOwnerDate, removeOwnerDate, type OwnerDate } from "@/lib/occasions/owner-dates";
import type { Palette } from "@/lib/brand/colors";

/**
 * Server actions for the brand memory page. Each one checks the signed-in user first; the
 * library functions then check that the user belongs to the brand, and validate with zod.
 */

export type Result<T = object> = ({ ok: true } & T) | MemoryFailure;

const signedOut: MemoryFailure = { ok: false, code: "generic", message: s.errors.signedOut };

async function run<T extends object>(fn: (userId: string) => Promise<T>): Promise<Result<T>> {
  const user = await getCurrentUser();
  if (!user) return signedOut;
  try {
    const done = await fn(user.id);
    revalidatePath("/brand");
    return { ok: true, ...done };
  } catch (e) {
    return describeMemoryError(e);
  }
}

const str = (v: unknown) => (typeof v === "string" ? v : "");

export async function addFactAction(brandId: string, input: unknown): Promise<Result<{ fact: FactView }>> {
  return run(async (userId) => ({ fact: await addFact(userId, str(brandId), input) }));
}

export async function editFactAction(brandId: string, factId: string, input: unknown): Promise<Result<{ fact: FactView }>> {
  return run(async (userId) => ({ fact: await editFact(userId, str(brandId), str(factId), input) }));
}

export async function removeFactAction(brandId: string, factId: string): Promise<Result> {
  return run(async (userId) => {
    if (!(await removeFact(userId, str(brandId), str(factId)))) throw new FactNotFoundError();
    return {};
  });
}

/** "Read my website again", also used to change the address. Can take up to a minute. */
export async function rereadWebsiteAction(brandId: string, url: string): Promise<Result<{ outcome: RereadOutcome }>> {
  return run(async (userId) => ({ outcome: await rereadWebsite({ userId, brandId: str(brandId), url: str(url) }) }));
}

export async function applyWebsiteLogoAction(brandId: string): Promise<Result<{ logoPath: string; palette: Palette | null }>> {
  return run(async (userId) => {
    const logo = await adoptWebsiteLogo({ userId, brandId: str(brandId) });
    return { logoPath: logo.logoPath, palette: logo.palette };
  });
}

export async function saveColorsAction(brandId: string, colors: unknown): Promise<Result<{ colors: Palette }>> {
  return run(async (userId) => ({ colors: await saveColors(userId, str(brandId), colors) }));
}

export async function addOwnerDateAction(
  brandId: string,
  input: { date: string; name: string; yearly: boolean },
): Promise<Result<{ date: OwnerDate }>> {
  return run(async (userId) => ({
    date: await addOwnerDate(userId, str(brandId), { date: str(input?.date), name: str(input?.name), yearly: input?.yearly !== false }),
  }));
}

export async function removeOwnerDateAction(brandId: string, id: string): Promise<Result> {
  return run(async (userId) => {
    await removeOwnerDate(userId, str(brandId), str(id));
    return {};
  });
}

/** "Use my mascot in posts" (V-25). Turning it on needs an active mascot. */
export async function setMascotInPostsAction(brandId: string, on: boolean): Promise<Result<{ on: boolean }>> {
  return run(async (userId) => ({ on: await setMascotInPosts(userId, str(brandId), on === true) }));
}

export async function saveSettingsAction(brandId: string, values: unknown): Promise<Result> {
  return run(async (userId) => {
    await saveSettings(userId, str(brandId), values);
    return {};
  });
}
