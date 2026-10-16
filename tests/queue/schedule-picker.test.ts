import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fromInstant, isDayDisabled, isTimeDisabled, makeLimits, timesFor, toInstant } from "@/components/ui/date-time-utils";
import type { MockDb } from "@/lib/db/mock";
import { listFreeSlotsForPost, scheduleApproved } from "@/lib/queue";
import { closeDb, openDb } from "../helpers/details";
import { NOW, itemOf, makeShop, seedApproved } from "./helpers";

let db: MockDb;
beforeAll(async () => {
  db = await openDb();
});
afterAll(async () => {
  await closeDb(db);
});

describe("the schedule step's date-time picker saves the same value as the list did", () => {
  it("a day and time picked in the brand's zone become exactly one of the offered instants, and the queue stores it", async () => {
    const shop = await makeShop(db, { timezone: "Asia/Kolkata" });
    const { briefId, posts } = await seedApproved(db, shop, ["instagram"]);
    const offered = await listFreeSlotsForPost({ userId: shop.userId, brandId: shop.brandId, postId: posts[0].id, now: NOW });
    expect(offered.length).toBeGreaterThan(3);

    // What the picker shows: only offered days are enabled and each lists its own times (all in the brand's zone).
    const limits = makeLimits({ now: NOW, timezone: shop.timezone, endsOn: "2026-10-31", allowed: offered });
    const target = offered[2];
    const { date, time } = fromInstant(target, shop.timezone)!;
    expect(isDayDisabled(date, limits)).toBe(false);
    expect(timesFor(date, limits)).toContain(time);
    expect(isTimeDisabled(date, time, limits)).toBe(false);
    expect(isDayDisabled("2026-10-13", limits)).toBe(true); // past
    expect(isDayDisabled("2026-11-02", limits)).toBe(true); // after the offer ends

    // What it hands to the page, and so to confirmScheduleAction / scheduleApproved: the same ISO string the list used.
    const picked = toInstant(date, time, shop.timezone);
    expect(picked).toBe(target);
    const ok = await scheduleApproved({ userId: shop.userId, brandId: shop.brandId, now: NOW, briefId, overrides: { [posts[0].id]: picked } });
    expect(ok.ok).toBe(true);
    expect(new Date((await itemOf(db, posts[0].id)).slot_at).toISOString()).toBe(target);
  });

  it("every offered instant survives the round trip through the brand's zone, whichever zone that is", async () => {
    for (const timezone of ["Europe/London", "America/New_York", "Australia/Sydney", "Asia/Kolkata"]) {
      const shop = await makeShop(db, { timezone });
      const { posts } = await seedApproved(db, shop, ["instagram"]);
      const offered = await listFreeSlotsForPost({ userId: shop.userId, brandId: shop.brandId, postId: posts[0].id, now: NOW, n: 20 });
      for (const iso of offered) {
        const p = fromInstant(iso, timezone)!;
        expect(toInstant(p.date, p.time, timezone), `${timezone} ${iso}`).toBe(iso);
      }
    }
  });
});

