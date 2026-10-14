"use server";

import { getCurrentUser } from "@/lib/auth";
import { getCurrentBrand } from "@/lib/brand/current";
import { BLOCK_KEYS, type BlockKey } from "@/lib/briefs/types";
import { getBrief, updateBrief } from "@/lib/briefs/service";
import {
  approveCreatePost,
  confirmPostFlag,
  describeCreateError,
  invalidateDesign,
  loadReviewData,
  logCreateShare,
  previewForOption,
  removePostFlag,
  saveCopy,
  undoCreateApproval,
  chooseDesign,
  type CopyEdit,
  type OptionView,
  type ReviewData,
} from "@/lib/create";
import type { DesignOption } from "@/lib/design/types";
import { s } from "@/lib/i18n/strings";
import { formatSlot, listFreeSlotsForPost, loadBrandTimezone, loadScheduleStep, postNowApproved, scheduleApproved, autoApproveBrief, type ScheduleStep } from "@/lib/queue";

/**
 * Server actions of the design and review steps. Each checks the signed-in user and takes the brand from
 * their current brand; the library functions check membership again, so a brief or post of another business
 * is never reachable.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const e = s.create.design.errors;

type Who = { userId: string; brandId: string };

async function who(): Promise<Who | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  const brand = await getCurrentBrand(user.id);
  return brand ? { userId: user.id, brandId: brand.id } : null;
}

const uuid = (v: unknown): string | null => (typeof v === "string" && UUID_RE.test(v) ? v : null);
const generic = { ok: false as const, message: e.generic };

function failure(err: unknown): { ok: false; message: string } {
  const known = describeCreateError(err);
  if (known && known.state !== "not_ready") return { ok: false, message: known.message };
  if (known) return { ok: false, message: e.notReady };
  console.error("[create] action failed", err);
  return generic;
}

const option = (o: unknown): DesignOption | null => {
  if (!o || typeof o !== "object") return null;
  const x = o as Record<string, unknown>;
  return typeof x.themeId === "string" && typeof x.layoutId === "string" && typeof x.scheme === "string" ? ({ themeId: x.themeId, layoutId: x.layoutId, scheme: x.scheme } as DesignOption) : null;
};

// ---------------------------------------------------------------------------------------------
// Design step
// ---------------------------------------------------------------------------------------------

/** A new preview for one option (layout or colours changed). Never calls the AI. */
export async function previewOptionAction(briefId: string, o: DesignOption): Promise<{ ok: true; view: OptionView } | { ok: false; message: string }> {
  const me = await who();
  const id = uuid(briefId);
  const opt = option(o);
  if (!me || !id || !opt) return { ok: false, message: me ? e.invalidOption : s.errors.signedOut };
  try {
    return { ok: true, view: await previewForOption({ ...me, briefId: id, option: opt }) };
  } catch (err) {
    return failure(err);
  }
}

export type SaveWordsResult = { ok: true; changed: boolean; message: string } | { ok: false; errors: string[] };

/** Saves the owner's changes to the words and checks them again. */
export async function saveWordsAction(briefId: string, edit: CopyEdit): Promise<SaveWordsResult> {
  const me = await who();
  const id = uuid(briefId);
  if (!me || !id) return { ok: false, errors: [s.errors.signedOut] };
  const str = (v: unknown) => (typeof v === "string" ? v : undefined);
  const clean: CopyEdit = {
    headline: str(edit?.headline),
    subline: str(edit?.subline),
    ctaText: str(edit?.ctaText),
    bubble: str(edit?.bubble),
    hashtags: str(edit?.hashtags),
    captions: edit?.captions && typeof edit.captions === "object" ? Object.fromEntries(Object.entries(edit.captions).filter(([, v]) => typeof v === "string")) : undefined,
  };
  try {
    const r = await saveCopy({ ...me, briefId: id, edit: clean });
    if (!r.ok) return { ok: false, errors: r.errors };
    return { ok: true, changed: r.changed, message: r.changed ? s.create.design.words.saved : s.create.design.words.unchanged };
  } catch (err) {
    return { ok: false, errors: [failure(err).message] };
  }
}

/** Another photo from the library, or none. Written back to the brief. A design already used is cleared (its pictures no longer match). */
export async function setPhotoAction(briefId: string, photoId: string | null): Promise<{ ok: true } | { ok: false; message: string }> {
  const me = await who();
  const id = uuid(briefId);
  if (!me || !id) return { ok: false, message: s.errors.signedOut };
  try {
    const brief = await getBrief(me.userId, me.brandId, id);
    if (!brief) return { ok: false, message: e.notFound };
    const next = photoId === null ? null : uuid(photoId);
    if (photoId !== null && !next) return generic;
    if (next === brief.photoId) return { ok: true };
    await updateBrief(me.userId, me.brandId, id, { photoId: next });
    await invalidateDesign(me.userId, me.brandId, id);
    return { ok: true };
  } catch (err) {
    return failure(err);
  }
}

