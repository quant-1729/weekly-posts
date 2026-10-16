import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { MockDb } from "@/lib/db/mock";
import { businessDiscoveryEnabled, findingFromDiscovery, parseDiscovery, velocityOf, type DiscoveryData } from "@/lib/ideas/competitor-instagram";
import { COMPETITOR_SITE_SYSTEM, readCompetitorSite } from "@/lib/ideas/competitor-site";
import { createCompetitor } from "@/lib/ideas/competitors";
import { runResearch } from "@/lib/ideas";
import { regionCode, searchYoutube, youtubeKey } from "@/lib/ideas/youtube";
import type { Competitor } from "@/lib/ideas/types";
import { fakeFetch } from "../connections/helpers";
import { NOW, WINDOW, baseDeps, closeDb, dnsOk, facebookConnection, groundedAnswer, makeShop, okSite, openDb, rows, scriptedAi, simpleCard } from "./helpers";

let db: MockDb;
beforeAll(async () => {
  db = await openDb();
});
afterAll(async () => {
  await closeDb(db);
});

const ytQuery = { q: "cake decorating", source: "youtube" as const, why: "video" };

describe("YouTube", () => {
  it("is skipped without a key: nothing is called", async () => {
    expect(youtubeKey({})).toBeNull();
    expect(youtubeKey({ YOUTUBE_API_KEY: "  " })).toBeNull();
    const shop = await makeShop(db);
    const fetchSpy = vi.fn();
    const { ai } = scriptedAi({ plan: [ytQuery, { q: "cakes trend", source: "web", why: "w" }], grounded: () => groundedAnswer("T", "n", "2026-10-14"), cards: (f) => f.map((x) => simpleCard([x.id])) });
    const run = await runResearch({ userId: shop.userId, brandId: shop.brandId, trigger: "manual", now: NOW }, baseDeps(ai, { fetch: fetchSpy as never, env: {} }));
    expect(run!.status).toBe("done");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("with a key: searches the window and the brand's region, then keeps the top 5 by views with their counts", async () => {
    const ids = ["vid0000001", "vid0000002", "vid0000003", "vid0000004", "vid0000005", "vid0000006", "vid0000007"];
    const views = [100, 7000, 50, 900000, 12, 4500, 80];
    const { fetch, calls } = fakeFetch([
      (c) => (c.path === "/youtube/v3/search" ? { body: { items: ids.map((id) => ({ id: { videoId: id } })) } } : undefined),
      (c) =>
        c.path === "/youtube/v3/videos"
          ? {
              body: {
                items: ids.map((id, i) => ({
                  id,
                  snippet: { title: `Video ${i}`, publishedAt: i === 6 ? "2026-01-01T00:00:00Z" : "2026-10-0" + ((i % 8) + 1) + "T10:00:00Z", channelTitle: "Somebody" },
                  statistics: { viewCount: String(views[i]), likeCount: "10", commentCount: "2" },
                })),
              },
            }
          : undefined,
    ]);
    const f = await searchYoutube(ytQuery, { key: "KEY123", region: regionCode("gb"), window: WINDOW, fetch });
    const search = calls.find((c) => c.path === "/youtube/v3/search")!;
    expect(search.params.get("publishedAfter")).toBe("2026-09-15T00:00:00Z");
    expect(search.params.get("regionCode")).toBe("GB");
    expect(search.params.get("q")).toBe("cake decorating");
    expect(f!.sources).toHaveLength(5);
    expect(f!.sources.map((s) => s.engagement!.views)).toEqual([900000, 7000, 4500, 100, 50]); // the old video is out of the window
    expect(f!.sources[0]).toMatchObject({ url: "https://www.youtube.com/watch?v=vid0000004", site: "youtube.com", kind: "youtube", engagement: { views: 900000, likes: 10, comments: 2 } });
    expect(JSON.stringify(f)).not.toContain("Somebody"); // no channel or uploader is kept
  });

  it("a YouTube API error is an error of that source only (and never shows the key)", async () => {
    const { fetch } = fakeFetch([() => ({ status: 403, body: { error: { message: "quota KEY123" } } })]);
    const err = await searchYoutube(ytQuery, { key: "KEY123", region: null, window: WINDOW, fetch }).catch((e) => e as Error);
    expect(err).toBeInstanceOf(Error);
    expect(String((err as Error).message)).not.toContain("KEY123");
  });

  it("region code needs two letters", () => {
    expect(regionCode(null)).toBeNull();
    expect(regionCode("GBR")).toBeNull();
    expect(regionCode("in")).toBe("IN");
  });
});

const ig: Competitor = { id: "00000000-0000-0000-0000-000000000001", brandId: "b", name: "Rival Bakes", website: null, instagramHandle: "rival.bakes", youtubeHandle: null };
const discovery = (posts: DiscoveryData["recent"], followers: number | null = 1000): DiscoveryData => ({ followers, mediaCount: 200, recent: posts });
const post = (date: string, likes: number | null, comments: number | null, format: "photo" | "video" | "carousel" = "photo", n = 1) => ({
  permalink: `https://www.instagram.com/p/${date}-${n}/`,
  postedAt: `${date}T09:00:00+0000`,
  format,
  likes,
  comments,
});

describe("Instagram Business Discovery", () => {
  it("is off unless IDEAS_BUSINESS_DISCOVERY is exactly 'on'", () => {
    expect(businessDiscoveryEnabled({})).toBe(false);
    expect(businessDiscoveryEnabled({ IDEAS_BUSINESS_DISCOVERY: "off" })).toBe(false);
    expect(businessDiscoveryEnabled({ IDEAS_BUSINESS_DISCOVERY: "true" })).toBe(false);
    expect(businessDiscoveryEnabled({ IDEAS_BUSINESS_DISCOVERY: " ON " })).toBe(true);
  });

  it("with the switch off a run never looks up the connection or calls Meta, even with an Instagram handle", async () => {
    const shop = await makeShop(db);
    await createCompetitor(shop.userId, shop.brandId, { name: "Rival", instagram: "@rival.bakes" }, { resolver: dnsOk });
    const getConnection = vi.fn(async () => facebookConnection(shop.brandId));
    const fetchSpy = vi.fn();
    const { ai } = scriptedAi({ plan: [{ q: "cakes trend", source: "web", why: "w" }], grounded: () => groundedAnswer("T", "n", "2026-10-14"), cards: (f) => f.map((x) => simpleCard([x.id])) });
    const run = await runResearch({ userId: shop.userId, brandId: shop.brandId, trigger: "manual", now: NOW }, baseDeps(ai, { getConnection, fetch: fetchSpy as never, env: {} }));
    expect(run!.status).toBe("done");
    expect(getConnection).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await rows(db, "select id from public.competitor_snapshots where brand_id = $1", [shop.brandId])).toHaveLength(0);
  });

  it("parses the Graph answer: counts, links, dates and formats only", () => {
    const d = parseDiscovery({
      business_discovery: {
        followers_count: 1200,
        media_count: 340,
        media: {
          data: [
            { permalink: "https://www.instagram.com/p/AAA/", timestamp: "2026-10-12T09:00:00+0000", media_type: "VIDEO", like_count: 50, comments_count: 4, caption: "never kept" },
            { permalink: "https://evil.example.com/x", timestamp: "2026-10-12T09:00:00+0000", media_type: "IMAGE" },
            { permalink: "https://www.instagram.com/p/BBB/", timestamp: "not a date", media_type: "IMAGE" },
            { permalink: "https://www.instagram.com/p/CCC/", timestamp: "2026-10-11T09:00:00+0000", media_type: "CAROUSEL_ALBUM" },
          ],
        },
      },
    })!;
    expect(d.followers).toBe(1200);
    expect(d.recent).toEqual([
      { permalink: "https://www.instagram.com/p/AAA/", postedAt: "2026-10-12T09:00:00+0000", format: "video", likes: 50, comments: 4 },
      { permalink: "https://www.instagram.com/p/CCC/", postedAt: "2026-10-11T09:00:00+0000", format: "carousel", likes: null, comments: null },
    ]);
    expect(JSON.stringify(d)).not.toContain("never kept");
    expect(parseDiscovery({})).toBeNull();
  });

  it("makes a finding from posts inside the window only, with dated post links", () => {
    const f = findingFromDiscovery(ig, discovery([post("2026-10-12", 100, 5, "video"), post("2026-10-10", 20, 1, "video", 2), post("2026-07-01", 9000, 900)]), WINDOW, 12.5)!;
    expect(f.kind).toBe("competitor");
    expect(f.velocity).toBe(12.5);
    expect(f.sources.map((s) => s.publishedAt)).toEqual(["2026-10-12", "2026-10-10"]);
    expect(f.sources.every((s) => s.site === "instagram.com" && s.kind === "competitor_instagram")).toBe(true);
    expect(f.note).toContain("2 times");
    expect(findingFromDiscovery(ig, discovery([post("2026-07-01", 1, 1)]), WINDOW, null)).toBeNull();
  });

  it("measures velocity against the last snapshot: engagement per post, else followers, else nothing", () => {
    const now = discovery([post("2026-10-12", 150, 50), post("2026-10-11", 150, 50)], 1100);
    expect(velocityOf(now, discovery([post("2026-10-01", 50, 50), post("2026-09-30", 50, 50)], 1000))).toBe(100);
    expect(velocityOf(discovery([], 1100), discovery([], 1000))).toBe(10);
    expect(velocityOf(now, null)).toBeNull();
    expect(velocityOf(discovery([], null), discovery([], null))).toBeNull();
  });

  it("with the switch on: reads through the brand's Facebook connection, stores a snapshot and compares with last week's", async () => {
    const shop = await makeShop(db);
    const comp = await createCompetitor(shop.userId, shop.brandId, { name: "Rival", instagram: "@rival.bakes" }, { resolver: dnsOk });
    // Last week's snapshot: 100 engagement per post.
    await rows(
      db,
      "insert into public.competitor_snapshots (brand_id, competitor_id, taken_at, followers, media_count, recent) values ($1, $2, $3, 1000, 190, $4::jsonb)",
      [shop.brandId, comp.id, "2026-10-08T09:00:00Z", JSON.stringify([{ permalink: "https://www.instagram.com/p/OLD/", posted_at: "2026-10-05T09:00:00+0000", format: "photo", likes: 90, comments: 10 }])],
    );
    const { fetch, calls } = fakeFetch([
      (c) => (c.path.endsWith("/100200300") ? { body: { instagram_business_account: { id: "17841400000000000" } } } : undefined),
      (c) =>
        c.path.endsWith("/17841400000000000")
          ? {
              body: {
                business_discovery: {
                  followers_count: 1100,
                  media_count: 200,
                  media: { data: [{ permalink: "https://www.instagram.com/p/NEW/", timestamp: "2026-10-12T09:00:00+0000", media_type: "IMAGE", like_count: 180, comments_count: 20 }] },
                },
              },
            }
          : undefined,
    ]);
    const readToken = vi.fn(async () => "page-token");
    const { ai } = scriptedAi({ plan: [{ q: "cakes trend", source: "web", why: "w" }], grounded: () => groundedAnswer("Unrelated", "n", "2026-10-14"), cards: (f) => f.map((x) => simpleCard([x.id])) });
    const run = await runResearch(
      { userId: shop.userId, brandId: shop.brandId, trigger: "manual", now: NOW },
      baseDeps(ai, { env: { IDEAS_BUSINESS_DISCOVERY: "on" }, fetch, getConnection: async () => facebookConnection(shop.brandId), readToken }),
    );
    expect(run!.status).toBe("done");
    const bd = calls.find((c) => c.path.endsWith("/17841400000000000"))!;
    expect(bd.params.get("fields")).toContain("business_discovery.username(rival.bakes)");
    expect(bd.params.get("fields")).toContain("followers_count");
    expect(bd.params.get("access_token")).toBe("page-token");

    const snaps = await rows<{ followers: number }>(db, "select followers from public.competitor_snapshots where competitor_id = $1 order by taken_at", [comp.id]);
    expect(snaps.map((s) => s.followers)).toEqual([1000, 1100]);
    const card = await rows<{ velocity: string | null; kind: string; sources: { url: string; published_at: string }[] }>(db, "select velocity, kind, sources from public.trend_cards where brand_id = $1 and kind = 'competitor'", [shop.brandId]);
    expect(card).toHaveLength(1);
    expect(Number(card[0].velocity)).toBe(100); // 200 per post now vs 100 last week
    expect(card[0].sources[0]).toMatchObject({ url: "https://www.instagram.com/p/NEW/", published_at: "2026-10-12" });
  });

  it("without a Facebook connection the source is skipped quietly", async () => {
    const shop = await makeShop(db);
    await createCompetitor(shop.userId, shop.brandId, { name: "Rival", instagram: "@rival.bakes" }, { resolver: dnsOk });
    const fetchSpy = vi.fn();
    const { ai } = scriptedAi({ plan: [{ q: "cakes trend", source: "web", why: "w" }], grounded: () => groundedAnswer("T", "n", "2026-10-14"), cards: (f) => f.map((x) => simpleCard([x.id])) });
    const run = await runResearch({ userId: shop.userId, brandId: shop.brandId, trigger: "manual", now: NOW }, baseDeps(ai, { env: { IDEAS_BUSINESS_DISCOVERY: "on" }, fetch: fetchSpy as never }));
    expect(run!.status).toBe("done");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("competitor websites", () => {
  const comp: Competitor = { id: "c1", brandId: "b", name: "Rival Bakes", website: "https://rival.example.com/", instagramHandle: null, youtubeHandle: null };

  it("reads at most the home page and 2 more, and dates findings by the fetch date when the page shows a date", async () => {
    const pages = ["/", "/a", "/b", "/c", "/d"].map((p) => ({ url: `https://rival.example.com${p}`, title: `P${p}`, metaDescription: "", text: `Page ${p} text` }));
    const loadSite = vi.fn(async () => ({ ...okSite(), pages }));
    const { ai, rec } = scriptedAi({ site: { findings: [{ topic: "Seasonal loaves", note: "They promote loaves." }], page_date: "2026-10-12" } });
    const res = await readCompetitorSite("b", comp, WINDOW, { ai, loadSite });
    expect(res.findings).toHaveLength(1);
    expect(res.findings[0].sources).toEqual([{ url: "https://rival.example.com/", title: "P/", site: "rival.example.com", publishedAt: WINDOW.end, kind: "competitor_site" }]);
    expect(rec.prompts[0]).toBe(COMPETITOR_SITE_SYSTEM);
    expect(rec.prompts[1]).toContain("PAGE 3");
    expect(rec.prompts[1]).not.toContain("PAGE 4");
  });

  it("a page with no date counts as read today; a page showing a date outside the window (or a bad date) is skipped", async () => {
    const { ai: ai0 } = scriptedAi({ site: { findings: [{ topic: "Seasonal loaves", note: "n" }], page_date: "" } });
    const today = await readCompetitorSite("b", comp, WINDOW, { ai: ai0, loadSite: async () => okSite() });
    expect(today.findings).toHaveLength(1);
    expect(today.findings[0].sources[0].publishedAt).toBe(WINDOW.end);
    for (const page_date of ["2025-01-01", "not a date"]) {
      const { ai } = scriptedAi({ site: { findings: [{ topic: "Seasonal loaves", note: "n" }], page_date } });
      const res = await readCompetitorSite("b", comp, WINDOW, { ai, loadSite: async () => okSite() });
      expect(res.findings).toEqual([]);
      expect(res.skipped).toBe("undated");
    }
  });

  it("skips a site the reader could not read (robots.txt, errors) without calling the model", async () => {
    const { ai, rec } = scriptedAi({});
    for (const status of ["blocked", "failed"] as const) {
      const res = await readCompetitorSite("b", comp, WINDOW, { ai, loadSite: async () => ({ ...okSite(), status, pages: [] }) });
      expect(res).toMatchObject({ findings: [], skipped: "not_readable", usd: 0 });
    }
    expect(rec.siteCalls).toBe(0);
    expect((await readCompetitorSite("b", { ...comp, website: null }, WINDOW, { ai, loadSite: async () => okSite() })).skipped).toBe("no_website");
  });
});
