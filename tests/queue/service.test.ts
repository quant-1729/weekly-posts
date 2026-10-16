import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { MockDb } from "@/lib/db/mock";
import {
  getQueueSettings,
  listFreeSlots,
  listFreeSlotsForPost,
  loadQueueView,
  loadScheduleStep,
  markDueNow,
  moveQueueItem,
  proposeSlots,
  saveQueueSettings,
  scheduleApproved,
  skipQueueItem,
  unscheduleQueueItem,
} from "@/lib/queue";
import { DEFAULT_QUEUE_SETTINGS } from "@/lib/queue/types";
import { BrandAccessError } from "@/lib/brand/current";
import { closeDb, makeOwner, openDb } from "../helpers/details";
import { NOW, connect, itemOf, itemsOf, makeShop, postStatus, rows, seedApproved, seedBrief, seedPost, type Shop } from "./helpers";

let db: MockDb;

beforeAll(async () => {
  db = await openDb();
});
afterAll(async () => {
  await closeDb(db);
});

const args = (shop: Shop) => ({ userId: shop.userId, brandId: shop.brandId, now: NOW });
const iso = (d: Date | string) => new Date(d).toISOString();

describe("settings", () => {
  it("returns the defaults when nothing was saved, and saves, merges and normalises", async () => {
    const shop = await makeShop(db);
    expect(await getQueueSettings(shop.userId, shop.brandId)).toEqual(DEFAULT_QUEUE_SETTINGS);

    const saved = await saveQueueSettings(shop.userId, shop.brandId, { postsPerWeek: 2, days: [5, 1, 5, 3], times: { instagram: "09:30", whatsapp: "18:00" }, autoApprove: { instagram: true, facebook: false } });
    expect(saved).toEqual({ postsPerWeek: 2, days: [1, 3, 5], times: { instagram: "09:30", whatsapp: "18:00" }, autoApprove: { instagram: true }, deliverEmail: true, paused: false });

    // A later save changes the fields it names (a times object replaces the old one).
    const next = await saveQueueSettings(shop.userId, shop.brandId, { paused: true, times: { instagram: "11:00" } });
    expect(next).toMatchObject({ postsPerWeek: 2, days: [1, 3, 5], paused: true, times: { instagram: "11:00" }, autoApprove: { instagram: true } });
    expect((await rows(db, "select 1 from public.queue_settings where brand_id = $1", [shop.brandId])).length).toBe(1);
  });

  it("rejects values that are not valid, and keeps what was saved", async () => {
    const shop = await makeShop(db);
    await saveQueueSettings(shop.userId, shop.brandId, { postsPerWeek: 4 });
    for (const bad of [{ postsPerWeek: 0 }, { postsPerWeek: 15 }, { postsPerWeek: 2.5 }, { days: [] }, { days: [0] }, { days: [8] }, { times: { instagram: "25:00" } }, { times: { instagram: "9:00" } }, { times: { telegram: "09:00" } }, { deliverEmail: "yes" }] as never[]) {
      await expect(saveQueueSettings(shop.userId, shop.brandId, bad), JSON.stringify(bad)).rejects.toMatchObject({ code: "invalid_settings" });
    }
    expect((await getQueueSettings(shop.userId, shop.brandId)).postsPerWeek).toBe(4);
  });

  it("is scoped by brand: another business's owner can neither read nor change it", async () => {
    const shop = await makeShop(db);
    const other = await makeOwner(db, { name: "Other Shop" });
    await expect(getQueueSettings(other.userId, shop.brandId)).rejects.toBeInstanceOf(BrandAccessError);
    await expect(saveQueueSettings(other.userId, shop.brandId, { paused: true })).rejects.toBeInstanceOf(BrandAccessError);
    expect((await getQueueSettings(shop.userId, shop.brandId)).paused).toBe(false);
  });
});

