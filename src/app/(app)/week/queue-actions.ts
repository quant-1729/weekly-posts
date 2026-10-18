"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { getCurrentBrand } from "@/lib/brand/current";
import { fill, s } from "@/lib/i18n/strings";
import {
  QueueError,
  formatSlot,
  listFreeSlotsForPost,
  loadQueueView,
  moveQueueItem,
  postNowApproved,
  postNowQueueItem,
  queueMessage,
  saveQueueSettings,
  scheduleApproved,
  skipQueueItem,
  unscheduleQueueItem,
  type QueueSettings,
  type QueueView,
} from "@/lib/queue";
import { emitQueueTouch } from "@/lib/realtime";

/**
 * Server actions of the Queue page. Each checks the signed-in user and takes the brand from their current
 * brand; the library functions check membership again and validate every value (a slot must be one we offer).
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const t = s.queue;

type Who = { userId: string; brandId: string };

async function who(): Promise<Who | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  const brand = await getCurrentBrand(user.id);
  return brand ? { userId: user.id, brandId: brand.id } : null;
}

export type QueueActionResult = { ok: true; message: string; view: QueueView } | { ok: false; message: string; view?: QueueView };

const uuid = (v: unknown): string | null => (typeof v === "string" && UUID_RE.test(v) ? v : null);

async function done(me: Who, run: () => Promise<{ ok: true; message: string } | { ok: false; message: string }>, opts: { touch?: boolean } = {}): Promise<QueueActionResult> {
  try {
    const r = await run();
    const view = await loadQueueView(me.userId, me.brandId);
    revalidatePath("/week");
    // Other open devices refresh. emitLive never throws and gives up after 1.5 s. A plain refresh changes nothing, so it
    // rings no bell (otherwise two open screens would refresh each other forever).
    if (r.ok && opts.touch !== false) await emitQueueTouch(me.brandId);
    return r.ok ? { ok: true, message: r.message, view } : { ok: false, message: r.message, view };
  } catch (err) {
    if (err instanceof QueueError) return { ok: false, message: queueMessage(err.code) };
    console.error("[queue] action failed", err);
    return { ok: false, message: t.errors.generic };
  }
}

const NO_ONE = { ok: false as const, message: t.errors.signedOut };

/** The page's data again (after something changed elsewhere). */
export async function refreshQueueAction(): Promise<QueueActionResult> {
  const me = await who();
  if (!me) return NO_ONE;
  return done(me, async () => ({ ok: true, message: "" }), { touch: false });
}

export async function saveQueueSettingsAction(patch: Partial<QueueSettings>): Promise<QueueActionResult> {
  const me = await who();
  if (!me) return NO_ONE;
  return done(me, async () => {
    await saveQueueSettings(me.userId, me.brandId, patch ?? {});
    return { ok: true, message: t.messages.saved };
  });
}

/** Free times for a post's channel, as ISO instants with their labels in the brand's zone. */
export async function slotOptionsAction(postId: string): Promise<{ ok: true; options: { at: string; label: string }[] } | { ok: false; message: string }> {
  const me = await who();
  const id = uuid(postId);
  if (!me || !id) return { ok: false, message: me ? t.errors.not_found : t.errors.signedOut };
  try {
    const view = await loadQueueView(me.userId, me.brandId);
    const at = await listFreeSlotsForPost({ ...me, postId: id, n: 12 });
    return { ok: true, options: at.map((iso) => ({ at: iso, label: formatSlot(iso, view.timezone) })) };
  } catch (err) {
    console.error("[queue] slot options failed", err);
    return { ok: false, message: t.errors.generic };
  }
}

/** "Schedule" on a ready post: the next free slot. */
export async function scheduleReadyAction(postId: string, pickedAt?: string): Promise<QueueActionResult> {
  const me = await who();
  const id = uuid(postId);
  if (!me || !id) return me ? { ok: false, message: t.errors.not_found } : NO_ONE;
  return done(me, async () => {
    const r = await scheduleApproved({ ...me, postIds: [id], overrides: pickedAt ? { [id]: pickedAt } : undefined });
    if (!r.ok) return { ok: false, message: r.message };
    if (r.outcome.noSlot.length > 0) return { ok: false, message: t.messages.noSlot };
    if (r.outcome.items.length === 0) return { ok: false, message: t.errors.not_approved };
    return { ok: true, message: t.messages.scheduled };
  });
}

/** "Post now" on a ready post. */
export async function postNowReadyAction(postId: string): Promise<QueueActionResult> {
  const me = await who();
  const id = uuid(postId);
  if (!me || !id) return me ? { ok: false, message: t.errors.not_found } : NO_ONE;
  return done(me, async () => {
    const r = await postNowApproved({ ...me, postIds: [id] });
    if (!r.ok) return { ok: false, message: r.message };
    if (r.outcome.noSlot.length > 0) return { ok: false, message: t.errors.ended };
    return { ok: true, message: sentMessage(r.results[0]?.outcome) };
  });
}

function sentMessage(outcome: string | undefined): string {
  if (outcome === "published") return t.messages.publishedNow;
  if (outcome === "delivered") return t.messages.emailedNow;
  if (outcome === "failed") return t.messages.failedNow;
  if (outcome === "retry") return t.messages.retryNow;
  return t.messages.sentNow;
}

export async function moveItemAction(itemId: string, slotAt: string): Promise<QueueActionResult> {
  const me = await who();
  const id = uuid(itemId);
  if (!me || !id) return me ? { ok: false, message: t.errors.not_found } : NO_ONE;
  return done(me, async () => {
    const r = await moveQueueItem({ ...me, itemId: id, slotAt: String(slotAt) });
    if (!r.ok) return { ok: false, message: r.message };
    const view = await loadQueueView(me.userId, me.brandId);
    return { ok: true, message: fill(t.messages.moved, { when: formatSlot(r.item.slotAt, view.timezone) }) };
  });
}

export async function postNowItemAction(itemId: string): Promise<QueueActionResult> {
  const me = await who();
  const id = uuid(itemId);
  if (!me || !id) return me ? { ok: false, message: t.errors.not_found } : NO_ONE;
  return done(me, async () => {
    const r = await postNowQueueItem({ ...me, itemId: id });
    return r.ok ? { ok: true, message: sentMessage(r.outcome) } : { ok: false, message: r.message };
  });
}

export async function skipItemAction(itemId: string): Promise<QueueActionResult> {
  const me = await who();
  const id = uuid(itemId);
  if (!me || !id) return me ? { ok: false, message: t.errors.not_found } : NO_ONE;
  return done(me, async () => {
    const r = await skipQueueItem({ ...me, itemId: id });
    return r.ok ? { ok: true, message: t.messages.skipped } : { ok: false, message: r.message };
  });
}

export async function unscheduleItemAction(itemId: string): Promise<QueueActionResult> {
  const me = await who();
  const id = uuid(itemId);
  if (!me || !id) return me ? { ok: false, message: t.errors.not_found } : NO_ONE;
  return done(me, async () => {
    const r = await unscheduleQueueItem({ ...me, itemId: id });
    return r.ok ? { ok: true, message: t.messages.unscheduled } : { ok: false, message: r.message };
  });
}
