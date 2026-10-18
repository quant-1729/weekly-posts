// Live status for the Queue (docs/14-firebase-plan.md, task T-FB4, test plan item 4): the sweep and "Post now" ring a bell per
// item after the database work is committed; the owner's actions ring one bell for the whole queue; none of it can change what
// the sweep does.
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ user: null as { id: string } | null }));
const liveState = vi.hoisted(() => ({ live: false }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: async () => session.user }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, refresh: () => undefined, replace: () => undefined }),
  usePathname: () => "/week",
}));
// Server rendering never runs effects, so the hooks are replaced by a switch: this tests what the screen draws when live.
vi.mock("@/components/live/use-live", () => ({
  useLiveKind: () => ({ live: liveState.live, docs: [] }),
  useLiveDoc: () => ({ live: liveState.live, doc: null }),
}));

import { refreshQueueAction, skipItemAction } from "@/app/(app)/week/queue-actions";
import { patchStatus, QueueScreen } from "@/components/queue/queue-screen";
import type { MockDb } from "@/lib/db/mock";
import { loadQueueView, postNowApproved, postNowQueueItem, runQueueSweep, scheduleApproved } from "@/lib/queue";
import { setPublisherForTests } from "@/lib/queue/publisher";
import type { PublishQueueItem, PublishResult } from "@/lib/queue/types";
import { clearLiveWritesForTests, liveWritesForTests, resetLiveForTests, setLiveSinkForTests, type LiveWrite } from "@/lib/realtime";
import { closeDb, openDb } from "../helpers/details";
import { NOW, connect, itemOf, makeShop, rows, seedApproved, seedBrief, seedItem, seedPost, type Shop } from "./helpers";

let db: MockDb;

beforeAll(async () => {
  db = await openDb();
});
afterAll(async () => {
  setPublisherForTests(null);
  await closeDb(db);
});
beforeEach(() => {
  clearLiveWritesForTests();
  resetLiveForTests();
});
afterEach(() => {
  setLiveSinkForTests(null);
  liveState.live = false;
  session.user = null;
  vi.restoreAllMocks();
});

/** Thursday 15 Oct 2026, 10:00 in London (BST) = 09:00 UTC; the sweep runs 15 minutes later. */
const SLOT = "2026-10-15T09:00:00.000Z";
const SWEEP = new Date("2026-10-15T09:15:00Z");

const ok = (id = "17900001"): PublishResult => ({ ok: true, platformPostId: id, permalink: `https://www.instagram.com/p/${id}/` });
const fail = (reason: Extract<PublishResult, { ok: false }>["reason"], retryable: boolean): PublishResult => ({ ok: false, retryable, reason, message: `fake ${reason}` });

/** A fake publisher that answers from a script (the last answer repeats) and remembers its calls. */
function fakePublisher(answers: PublishResult[]) {
  const calls: { itemId: string; brandId: string }[] = [];
  const publish: PublishQueueItem = async (a) => {
    calls.push(a);
    return answers[Math.min(calls.length - 1, answers.length - 1)];
  };
  return { publish, calls };
}

/** One approved post with a scheduled item due at SLOT. */
async function due(shop: Shop, channel: "instagram" | "whatsapp" | "facebook" | "youtube" = "whatsapp", o: { mode?: "publish" | "deliver"; slotAt?: string; endsOn?: string | null; attempts?: number } = {}) {
  const x = await seedApproved(db, shop, [channel], { endsOn: o.endsOn });
  const itemId = await seedItem(db, shop, x.posts[0], { slotAt: o.slotAt ?? SLOT, mode: o.mode ?? "deliver", attempts: o.attempts });
  return { ...x, post: x.posts[0], itemId };
}

/** What was written for one item, oldest first. */
const writesFor = (itemId: string): LiveWrite[] => liveWritesForTests().filter((w) => w.docId === `q_${itemId}`);
const statuses = (itemId: string) => writesFor(itemId).map((w) => w.data.status);

