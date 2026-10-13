"use server";

import { after } from "next/server";
import { approvePost, confirmFlag, editPost, logDownload, logShare, markPosted, removeFlag, rewritePost, skipPost, swapPhoto, undoPost, unmarkPosted } from "@/lib/approvals/ops";
import { parseHashtags } from "@/lib/approvals/parse";
import type { OpOk, OpResult, PostRef } from "@/lib/approvals/types";
import { getCurrentUser } from "@/lib/auth";
import { getCurrentBrand } from "@/lib/brand/current";
import { fill, s } from "@/lib/i18n/strings";
import { isValidIsoDate } from "@/lib/occasions/dates";
import { startGenerateNow } from "@/lib/weekly/button";
import { loadWeekView, type WeekView } from "@/lib/weekly/view";

export type GenerateNowResult =
  | { ok: true; weekStart: string }
  | { ok: false; message: string; weekStart?: string };

const REASON_MESSAGE: Record<string, string> = {
  busy: s.week.errors.busy,
  has_approved: s.week.errors.hasApproved,
  limit_reached: s.week.errors.limitReached,
  no_brand: s.week.errors.noBrand,
};

/**
 * Starts this week's generation for the current brand and returns at once; the work goes on
 * after the response (the screen polls getWeekViewAction). The /week page that mounts the
 * button needs `export const maxDuration = 300` so the work is not cut short on Vercel.
 */
export async function generateNowAction(): Promise<GenerateNowResult> {
  try {
    const user = await getCurrentUser();
    if (!user) return { ok: false, message: s.week.errors.signedOut };
    const r = await startGenerateNow(user.id);
    if (!r.ok) return { ok: false, message: REASON_MESSAGE[r.code] ?? s.week.errors.generic, weekStart: r.weekStart };
    after(async () => {
      try {
        await r.run();
      } catch (e) {
        console.error("[weekly] button run crashed", e);
      }
    });
    return { ok: true, weekStart: r.weekStart };
  } catch (e) {
    console.error("[weekly] generateNowAction failed", e);
    return { ok: false, message: s.week.errors.generic };
  }
}

/** The week's batch and posts for the current brand (the screen's 3-second poll). */
export async function getWeekViewAction(weekStart: string): Promise<WeekView | null> {
  try {
    const user = await getCurrentUser();
    if (!user || typeof weekStart !== "string") return null;
    const brand = await getCurrentBrand(user.id);
    if (!brand) return null;
    return await loadWeekView(user.id, brand.id, weekStart);
  } catch (e) {
    console.error("[weekly] getWeekViewAction failed", e);
    return null;
  }
}

// ---------------------------------------------------------------------------------------------
// Approve, skip, edit (V-16). The same operations the emailed links use (src/lib/approvals/ops.ts),
// with the signed-in user as the actor. The brand is always the user's current brand, and the
// operations check membership again, so a post of another brand is never reachable.
// ---------------------------------------------------------------------------------------------

export type PostActionResult =
  | { ok: true; view: WeekView; message: string; lines: string[] }
  | { ok: false; message: string; errors?: string[]; /** The photo is low quality: offer "use it anyway". */ insistPhoto?: boolean; view?: WeekView };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const failed = (message: string): PostActionResult => ({ ok: false, message });

async function perform<T extends object>(
  weekStart: unknown,
  postId: unknown,
  run: (ref: PostRef) => Promise<OpResult<T>>,
  done: (r: OpOk<T>) => { message: string; lines?: string[] },
): Promise<PostActionResult> {
  try {
    const user = await getCurrentUser();
    if (!user) return failed(s.approvals.errors.signedOut);
    if (typeof weekStart !== "string" || !isValidIsoDate(weekStart) || typeof postId !== "string" || !UUID_RE.test(postId)) {
      return failed(s.approvals.errors.notFound);
    }
    const brand = await getCurrentBrand(user.id);
    if (!brand) return failed(s.week.errors.noBrand);
    const r = await run({ brandId: brand.id, postId, actor: { via: "dashboard", userId: user.id } });
    const view = await loadWeekView(user.id, brand.id, weekStart);
    if (!r.ok) return { ok: false, message: r.message, errors: r.errors, insistPhoto: r.code === "photo_unusable", view };
    const d = done(r);
    return { ok: true, view, message: d.message, lines: d.lines ?? [] };
  } catch (e) {
    console.error("[approvals] dashboard action failed", e);
    return failed(s.approvals.errors.generic);
  }
}

const str = (v: unknown) => (typeof v === "string" ? v : "");
const reapproveLine = (reapprove: boolean) => (reapprove ? [s.approvals.edit.reapprove] : []);

export async function approvePostAction(weekStart: string, postId: string): Promise<PostActionResult> {
  return perform(weekStart, postId, (ref) => approvePost(ref), () => ({ message: s.approvals.dash.approved }));
}