describe("scheduling approved posts", () => {
  it("puts an approved post into the next free slot in the brand's zone, as a delivery without a connection", async () => {
    const shop = await makeShop(db);
    const { briefId, posts } = await seedApproved(db, shop, ["instagram"]);
    const r = await scheduleApproved({ ...args(shop), briefId });
    expect(r.ok && r.outcome.items).toHaveLength(1);
    const item = await itemOf(db, posts[0].id);
    expect(iso(item.slot_at)).toBe("2026-10-15T09:00:00.000Z"); // Thursday 10:00 BST
    expect(item).toMatchObject({ status: "scheduled", mode: "deliver", channel: "instagram", attempts: 0 });
  });

  it("uses each channel's own time, and the mode follows the connection (publish only with an active one)", async () => {
    const shop = await makeShop(db);
    await saveQueueSettings(shop.userId, shop.brandId, { days: [4], times: { instagram: "09:00", facebook: "12:00", whatsapp: "18:30" } });
    await connect(db, shop, "instagram");
    await connect(db, shop, "facebook", { status: "expired" });
    const { briefId } = await seedApproved(db, shop, ["instagram", "facebook", "whatsapp"]);
    const r = await scheduleApproved({ ...args(shop), briefId });
    expect(r.ok && r.outcome.items).toHaveLength(3);
    const byChannel = Object.fromEntries((await itemsOf(db, shop.brandId)).map((i) => [i.channel, i]));
    expect(iso(byChannel.instagram.slot_at)).toBe("2026-10-15T08:00:00.000Z");
    expect(iso(byChannel.facebook.slot_at)).toBe("2026-10-15T11:00:00.000Z");
    expect(iso(byChannel.whatsapp.slot_at)).toBe("2026-10-15T17:30:00.000Z");
    expect(byChannel.instagram.mode).toBe("publish");
    expect(byChannel.facebook.mode).toBe("deliver"); // expired connection
    expect(byChannel.whatsapp.mode).toBe("deliver"); // no provider at all
  });

  it("a token that has run out of time does not count as a connection", async () => {
    const shop = await makeShop(db);
    await connect(db, shop, "instagram", { expiresAt: "2026-10-01T00:00:00Z" });
    const { posts } = await seedApproved(db, shop, ["instagram"]);
    await scheduleApproved({ ...args(shop), postIds: [posts[0].id] });
    expect((await itemOf(db, posts[0].id)).mode).toBe("deliver");
  });

  it("one post per slot per channel; the weekly limit counts slot days across the queue", async () => {
    const shop = await makeShop(db);
    await saveQueueSettings(shop.userId, shop.brandId, { postsPerWeek: 2, days: [1, 2, 3, 4, 5, 6, 7] });
    const a = await seedApproved(db, shop, ["instagram"]);
    const b = await seedApproved(db, shop, ["instagram"]);
    const c = await seedApproved(db, shop, ["instagram"]);
    for (const x of [a, b, c]) await scheduleApproved({ ...args(shop), briefId: x.briefId });
    const slots = (await itemsOf(db, shop.brandId)).map((i) => iso(i.slot_at));
    // Thu 15 and Fri 16 fill the week of 12 Oct (limit 2); the third post waits for Monday 19 Oct.
    expect(slots).toEqual(["2026-10-15T09:00:00.000Z", "2026-10-16T09:00:00.000Z", "2026-10-19T09:00:00.000Z"]);
  });

  it("a second channel can share a slot day that already holds a post of another channel", async () => {
    const shop = await makeShop(db);
    await saveQueueSettings(shop.userId, shop.brandId, { postsPerWeek: 1, days: [4] });
    const a = await seedApproved(db, shop, ["instagram"]);
    const b = await seedApproved(db, shop, ["facebook"]);
    await scheduleApproved({ ...args(shop), briefId: a.briefId });
    await scheduleApproved({ ...args(shop), briefId: b.briefId });
    expect((await itemsOf(db, shop.brandId)).map((i) => [i.channel, iso(i.slot_at)])).toEqual([
      ["facebook", "2026-10-15T09:00:00.000Z"],
      ["instagram", "2026-10-15T09:00:00.000Z"],
    ]);
  });

  it("never after the offer's end date: reports no slot so the screen offers Post now; the end day itself is fine", async () => {
    const shop = await makeShop(db);
    const early = await seedApproved(db, shop, ["instagram"], { endsOn: "2026-10-14" }); // today: no chosen day left before it ends
    const r = await scheduleApproved({ ...args(shop), briefId: early.briefId });
    expect(r.ok && r.outcome.items).toHaveLength(0);
    expect(r.ok && r.outcome.noSlot).toEqual([{ postId: early.posts[0].id, briefId: early.briefId, channel: "instagram", reason: "ends_before_slot" }]);
    expect(await itemOf(db, early.posts[0].id)).toBeNull();
    const over = await seedApproved(db, shop, ["instagram"], { endsOn: "2026-10-13" }); // already over
    const o = await scheduleApproved({ ...args(shop), briefId: over.briefId });
    expect(o.ok && o.outcome.noSlot).toMatchObject([{ reason: "ended" }]);

    const soon = await seedApproved(db, shop, ["instagram"], { endsOn: "2026-10-16" });
    await scheduleApproved({ ...args(shop), briefId: soon.briefId });
    expect(iso((await itemOf(db, soon.posts[0].id)).slot_at)).toBe("2026-10-15T09:00:00.000Z");

    // The next free slot is after the end: none fits, and nothing is saved.
    const squeezed = await seedApproved(db, shop, ["instagram"], { endsOn: "2026-10-16" });
    const q = await scheduleApproved({ ...args(shop), briefId: squeezed.briefId });
    expect(q.ok && q.outcome.noSlot).toMatchObject([{ reason: "ends_before_slot" }]);
    expect(await itemOf(db, squeezed.posts[0].id)).toBeNull();
  });

  it("a carousel is queued once, as its first slide's post", async () => {
    const shop = await makeShop(db);
    const { briefId, posts } = await seedApproved(db, shop, ["instagram"], { carousel: 3 });
    expect((await rows<{ n: number }>(db, "select count(*)::int as n from public.posts where brief_id = $1", [briefId]))[0].n).toBe(4);
    const r = await scheduleApproved({ ...args(shop), briefId });
    expect(r.ok && r.outcome.items).toHaveLength(1);
    expect(await itemsOf(db, shop.brandId)).toHaveLength(1);
    expect((await itemsOf(db, shop.brandId))[0].post_id).toBe(posts[0].id);
  });

  it("leaves posts that are not approved, or already queued, alone", async () => {
    const shop = await makeShop(db);
    const briefId = await seedBrief(db, shop, { channels: ["instagram", "facebook"] });
    const draft = await seedPost(db, shop, briefId, "instagram", { status: "draft" });
    const ready = await seedPost(db, shop, briefId, "facebook");
    const first = await scheduleApproved({ ...args(shop), briefId });
    expect(first.ok && first.outcome.skipped).toEqual([{ postId: draft.id, reason: "not_approved" }]);
    expect(first.ok && first.outcome.items.map((i) => i.postId)).toEqual([ready.id]);
    const again = await scheduleApproved({ ...args(shop), postIds: [ready.id, draft.id] });
    expect(again.ok && again.outcome.skipped.sort((a, b) => a.reason.localeCompare(b.reason))).toEqual([
      { postId: ready.id, reason: "already_queued" },
      { postId: draft.id, reason: "not_approved" },
    ]);
    expect(await itemsOf(db, shop.brandId)).toHaveLength(1);
  });

  it("only posts of the signed-in owner's brand: another brand's post id is 'not found'", async () => {
    const shop = await makeShop(db);
    const other = await makeShop(db, { name: "Other Shop" });
    const theirs = await seedApproved(db, other, ["instagram"]);
    const r = await scheduleApproved({ ...args(shop), postIds: [theirs.posts[0].id] });
    expect(r.ok && r.outcome.skipped).toEqual([{ postId: theirs.posts[0].id, reason: "not_found" }]);
    expect(await itemsOf(db, other.brandId)).toHaveLength(0);
    await expect(scheduleApproved({ userId: shop.userId, brandId: other.brandId, briefId: theirs.briefId })).rejects.toBeInstanceOf(BrandAccessError);
  });

  it("proposeSlots shows what scheduling would do and saves nothing", async () => {
    const shop = await makeShop(db);
    const { briefId, posts } = await seedApproved(db, shop, ["instagram", "whatsapp"]);
    const p = await proposeSlots({ ...args(shop), briefId });
    expect(p.ok && p.outcome.placed.map((x) => [x.channel, x.slotAt, x.mode])).toEqual([
      ["instagram", "2026-10-15T09:00:00.000Z", "deliver"],
      ["whatsapp", "2026-10-15T09:00:00.000Z", "deliver"],
    ]);
    expect(await itemsOf(db, shop.brandId)).toHaveLength(0);
    const step = await loadScheduleStep(shop.userId, shop.brandId, briefId, NOW);
    expect(step.lines.map((l) => [l.channel, l.proposedWhen, l.modeLine, l.queued])).toEqual([
      ["instagram", "Thu 15 Oct, 10:00", "We'll email it to you", null],
      ["whatsapp", "Thu 15 Oct, 10:00", "We'll email it to you", null],
    ]);
    await scheduleApproved({ ...args(shop), postIds: [posts[0].id] });
    const after = await loadScheduleStep(shop.userId, shop.brandId, briefId, NOW);
    expect(after.lines[0].queued).toMatchObject({ status: "scheduled", when: "Thu 15 Oct, 10:00" });
    expect(after.lines[1].proposedWhen).toBe("Thu 15 Oct, 10:00"); // WhatsApp has its own slot on the day Instagram uses
  });

  it("the owner can pick another of the offered times (any time is allowed now: see schedule-picker.test.ts for the rules)", async () => {
    const shop = await makeShop(db);
    const { briefId, posts } = await seedApproved(db, shop, ["instagram"]);
    const offered = await listFreeSlotsForPost({ userId: shop.userId, brandId: shop.brandId, postId: posts[0].id, now: NOW });
    expect(offered.slice(0, 3)).toEqual(["2026-10-15T09:00:00.000Z", "2026-10-17T09:00:00.000Z", "2026-10-20T09:00:00.000Z"]);
    const bad = await scheduleApproved({ ...args(shop), briefId, overrides: { [posts[0].id]: "garbage" } });
    expect(bad).toMatchObject({ ok: false, code: "invalid_slot" });
    expect(await itemOf(db, posts[0].id)).toBeNull();
    const ok = await scheduleApproved({ ...args(shop), briefId, overrides: { [posts[0].id]: offered[2] } });
    expect(ok.ok).toBe(true);
    expect(iso((await itemOf(db, posts[0].id)).slot_at)).toBe(offered[2]);
  });
});