describe("the sweep rings a bell per item", () => {
  it("publishing then published, at brands/{brandId}/live/q_{itemId}, with nothing but the allow-listed fields", async () => {
    const shop = await makeShop(db);
    await connect(db, shop, "instagram");
    const d = await due(shop, "instagram", { mode: "publish" });
    const seenWhileSending: unknown[] = [];
    const publish: PublishQueueItem = async () => {
      // The claim is committed and announced before the publisher is called.
      seenWhileSending.push(...statuses(d.itemId));
      return ok("178999");
    };
    await runQueueSweep({ now: SWEEP, deps: { publish } });
    expect(seenWhileSending).toEqual(["publishing"]);
    expect(statuses(d.itemId)).toEqual(["publishing", "published"]);
    const [first, last] = writesFor(d.itemId);
    expect(last.path).toBe(`brands/${shop.brandId}/live/q_${d.itemId}`);
    expect(last.kind).toBe("queue");
    expect(last.data).toEqual({ itemId: d.itemId, postId: d.post.id, channel: "instagram", status: "published", mode: "publish", attempts: 0, slotAt: SLOT });
    expect(last.seq).toBeGreaterThan(first.seq);
    // No caption, link, platform id or error text ever goes into a live document.
    expect(JSON.stringify(liveWritesForTests())).not.toMatch(/Fresh bread|instagram\.com\/p|178999|fake /);
  });

  it("delivered: an item emailed to the owner goes publishing then delivered", async () => {
    const shop = await makeShop(db);
    const d = await due(shop, "whatsapp");
    await runQueueSweep({ now: SWEEP });
    expect(statuses(d.itemId)).toEqual(["publishing", "delivered"]);
    expect(writesFor(d.itemId)[1].data.mode).toBe("deliver");
  });

  it("a retryable failure goes publishing then back to scheduled with attempts 1", async () => {
    const shop = await makeShop(db);
    const d = await due(shop, "instagram", { mode: "publish" });
    await runQueueSweep({ now: SWEEP, deps: { publish: fakePublisher([fail("rate_limited", true)]).publish } });
    expect(statuses(d.itemId)).toEqual(["publishing", "scheduled"]);
    expect(writesFor(d.itemId)[1].data).toMatchObject({ status: "scheduled", attempts: 1 });
  });

  it("a final failure goes publishing then failed, now a delivery", async () => {
    const shop = await makeShop(db);
    const d = await due(shop, "instagram", { mode: "publish", attempts: 2 });
    await runQueueSweep({ now: SWEEP, deps: { publish: fakePublisher([fail("network", true)]).publish } });
    expect(statuses(d.itemId)).toEqual(["publishing", "failed"]);
    expect(writesFor(d.itemId)[1].data).toMatchObject({ status: "failed", mode: "deliver", attempts: 3 });
  });

  it("a publisher that throws is a retry, and the bell still says so", async () => {
    const shop = await makeShop(db);
    const d = await due(shop, "instagram", { mode: "publish" });
    const publish: PublishQueueItem = async () => {
      throw new Error("socket hang up");
    };
    await runQueueSweep({ now: SWEEP, deps: { publish } });
    expect(statuses(d.itemId)).toEqual(["publishing", "scheduled"]);
  });

  it("an item changed by someone else while it was being sent (lost) is announced as it stands", async () => {
    const shop = await makeShop(db);
    const d = await due(shop, "instagram", { mode: "publish" });
    const publish: PublishQueueItem = async (a) => {
      if (a.itemId === d.itemId) await rows(db, "update public.queue_items set status = 'skipped' where id = $1", [d.itemId]);
      return ok("1");
    };
    const sum = await runQueueSweep({ now: SWEEP, deps: { publish } });
    expect(sum.items.find((i) => i.itemId === d.itemId)?.outcome).toBe("lost");
    expect(statuses(d.itemId)).toEqual(["publishing", "skipped"]);
  });

  it("missed, expired and skipped each write once", async () => {
    const shop = await makeShop(db);
    const expired = await due(shop, "instagram", { mode: "publish", endsOn: "2026-10-14" });
    const skipped = await due(shop, "facebook");
    await rows(db, "update public.posts set status = 'draft' where id = $1", [skipped.post.id]);
    const old = await due(shop, "whatsapp", { slotAt: "2026-10-12T09:00:00.000Z" });
    const fresh = await due(shop, "whatsapp");
    await runQueueSweep({ now: SWEEP });
    expect(statuses(expired.itemId)).toEqual(["expired"]);
    expect(statuses(skipped.itemId)).toEqual(["skipped"]);
    expect(statuses(old.itemId)).toEqual(["missed"]);
    expect(statuses(fresh.itemId)).toEqual(["publishing", "delivered"]);
    expect(writesFor(expired.itemId)[0].path).toBe(`brands/${shop.brandId}/live/q_${expired.itemId}`);
  });

  it("a run that died half way (stale publishing) is announced as failed", async () => {
    const shop = await makeShop(db);
    const d = await due(shop, "instagram", { mode: "publish" });
    await rows(db, "update public.queue_items set status = 'publishing', updated_at = $2 where id = $1", [d.itemId, "2026-10-15T08:50:00Z"]);
    await runQueueSweep({ now: SWEEP, deps: { publish: fakePublisher([ok()]).publish } });
    expect(statuses(d.itemId)).toEqual(["failed"]);
    expect(writesFor(d.itemId)[0].data).toMatchObject({ status: "failed", mode: "deliver" });
  });

  it("an item that is not due yet writes nothing", async () => {
    const shop = await makeShop(db);
    const later = await due(shop, "whatsapp", { slotAt: "2026-10-16T09:00:00.000Z" });
    await runQueueSweep({ now: SWEEP });
    expect(writesFor(later.itemId)).toEqual([]);
  });
});

