"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getCurrentBrand } from "@/lib/brand/current";
import { fill, s } from "@/lib/i18n/strings";
import { runResearch } from "@/lib/ideas/run";
import { IdeaError, dismissCard, dismissIdea, makePostFromIdea } from "@/lib/ideas/use";
import { loadIdeasView } from "@/lib/ideas/view";
import { MANUAL_RUNS_PER_WEEK } from "@/lib/ideas/types";

/**
 * Server actions of the Ideas page. Each checks the signed-in user and uses the brand the owner is working in
 * (never a brand id from the browser). The forms work without JavaScript.
 */

const t = s.ideas.page;
const str = (v: FormDataEntryValue | null): string => (typeof v === "string" ? v : "");

export type ResearchResult = { ok: true; cards: number } | { ok: false; message: string };

/** "Research now": one manual run (2 a week). Takes up to a minute; the page shows a calm progress state meanwhile. */
export async function researchNowAction(): Promise<ResearchResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, message: s.errors.signedOut };
  const brand = await getCurrentBrand(user.id);
  if (!brand || !brand.setupCompleted) return { ok: false, message: t.errors.generic };
  try {
    const view = await loadIdeasView(user.id, brand.id);
    if (view.disabled) return { ok: false, message: fill(t.disabled[view.disabled], { max: MANUAL_RUNS_PER_WEEK }) };
    const run = await runResearch({ userId: user.id, brandId: brand.id, trigger: "manual" });
    revalidatePath("/ideas");
    if (!run || run.status === "failed") return { ok: false, message: t.errors.failed };
    if (run.status === "capped") {
      const reason = (run.error ?? "research_cap") as keyof typeof t.disabled;
      return { ok: false, message: fill(t.disabled[reason] ?? t.disabled.research_cap, { max: MANUAL_RUNS_PER_WEEK }) };
    }
    const after = await loadIdeasView(user.id, brand.id);
    return { ok: true, cards: after.cards.length };
  } catch (e) {
    console.error("[ideas] research now failed:", e instanceof Error ? e.name : "error");
    return { ok: false, message: t.errors.generic };
  }
}

/** "Make this post": starts a draft brief from the idea and opens Create a post at its Details step. */
export async function makeIdeaPostAction(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const brand = await getCurrentBrand(user.id);
  if (!brand || !brand.setupCompleted) redirect("/setup");
  let briefId: string;
  try {
    briefId = (await makePostFromIdea(user.id, brand.id, str(formData.get("ideaId")))).briefId;
  } catch (e) {
    redirect(`/ideas?e=${e instanceof IdeaError ? e.code : "failed"}`);
  }
  revalidatePath("/ideas");
  redirect(`/create/${briefId}`);
}

/** "Not for me". */
export async function dismissIdeaAction(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const brand = await getCurrentBrand(user.id);
  if (!brand || !brand.setupCompleted) redirect("/setup");
  try {
    await dismissIdea(user.id, brand.id, str(formData.get("ideaId")));
  } catch (e) {
    if (!(e instanceof IdeaError)) throw e;
  }
  revalidatePath("/ideas");
  revalidatePath("/week");
}

/** Dismisses a whole trend card. */
export async function dismissCardAction(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const brand = await getCurrentBrand(user.id);
  if (!brand || !brand.setupCompleted) redirect("/setup");
  try {
    await dismissCard(user.id, brand.id, str(formData.get("cardId")));
  } catch (e) {
    if (!(e instanceof IdeaError)) throw e;
  }
  revalidatePath("/ideas");
  revalidatePath("/week");
}