/** Shows or hides one line (logo, phone, ...). Written back to the brief's blocks. */
export async function setBlockAction(briefId: string, key: string, on: boolean): Promise<{ ok: true } | { ok: false; message: string }> {
  const me = await who();
  const id = uuid(briefId);
  if (!me || !id) return { ok: false, message: s.errors.signedOut };
  if (!(BLOCK_KEYS as readonly string[]).includes(key)) return generic;
  try {
    const brief = await getBrief(me.userId, me.brandId, id);
    if (!brief) return { ok: false, message: e.notFound };
    const blocks = { ...brief.blocks, [key as BlockKey]: on === true };
    await updateBrief(me.userId, me.brandId, id, { blocks });
    await invalidateDesign(me.userId, me.brandId, id);
    return { ok: true };
  } catch (err) {
    return failure(err);
  }
}

/** "Use this design": draws every picture and stores the posts. */
export async function chooseDesignAction(briefId: string, o: DesignOption): Promise<{ ok: true } | { ok: false; message: string }> {
  const me = await who();
  const id = uuid(briefId);
  const opt = option(o);
  if (!me || !id || !opt) return { ok: false, message: me ? e.invalidOption : s.errors.signedOut };
  try {
    await chooseDesign({ ...me, briefId: id, option: opt });
    // S-4 / C-28: a channel with "auto-approve posts with no flags" on approves and queues what has nothing to check.
    await autoApproveBrief({ ...me, briefId: id }).catch((err) => console.error("[create] auto-approve failed", err));
    return { ok: true };
  } catch (err) {
    return failure(err);
  }
}

// ---------------------------------------------------------------------------------------------
// Review step
// ---------------------------------------------------------------------------------------------

export type ReviewActionResult = { ok: true; view: ReviewData; message: string } | { ok: false; message: string; view?: ReviewData };

async function review(me: Who, briefId: string, run: () => Promise<{ ok: true; message: string } | { ok: false; message: string }>): Promise<ReviewActionResult> {
  try {
    const r = await run();
    const view = (await loadReviewData(me.userId, me.brandId, briefId)) ?? undefined;
    if (!r.ok) return { ok: false, message: r.message, view };
    return view ? { ok: true, view, message: r.message } : { ok: false, message: e.notFound };
  } catch (err) {
    return failure(err);
  }
}

export async function confirmFlagAction(briefId: string, postId: string, flagId: string, regulatedAck: boolean): Promise<ReviewActionResult> {
  const me = await who();
  const b = uuid(briefId);
  const p = uuid(postId);
  if (!me || !b || !p || typeof flagId !== "string") return { ok: false, message: me ? e.notFound : s.errors.signedOut };
  return review(me, b, async () => {
    const r = await confirmPostFlag({ ...me, postId: p, flagId, regulatedAck: regulatedAck === true });
    return r.ok ? { ok: true, message: s.approvals.flags.confirmedOk } : { ok: false, message: r.message };
  });
}

export async function removeFlagAction(briefId: string, postId: string, flagId: string): Promise<ReviewActionResult> {
  const me = await who();
  const b = uuid(briefId);
  const p = uuid(postId);
  if (!me || !b || !p || typeof flagId !== "string") return { ok: false, message: me ? e.notFound : s.errors.signedOut };
  return review(me, b, async () => {
    const r = await removePostFlag({ ...me, postId: p, flagId });
    return r.ok ? { ok: true, message: s.approvals.flags.removedOk } : { ok: false, message: r.message };
  });
}

export async function approvePostAction(briefId: string, postId: string): Promise<ReviewActionResult> {
  const me = await who();
  const b = uuid(briefId);
  const p = uuid(postId);
  if (!me || !b || !p) return { ok: false, message: me ? e.notFound : s.errors.signedOut };
  return review(me, b, async () => {
    const r = await approveCreatePost({ ...me, postId: p });
    return r.ok ? { ok: true, message: s.approvals.dash.approved } : { ok: false, message: r.message };
  });
}

/** Approves every post that has nothing left to check. The others stay as they are, with their own reasons. */
export async function approveAllAction(briefId: string): Promise<ReviewActionResult> {
  const me = await who();
  const b = uuid(briefId);
  if (!me || !b) return { ok: false, message: me ? e.notFound : s.errors.signedOut };
  return review(me, b, async () => {
    const before = await loadReviewData(me.userId, me.brandId, b);
    let blocked = 0;
    for (const post of before?.posts ?? []) {
      if (post.status === "approved" || post.status === "posted") continue;
      const r = await approveCreatePost({ ...me, postId: post.id });
      if (!r.ok) blocked++;
    }
    return blocked === 0 ? { ok: true, message: s.approvals.dash.approved } : { ok: false, message: s.approvals.errors.blocked };
  });
}