describe("Post now rings a bell too", () => {
  it("an item posted now goes publishing then delivered", async () => {
    const shop = await makeShop(db);
    const x = await seedApproved(db, shop, ["whatsapp"]);
    await scheduleApproved({ userId: shop.userId, brandId: shop.brandId, briefId: x.briefId, now: NOW });
    const [{ id }] = await rows<{ id: string }>(db, "select id::text as id from public.queue_items where brand_id = $1", [shop.brandId]);
    await postNowQueueItem({ userId: shop.userId, brandId: shop.brandId, itemId: id, now: NOW });
    expect(statuses(id)).toEqual(["publishing", "delivered"]);
  });

  it("failures and posting an approved post now write for their items", async () => {
    const shop = await makeShop(db);
    await connect(db, shop, "instagram");
    const brief = await seedBrief(db, shop, { channels: ["instagram"] });
    const post = await seedPost(db, shop, brief, "instagram");
    const id = await seedItem(db, shop, post, { slotAt: "2026-10-20T09:00:00Z", mode: "publish" });
    await postNowQueueItem({ userId: shop.userId, brandId: shop.brandId, itemId: id, now: NOW, deps: { publish: fakePublisher([fail("media_rejected", false)]).publish } });
    expect(statuses(id)).toEqual(["publishing", "failed"]);

    const y = await seedApproved(db, shop, ["instagram"]);
    const r = await postNowApproved({ userId: shop.userId, brandId: shop.brandId, briefId: y.briefId, now: NOW, deps: { publish: fakePublisher([ok("77")]).publish } });
    expect(r.ok && r.results[0].outcome).toBe("published");
    const itemId = r.ok ? r.results[0].itemId : "";
    expect(statuses(itemId)).toEqual(["publishing", "published"]);
  });
});