export async function skipPostAction(weekStart: string, postId: string): Promise<PostActionResult> {
  return perform(weekStart, postId, (ref) => skipPost(ref), () => ({ message: s.approvals.dash.skipped }));
}

export async function undoPostAction(weekStart: string, postId: string): Promise<PostActionResult> {
  return perform(weekStart, postId, (ref) => undoPost(ref), () => ({ message: s.approvals.dash.undone }));
}

export async function confirmFlagAction(weekStart: string, postId: string, flagId: string, regulatedAck: boolean): Promise<PostActionResult> {
  return perform(
    weekStart,
    postId,
    (ref) => confirmFlag({ ...ref, flagId: str(flagId), regulatedAck: regulatedAck === true }),
    () => ({ message: s.approvals.flags.confirmedOk }),
  );
}

export async function removeFlagAction(weekStart: string, postId: string, flagId: string): Promise<PostActionResult> {
  return perform(
    weekStart,
    postId,
    (ref) => removeFlag({ ...ref, flagId: str(flagId) }),
    (r) => ({ message: s.approvals.flags.removedOk, lines: reapproveLine(r.reapprove) }),
  );
}

export interface SavePostInput {
  caption: string;
  cta: string;
  /** Comma or space separated. */
  hashtags: string;
  headline: string;
  subline: string;
}

export async function savePostAction(weekStart: string, postId: string, input: SavePostInput): Promise<PostActionResult> {
  return perform(
    weekStart,
    postId,
    (ref) =>
      editPost({
        ...ref,
        input: {
          caption: str(input?.caption),
          cta: str(input?.cta),
          hashtags: parseHashtags(str(input?.hashtags)),
          image_text: { headline: str(input?.headline), subline: str(input?.subline) },
        },
      }),
    (r) => ({ message: r.changed ? s.approvals.edit.saved : s.approvals.edit.unchanged, lines: reapproveLine(r.reapprove) }),
  );
}

/** `photoId` null = no photo. `insist` uses a photo the model marked low quality. */
export async function swapPhotoAction(weekStart: string, postId: string, photoId: string | null, insist = false): Promise<PostActionResult> {
  return perform(
    weekStart,
    postId,
    (ref) => swapPhoto({ ...ref, photoId: photoId === null ? null : str(photoId), insist: insist === true }),
    (r) => ({ message: r.warning ? s.approvals.edit.photoWarned : s.approvals.edit.photoSaved, lines: reapproveLine(r.reapprove) }),
  );
}

/** Rewrite with a short instruction (Req 15). Takes a few seconds (up to 15). */
export async function rewritePostAction(weekStart: string, postId: string, instruction: string): Promise<PostActionResult> {
  return perform(
    weekStart,
    postId,
    (ref) => rewritePost({ ...ref, instruction: str(instruction) }),
    (r) => ({
      message: s.approvals.edit.rewriteDone,
      lines: [
        fill(s.approvals.edit.rewriteTime, { seconds: (r.timings.totalMs / 1000).toFixed(1) }),
        s.approvals.edit.rewriteSaved,
        ...(r.note ? [fill(s.approvals.edit.rewriteNote, { note: r.note })] : []),
        ...(r.guardrailTimedOut ? [s.approvals.edit.rewriteTimedOut] : []),
        ...reapproveLine(r.reapprove),
      ],
    }),
  );
}

// ---------------------------------------------------------------------------------------------
// Share, download, mark as posted (V-17, Req 17, 18). Same operations as the ready page's.
// ---------------------------------------------------------------------------------------------

export async function markPostedAction(weekStart: string, postId: string): Promise<PostActionResult> {
  return perform(weekStart, postId, (ref) => markPosted(ref), () => ({ message: s.share.markedPosted }));
}

/** "Not posted yet": only within 24 hours of marking it. */
export async function unmarkPostedAction(weekStart: string, postId: string): Promise<PostActionResult> {
  return perform(weekStart, postId, (ref) => unmarkPosted(ref), () => ({ message: s.share.unmarked }));
}

/** Records that the owner shared or downloaded a post's picture (Copy is not recorded). Never throws. */
export async function logShareAction(postId: string, kind: "share" | "download", format?: string, story?: boolean): Promise<{ ok: boolean }> {
  try {
    const user = await getCurrentUser();
    if (!user || typeof postId !== "string" || !UUID_RE.test(postId)) return { ok: false };
    const brand = await getCurrentBrand(user.id);
    if (!brand) return { ok: false };
    const ref = { brandId: brand.id, postId, actor: { via: "dashboard", userId: user.id } } as const;
    const fmt = typeof format === "string" ? format : undefined;
    const r = kind === "share" ? await logShare({ ...ref, format: fmt, story: story === true }) : await logDownload({ ...ref, format: fmt });
    return { ok: r.ok };
  } catch (e) {
    console.error("[share] could not log", e);
    return { ok: false };
  }
}
