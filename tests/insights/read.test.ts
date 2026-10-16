import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { MockDb } from "@/lib/db/mock";
import { insightsPermission, metricsForBrand } from "@/lib/insights/read";
import { addMember, makeStranger } from "../connections/helpers";
import { NOW, closeDb, connectWith, hoursAgo, makeShop, openDb, rows, seedPublished, stubMetaEnv, type Shop } from "./helpers";

let db: MockDb;
beforeAll(async () => {
  db = await openDb();
  stubMetaEnv();
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await closeDb(db);
});

const addMetric = (shop: Shop, itemId: string, ageHours: number, v: Partial<Record<"reach" | "likes" | "views", number | null>>, fetchedHoursAgo = 1) =>
  rows(db, "insert into public.post_metrics (brand_id, queue_item_id, age_hours, fetched_at, reach, likes, views) values ($1, $2, $3, $4, $5, $6, $7)", [
    shop.brandId, itemId, ageHours, hoursAgo(fetchedHoursAgo).toISOString(), v.reach ?? null, v.likes ?? null, v.views ?? null,
  ]);

describe("metricsForBrand", () => {
  it("returns the latest bucket per post, joined with type, theme, channel, hour in the brand's time zone and idea origin", async () => {
    const shop = await makeShop(db, { name: "Read Shop", timezone: "Asia/Kolkata" });
    // Posted 2026-10-13 06:00 UTC = 11:30 in Kolkata (Tuesday).
    const doneAgo = (NOW.getTime() - new Date("2026-10-13T06:00:00Z").getTime()) / 3_600_000;
    const a = await seedPublished(db, shop, "instagram", { ageHours: doneAgo });
    const b = await seedPublished(db, shop, "instagram", { ageHours: 50 });
    await addMetric(shop, a.itemId, 24, { reach: 100, likes: 5 });
    await addMetric(shop, a.itemId, 72, { reach: 250, likes: 9, views: 400 });
    await addMetric(shop, a.itemId, 168, { reach: null, likes: null }); // an empty row never hides the real numbers
    await addMetric(shop, b.itemId, 24, { reach: 40 });

    // Post a came from a trend idea.
    const [run] = await rows<{ id: string }>(db, "insert into public.research_runs (brand_id, trigger, window_start, window_end) values ($1, 'manual', '2026-09-15', '2026-10-15') returning id::text as id", [shop.brandId]);
    const [card] = await rows<{ id: string }>(
      db,
      `insert into public.trend_cards (brand_id, run_id, title, summary, why_it_matters, sources, confidence, expires_at)
       values ($1, $2, 't', 's', 'w', '[{"url":"https://x.example.com","title":"t","site":"x","publishedAt":"2026-10-01","kind":"web"}]'::jsonb, 'medium', '2026-11-01') returning id::text as id`,
      [shop.brandId, run.id],
    );
    await rows(db, "insert into public.post_ideas (brand_id, card_id, post_type, angle, description, brief_id, status) values ($1, $2, 'announcement', 'a', 'd', $3, 'used')", [shop.brandId, card.id, a.briefId]);

    const out = await metricsForBrand(shop.brandId, 30, NOW);
    expect(out).toHaveLength(2);
    const ma = out.find((m) => m.postId === a.postId)!;
    expect(ma).toMatchObject({
      queueItemId: a.itemId, ageHours: 72, reach: 250, likes: 9, views: 400, impressions: null,
      channel: "instagram", postType: "announcement", themeId: "classic", postedHour: 11, postedWeekday: 2, fromIdea: true,
      postedAt: "2026-10-13T06:00:00.000Z",
    });
    const mb = out.find((m) => m.postId === b.postId)!;
    expect(mb).toMatchObject({ ageHours: 24, reach: 40, fromIdea: false, channel: "instagram" });
    // Newest post first.
    expect(out.map((x) => x.postId)).toEqual([a.postId, b.postId]);
  });

  it("respects the window and leaves out posts with nothing to show", async () => {
    const shop = await makeShop(db, { name: "Window Shop" });
    const recent = await seedPublished(db, shop, "instagram", { ageHours: 48 });
    const old = await seedPublished(db, shop, "instagram", { ageHours: 20 * 24 });
    const empty = await seedPublished(db, shop, "instagram", { ageHours: 30 });
    await addMetric(shop, recent.itemId, 24, { reach: 10 });
    await addMetric(shop, old.itemId, 168, { reach: 99 });
    await addMetric(shop, empty.itemId, 24, {});
    expect((await metricsForBrand(shop.brandId, 7, NOW)).map((m) => m.postId)).toEqual([recent.postId]);
    expect((await metricsForBrand(shop.brandId, 30, NOW)).map((m) => m.postId).sort()).toEqual([recent.postId, old.postId].sort());
    expect(await metricsForBrand(shop.brandId, 0, NOW)).toEqual([]);
    expect(await metricsForBrand("not-a-uuid", 7, NOW)).toEqual([]);
  });

  it("never mixes brands", async () => {
    const mine = await makeShop(db, { name: "Mine" });
    const theirs = await makeShop(db, { name: "Theirs" });
    const m = await seedPublished(db, mine, "instagram", { ageHours: 30 });
    const t = await seedPublished(db, theirs, "instagram", { ageHours: 30 });
    await addMetric(mine, m.itemId, 24, { reach: 1 });
    await addMetric(theirs, t.itemId, 24, { reach: 2 });
    expect((await metricsForBrand(mine.brandId, 30, NOW)).map((x) => x.postId)).toEqual([m.postId]);
  });
});