describe("owner actions", () => {
  async function queued(shop: Shop, channels: ("instagram" | "whatsapp")[] = ["whatsapp"]) {
    const x = await seedApproved(db, shop, channels);
    await scheduleApproved({ ...args(shop), briefId: x.briefId });
    const items = await itemsOf(db, shop.brandId);
    return { ...x, items };
  }

  it("move: only to a slot that is offered; the item goes back to scheduled with no failed attempts", async () => {
    const shop = await makeShop(db);
    const q = await queued(shop);
    const item = q.items[0];
    await rows(db, "update public.queue_items set status = 'missed', attempts = 2, last_error = 'x' where id = $1", [item.id]);
    const slots = await listFreeSlots({ userId: shop.userId, brandId: shop.brandId, channel: "whatsapp", exceptItemId: item.id, now: NOW });
    expect(slots[0]).toBe("2026-10-15T09:00:00.000Z"); // its own slot is free for it again

    expect(await moveQueueItem({ ...args(shop), itemId: item.id, slotAt: "2026-10-16T09:00:00.000Z" })).toMatchObject({ ok: false, code: "invalid_slot" });
    expect(await moveQueueItem({ ...args(shop), itemId: item.id, slotAt: "garbage" })).toMatchObject({ ok: false, code: "invalid_slot" });
    const r = await moveQueueItem({ ...args(shop), itemId: item.id, slotAt: slots[1] });
    expect(r).toMatchObject({ ok: true, item: { status: "scheduled", attempts: 0, lastError: null } });
    expect(iso((await itemOf(db, q.posts[0].id)).slot_at)).toBe(slots[1]);
  });

  it("move: refused after the offer has ended, or for an item already sent", async () => {
    const shop = await makeShop(db);
    const q = await queued(shop);
    const id = q.items[0].id;
    expect(await moveQueueItem({ ...args(shop), itemId: id, slotAt: "2026-10-17T09:00:00.000Z" })).toMatchObject({ ok: true });
    await rows(db, "update public.post_briefs set ends_on = '2026-10-13' where id = $1", [q.briefId]);
    expect(await moveQueueItem({ ...args(shop), itemId: id, slotAt: "2026-10-20T09:00:00.000Z" })).toMatchObject({ ok: false, code: "ended" });
    expect(await markDueNow({ ...args(shop), itemId: id })).toMatchObject({ ok: false, code: "ended" });
    await rows(db, "update public.post_briefs set ends_on = '2026-10-31' where id = $1", [q.briefId]);
    await rows(db, "update public.queue_items set status = 'delivered' where id = $1", [id]);
    expect(await moveQueueItem({ ...args(shop), itemId: id, slotAt: "2026-10-20T09:00:00.000Z" })).toMatchObject({ ok: false, code: "already_sent" });
    expect(await skipQueueItem({ ...args(shop), itemId: id })).toMatchObject({ ok: false, code: "already_sent" });
    expect(await unscheduleQueueItem({ ...args(shop), itemId: id })).toMatchObject({ ok: false, code: "already_sent" });
  });

  it("post now: slot becomes the current time, status scheduled, and the sweep path sends it", async () => {
    const shop = await makeShop(db);
    const q = await queued(shop);
    const r = await markDueNow({ ...args(shop), itemId: q.items[0].id });
    expect(r).toMatchObject({ ok: true, item: { status: "scheduled", slotAt: NOW.toISOString() } });
  });

  it("skip: the item is skipped and so is its post; it can be approved and scheduled again later", async () => {
    const shop = await makeShop(db);
    const q = await queued(shop);
    const r = await skipQueueItem({ ...args(shop), itemId: q.items[0].id });
    expect(r).toMatchObject({ ok: true, item: { status: "skipped" } });
    expect(await postStatus(db, q.posts[0].id)).toBe("skipped");
    // A skipped slot is free again for others.
    const other = await seedApproved(db, shop, ["whatsapp"]);
    await scheduleApproved({ ...args(shop), briefId: other.briefId });
    expect(iso((await itemOf(db, other.posts[0].id)).slot_at)).toBe("2026-10-15T09:00:00.000Z");
    // Approved again: it goes back into the queue (the skipped row is reused).
    await rows(db, "update public.posts set status = 'approved' where id = $1", [q.posts[0].id]);
    const again = await scheduleApproved({ ...args(shop), postIds: [q.posts[0].id] });
    expect(again.ok && again.outcome.items).toHaveLength(1);
    expect((await itemOf(db, q.posts[0].id)).status).toBe("scheduled");
  });

  it("unschedule: the item is removed, the post stays approved and shows under Ready to schedule", async () => {
    const shop = await makeShop(db);
    const q = await queued(shop);
    expect((await loadQueueView(shop.userId, shop.brandId, NOW)).ready).toHaveLength(0);
    expect(await unscheduleQueueItem({ ...args(shop), itemId: q.items[0].id })).toMatchObject({ ok: true, postId: q.posts[0].id });
    expect(await itemOf(db, q.posts[0].id)).toBeNull();
    expect(await postStatus(db, q.posts[0].id)).toBe("approved");
    const view = await loadQueueView(shop.userId, shop.brandId, NOW);
    expect(view.ready.map((r) => r.postId)).toEqual([q.posts[0].id]);
  });

  it("another business cannot act on an item", async () => {
    const shop = await makeShop(db);
    const q = await queued(shop);
    const other = await makeShop(db, { name: "Other Shop" });
    const id = q.items[0].id;
    await expect(moveQueueItem({ userId: other.userId, brandId: shop.brandId, itemId: id, slotAt: "2026-10-17T09:00:00.000Z" })).rejects.toBeInstanceOf(BrandAccessError);
    // Even with their own brand id the item is not theirs.
    expect(await skipQueueItem({ userId: other.userId, brandId: other.brandId, itemId: id, now: NOW })).toMatchObject({ ok: false, code: "not_found" });
    expect(await unscheduleQueueItem({ userId: other.userId, brandId: other.brandId, itemId: id })).toMatchObject({ ok: false, code: "not_found" });
    expect((await itemOf(db, q.posts[0].id)).status).toBe("scheduled");
  });

  it("changing or un-approving a post takes it out of the queue", async () => {
    const shop = await makeShop(db);
    const q = await queued(shop);
    const { undoCreateApproval } = await import("@/lib/create");
    await undoCreateApproval({ userId: shop.userId, brandId: shop.brandId, postId: q.posts[0].id });
    expect(await itemOf(db, q.posts[0].id)).toBeNull();
    expect(await postStatus(db, q.posts[0].id)).toBe("draft");
  });
});