describe("a failing live sink changes no sweep outcome", () => {
  /** One sweep with every kind of outcome; returns what the sweep and the database say, with nothing that differs by shop. */
  async function scenario(shop: Shop) {
    await connect(db, shop, "instagram");
    const published = await due(shop, "instagram", { mode: "publish" });
    const retried = await due(shop, "facebook", { mode: "publish" });
    const failed = await due(shop, "youtube", { mode: "publish", attempts: 2 });
    const delivered = await due(shop, "whatsapp");
    const missed = await due(shop, "whatsapp", { slotAt: "2026-10-12T09:00:00.000Z" });
    const expired = await due(shop, "instagram", { mode: "publish", endsOn: "2026-10-14", slotAt: "2026-10-15T08:30:00.000Z" });
    const skipped = await due(shop, "instagram", { slotAt: "2026-10-15T08:00:00.000Z" });
    await rows(db, "update public.posts set status = 'draft' where id = $1", [skipped.post.id]);
    const stale = await due(shop, "instagram", { mode: "publish", slotAt: "2026-10-15T07:00:00.000Z" });
    await rows(db, "update public.queue_items set status = 'publishing', updated_at = $2 where id = $1", [stale.itemId, "2026-10-15T08:30:00Z"]);
    const answers = new Map<string, PublishResult>([
      [published.itemId, ok("1")],
      [retried.itemId, fail("rate_limited", true)],
      [failed.itemId, fail("network", true)],
    ]);
    const calls: string[] = [];
    const publish: PublishQueueItem = async (a) => {
      calls.push(a.itemId);
      return answers.get(a.itemId) ?? ok("9");
    };
    // Other tests' leftovers in this shared database are swept too; only this shop's items are compared.
    const sum = await runQueueSweep({ now: SWEEP, deps: { publish } });
    const all = [published, retried, failed, delivered, missed, expired, skipped, stale];
    const names = ["published", "retried", "failed", "delivered", "missed", "expired", "skipped", "stale"];
    const final = await Promise.all(
      all.map(async (x) => {
        const r = await itemOf(db, x.post.id);
        return [r.status, r.mode, r.attempts, r.last_error, r.platform_post_id];
      }),
    );
    return {
      outcomes: all.map((x, i) => [names[i], sum.items.find((it) => it.itemId === x.itemId)?.outcome ?? null]),
      final,
      calls: calls.map((id) => names[all.findIndex((x) => x.itemId === id)]).filter(Boolean).sort(),
    };
  }

  it("with a sink that throws or rejects, every outcome and row is the same as with a quiet one", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const quiet = await scenario(await makeShop(db, { name: "Quiet Bakery" }));
    expect(liveWritesForTests().length).toBeGreaterThan(0);
    expect(quiet.outcomes).toEqual([
      ["published", "published"],
      ["retried", "retry"],
      ["failed", "failed"],
      ["delivered", "delivered"],
      ["missed", "missed"],
      ["expired", "expired"],
      ["skipped", "skipped"],
      ["stale", "failed"],
    ]);

    clearLiveWritesForTests();
    resetLiveForTests();
    setLiveSinkForTests(() => {
      throw new Error("firestore is down");
    });
    const loud = await scenario(await makeShop(db, { name: "Loud Bakery" }));
    expect(loud).toEqual(quiet);
    expect(liveWritesForTests().length).toBeGreaterThan(0); // the writes were attempted
    expect(error.mock.calls.filter((c) => c[0] === "[live] write failed")).toHaveLength(1); // and logged once, not per write

    setLiveSinkForTests(() => Promise.reject(new Error("rejected later")));
    clearLiveWritesForTests();
    expect(await scenario(await makeShop(db, { name: "Third Bakery" }))).toEqual(quiet);
  });
});

