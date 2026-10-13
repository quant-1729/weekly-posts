"use server";

import { BrandAccessError, getCurrentBrand } from "@/lib/brand/current";
import { getCurrentUser } from "@/lib/auth";
import { s } from "@/lib/i18n/strings";
import { isCheckinAnswer } from "@/lib/links/ops";
import { saveDashboardCheckin } from "@/lib/results/checkin";

export type SaveCheckinActionResult = { ok: true } | { ok: false; message: string };

const e = s.results.errors;

/** One tap on None, A few or Many: saves (or changes) the check-in for that week. */
export async function saveCheckinAction(weekStart: string, answer: string): Promise<SaveCheckinActionResult> {
  try {
    const user = await getCurrentUser();
    if (!user) return { ok: false, message: e.signedOut };
    const brand = await getCurrentBrand(user.id);
    if (!brand) return { ok: false, message: e.noBrand };
    // The arguments come from the browser.
    if (!isCheckinAnswer(answer)) return { ok: false, message: e.badAnswer };
    if (typeof weekStart !== "string") return { ok: false, message: e.badWeek };
    const res = await saveDashboardCheckin(user.id, brand.id, weekStart, answer);
    return res.ok ? { ok: true } : { ok: false, message: e.badWeek };
  } catch (err) {
    if (!(err instanceof BrandAccessError)) console.error("[results] saveCheckinAction failed", err);
    return { ok: false, message: e.generic };
  }
}
