import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { MockDb } from "@/lib/db/mock";
import { postNowApproved, postNowQueueItem, runQueueSweep, saveQueueSettings, scheduleApproved } from "@/lib/queue";
import { setPublisherForTests } from "@/lib/queue/publisher";
import type { PublishQueueItem, PublishResult } from "@/lib/queue/types";
import { cookieOf, nonceOf, openLink, pressLink } from "../links/helpers";
import { closeDb, openDb } from "../helpers/details";
import { NOW, connect, itemOf, itemsOf, mailOf, makeShop, postStatus, rows, seedApproved, seedBrief, seedItem, seedPost, type Shop } from "./helpers";

let db: MockDb;

beforeAll(async () => {
  db = await openDb();
});
afterAll(async () => {
  setPublisherForTests(null);
  await closeDb(db);
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
async function due(shop: Shop, channel: "instagram" | "whatsapp" | "facebook" = "whatsapp", o: { mode?: "publish" | "deliver"; slotAt?: string; endsOn?: string | null; carousel?: number; attempts?: number } = {}) {
  const x = await seedApproved(db, shop, [channel], { endsOn: o.endsOn, carousel: o.carousel });
  const itemId = await seedItem(db, shop, x.posts[0], { slotAt: o.slotAt ?? SLOT, mode: o.mode ?? "deliver", attempts: o.attempts });
  return { ...x, post: x.posts[0], itemId };
}

describe("delivery to the owner (mode deliver)", () => {
  it("emails the picture, the caption and a no-login link at the slot, and marks the item delivered", async () => {
    const shop = await makeShop(db);
    const d = await due(shop, "whatsapp");
    const before = await runQueueSweep({ now: new Date("2026-10-15T08:45:00Z") }); // not due yet
    expect(before.items.filter((i) => i.itemId === d.itemId)).toEqual([]);
    expect(await mailOf(shop, "post_delivery")).toHaveLength(0);

    const sum = await runQueueSweep({ now: SWEEP });
    expect(sum.items.find((i) => i.itemId === d.itemId)).toMatchObject({ outcome: "delivered", channel: "whatsapp" });
    expect(await itemOf(db, d.post.id)).toMatchObject({ status: "delivered" });
    expect((await rows<{ done_at: Date }>(db, "select done_at from public.queue_items where id = $1", [d.itemId]))[0].done_at).toBeTruthy();
    expect(await postStatus(db, d.post.id)).toBe("approved"); // posted only when the owner says so

    const mail = await mailOf(shop, "post_delivery");
    expect(mail).toHaveLength(1);
    const m = mail[0];
    expect(m.to).toMatch(/@example\.com$/);
    expect(m.subject).toBe("Time to post on WhatsApp");
    expect(m.text).toContain("Fresh bread every morning at Corner Bakery."); // the caption, in full
    expect(m.text).toContain("Thu 15 Oct, 10:00"); // when it was planned, in the brand's zone
    expect(m.html).toContain("Copy and share");
    expect(m.html).toMatch(/<img src="http:\/\/localhost:3000\/i\/[A-Za-z0-9_.-]+"/); // the picture
    expect(m.html).toContain("Your caption");
    expect(m.headers["List-Unsubscribe"]).toBeTruthy();
    const ready = /http:\/\/localhost:3000\/e\/([A-Za-z0-9_.-]+)/.exec(m.text)![1];

    // The link opens a page with the picture, Copy, Share and Mark as posted.
    const page = await openLink(ready);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain("Fresh bread every morning at Corner Bakery.");
    expect(html).toContain("data-share-root");
    expect(html).toContain("Copy caption");
    expect(html).toContain("Download story size"); // WhatsApp status is a vertical picture
    expect(html).toContain("Mark as posted");
    // GET changed nothing.
    expect(await postStatus(db, d.post.id)).toBe("approved");

    const cookie = cookieOf(page);
    const posted = await pressLink(ready, { nonce: nonceOf(html), op: "posted" }, cookie);
    expect(await posted.text()).toContain("Marked as posted.");
    expect(await postStatus(db, d.post.id)).toBe("posted");
    expect((await rows<{ n: number }>(db, "select count(*)::int as n from public.post_actions where post_id = $1 and action = 'posted'", [d.post.id]))[0].n).toBe(1);
  });

  it("a carousel is emailed once, with its slides", async () => {
    const shop = await makeShop(db);
    const d = await due(shop, "whatsapp", { carousel: 3 });
    await runQueueSweep({ now: SWEEP });
    const mail = await mailOf(shop, "post_delivery");
    expect(mail).toHaveLength(1);
    expect(mail[0].html).toContain("A carousel of 3 slides");
    expect((mail[0].html.match(/alt="Slide \d"/g) ?? []).length).toBe(3);
    expect((await itemsOf(db, shop.brandId)).map((i) => i.post_id)).toEqual([d.post.id]);
  });

  it("never sends twice: a second run, and two runs at once, send exactly one email", async () => {
    const shop = await makeShop(db);
    await due(shop, "whatsapp");
    await Promise.all([runQueueSweep({ now: SWEEP }), runQueueSweep({ now: SWEEP })]);
    await runQueueSweep({ now: new Date("2026-10-15T09:45:00Z") });
    expect(await mailOf(shop, "post_delivery")).toHaveLength(1);
  });

  it("with emails off (or unsubscribed) the item is simply ready in the app: delivered, nothing sent", async () => {
    const off = await makeShop(db);
    await saveQueueSettings(off.userId, off.brandId, { deliverEmail: false });
    const a = await due(off);
    const unsub = await makeShop(db);
    const b = await due(unsub);
    await rows(db, "update public.brand_memory set email_unsubscribed_at = now() where brand_id = $1", [unsub.brandId]);
    await runQueueSweep({ now: SWEEP });
    expect((await itemOf(db, a.post.id)).status).toBe("delivered");
    expect((await itemOf(db, b.post.id)).status).toBe("delivered");
    expect(await mailOf(off, "post_delivery")).toHaveLength(0);
    expect(await mailOf(unsub, "post_delivery")).toHaveLength(0);
  });

  it("an email that cannot be sent is tried again on the next run, then gives up as failed", async () => {
    const shop = await makeShop(db);
    const d = await due(shop);
    const sendEmail = vi.fn(async () => {
      throw new Error("resend down");
    });
    await runQueueSweep({ now: SWEEP, deps: { sendEmail } });
    expect(await itemOf(db, d.post.id)).toMatchObject({ status: "scheduled", attempts: 1, last_error: "resend down" });
    await runQueueSweep({ now: new Date("2026-10-15T10:15:00Z"), deps: { sendEmail } });
    expect(await itemOf(db, d.post.id)).toMatchObject({ status: "scheduled", attempts: 2 });
    await runQueueSweep({ now: new Date("2026-10-15T11:15:00Z"), deps: { sendEmail } });
    expect(await itemOf(db, d.post.id)).toMatchObject({ status: "failed", attempts: 3 });
    // Back up: nothing more is sent for a failed item.
    await runQueueSweep({ now: new Date("2026-10-15T12:15:00Z") });
    expect(await mailOf(shop, "post_delivery")).toHaveLength(0);
  });
});

describe("auto-publishing (mode publish)", () => {
  it("publishes through the publisher: published with the platform id and link, the post is posted, no email", async () => {
    const shop = await makeShop(db);
    await connect(db, shop, "instagram");
    const d = await due(shop, "instagram", { mode: "publish", carousel: 2 });
    const pub = fakePublisher([ok("178999")]);
    const sum = await runQueueSweep({ now: SWEEP, deps: { publish: pub.publish } });
    expect(sum.items.find((i) => i.itemId === d.itemId)).toMatchObject({ outcome: "published" });
    expect(pub.calls).toEqual([{ itemId: d.itemId, brandId: shop.brandId }]);
    expect(await itemOf(db, d.post.id)).toMatchObject({ status: "published", platform_post_id: "178999", permalink: "https://www.instagram.com/p/178999/", attempts: 0 });
    expect(await postStatus(db, d.post.id)).toBe("posted");
    // The carousel's slides are posted with it.
    expect((await rows<{ s: string }>(db, "select distinct status::text as s from public.posts where brief_id = $1", [d.briefId])).map((r) => r.s)).toEqual(["posted"]);
    expect(await mailOf(shop)).toHaveLength(0);
    await runQueueSweep({ now: new Date("2026-10-15T10:15:00Z"), deps: { publish: pub.publish } });
    expect(pub.calls).toHaveLength(1); // never twice
  });

  it("a retryable failure goes back to scheduled with one more attempt, and is retried on the next run", async () => {
    const shop = await makeShop(db);
    const d = await due(shop, "instagram", { mode: "publish" });
    const pub = fakePublisher([fail("rate_limited", true), ok("55")]);
    await runQueueSweep({ now: SWEEP, deps: { publish: pub.publish } });
    expect(await itemOf(db, d.post.id)).toMatchObject({ status: "scheduled", attempts: 1, last_error: "fake rate_limited" });
    expect(await mailOf(shop)).toHaveLength(0); // the owner hears nothing yet
    await runQueueSweep({ now: new Date("2026-10-15T10:15:00Z"), deps: { publish: pub.publish } }); // 75 minutes after the slot: a retry is still allowed
    expect(await itemOf(db, d.post.id)).toMatchObject({ status: "published", platform_post_id: "55" });
    expect(pub.calls).toHaveLength(2);
  });

  it("a publisher that throws counts as a retryable failure", async () => {
    const shop = await makeShop(db);
    const d = await due(shop, "instagram", { mode: "publish" });
    const publish: PublishQueueItem = async () => {
      throw new Error("socket hang up");
    };
    await runQueueSweep({ now: SWEEP, deps: { publish } });
    expect(await itemOf(db, d.post.id)).toMatchObject({ status: "scheduled", attempts: 1, last_error: "socket hang up" });
  });

  it("after the maximum attempts: failed, switched to delivery, the owner gets 'share it yourself'", async () => {
    const shop = await makeShop(db);
    const d = await due(shop, "instagram", { mode: "publish", attempts: 2 });
    const pub = fakePublisher([fail("network", true)]);
    const report = vi.fn(async () => true);
    await runQueueSweep({ now: SWEEP, deps: { publish: pub.publish, reportConnectionProblem: report } });
    expect(await itemOf(db, d.post.id)).toMatchObject({ status: "failed", mode: "deliver", attempts: 3, last_error: "fake network" });
    expect(await postStatus(db, d.post.id)).toBe("approved"); // still the owner's to share
    const mail = await mailOf(shop, "post_delivery");
    expect(mail).toHaveLength(1);
    expect(mail[0].subject).toBe("Please post this on Instagram yourself");
    expect(mail[0].text).toContain("We couldn't publish this to Instagram ourselves (the platform could not be reached). Here it is to share yourself.");
    expect(mail[0].text).toContain("Fresh bread every morning at Corner Bakery.");
    expect(report).not.toHaveBeenCalled(); // a network problem is not a connection problem
  });

  it("a final failure (expired token): failed at once, owner emailed, and the connection problem is emailed ONCE however many items fail", async () => {
    const shop = await makeShop(db);
    await connect(db, shop, "instagram");
    const a = await due(shop, "instagram", { mode: "publish" });
    const b = await due(shop, "facebook", { mode: "publish" });
    await connect(db, shop, "facebook");
    const c = await due(shop, "instagram", { mode: "publish", slotAt: "2026-10-15T08:45:00.000Z" });
    const pub = fakePublisher([fail("token_expired", false)]);
    await runQueueSweep({ now: SWEEP, deps: { publish: pub.publish } });

    // Two Instagram items due: only the newest is sent, the other is missed. Facebook is its own channel.
    expect(await itemOf(db, a.post.id)).toMatchObject({ status: "failed", mode: "deliver", attempts: 1, last_error: "fake token_expired" });
    expect(await itemOf(db, c.post.id)).toMatchObject({ status: "missed" });
    expect(await itemOf(db, b.post.id)).toMatchObject({ status: "failed" });
    expect(await mailOf(shop, "post_delivery")).toHaveLength(2); // one fallback per failed item
    const problems = await mailOf(shop, "connection_problem");
    expect(problems).toHaveLength(2); // one per connection (Instagram and Facebook), not one per item
    expect(new Set(problems.map((p) => p.subject)).size).toBe(2);
    expect((await rows<{ provider: string; status: string }>(db, "select provider, status from public.channel_connections where brand_id = $1 order by provider", [shop.brandId])).map((r) => [r.provider, r.status])).toEqual([
      ["facebook", "expired"],
      ["instagram", "expired"],
    ]);

    // The same problem on a later item does not email again.
    const e = await due(shop, "instagram", { mode: "publish", slotAt: "2026-10-16T09:00:00.000Z" });
    await runQueueSweep({ now: new Date("2026-10-16T09:15:00Z"), deps: { publish: pub.publish } });
    expect(await itemOf(db, e.post.id)).toMatchObject({ status: "failed" });
    expect(await mailOf(shop, "connection_problem")).toHaveLength(2);
    expect(await mailOf(shop, "post_delivery")).toHaveLength(3);
  });

  it("the real default publisher on a brand with no connection says 'not connected': the item falls back to delivery", async () => {
    const shop = await makeShop(db);
    const d = await due(shop, "instagram", { mode: "publish" });
    await runQueueSweep({ now: SWEEP }); // no fake: the publisher from @/lib/publish
    expect(await itemOf(db, d.post.id)).toMatchObject({ status: "failed", mode: "deliver", attempts: 1, last_error: "No connected account for this channel." });
    expect(await postStatus(db, d.post.id)).toBe("approved");
    const mail = await mailOf(shop, "post_delivery");
    expect(mail).toHaveLength(1);
    expect(mail[0].subject).toBe("Please post this on Instagram yourself");
    expect(mail[0].text).toContain("(your account is not connected)");
    expect(mail[0].text).toContain("Fresh bread every morning at Corner Bakery.");
    expect(await mailOf(shop, "connection_problem")).toHaveLength(0); // there is no connection to report
  });

  it("the mode is decided again at send time: a queued delivery is published once a working connection exists", async () => {
    const shop = await makeShop(db);
    const d = await due(shop, "instagram", { mode: "deliver" });
    await connect(db, shop, "instagram");
    const pub = fakePublisher([ok("9001")]);
    const sum = await runQueueSweep({ now: SWEEP, deps: { publish: pub.publish } });
    expect(sum.items.find((i) => i.itemId === d.itemId)).toMatchObject({ outcome: "published" });
    expect(pub.calls).toHaveLength(1);
    expect(await itemOf(db, d.post.id)).toMatchObject({ status: "published", mode: "publish", platform_post_id: "9001" });
    expect(await mailOf(shop)).toHaveLength(0);
  });

  it("without a working connection (expired) or a provider (WhatsApp) a delivery stays a delivery", async () => {
    const shop = await makeShop(db);
    await connect(db, shop, "instagram", { status: "expired" });
    await connect(db, shop, "facebook");
    const ig = await due(shop, "instagram", { mode: "deliver" });
    const wa = await due(shop, "whatsapp", { mode: "deliver" });
    const pub = fakePublisher([ok()]);
    await runQueueSweep({ now: SWEEP, deps: { publish: pub.publish } });
    expect(pub.calls).toHaveLength(0);
    expect(await itemOf(db, ig.post.id)).toMatchObject({ status: "delivered", mode: "deliver" });
    expect(await itemOf(db, wa.post.id)).toMatchObject({ status: "delivered", mode: "deliver" });
    expect(await mailOf(shop, "post_delivery")).toHaveLength(2);
  });

});

describe("one at a time, missed and expired", () => {
  it("expired: an item whose offer has ended is never sent", async () => {
    const shop = await makeShop(db);
    const d = await due(shop, "instagram", { mode: "publish", endsOn: "2026-10-14" }); // ended yesterday (15 Oct local date is after it)
    const pub = fakePublisher([ok()]);
    const sum = await runQueueSweep({ now: SWEEP, deps: { publish: pub.publish } });
    expect(sum.items.find((i) => i.itemId === d.itemId)).toMatchObject({ outcome: "expired" });
    expect(await itemOf(db, d.post.id)).toMatchObject({ status: "expired" });
    expect(pub.calls).toHaveLength(0);
    expect(await mailOf(shop)).toHaveLength(0);
    // The last day itself is still fine.
    const lastDay = await due(shop, "whatsapp", { endsOn: "2026-10-15" });
    await runQueueSweep({ now: SWEEP });
    expect((await itemOf(db, lastDay.post.id)).status).toBe("delivered");
  });

  it("the end date is the brand's local date, not UTC", async () => {
    const shop = await makeShop(db, { timezone: "Pacific/Auckland", name: "Kiwi Cafe" });
    // 16 Oct 2026, 09:00 NZDT is 15 Oct 20:00 UTC. The offer ended on the 15th (local): expired although the UTC date is still the 15th.
    const d = await due(shop, "whatsapp", { slotAt: "2026-10-15T20:00:00.000Z", endsOn: "2026-10-15" });
    await runQueueSweep({ now: new Date("2026-10-15T20:15:00Z") });
    expect((await itemOf(db, d.post.id)).status).toBe("expired");
    const e = await due(shop, "whatsapp", { slotAt: "2026-10-15T20:00:00.000Z", endsOn: "2026-10-16" });
    await runQueueSweep({ now: new Date("2026-10-15T20:15:00Z") });
    expect((await itemOf(db, e.post.id)).status).toBe("delivered");
  });

  it("after downtime only the newest due item per channel is sent; the older ones are missed", async () => {
    const shop = await makeShop(db);
    const mon = await due(shop, "whatsapp", { slotAt: "2026-10-12T09:00:00.000Z" });
    const tue = await due(shop, "whatsapp", { slotAt: "2026-10-13T09:00:00.000Z" });
    const thu = await due(shop, "whatsapp", { slotAt: SLOT });
    const igOld = await due(shop, "instagram", { slotAt: "2026-10-13T09:00:00.000Z" });
    const igNew = await due(shop, "instagram", { slotAt: SLOT });
    const sum = await runQueueSweep({ now: SWEEP });
    const status = async (x: { post: { id: string } }) => (await itemOf(db, x.post.id)).status;
    expect([await status(mon), await status(tue), await status(thu)]).toEqual(["missed", "missed", "delivered"]);
    expect([await status(igOld), await status(igNew)]).toEqual(["missed", "delivered"]);
    expect(sum.missed).toBeGreaterThanOrEqual(3);
    expect(await mailOf(shop, "post_delivery")).toHaveLength(2); // one per channel, never two for the same channel
    // The older ones can still be handled by the owner (Needs attention) and are not sent by later runs.
    await runQueueSweep({ now: new Date("2026-10-15T10:15:00Z") });
    expect(await mailOf(shop, "post_delivery")).toHaveLength(2);
  });

  it("two items of one channel inside the window: the newest goes, the older is missed", async () => {
    const shop = await makeShop(db);
    const first = await due(shop, "whatsapp", { slotAt: "2026-10-15T09:00:00.000Z" });
    const second = await due(shop, "whatsapp", { slotAt: "2026-10-15T09:30:00.000Z" });
    await runQueueSweep({ now: new Date("2026-10-15T09:45:00Z") });
    expect((await itemOf(db, first.post.id)).status).toBe("missed");
    expect((await itemOf(db, second.post.id)).status).toBe("delivered");
  });

  it("a never-handled item older than the window becomes missed even when it is the only one", async () => {
    const shop = await makeShop(db);
    const d = await due(shop, "whatsapp", { slotAt: "2026-10-15T09:00:00.000Z" });
    await runQueueSweep({ now: new Date("2026-10-15T10:45:00Z") }); // 105 minutes late
    expect((await itemOf(db, d.post.id)).status).toBe("missed");
    expect(await mailOf(shop, "post_delivery")).toHaveLength(0);
    // Just inside the window it still goes.
    const e = await due(shop, "whatsapp", { slotAt: "2026-10-15T09:00:00.000Z" });
    await runQueueSweep({ now: new Date("2026-10-15T10:29:00Z") }); // 89 minutes
    expect((await itemOf(db, e.post.id)).status).toBe("delivered");
  });

  it("an item whose post is no longer approved is skipped, not sent", async () => {
    const shop = await makeShop(db);
    const d = await due(shop, "whatsapp");
    await rows(db, "update public.posts set status = 'draft' where id = $1", [d.post.id]);
    await runQueueSweep({ now: SWEEP });
    expect(await itemOf(db, d.post.id)).toMatchObject({ status: "skipped", last_error: "no longer approved" });
    expect(await mailOf(shop)).toHaveLength(0);
  });

  it("a run that died half way (stuck in publishing) is not sent again: the owner gets the post to check and share", async () => {
    const shop = await makeShop(db);
    const d = await due(shop, "instagram", { mode: "publish" });
    await rows(db, "update public.queue_items set status = 'publishing', updated_at = $2 where id = $1", [d.itemId, "2026-10-15T08:50:00Z"]);
    const pub = fakePublisher([ok()]);
    await runQueueSweep({ now: SWEEP, deps: { publish: pub.publish } });
    expect(pub.calls).toHaveLength(0);
    expect(await itemOf(db, d.post.id)).toMatchObject({ status: "failed", last_error: "interrupted", mode: "deliver" });
    expect((await mailOf(shop, "post_delivery"))[0].text).toContain("please check your account first");
  });
});

describe("pause and holiday", () => {
  it("a paused queue sends nothing and is skipped entirely; switching it on again resumes (old items become missed)", async () => {
    const shop = await makeShop(db);
    await saveQueueSettings(shop.userId, shop.brandId, { paused: true });
    const d = await due(shop, "whatsapp");
    const pub = fakePublisher([ok()]);
    const sum = await runQueueSweep({ now: SWEEP, deps: { publish: pub.publish } });
    expect(sum.pausedBrands).toBeGreaterThanOrEqual(1);
    expect(sum.items.filter((i) => i.brandId === shop.brandId)).toEqual([]);
    expect(await itemOf(db, d.post.id)).toMatchObject({ status: "scheduled", attempts: 0 });
    expect(await mailOf(shop)).toHaveLength(0);
    await saveQueueSettings(shop.userId, shop.brandId, { paused: false });
    await runQueueSweep({ now: new Date("2026-10-15T12:15:00Z") }); // 3 hours late: the owner is asked, not surprised
    expect((await itemOf(db, d.post.id)).status).toBe("missed");
  });

  it("'pause for 2 weeks' from the email link also pauses the queue", async () => {
    const shop = await makeShop(db);
    await rows(db, "update public.brand_memory set email_paused_until = '2026-10-29' where brand_id = $1", [shop.brandId]);
    const d = await due(shop, "whatsapp");
    await runQueueSweep({ now: SWEEP });
    expect((await itemOf(db, d.post.id)).status).toBe("scheduled");
    await rows(db, "update public.brand_memory set email_paused_until = '2026-10-15' where brand_id = $1", [shop.brandId]); // the pause ended today
    await runQueueSweep({ now: SWEEP });
    expect((await itemOf(db, d.post.id)).status).toBe("delivered");
  });

  it("one brand's pause or trouble does not stop another brand", async () => {
    const paused = await makeShop(db);
    await saveQueueSettings(paused.userId, paused.brandId, { paused: true });
    const p = await due(paused, "whatsapp");
    const live = await makeShop(db);
    const l = await due(live, "whatsapp");
    await runQueueSweep({ now: SWEEP });
    expect((await itemOf(db, p.post.id)).status).toBe("scheduled");
    expect((await itemOf(db, l.post.id)).status).toBe("delivered");
  });
});

describe("post now", () => {
  it("sends an item straight away through the same path, even though its slot is days ahead", async () => {
    const shop = await makeShop(db);
    const x = await seedApproved(db, shop, ["whatsapp"]);
    await scheduleApproved({ userId: shop.userId, brandId: shop.brandId, briefId: x.briefId, now: NOW });
    const item = (await itemsOf(db, shop.brandId))[0];
    const r = await postNowQueueItem({ userId: shop.userId, brandId: shop.brandId, itemId: item.id, now: NOW });
    expect(r).toMatchObject({ ok: true, outcome: "delivered", item: { status: "delivered" } });
    expect(await mailOf(shop, "post_delivery")).toHaveLength(1);
    // Pressing it again does nothing more.
    expect(await postNowQueueItem({ userId: shop.userId, brandId: shop.brandId, itemId: item.id, now: NOW })).toMatchObject({ ok: false, code: "already_sent" });
    expect(await mailOf(shop, "post_delivery")).toHaveLength(1);
  });

  it("an approved post that was never scheduled can be posted now; a connected channel is published", async () => {
    const shop = await makeShop(db);
    await connect(db, shop, "instagram");
    const x = await seedApproved(db, shop, ["instagram", "whatsapp"]);
    const pub = fakePublisher([ok("77")]);
    const r = await postNowApproved({ userId: shop.userId, brandId: shop.brandId, briefId: x.briefId, now: NOW, deps: { publish: pub.publish } });
    expect(r.ok && r.results.map((i) => [i.channel, i.outcome])).toEqual([
      ["instagram", "published"],
      ["whatsapp", "delivered"],
    ]);
    expect(pub.calls).toHaveLength(1);
    expect(await postStatus(db, x.posts[0].id)).toBe("posted");
    expect(await mailOf(shop, "post_delivery")).toHaveLength(1);
  });

  it("refuses when the offer has ended", async () => {
    const shop = await makeShop(db);
    const x = await seedApproved(db, shop, ["whatsapp"], { endsOn: "2026-10-13" });
    const r = await postNowApproved({ userId: shop.userId, brandId: shop.brandId, briefId: x.briefId, now: NOW });
    expect(r.ok && r.outcome.noSlot).toMatchObject([{ reason: "ended" }]);
    expect(await mailOf(shop)).toHaveLength(0);
  });

  it("a failed publish from Post now falls back to delivery too", async () => {
    const shop = await makeShop(db);
    await connect(db, shop, "instagram");
    const brief = await seedBrief(db, shop, { channels: ["instagram"] });
    const post = await seedPost(db, shop, brief, "instagram");
    const id = await seedItem(db, shop, post, { slotAt: "2026-10-20T09:00:00Z", mode: "publish" });
    const pub = fakePublisher([fail("media_rejected", false)]);
    const r = await postNowQueueItem({ userId: shop.userId, brandId: shop.brandId, itemId: id, now: NOW, deps: { publish: pub.publish } });
    expect(r).toMatchObject({ ok: true, outcome: "failed", item: { status: "failed", mode: "deliver" } });
    expect((await mailOf(shop, "post_delivery"))[0].text).toContain("the platform did not accept the picture");
  });
});