export async function undoApprovalAction(briefId: string, postId: string): Promise<ReviewActionResult> {
  const me = await who();
  const b = uuid(briefId);
  const p = uuid(postId);
  if (!me || !b || !p) return { ok: false, message: me ? e.notFound : s.errors.signedOut };
  return review(me, b, async () => {
    const r = await undoCreateApproval({ ...me, postId: p });
    return r.ok ? { ok: true, message: s.approvals.dash.undone } : { ok: false, message: r.message };
  });
}

/** Records that the owner shared or downloaded a picture (Copy is not recorded). Never throws. */
export async function logShareAction(postId: string, kind: "share" | "download", format?: string): Promise<{ ok: boolean }> {
  try {
    const me = await who();
    const p = uuid(postId);
    if (!me || !p || (kind !== "share" && kind !== "download")) return { ok: false };
    const r = await logCreateShare({ ...me, postId: p, kind, format: typeof format === "string" ? format : undefined });
    return { ok: r.ok };
  } catch (err) {
    console.error("[create] could not log a share", err);
    return { ok: false };
  }
}

// ---------------------------------------------------------------------------------------------
// Schedule step
// ---------------------------------------------------------------------------------------------

export type ScheduleActionResult = { ok: true; message: string; step: ScheduleStep } | { ok: false; message: string; step?: ScheduleStep };

async function schedule(me: Who, briefId: string, run: () => Promise<{ ok: true; message: string } | { ok: false; message: string }>): Promise<ScheduleActionResult> {
  try {
    const r = await run();
    const step = await loadScheduleStep(me.userId, me.brandId, briefId);
    return r.ok ? { ok: true, message: r.message, step } : { ok: false, message: r.message, step };
  } catch (err) {
    console.error("[create] schedule action failed", err);
    return { ok: false, message: s.create.schedule.error };
  }
}

/** The free times for one post's channel ("Pick another time"), labelled in the brand's time zone. */
export async function slotOptionsForPostAction(postId: string): Promise<{ ok: true; options: { at: string; label: string }[] } | { ok: false; message: string }> {
  const me = await who();
  const p = uuid(postId);
  if (!me || !p) return { ok: false, message: me ? e.notFound : s.errors.signedOut };
  try {
    const [at, step] = await Promise.all([listFreeSlotsForPost({ ...me, postId: p, n: 12 }), loadBrandTimezone(me.userId, me.brandId)]);
    return { ok: true, options: at.map((iso) => ({ at: iso, label: formatSlot(iso, step) })) };
  } catch (err) {
    console.error("[create] slot options failed", err);
    return { ok: false, message: s.create.schedule.error };
  }
}

/** Confirm: queue the approved posts of the brief at the proposed times, or at the times the owner picked. */
export async function confirmScheduleAction(briefId: string, picked?: Record<string, string>): Promise<ScheduleActionResult> {
  const me = await who();
  const b = uuid(briefId);
  if (!me || !b) return { ok: false, message: me ? e.notFound : s.errors.signedOut };
  const overrides: Record<string, string> = {};
  for (const [k, v] of Object.entries(picked ?? {})) if (uuid(k) && typeof v === "string") overrides[k] = v;
  return schedule(me, b, async () => {
    const r = await scheduleApproved({ ...me, briefId: b, overrides });
    if (!r.ok) return { ok: false, message: r.message };
    if (r.outcome.items.length === 0 && r.outcome.noSlot.length > 0) return { ok: false, message: s.queue.messages.noSlot };
    return { ok: true, message: s.create.schedule.done };
  });
}

/** Post now: send the approved posts of the brief right away, through the same path as the sweep. */
export async function postNowBriefAction(briefId: string): Promise<ScheduleActionResult> {
  const me = await who();
  const b = uuid(briefId);
  if (!me || !b) return { ok: false, message: me ? e.notFound : s.errors.signedOut };
  return schedule(me, b, async () => {
    const r = await postNowApproved({ ...me, briefId: b });
    if (!r.ok) return { ok: false, message: r.message };
    if (r.outcome.items.length === 0 && r.outcome.noSlot.length > 0) return { ok: false, message: s.queue.errors.ended };
    const out = r.results.map((x) => x.outcome);
    const text = out.includes("failed") ? s.queue.messages.failedNow : out.every((o) => o === "published") ? s.queue.messages.publishedNow : out.includes("delivered") ? s.queue.messages.emailedNow : s.queue.messages.sentNow;
    return { ok: true, message: text };
  });
}
