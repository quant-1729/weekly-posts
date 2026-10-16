"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { BrandAccessError } from "@/lib/brand/current";
import { s } from "@/lib/i18n/strings";
import {
  CompetitorError,
  ResearchSettingsError,
  createCompetitor,
  deleteCompetitor,
  saveResearchSettings,
  updateCompetitor,
  type Competitor,
  type CompetitorInput,
  type ResearchSettings,
} from "@/lib/ideas";

/**
 * Server actions for the Brand page's "Competitors" card (R-1): add, change and remove a competitor, and save the
 * research focus and the weekly switch. Each checks the signed-in user; the library checks brand membership and
 * the database (row-level security) is the last word.
 */

const t = s.ideas.competitors;

export type CompetitorResult<T = object> = ({ ok: true } & T) | { ok: false; message: string; field?: "name" | "website" | "instagram" | "youtube" };

const str = (v: unknown) => (typeof v === "string" ? v : "");

function input(raw: unknown): CompetitorInput {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return { name: str(o.name), website: str(o.website), instagram: str(o.instagram), youtube: str(o.youtube) };
}

function fail(e: unknown): CompetitorResult<never> {
  if (e instanceof CompetitorError) {
    switch (e.code) {
      case "name":
      case "website":
      case "instagram":
      case "youtube":
        return { ok: false, message: t.errors[e.code], field: e.code };
      case "limit":
        return { ok: false, message: t.errors.limit };
      case "not_found":
        return { ok: false, message: t.errors.notFound };
    }
  }
  if (!(e instanceof BrandAccessError)) console.error("[ideas] competitor action failed:", e instanceof Error ? e.name : "error");
  return { ok: false, message: t.errors.generic };
}

export async function addCompetitorAction(brandId: string, raw: CompetitorInput): Promise<CompetitorResult<{ competitor: Competitor }>> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, message: t.errors.generic };
  try {
    const competitor = await createCompetitor(user.id, str(brandId), input(raw));
    revalidatePath("/brand");
    return { ok: true, competitor };
  } catch (e) {
    return fail(e);
  }
}

export async function updateCompetitorAction(brandId: string, id: string, raw: CompetitorInput): Promise<CompetitorResult<{ competitor: Competitor }>> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, message: t.errors.generic };
  try {
    const competitor = await updateCompetitor(user.id, str(brandId), str(id), input(raw));
    revalidatePath("/brand");
    return { ok: true, competitor };
  } catch (e) {
    return fail(e);
  }
}

export async function deleteCompetitorAction(brandId: string, id: string): Promise<CompetitorResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, message: t.errors.generic };
  try {
    await deleteCompetitor(user.id, str(brandId), str(id));
    revalidatePath("/brand");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function saveResearchSettingsAction(brandId: string, focus: string, on: boolean): Promise<{ ok: true; settings: ResearchSettings } | { ok: false; message: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, message: s.ideas.research.error };
  try {
    const settings = await saveResearchSettings(user.id, str(brandId), { focus: str(focus), on: on === true });
    revalidatePath("/brand");
    return { ok: true, settings };
  } catch (e) {
    if (!(e instanceof ResearchSettingsError) && !(e instanceof BrandAccessError)) console.error("[ideas] research settings failed:", e instanceof Error ? e.name : "error");
    return { ok: false, message: s.ideas.research.error };
  }
}
