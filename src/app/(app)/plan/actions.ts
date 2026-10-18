"use server";

import { getCurrentUser } from "@/lib/auth";
import { getCurrentBrand } from "@/lib/brand/current";
import { approveAndSchedulePlan, createPlan, finishPlanDesign, PlanError, savePlanStudio } from "@/lib/plans/service";
import { smartFit } from "@/lib/studio/smart-fit";

/** Server actions of weekly plans. Each checks the signed-in user and their current brand. */

async function who() {
  const user = await getCurrentUser();
  if (!user) return null;
  const brand = await getCurrentBrand(user.id);
  if (!brand) return null;
  return { userId: user.id, brandId: brand.id };
}

const SIGNED_OUT = "Your session has ended. Please sign in again.";

export async function createPlanAction(input: unknown): Promise<{ ok: true; id: string } | { ok: false; message: string }> {
  const w = await who();
  if (!w) return { ok: false, message: SIGNED_OUT };
  try {
    const plan = await createPlan(w.userId, w.brandId, input);
    return { ok: true, id: plan.id };
  } catch (e) {
    if (e instanceof PlanError) return { ok: false, message: e.message };
    console.error("[plan] create failed", e);
    return { ok: false, message: "The plan could not be made. Please try again." };
  }
}

export async function savePlanStudioAction(planId: string, state: unknown): Promise<{ ok: boolean }> {
  const w = await who();
  if (!w) return { ok: false };
  try {
    return { ok: await savePlanStudio(w.userId, w.brandId, planId, state) };
  } catch (e) {
    console.error("[plan] save failed", e);
    return { ok: false };
  }
}

export async function finishPlanDesignAction(planId: string, state: unknown): Promise<{ ok: boolean; message?: string; href?: string }> {
  const w = await who();
  if (!w) return { ok: false, message: SIGNED_OUT };
  try {
    const r = await finishPlanDesign(w.userId, w.brandId, planId, state);
    return r.ok ? { ok: true, href: `/plan/${planId}` } : r;
  } catch (e) {
    console.error("[plan] finish failed", e);
    return { ok: false, message: "The week could not be drawn. Please try again." };
  }
}

export async function approveAndScheduleAction(planId: string): Promise<{ ok: boolean; message: string }> {
  const w = await who();
  if (!w) return { ok: false, message: SIGNED_OUT };
  try {
    const r = await approveAndSchedulePlan(w.userId, w.brandId, planId);
    // The Automate page shows the result from the stored queue; this message is for the reader of the action and for problems.
    const parts = [`${r.scheduled} post${r.scheduled === 1 ? "" : "s"} scheduled.`];
    if (r.needsCheck.length) parts.push(`${r.needsCheck.join(", ")} still need${r.needsCheck.length === 1 ? "s" : ""} a look.`);
    if (r.failed.length) return { ok: false, message: r.failed.join(" ") };
    return { ok: true, message: parts.join(" ") };
  } catch (e) {
    console.error("[plan] schedule failed", e);
    return { ok: false, message: "Scheduling did not work. Please try again." };
  }
}

export async function planSmartFitAction(args: { photoId?: string; colors: string[]; plainBackground: boolean; focus: { x: number; y: number }; busy: number }) {
  const w = await who();
  if (!w) return { ok: false };
  const colors = Array.isArray(args.colors) ? args.colors.filter((c) => typeof c === "string" && /^#[0-9a-fA-F]{6}$/.test(c)).slice(0, 6) : [];
  const r = await smartFit({ ...w, photoId: typeof args.photoId === "string" && /^[0-9a-f-]{36}$/i.test(args.photoId) ? args.photoId : undefined, hints: { colors, plainBackground: !!args.plainBackground, focus: { x: Number(args.focus?.x) || 0.5, y: Number(args.focus?.y) || 0.5 }, busy: Number(args.busy) || 0.5 } });
  return { ok: true, ...r };
}