describe("any time can be picked, as long as the server's rules hold", () => {
  const pick = (shop: { userId: string; brandId: string }, briefId: string, postId: string, at: string) =>
    scheduleApproved({ userId: shop.userId, brandId: shop.brandId, now: NOW, briefId, overrides: { [postId]: at } });

  it("a time that is not one of the suggestions is saved as picked", async () => {
    const shop = await makeShop(db);
    const { briefId, posts } = await seedApproved(db, shop, ["instagram"]);
    const offered = await listFreeSlotsForPost({ userId: shop.userId, brandId: shop.brandId, postId: posts[0].id, now: NOW });
    const at = "2026-10-16T14:15:00.000Z"; // a Friday afternoon: not a chosen day, not the channel's time
    expect(offered).not.toContain(at);
    expect((await pick(shop, briefId, posts[0].id, at)).ok).toBe(true);
    expect(new Date((await itemOf(db, posts[0].id)).slot_at).toISOString()).toBe(at);
  });

  it("less than 10 minutes ahead is refused; just over 10 is fine; rubbish is refused", async () => {
    const shop = await makeShop(db);
    const { briefId, posts } = await seedApproved(db, shop, ["instagram"]);
    expect(await pick(shop, briefId, posts[0].id, "2026-10-14T12:05:00.000Z")).toMatchObject({ ok: false, code: "too_soon" });
    expect(await pick(shop, briefId, posts[0].id, "2026-10-13T09:00:00.000Z")).toMatchObject({ ok: false, code: "too_soon" });
    expect(await pick(shop, briefId, posts[0].id, "not a time")).toMatchObject({ ok: false, code: "invalid_slot" });
    expect(await itemOf(db, posts[0].id)).toBeNull();
    expect((await pick(shop, briefId, posts[0].id, "2026-10-14T12:11:00.000Z")).ok).toBe(true);
  });

  it("after the end date (in the brand's zone) is refused; the last evening of that day is fine", async () => {
    const shop = await makeShop(db); // London, BST
    const { briefId, posts } = await seedApproved(db, shop, ["instagram"], { endsOn: "2026-10-20" });
    expect(await pick(shop, briefId, posts[0].id, "2026-10-20T23:30:00.000Z")).toMatchObject({ ok: false, code: "after_end" }); // 00:30 on the 21st
    expect(await pick(shop, briefId, posts[0].id, "2026-10-21T09:00:00.000Z")).toMatchObject({ ok: false, code: "after_end" });
    expect((await pick(shop, briefId, posts[0].id, "2026-10-20T22:30:00.000Z")).ok).toBe(true); // 23:30 on the 20th
  });

  it("an open-ended offer has no last day", async () => {
    const shop = await makeShop(db);
    const { briefId, posts } = await seedApproved(db, shop, ["instagram"], { endsOn: null });
    expect((await pick(shop, briefId, posts[0].id, "2026-12-01T09:00:00.000Z")).ok).toBe(true);
  });

  it("within 30 minutes of another scheduled post of the same channel is refused, naming that time; the other channel and 30 minutes apart are fine", async () => {
    const shop = await makeShop(db);
    const first = await seedApproved(db, shop, ["instagram", "whatsapp"]);
    expect((await pick(shop, first.briefId, first.posts[0].id, "2026-10-16T09:00:00.000Z")).ok).toBe(true);

    const second = await seedApproved(db, shop, ["instagram", "whatsapp"]);
    const clash = await pick(shop, second.briefId, second.posts[0].id, "2026-10-16T09:20:00.000Z");
    expect(clash).toMatchObject({ ok: false, code: "clash" });
    expect(clash.ok === false && clash.message).toBe("Another Instagram post is already planned for Fri 16 Oct, 10:00. Please pick a time at least 30 minutes away from it.");
    expect(await itemOf(db, second.posts[0].id)).toBeNull();
    expect(await pick(shop, second.briefId, second.posts[0].id, "2026-10-16T08:40:00.000Z")).toMatchObject({ ok: false, code: "clash" });

    // The same minute on another channel is fine, and so is exactly 30 minutes apart on the same channel.
    expect((await pick(shop, second.briefId, second.posts[1].id, "2026-10-16T09:00:00.000Z")).ok).toBe(true);
    expect((await pick(shop, second.briefId, second.posts[0].id, "2026-10-16T09:30:00.000Z")).ok).toBe(true);
  });

  it("two posts of the same channel picked in one go can not share a time either", async () => {
    const shop = await makeShop(db);
    const a = await seedApproved(db, shop, ["instagram"]);
    const b = await seedApproved(db, shop, ["instagram"]);
    const r = await scheduleApproved({
      userId: shop.userId,
      brandId: shop.brandId,
      now: NOW,
      postIds: [a.posts[0].id, b.posts[0].id],
      overrides: { [a.posts[0].id]: "2026-10-16T09:00:00.000Z", [b.posts[0].id]: "2026-10-16T09:10:00.000Z" },
    });
    expect(r).toMatchObject({ ok: false, code: "clash" });
  });

  it("a suggested slot still works", async () => {
    const shop = await makeShop(db);
    const { briefId, posts } = await seedApproved(db, shop, ["instagram"]);
    const offered = await listFreeSlotsForPost({ userId: shop.userId, brandId: shop.brandId, postId: posts[0].id, now: NOW });
    expect((await pick(shop, briefId, posts[0].id, offered[1])).ok).toBe(true);
    expect(new Date((await itemOf(db, posts[0].id)).slot_at).toISOString()).toBe(offered[1]);
  });
});