describe("the owner's actions ring one bell for the whole queue", () => {
  const touches = (brandId: string) => liveWritesForTests().filter((w) => w.path === `brands/${brandId}/live/queue_touch`);

  it("a successful action writes queue_touch with no fields; a refresh does not (two screens must not refresh each other forever)", async () => {
    const shop = await makeShop(db);
    session.user = { id: shop.userId };
    const d = await due(shop, "whatsapp", { slotAt: "2026-10-20T09:00:00.000Z" });

    const refreshed = await refreshQueueAction();
    expect(refreshed.ok).toBe(true);
    expect(touches(shop.brandId)).toHaveLength(0);

    const skipped = await skipItemAction(d.itemId);
    expect(skipped.ok).toBe(true);
    expect(touches(shop.brandId)).toHaveLength(1);
    expect(touches(shop.brandId)[0]).toMatchObject({ kind: "queue_touch", data: {} });
  });

  it("a refused action rings nothing, and a throwing sink does not break the action", async () => {
    const shop = await makeShop(db);
    session.user = { id: shop.userId };
    const x = await due(shop, "whatsapp", { slotAt: "2026-10-20T09:00:00.000Z" });
    const refused = await skipItemAction("00000000-0000-4000-8000-000000000000");
    expect(refused.ok).toBe(false);
    expect(touches(shop.brandId)).toHaveLength(0);

    vi.spyOn(console, "error").mockImplementation(() => undefined);
    setLiveSinkForTests(() => {
      throw new Error("down");
    });
    const r = await skipItemAction(x.itemId);
    expect(r).toMatchObject({ ok: true });
    expect((await itemOf(db, x.post.id)).status).toBe("skipped");
  });
});

describe("the Queue screen", () => {
  const html = async (shop: Shop, brandId: string | null = shop.brandId) => {
    const view = await loadQueueView(shop.userId, shop.brandId, NOW);
    return renderToString(createElement(QueueScreen, { initial: view, brandId }));
  };

  it("shows the Live dot by Coming up only while live", async () => {
    const shop = await makeShop(db);
    const x = await seedApproved(db, shop, ["whatsapp"]);
    await scheduleApproved({ userId: shop.userId, brandId: shop.brandId, briefId: x.briefId, now: NOW });
    liveState.live = false;
    const off = await html(shop);
    expect(off).not.toContain("Updates appear here as they happen");
    expect(off).toContain("Coming up");
    liveState.live = true;
    const on = await html(shop);
    expect(on).toContain("Updates appear here as they happen");
    expect(on).toContain("Coming up");
  });

  it("pulses the badge of an item that is being sent, and only that one", async () => {
    const shop = await makeShop(db);
    const x = await seedApproved(db, shop, ["instagram"]);
    await seedItem(db, shop, x.posts[0], { slotAt: "2026-10-20T09:00:00.000Z", status: "publishing" });
    const y = await seedApproved(db, shop, ["whatsapp"]);
    await seedItem(db, shop, y.posts[0], { slotAt: "2026-10-20T10:00:00.000Z" });
    const out = await html(shop);
    expect(out.match(/animate-pulse/g)).toHaveLength(1);
    expect(out).toMatch(/data-status="publishing"[\s\S]*?animate-pulse[^>]*data-status-badge[^>]*>Sending now/);
  });

  it("patchStatus changes one card's status and label, and nothing else", async () => {
    const shop = await makeShop(db);
    const x = await seedApproved(db, shop, ["instagram", "whatsapp"]);
    await scheduleApproved({ userId: shop.userId, brandId: shop.brandId, briefId: x.briefId, now: NOW });
    const view = await loadQueueView(shop.userId, shop.brandId, NOW);
    const [a, b] = view.upcoming.flatMap((d) => d.items);
    const next = patchStatus(view, a.id, "publishing");
    const cards = next.upcoming.flatMap((d) => d.items);
    expect(cards.find((c) => c.id === a.id)).toMatchObject({ status: "publishing", statusLabel: "Sending now" });
    expect(cards.find((c) => c.id === b.id)).toEqual(b);
    expect(patchStatus(view, a.id, a.status)).toBe(view); // same status: the very same view
    expect(patchStatus(view, "00000000-0000-4000-8000-000000000000", "failed")).toBe(view); // unknown item: unchanged
  });
});
