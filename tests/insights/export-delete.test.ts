import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { deleteAccount } from "@/lib/account/delete";
import { buildExport } from "@/lib/account/export";
import type { MockDb } from "@/lib/db/mock";
import { createMockStorage } from "@/lib/storage/mock";
import { accountRowCounts } from "../account/helpers";
import { collect, parseZip } from "../account/zip-read";
import { NOW, closeDb, makeShop, openDb, rows, seedPublished, stubMetaEnv, type Shop } from "./helpers";

let db: MockDb;
let dir: string;
beforeAll(async () => {
  db = await openDb();
  stubMetaEnv();
  dir = await mkdtemp(path.join(os.tmpdir(), "pm-insights-export-"));
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await closeDb(db);
  await rm(dir, { recursive: true, force: true });
});

const read = (zip: ReturnType<typeof parseZip>, name: string) => JSON.parse(new TextDecoder().decode(zip.files.get(name))) as Record<string, unknown>[];

async function seed(shop: Shop, reach: number) {
  const p = await seedPublished(db, shop, "instagram", { ageHours: 30, platformPostId: `secret-media-${reach}` });
  for (const [age, mult] of [[24, 1], [72, 2]] as const) {
    await rows(db, "insert into public.post_metrics (brand_id, queue_item_id, age_hours, reach, impressions, likes, comments, saves, shares, views) values ($1, $2, $3, $4, null, 5, 1, 2, 3, 4)", [shop.brandId, p.itemId, age, reach * mult]);
  }
  return p;
}

describe("account export and deletion include the insights", () => {
  it("the export has insights.json with the numbers by post code and channel, nothing of another brand, no platform ids", async () => {
    const mine = await makeShop(db, { name: "Mine" });
    const theirs = await makeShop(db, { name: "Theirs" });
    await seed(mine, 111);
    await seed(theirs, 999);

    const zip = parseZip(await collect(await buildExport(mine.userId, { storage: createMockStorage(dir), now: NOW })));
    expect(zip.names).toContain("insights.json");
    const insights = read(zip, "insights.json");
    expect(insights).toHaveLength(2);
    expect(insights[0]).toMatchObject({ post_code: expect.any(String), channel: "instagram", age_hours: 24, reach: 111, impressions: null, likes: 5, comments: 1, saves: 2, shares: 3, views: 4, fetched_at: expect.stringMatching(/Z$/) });
    expect(insights[1]).toMatchObject({ age_hours: 72, reach: 222 });
    const text = new TextDecoder().decode(zip.files.get("insights.json"));
    expect(text).not.toContain("999");
    expect(text).not.toMatch(/secret-media|token|platform_post_id/i);
    expect(new TextDecoder().decode(zip.files.get("README.txt"))).toContain("insights.json");
  });

  it("a business without any insights exports an empty list", async () => {
    const shop = await makeShop(db, { name: "Fresh" });
    const zip = parseZip(await collect(await buildExport(shop.userId, { storage: createMockStorage(dir), now: NOW })));
    expect(read(zip, "insights.json")).toEqual([]);
  });

  it("deleting the account removes its post_metrics and leaves the other brand's untouched", async () => {
    const a = await makeShop(db, { name: "Gone" });
    const b = await makeShop(db, { name: "Stays" });
    await seed(a, 10);
    await seed(b, 20);
    const emailOf = async (s: Shop) => (await rows<{ email: string }>(db, "select email from public.profiles where id = $1", [s.userId]))[0].email;
    const acct = async (s: Shop) => ({ brandId: s.brandId, userId: s.userId, email: await emailOf(s) });
    const accA = await acct(a);
    const accB = await acct(b);
    expect((await accountRowCounts(db, accA)).post_metrics).toBe(2);
    const beforeB = await accountRowCounts(db, accB);

    await deleteAccount(a.userId, { storage: createMockStorage(dir) });

    const after = await accountRowCounts(db, accA);
    expect(after.post_metrics).toBe(0);
    expect(Object.entries(after).filter(([, n]) => n > 0)).toEqual([]);
    expect(await accountRowCounts(db, accB)).toEqual(beforeB);
  });
});