describe("the queue page data", () => {
  it("groups upcoming items by local day, lists what needs attention and what was sent lately", async () => {
    const shop = await makeShop(db);
    const a = await seedApproved(db, shop, ["instagram", "whatsapp"]);
    await scheduleApproved({ ...args(shop), briefId: a.briefId });
    const b = await seedApproved(db, shop, ["instagram"]);
    await scheduleApproved({ ...args(shop), briefId: b.briefId });
    const items = await itemsOf(db, shop.brandId);
    await rows(db, "update public.queue_items set status = 'missed' where id = $1", [items[2].id]);
    await rows(db, "update public.queue_items set status = 'delivered', done_at = $2 where id = $1", [items[1].id, "2026-10-13T09:00:00Z"]);

    const view = await loadQueueView(shop.userId, shop.brandId, NOW);
    expect(view.timezone).toBe("Europe/London");
    expect(view.upcoming.map((d) => [d.date, d.label, d.items.map((i) => i.channel)])).toEqual([["2026-10-15", "Thu 15 Oct", ["instagram"]]]);
    expect(view.upcoming[0].items[0]).toMatchObject({ when: "Thu 15 Oct, 10:00", modeLabel: "We'll email it to you", statusLabel: "Scheduled", actionable: true });
    expect(view.attention.map((c) => [c.status, c.reason])).toEqual([["missed", "Its time passed before it was sent."]]);
    expect(view.recent.map((c) => c.status)).toEqual(["delivered"]);
    expect(view.settings.postsPerWeek).toBe(3);
    expect(view.channels.find((c) => c.channel === "instagram")).toMatchObject({ provider: "instagram", connected: false });
  });
});
