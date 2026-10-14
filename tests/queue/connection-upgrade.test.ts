import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetTokenKeyForTests } from "@/lib/connections/crypto";
import { replaceToken, saveConnection } from "@/lib/connections/service";
import type { MockDb } from "@/lib/db/mock";
import { loadQueueView, scheduleApproved } from "@/lib/queue";
import { upgradeQueuedToPublish } from "@/lib/queue/connection-hook";
import { vi } from "vitest";
import { stubMetaEnv } from "../connections/helpers";
import { closeDb, openDb } from "../helpers/details";
import { NOW, itemOf, makeShop, rows, seedApproved, seedItem, type Shop } from "./helpers";

let db: MockDb;
beforeAll(async () => {
  db = await openDb();
});
afterAll(async () => {
  await closeDb(db);
});
beforeEach(() => {
  stubMetaEnv();
  resetTokenKeyForTests();
});
afterEach(() => vi.unstubAllEnvs());

const connectIg = (shop: Shop) =>
  saveConnection({ brandId: shop.brandId, userId: shop.userId, provider: "instagram", accountId: "17841400000000001", accountName: "@cornerbakery", scopes: [], expiresAt: null, platformUserId: null, token: "IGAAtoken-123456789" });

describe("connecting a channel upgrades the queued deliveries", () => {
  it("scheduled 'email it to you' items of that provider's channels become auto-publish; nothing else changes", async () => {
    const shop = await makeShop(db);
    const x = await seedApproved(db, shop, ["instagram", "facebook", "whatsapp"]);
    await scheduleApproved({ userId: shop.userId, brandId: shop.brandId, briefId: x.briefId, now: NOW });
    const y = await seedApproved(db, shop, ["instagram"]);
    await seedItem(db, shop, y.posts[0], { slotAt: "2026-10-01T09:00:00Z", status: "delivered" }); // history
    const z = await seedApproved(db, shop, ["instagram"]);
    await seedItem(db, shop, z.posts[0], { slotAt: "2026-10-02T09:00:00Z", status: "missed" });
    const before = await loadQueueView(shop.userId, shop.brandId, NOW);
    expect(before.upcoming.flatMap((d) => d.items).every((i) => i.modeLabel === "We'll email it to you")).toBe(true);

    await connectIg(shop);
    expect(await itemOf(db, x.posts[0].id)).toMatchObject({ channel: "instagram", status: "scheduled", mode: "publish" });
    expect(await itemOf(db, x.posts[1].id)).toMatchObject({ channel: "facebook", mode: "deliver" }); // another provider
    expect(await itemOf(db, x.posts[2].id)).toMatchObject({ channel: "whatsapp", mode: "deliver" }); // no provider
    expect(await itemOf(db, y.posts[0].id)).toMatchObject({ status: "delivered", mode: "deliver" });
    expect(await itemOf(db, z.posts[0].id)).toMatchObject({ status: "missed", mode: "deliver" });

    const after = await loadQueueView(shop.userId, shop.brandId, NOW);
    const ig = after.upcoming.flatMap((d) => d.items).find((i) => i.channel === "instagram")!;
    expect(ig.modeLabel).toBe("Auto-publish");
  });

  it("another business's items are not touched", async () => {
    const a = await makeShop(db);
    const b = await makeShop(db, { name: "Other Shop" });
    const x = await seedApproved(db, b, ["instagram"]);
    await seedItem(db, b, x.posts[0], { slotAt: "2026-10-20T09:00:00Z" });
    await connectIg(a);
    expect((await itemOf(db, x.posts[0].id)).mode).toBe("deliver");
  });

  it("reconnecting, and renewing a token that had expired, upgrade too", async () => {
    const shop = await makeShop(db);
    const first = await connectIg(shop);
    const x = await seedApproved(db, shop, ["instagram"]);
    const id = await seedItem(db, shop, x.posts[0], { slotAt: "2026-10-20T09:00:00Z", mode: "deliver" });
    await rows(db, "update public.channel_connections set status = 'expired' where id = $1", [first.id]);
    await replaceToken({ connectionId: first.id, brandId: shop.brandId, provider: "instagram", token: "IGAAnew-123456789", expiresAt: null });
    expect((await rows<{ mode: string }>(db, "select mode from public.queue_items where id = $1", [id]))[0].mode).toBe("publish");

    await rows(db, "update public.queue_items set mode = 'deliver' where id = $1", [id]);
    await connectIg(shop); // reconnect
    expect((await rows<{ mode: string }>(db, "select mode from public.queue_items where id = $1", [id]))[0].mode).toBe("publish");
  });

  it("the hook can be called on its own and says how many it upgraded", async () => {
    const shop = await makeShop(db);
    const x = await seedApproved(db, shop, ["facebook"]);
    await seedItem(db, shop, x.posts[0], { slotAt: "2026-10-20T09:00:00Z" });
    expect(await upgradeQueuedToPublish(shop.brandId, "instagram")).toBe(0);
    expect(await upgradeQueuedToPublish(shop.brandId, "facebook")).toBe(1);
    expect(await upgradeQueuedToPublish(shop.brandId, "facebook")).toBe(0);
  });
});
