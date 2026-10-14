import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { MockDb } from "@/lib/db/mock";
import { closeDb, openDb } from "../helpers/details";
import { NOW, connect, makeShop, rows, seedApproved, seedItem, type Shop } from "./helpers";

let db: MockDb;
let a: Shop;
let b: Shop;
let itemA: string;
let postB: string;

beforeAll(async () => {
  db = await openDb();
  a = await makeShop(db, { name: "Shop A" });
  b = await makeShop(db, { name: "Shop B" });
  const x = await seedApproved(db, a, ["instagram"]);
  itemA = await seedItem(db, a, x.posts[0], { slotAt: "2026-10-20T09:00:00Z" });
  const y = await seedApproved(db, b, ["instagram"]);
  postB = y.posts[0].id;
  await connect(db, a, "instagram");
  await rows(db, "insert into public.queue_settings (brand_id, paused) values ($1, true)", [a.brandId]);
});
afterAll(async () => {
  await closeDb(db);
});

const asUser = <T,>(shop: Shop, fn: (q: (sql: string, p?: unknown[]) => Promise<unknown[]>) => Promise<T>) => db.withUser(shop.userId, (tx) => fn((sql, p) => tx.query(sql, p)));

describe("row-level security on the queue tables", () => {
  it("all five tables have it switched on", async () => {
    const r = await rows<{ relname: string; relrowsecurity: boolean }>(
      db,
      "select relname, relrowsecurity from pg_class where relnamespace = 'public'::regnamespace and relname in ('queue_settings', 'queue_items', 'channel_connections', 'channel_tokens', 'deletion_requests') order by relname",
    );
    expect(r).toHaveLength(5);
    expect(r.every((x) => x.relrowsecurity)).toBe(true);
  });

  it("a member sees their own queue and settings, and nobody else's", async () => {
    expect(await asUser(a, (q) => q("select id from public.queue_items where brand_id = $1", [a.brandId]))).toHaveLength(1);
    expect(await asUser(b, (q) => q("select id from public.queue_items"))).toHaveLength(0);
    expect(await asUser(b, (q) => q("select id from public.queue_items where brand_id = $1", [a.brandId]))).toHaveLength(0);
    expect(await asUser(a, (q) => q("select brand_id from public.queue_settings"))).toHaveLength(1);
    expect(await asUser(b, (q) => q("select brand_id from public.queue_settings"))).toHaveLength(0);
  });

  it("another business cannot add, change or remove queue rows or settings", async () => {
    await expect(
      asUser(b, (q) => q("insert into public.queue_items (brand_id, post_id, channel, slot_at, mode) values ($1, $2, 'instagram', now(), 'deliver')", [a.brandId, postB])),
    ).rejects.toThrow();
    expect(await asUser(b, (q) => q("update public.queue_items set status = 'skipped' where id = $1 returning id", [itemA]))).toHaveLength(0);
    expect(await asUser(b, (q) => q("delete from public.queue_items where id = $1 returning id", [itemA]))).toHaveLength(0);
    await expect(asUser(b, (q) => q("insert into public.queue_settings (brand_id, paused) values ($1, false)", [a.brandId]))).rejects.toThrow();
    expect(await asUser(b, (q) => q("update public.queue_settings set paused = false where brand_id = $1 returning brand_id", [a.brandId]))).toHaveLength(0);
    expect((await rows<{ status: string }>(db, "select status from public.queue_items where id = $1", [itemA]))[0].status).toBe("scheduled");
    expect((await rows<{ paused: boolean }>(db, "select paused from public.queue_settings where brand_id = $1", [a.brandId]))[0].paused).toBe(true);
  });

  it("a queue row can only point at a post of its own brand", async () => {
    await expect(
      asUser(a, (q) => q("insert into public.queue_items (brand_id, post_id, channel, slot_at, mode) values ($1, $2, 'instagram', now(), 'deliver')", [a.brandId, postB])),
    ).rejects.toThrow(/foreign key|violates/i);
  });

  it("one queue row per post", async () => {
    const [{ post_id }] = await rows<{ post_id: string }>(db, "select post_id::text as post_id from public.queue_items where id = $1", [itemA]);
    await expect(asUser(a, (q) => q("insert into public.queue_items (brand_id, post_id, channel, slot_at, mode) values ($1, $2, 'instagram', now(), 'deliver')", [a.brandId, post_id]))).rejects.toThrow(/unique|duplicate/i);
  });

  it("members can read their connections but not create, change or remove them; other businesses see nothing", async () => {
    expect(await asUser(a, (q) => q("select provider, status from public.channel_connections"))).toEqual([{ provider: "instagram", status: "active" }]);
    expect(await asUser(b, (q) => q("select provider from public.channel_connections"))).toHaveLength(0);
    await expect(asUser(a, (q) => q("insert into public.channel_connections (brand_id, provider, account_id) values ($1, 'facebook', 'x')", [a.brandId]))).rejects.toThrow();
    expect(await asUser(a, (q) => q("update public.channel_connections set status = 'revoked' where brand_id = $1 returning id", [a.brandId]))).toHaveLength(0);
    expect(await asUser(a, (q) => q("delete from public.channel_connections where brand_id = $1 returning id", [a.brandId]))).toHaveLength(0);
  });

  it("tokens and deletion requests are server-only: a signed-in user cannot even read them", async () => {
    await expect(asUser(a, (q) => q("select * from public.channel_tokens"))).rejects.toThrow(/permission denied/i);
    await expect(asUser(a, (q) => q("select * from public.deletion_requests"))).rejects.toThrow(/permission denied/i);
  });

  it("deleting a brand removes its queue rows, settings and connections", async () => {
    const c = await makeShop(db, { name: "Shop C" });
    const x = await seedApproved(db, c, ["instagram"]);
    await seedItem(db, c, x.posts[0], { slotAt: new Date(NOW.getTime() + 86_400_000).toISOString() });
    await connect(db, c, "facebook");
    await rows(db, "insert into public.queue_settings (brand_id) values ($1)", [c.brandId]);
    await rows(db, "delete from public.brands where id = $1", [c.brandId]);
    for (const t of ["queue_items", "queue_settings", "channel_connections"]) {
      expect((await rows<{ n: number }>(db, `select count(*)::int as n from public.${t} where brand_id = $1`, [c.brandId]))[0].n).toBe(0);
    }
  });
});
