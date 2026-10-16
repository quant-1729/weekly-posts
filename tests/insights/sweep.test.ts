import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetTokenKeyForTests } from "@/lib/connections/crypto";
import type { MockDb } from "@/lib/db/mock";
import { sweepInsights } from "@/lib/insights/sweep";
import {
  FB_TOKEN, HOUR, IG_TOKEN, NOW, closeDb, connectWith, fakeFetch, graphError, igBody, makeShop, metricRows, openDb, rows, seedPublished, stubMetaEnv, when, type Shop,
} from "./helpers";

let db: MockDb;
beforeAll(async () => {
  db = await openDb();
});
afterAll(async () => {
  await closeDb(db);
});
beforeEach(async () => {
  stubMetaEnv();
  resetTokenKeyForTests();
  // Each test starts without queue items (post_metrics go with them), so one test's leftovers never get measured in another.
  await rows(db, "delete from public.queue_items");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const metricsOf = (c: { params: URLSearchParams }) => (c.params.get("metric") ?? "").split(",");
const igOk = () => when("GET", /^\/v23\.0\/[^/]+\/insights$/, (c) => ({ body: igBody(metricsOf(c)) }));

async function igShop(name = "Corner Bakery", scopes?: string[]): Promise<Shop> {
  const shop = await makeShop(db, { name });
  await connectWith(shop, "instagram", scopes);
  return shop;
}

describe("sweepInsights: buckets", () => {
  it("measures a post once it is 24 hours old, not before, and stores the mapped numbers", async () => {
    const shop = await igShop("Early Shop");
    const young = await seedPublished(db, shop, "instagram", { ageHours: 23 });
    const f = fakeFetch([igOk()]);
    const early = await sweepInsights({ now: NOW }, { fetch: f.fetch });
    expect(early.items.filter((i) => i.itemId === young.itemId)).toHaveLength(0);
    expect(await metricRows(db, young.itemId)).toHaveLength(0);

    const later = await sweepInsights({ now: new Date(NOW.getTime() + 2 * HOUR) }, { fetch: f.fetch });
    expect(later.items.find((i) => i.itemId === young.itemId)).toMatchObject({ bucket: 24, outcome: "stored" });
    const [row] = await metricRows(db, young.itemId);
    expect(row).toMatchObject({ age_hours: 24, reach: 10, likes: 20, comments: 30, saves: 40, shares: 50, views: 60, impressions: null });
    // The call used the connection's token and the instagram host.
    expect(f.calls.at(-1)).toMatchObject({ host: "graph.instagram.com" });
    expect(f.calls.at(-1)!.params.get("access_token")).toBe(IG_TOKEN);
  });

  it("is idempotent: a second run, or the same hour twice, never adds a second row for a bucket", async () => {
    const shop = await igShop("Idem Shop");
    const p = await seedPublished(db, shop, "instagram", { ageHours: 26 });
    const f = fakeFetch([igOk()]);
    await sweepInsights({ now: NOW }, { fetch: f.fetch });
    const calls = f.calls.length;
    const again = await sweepInsights({ now: new Date(NOW.getTime() + HOUR) }, { fetch: f.fetch });
    expect(again.items.filter((i) => i.itemId === p.itemId)).toHaveLength(0);
    expect(f.calls.length).toBe(calls);
    expect(await metricRows(db, p.itemId)).toHaveLength(1);
  });

  it("adds the 72 h and 7 day rows as the post ages, one row per bucket", async () => {
    const shop = await igShop("Aging Shop");
    const p = await seedPublished(db, shop, "instagram", { ageHours: 25 });
    const f = fakeFetch([igOk()]);
    await sweepInsights({ now: NOW }, { fetch: f.fetch });
    await sweepInsights({ now: new Date(NOW.getTime() + 48 * HOUR) }, { fetch: f.fetch }); // 73 h
    await sweepInsights({ now: new Date(NOW.getTime() + 48 * HOUR + HOUR) }, { fetch: f.fetch }); // nothing new
    await sweepInsights({ now: new Date(NOW.getTime() + 144 * HOUR) }, { fetch: f.fetch }); // 169 h
    expect((await metricRows(db, p.itemId)).map((r) => r.age_hours)).toEqual([24, 72, 168]);
  });

  it("tolerates a late run: a post found at 100 hours is measured once, as the 72 h bucket (the 24 h one stays empty)", async () => {
    const shop = await igShop("Late Shop");
    const p = await seedPublished(db, shop, "instagram", { ageHours: 100 });
    const f = fakeFetch([igOk()]);
    await sweepInsights({ now: NOW }, { fetch: f.fetch });
    await sweepInsights({ now: NOW }, { fetch: f.fetch });
    const stored = await metricRows(db, p.itemId);
    expect(stored.map((r) => r.age_hours)).toEqual([72]);
    expect(new Date(stored[0].fetched_at).toISOString()).toBe(NOW.toISOString());
  });

  it("stops measuring posts older than 30 days", async () => {
    const shop = await igShop("Old Shop");
    const p = await seedPublished(db, shop, "instagram", { ageHours: 31 * 24 });
    const f = fakeFetch([igOk()]);
    await sweepInsights({ now: NOW }, { fetch: f.fetch });
    expect(await metricRows(db, p.itemId)).toHaveLength(0);
  });

  it("measures a story once, from 20 hours (its numbers vanish at 24), with the story metrics", async () => {
    const shop = await igShop("Story Shop");
    const s = await seedPublished(db, shop, "instagram", { ageHours: 21, formats: ["vertical"] });
    const f = fakeFetch([igOk()]);
    await sweepInsights({ now: NOW }, { fetch: f.fetch });
    const call = f.calls.at(-1)!;
    expect(metricsOf(call)).toEqual(["reach", "replies", "views"]);
    expect(await metricRows(db, s.itemId)).toMatchObject([{ age_hours: 24, reach: 10, comments: 20, views: 30 }]);
    // Never a 72 h or 7 day row for a story.
    await sweepInsights({ now: new Date(NOW.getTime() + 200 * HOUR) }, { fetch: f.fetch });
    expect(await metricRows(db, s.itemId)).toHaveLength(1);
  });

  it("uses the carousel metrics for a carousel post", async () => {
    const shop = await igShop("Carousel Shop");
    const c = await seedPublished(db, shop, "instagram", { ageHours: 30, carousel: 3 });
    const f = fakeFetch([igOk()]);
    await sweepInsights({ now: NOW }, { fetch: f.fetch });
    expect(metricsOf(f.calls.at(-1)!)).toEqual(["reach", "likes", "comments", "saved", "shares", "views"]);
    expect(await metricRows(db, c.itemId)).toHaveLength(1);
  });

  it("measures a Facebook Page post with the Page metrics", async () => {
    const shop = await makeShop(db, { name: "FB Shop" });
    await connectWith(shop, "facebook");
    const p = await seedPublished(db, shop, "facebook", { ageHours: 30, platformPostId: "100200300_555" });
    const f = fakeFetch([
      when("GET", /\/100200300_555\/insights$/, {
        body: { data: [{ name: "post_impressions_unique", values: [{ value: 200 }] }, { name: "post_impressions", values: [{ value: 260 }] }, { name: "post_reactions_by_type_total", values: [{ value: { like: 5, love: 2 } }] }] },
      }),
      when("GET", /\/100200300_555$/, { body: { shares: { count: 3 }, comments: { summary: { total_count: 2 } } } }),
    ]);
    await sweepInsights({ now: NOW }, { fetch: f.fetch });
    expect(await metricRows(db, p.itemId)).toMatchObject([{ age_hours: 24, reach: 200, impressions: 260, likes: 7, shares: 3, comments: 2, saves: null }]);
    expect(f.calls[0]).toMatchObject({ host: "graph.facebook.com" });
    expect(f.calls[0].params.get("access_token")).toBe(FB_TOKEN);
  });

  it("only measures published posts that have a platform id; delivered and failed ones are ignored", async () => {
    const shop = await igShop("Mixed Shop");
    const a = await seedPublished(db, shop, "instagram", { ageHours: 30 });
    const b = await seedPublished(db, shop, "instagram", { ageHours: 30 });
    await rows(db, "update public.queue_items set status = 'delivered' where id = $1", [a.itemId]);
    await rows(db, "update public.queue_items set platform_post_id = null where id = $1", [b.itemId]);
    const f = fakeFetch([igOk()]);
    await sweepInsights({ now: NOW }, { fetch: f.fetch });
    expect(await metricRows(db, a.itemId)).toHaveLength(0);
    expect(await metricRows(db, b.itemId)).toHaveLength(0);
  });

  it("handles at most the batch limit per run and picks the rest up on the next run", async () => {
    const shop = await igShop("Batch Shop");
    const ps = [];
    for (let i = 0; i < 3; i++) ps.push(await seedPublished(db, shop, "instagram", { ageHours: 40 + i }));
    const f = fakeFetch([igOk()]);
    const first = await sweepInsights({ now: NOW, limit: 2 }, { fetch: f.fetch });
    expect(first.stored).toBe(2);
    const second = await sweepInsights({ now: NOW, limit: 2 }, { fetch: f.fetch });
    expect(second.stored).toBe(1);
    for (const p of ps) expect(await metricRows(db, p.itemId)).toHaveLength(1);
  });
});

describe("sweepInsights: graceful failures", () => {
  it("a deprecated metric is skipped and the others are stored", async () => {
    const shop = await igShop("Deprecated Shop");
    const p = await seedPublished(db, shop, "instagram", { ageHours: 30 });
    const f = fakeFetch([
      when("GET", /\/insights$/, (c) => {
        const names = metricsOf(c);
        if (names.includes("views")) return graphError(100, "(#100) metric[5] must be one of the following values");
        return { body: igBody(names) };
      }),
    ]);
    const sum = await sweepInsights({ now: NOW }, { fetch: f.fetch });
    expect(sum.items.find((i) => i.itemId === p.itemId)).toMatchObject({ outcome: "stored", skipped: ["views"] });
    expect(await metricRows(db, p.itemId)).toMatchObject([{ reach: 10, likes: 10, comments: 10, saves: 10, shares: 10, views: null }]);
  });

  it("when Meta refuses every metric, an empty row marks the bucket done and it is not asked again", async () => {
    const shop = await igShop("Refused Shop");
    const p = await seedPublished(db, shop, "instagram", { ageHours: 30 });
    const f = fakeFetch([when("GET", /\/insights$/, graphError(100, "Unsupported get request"))]);
    const first = await sweepInsights({ now: NOW }, { fetch: f.fetch });
    expect(first.items.find((i) => i.itemId === p.itemId)?.outcome).toBe("empty");
    expect(await metricRows(db, p.itemId)).toMatchObject([{ age_hours: 24, reach: null, likes: null }]);
    const n = f.calls.length;
    await sweepInsights({ now: NOW }, { fetch: f.fetch });
    expect(f.calls.length).toBe(n);
  });

  it("a connection without the insights permission is skipped with a reason: no call, no row, counted", async () => {
    const shop = await igShop("No Scope Shop", ["instagram_business_basic", "instagram_business_content_publish"]);
    const p = await seedPublished(db, shop, "instagram", { ageHours: 30 });
    const f = fakeFetch([igOk()]);
    const sum = await sweepInsights({ now: NOW }, { fetch: f.fetch });
    expect(f.calls).toHaveLength(0);
    expect(sum.permissionMissing).toBeGreaterThanOrEqual(1);
    expect(sum.items.find((i) => i.itemId === p.itemId)).toBeUndefined();
    expect(await metricRows(db, p.itemId)).toHaveLength(0);

    // Reconnecting with the permission picks the post up on the next run.
    await connectWith(shop, "instagram");
    await sweepInsights({ now: NOW }, { fetch: f.fetch });
    expect(await metricRows(db, p.itemId)).toHaveLength(1);
  });

  it("a Facebook connection needs read_insights AND pages_read_engagement", async () => {
    const shop = await makeShop(db, { name: "FB Scope Shop" });
    await connectWith(shop, "facebook", ["pages_manage_posts", "pages_read_engagement", "pages_show_list"]);
    const p = await seedPublished(db, shop, "facebook", { ageHours: 30 });
    const f = fakeFetch([igOk()]);
    await sweepInsights({ now: NOW }, { fetch: f.fetch });
    expect(f.calls).toHaveLength(0);
    expect(await metricRows(db, p.itemId)).toHaveLength(0);
  });

  it("when Meta itself says the permission is missing, nothing is stored and the claim is released", async () => {
    const shop = await igShop("Refuses Shop");
    const p = await seedPublished(db, shop, "instagram", { ageHours: 30 });
    const f = fakeFetch([when("GET", /\/insights$/, graphError(10, "(#10) Application does not have permission for this action"))]);
    const sum = await sweepInsights({ now: NOW }, { fetch: f.fetch });
    expect(sum.items.find((i) => i.itemId === p.itemId)?.outcome).toBe("permission_missing");
    expect(sum.permissionRefused).toBeGreaterThanOrEqual(1);
    expect(await metricRows(db, p.itemId)).toHaveLength(0);
  });

  it("a busy Meta or a bad token releases the claim so a later run retries", async () => {
    const shop = await igShop("Busy Shop");
    const p = await seedPublished(db, shop, "instagram", { ageHours: 30 });
    const busy = fakeFetch([when("GET", /\/insights$/, { status: 500, body: { error: { message: "down", code: 2 } } })]);
    const s1 = await sweepInsights({ now: NOW }, { fetch: busy.fetch });
    expect(s1.items.find((i) => i.itemId === p.itemId)?.outcome).toBe("retry_later");
    expect(await metricRows(db, p.itemId)).toHaveLength(0);
    const bad = fakeFetch([when("GET", /\/insights$/, graphError(190, "Invalid OAuth access token", { status: 401 }))]);
    const s2 = await sweepInsights({ now: NOW }, { fetch: bad.fetch });
    expect(s2.items.find((i) => i.itemId === p.itemId)?.outcome).toBe("token_problem");
    expect(await metricRows(db, p.itemId)).toHaveLength(0);
    const ok = fakeFetch([igOk()]);
    await sweepInsights({ now: NOW }, { fetch: ok.fetch });
    expect(await metricRows(db, p.itemId)).toHaveLength(1);
  });

  it("skips connections that are expired or revoked", async () => {
    const shop = await igShop("Expired Shop");
    const p = await seedPublished(db, shop, "instagram", { ageHours: 30 });
    await rows(db, "update public.channel_connections set status = 'expired' where brand_id = $1", [shop.brandId]);
    const f = fakeFetch([igOk()]);
    await sweepInsights({ now: NOW }, { fetch: f.fetch });
    expect(f.calls).toHaveLength(0);
    expect(await metricRows(db, p.itemId)).toHaveLength(0);
  });
});

describe("sweepInsights: concurrency", () => {
  it("two sweeps at the same time measure a post once: one fetch, one row", async () => {
    const shop = await igShop("Race Shop");
    const p = await seedPublished(db, shop, "instagram", { ageHours: 30 });
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const f = fakeFetch([igOk()]);
    const slow = async (input: string, init?: RequestInit) => {
      await gate;
      return f.fetch(input, init);
    };
    const a = sweepInsights({ now: NOW }, { fetch: slow });
    const b = sweepInsights({ now: NOW }, { fetch: slow });
    // Let both reach the claim, then let Meta answer.
    await new Promise((r) => setTimeout(r, 200));
    release();
    const [sa, sb] = await Promise.all([a, b]);
    const mine = [sa, sb].map((s) => s.items.find((i) => i.itemId === p.itemId)?.outcome).filter(Boolean);
    expect(mine.filter((o) => o === "stored")).toHaveLength(1);
    expect(f.calls).toHaveLength(1);
    expect(await metricRows(db, p.itemId)).toHaveLength(1);
  });
});

describe("sweepInsights: the token is never logged", () => {
  it("neither the console, the summary nor an error holds the token", async () => {
    const shop = await igShop("Quiet Shop");
    const p = await seedPublished(db, shop, "instagram", { ageHours: 30 });
    const logs: string[] = [];
    const spy = (...args: unknown[]) => void logs.push(args.map(String).join(" "));
    vi.spyOn(console, "info").mockImplementation(spy);
    vi.spyOn(console, "error").mockImplementation(spy);
    vi.spyOn(console, "warn").mockImplementation(spy);

    const leaky = fakeFetch([when("GET", /\/insights$/, { status: 500, body: { error: { message: `boom access_token=${IG_TOKEN} ${IG_TOKEN}`, code: 2 } } })]);
    const s1 = await sweepInsights({ now: NOW }, { fetch: leaky.fetch });
    // An unexpected error (not a Meta one) that mentions the token is scrubbed before it is logged.
    const crash = await sweepInsights({ now: NOW }, { fetch: async () => { throw new TypeError(`bad ${IG_TOKEN}`); } });
    const ok = await sweepInsights({ now: NOW }, { fetch: fakeFetch([igOk()]).fetch });

    const all = JSON.stringify([s1, crash, ok]) + logs.join("\n");
    expect(all).not.toContain(IG_TOKEN);
    expect(all).not.toContain(FB_TOKEN);
    expect(await metricRows(db, p.itemId)).toHaveLength(1);
    expect(logs.some((l) => l.includes("[insights] sweep"))).toBe(true);
  });
});
