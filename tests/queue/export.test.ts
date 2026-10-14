import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildExport } from "@/lib/account/export";
import type { MockDb } from "@/lib/db/mock";
import { saveQueueSettings } from "@/lib/queue";
import { createMockStorage } from "@/lib/storage/mock";
import { collect, parseZip } from "../account/zip-read";
import { closeDb, openDb } from "../helpers/details";
import { NOW, makeShop, rows, seedApproved, seedItem } from "./helpers";

let db: MockDb;
let dir: string;

beforeAll(async () => {
  db = await openDb();
  dir = await mkdtemp(path.join(os.tmpdir(), "pm-queue-export-"));
});
afterAll(async () => {
  await closeDb(db);
  await rm(dir, { recursive: true, force: true });
});

const read = (zip: ReturnType<typeof parseZip>, name: string) => JSON.parse(new TextDecoder().decode(zip.files.get(name))) as unknown;

describe("account export: the queue", () => {
  it("has queue.json (channel, time, status, mode, permalink, dates) and queue-settings.json, and no tokens", async () => {
    const shop = await makeShop(db);
    const other = await makeShop(db, { name: "Other Shop" });
    const x = await seedApproved(db, shop, ["instagram", "whatsapp"]);
    const theirs = await seedApproved(db, other, ["instagram"]);
    await seedItem(db, other, theirs.posts[0], { slotAt: "2026-10-20T09:00:00Z" });
    const ig = await seedItem(db, shop, x.posts[0], { slotAt: "2026-10-15T09:00:00Z", mode: "publish" });
    await seedItem(db, shop, x.posts[1], { slotAt: "2026-10-17T09:00:00Z" });
    await rows(db, "update public.queue_items set status = 'published', platform_post_id = '178', permalink = 'https://www.instagram.com/p/178/', done_at = $2 where id = $1", [ig, "2026-10-15T09:01:00Z"]);
    await saveQueueSettings(shop.userId, shop.brandId, { postsPerWeek: 2, days: [2, 5], times: { instagram: "08:30" }, autoApprove: { instagram: true }, paused: true });
    // A connection with a token row must not leak into the queue files.
    await rows(db, "insert into public.channel_connections (brand_id, provider, account_id, status) values ($1, 'instagram', 'ig-secret-account', 'active')", [shop.brandId]);

    const zip = parseZip(await collect(await buildExport(shop.userId, { storage: createMockStorage(dir), now: NOW })));
    expect(zip.names).toContain("queue.json");
    expect(zip.names).toContain("queue-settings.json");
    const queue = read(zip, "queue.json") as Record<string, unknown>[];
    expect(queue).toHaveLength(2);
    expect(queue[0]).toMatchObject({ channel: "instagram", slot_at: "2026-10-15T09:00:00Z", status: "published", mode: "publish", permalink: "https://www.instagram.com/p/178/", done_at: "2026-10-15T09:01:00Z", post_code: expect.any(String) });
    expect(queue[1]).toMatchObject({ channel: "whatsapp", slot_at: "2026-10-17T09:00:00Z", status: "scheduled", mode: "deliver", permalink: null });
    const settings = read(zip, "queue-settings.json") as Record<string, unknown>;
    expect(settings).toMatchObject({ posts_per_week: 2, days: [2, 5], times: { instagram: "08:30" }, auto_approve: { instagram: true }, paused: true, deliver_email: true });

    // Nothing of another business, and nothing secret.
    const text = ["queue.json", "queue-settings.json"].map((n) => new TextDecoder().decode(zip.files.get(n))).join("\n");
    expect(text).not.toContain(theirs.posts[0].id);
    expect(text).not.toContain("ig-secret-account");
    expect(text).not.toMatch(/token|ciphertext|platform_post_id/i);
    expect(new TextDecoder().decode(zip.files.get("README.txt"))).toContain("queue.json");
  });

  it("a business without any queue exports an empty list and null settings", async () => {
    const shop = await makeShop(db);
    const zip = parseZip(await collect(await buildExport(shop.userId, { storage: createMockStorage(dir), now: NOW })));
    expect(read(zip, "queue.json")).toEqual([]);
    expect(read(zip, "queue-settings.json")).toBeNull();
  });
});
