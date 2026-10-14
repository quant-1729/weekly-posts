"use server";

import { editPost } from "@/lib/approvals/ops";
import { getCurrentUser } from "@/lib/auth";
import { getCurrentBrand } from "@/lib/brand/current";
import { s } from "@/lib/i18n/strings";
import { isValidIsoDate } from "@/lib/occasions/dates";
import { loadWeekView } from "@/lib/weekly/view";
import type { PostActionResult } from "./actions";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Per-post mascot choice from the dashboard editor (V-25, D9): show or hide the brand's
 * mascot on this post, how it stands (one of the 7 post poses) and what it says. The same edit operation as the emailed edit page.
 * Hiding sets the post's mascot_id to null and redraws the pictures without it.
 */
export async function savePostMascotAction(weekStart: string, postId: string, show: boolean, bubble: string, pose?: string): Promise<PostActionResult> {
  try {
    const user = await getCurrentUser();
    if (!user) return { ok: false, message: s.approvals.errors.signedOut };
    if (typeof weekStart !== "string" || !isValidIsoDate(weekStart) || typeof postId !== "string" || !UUID_RE.test(postId)) {
      return { ok: false, message: s.approvals.errors.notFound };
    }
    const brand = await getCurrentBrand(user.id);
    if (!brand) return { ok: false, message: s.week.errors.noBrand };
    const r = await editPost({
      brandId: brand.id,
      postId,
      actor: { via: "dashboard", userId: user.id },
      input: { image_text: { bubble: typeof bubble === "string" ? bubble : "", ...(typeof pose === "string" ? { pose } : {}) }, showMascot: show === true },
    });
    const view = await loadWeekView(user.id, brand.id, weekStart);
    if (!r.ok) return { ok: false, message: r.message, errors: r.errors, view };
    return {
      ok: true,
      view,
      message: r.changed ? s.mascot.post.saved : s.mascot.post.unchanged,
      lines: r.reapprove ? [s.approvals.edit.reapprove] : [],
    };
  } catch (e) {
    console.error("[mascot] dashboard save failed", e);
    return { ok: false, message: s.approvals.errors.generic };
  }
}