describe("row-level security of post_metrics", () => {
  it("brand members can read their numbers; another brand's owner and strangers cannot; nobody signed in can write", async () => {
    const shop = await makeShop(db, { name: "RLS Shop" });
    const other = await makeShop(db, { name: "RLS Other" });
    const editor = await addMember(db, shop.brandId, "editor");
    const stranger = await makeStranger(db);
    const p = await seedPublished(db, shop, "instagram", { ageHours: 30 });
    await addMetric(shop, p.itemId, 24, { reach: 10 });

    for (const u of [shop.userId, editor]) {
      expect(await db.withUser(u, (tx) => tx.query("select id from public.post_metrics where brand_id = $1", [shop.brandId]))).toHaveLength(1);
    }
    for (const u of [other.userId, stranger]) {
      expect(await db.withUser(u, (tx) => tx.query("select id from public.post_metrics where brand_id = $1", [shop.brandId]))).toHaveLength(0);
      expect(await db.withUser(u, (tx) => tx.query("select id from public.post_metrics"))).toHaveLength(0);
    }
    await expect(
      db.withUser(shop.userId, (tx) => tx.query("insert into public.post_metrics (brand_id, queue_item_id, age_hours, reach) values ($1, $2, 72, 999999)", [shop.brandId, p.itemId])),
    ).rejects.toThrow(/row-level security|permission denied/i);
    expect(await db.withUser(shop.userId, (tx) => tx.query("update public.post_metrics set reach = 1 where brand_id = $1 returning id", [shop.brandId]))).toHaveLength(0);
    expect(await db.withUser(shop.userId, (tx) => tx.query("delete from public.post_metrics where brand_id = $1 returning id", [shop.brandId]))).toHaveLength(0);
  });
});

describe("insightsPermission", () => {
  it("tells connected-with-permission, connected-without it (reconnect), and not connected", async () => {
    const shop = await makeShop(db, { name: "Perm Shop" });
    expect(await insightsPermission(shop.brandId)).toEqual({ instagram: "not_connected", facebook: "not_connected" });
    await connectWith(shop, "instagram", ["instagram_business_basic", "instagram_business_content_publish"]);
    await connectWith(shop, "facebook");
    expect(await insightsPermission(shop.brandId)).toEqual({ instagram: "missing", facebook: "ok" });
    await connectWith(shop, "instagram");
    expect(await insightsPermission(shop.brandId)).toEqual({ instagram: "ok", facebook: "ok" });
  });
});
