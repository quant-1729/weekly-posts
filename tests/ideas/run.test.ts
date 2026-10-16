import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AiError } from "@/lib/ai/client";
import { BrandAccessError } from "@/lib/brand/current";
import type { MockDb } from "@/lib/db/mock";
import { createCompetitor, saveResearchSettings } from "@/lib/ideas/competitors";
import { runResearch } from "@/lib/ideas";
import { MIN_RUN_USD, estimateRunUsd } from "@/lib/ideas/cost";
import { CARD_TTL_DAYS, MANUAL_RUNS_PER_WEEK, MAX_QUERIES, RESEARCH_WEEKLY_CAP_USD } from "@/lib/ideas/types";
import { NOW, baseDeps, closeDb, dnsOk, groundedAnswer, makeShop, okSite, openDb, rows, scriptedAi, simpleCard, type Shop } from "./helpers";

let db: MockDb;

beforeAll(async () => {
  db = await openDb();
});
afterAll(async () => {
  await closeDb(db);
});

const web = (q: string) => ({ q, source: "web" as const, why: "trend" });
const count = async (table: string, brandId: string) => (await rows<{ n: number }>(db, `select count(*)::int as n from public.${table} where brand_id = $1`, [brandId]))[0].n;
const usage = (brandId: string) => rows<{ kind: string; usd: string; user_id: string | null }>(db, "select kind::text as kind, usd, user_id::text as user_id from public.usage_events where brand_id = $1 order by id", [brandId]);

/** Usage already spent on research this week. */
const spendResearch = (brandId: string, usd: number, at = NOW) =>
  rows(db, "insert into public.usage_events (brand_id, kind, usd, created_at) values ($1, 'research', $2, $3)", [brandId, usd, at.toISOString()]);

describe("a research run, start to finish (fixtures only)", () => {
  let shop: Shop;
  beforeEach(async () => {
    shop = await makeShop(db, { name: `Bakery ${Math.random().toString(36).slice(2, 8)}` });
  });

  it("plans, searches, reads a competitor site, makes cards with ideas, saves them and records one usage event", async () => {
    await createCompetitor(shop.userId, shop.brandId, { name: "Rival Bakes", website: "https://rival.example.com", instagram: "@rival.bakes" }, { resolver: dnsOk });
    await saveResearchSettings(shop.userId, shop.brandId, { focus: "wedding cakes", on: true });
    const { ai, rec } = scriptedAi({
      plan: [web("autumn bakes Leeds"), web("harvest festival Leeds events"), web("Rival Bakes new menu"), { q: "cake decorating", source: "youtube", why: "video" }],
      grounded: (q) => groundedAnswer(`Trend for ${q}`.slice(0, 60), `Note about ${q}.`, "2026-10-12", `https://news.example.com/${encodeURIComponent(q)}`),
      site: { findings: [{ topic: "Rival pushes pumpkin loaves", note: "The competitor promotes seasonal loaves." }], page_date: "2026-10-12" },
      cards: (findings) => findings.slice(0, 3).map((f, i) => simpleCard([f.id], `Card ${i + 1}`, "A post about our autumn bakes with 20% off until 31 Oct, the best in town, inviting people in")),
    });
    const fetchSpy = vi.fn(async () => new Response("{}"));
    const getConnection = vi.fn(async () => null);
    const loadSite = vi.fn(async () => okSite());

    const run = await runResearch({ userId: shop.userId, brandId: shop.brandId, trigger: "manual", now: NOW }, baseDeps(ai, { loadSite, fetch: fetchSpy, getConnection }));

    expect(run).toMatchObject({ status: "done", trigger: "manual", windowStart: "2026-09-15", windowEnd: "2026-10-15", focus: "wedding cakes", error: null });
    expect(run!.queries.map((q) => q.q)).toContain("autumn bakes Leeds");
    // 1 plan + 3 grounded + 1 site read + 1 cards call, from the scripted prices.
    expect(rec).toMatchObject({ planCalls: 1, groundedCalls: 3, siteCalls: 1, cardsCalls: 1 });
    expect(run!.costUsd).toBeCloseTo(0.002 + 3 * 0.039 + 0.005 + 0.01, 3);
    expect(run!.sourcesCount).toBe(4); // 3 web links + the competitor page
    expect(loadSite).toHaveBeenCalledWith("https://rival.example.com/");
    // Business Discovery is off by default and no YouTube key: no network call at all, not even a connection lookup.
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(getConnection).not.toHaveBeenCalled();

    const cards = await rows<{ title: string; sources: { url: string; published_at: string }[]; expires_at: string; created_at: string; confidence: string; status: string }>(
      db,
      "select title, sources, expires_at, created_at, confidence, status from public.trend_cards where brand_id = $1 order by title",
      [shop.brandId],
    );
    expect(cards).toHaveLength(3);
    for (const c of cards) {
      expect(c.sources.length).toBeGreaterThan(0);
      expect(c.sources.every((s) => /^\d{4}-\d{2}-\d{2}$/.test(s.published_at))).toBe(true);
      expect(new Date(c.expires_at).getTime() - new Date(c.created_at).getTime()).toBe(CARD_TTL_DAYS * 86_400_000);
      expect(c.status).toBe("new");
    }
    const ideas = await rows<{ description: string; flags: string[]; post_type: string }>(db, "select description, flags, post_type::text as post_type from public.post_ideas where brand_id = $1", [shop.brandId]);
    expect(ideas).toHaveLength(3);
    for (const i of ideas) {
      expect(i.description).not.toMatch(/\d|best/i);
      expect(i.flags.length).toBeGreaterThanOrEqual(3);
      expect(i.flags[0]).toMatch(/^from research, please check/);
    }

    const events = await usage(shop.brandId);
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe("research");
    expect(Number(events[0].usd)).toBeCloseTo(run!.costUsd, 3);
    expect(events[0].user_id).toBe(shop.userId);
  });

  it("drops findings whose sources have no date or a date outside the window, and makes no cards from them", async () => {
    const { ai } = scriptedAi({
      plan: [web("q one"), web("q two"), web("q three")],
      grounded: (q) => (q === "q one" ? groundedAnswer("Undated", "n", "") : q === "q two" ? groundedAnswer("Old", "n", "2026-06-01") : groundedAnswer("Fine", "n", "2026-10-14")),
      cards: (f) => f.map((x) => simpleCard([x.id])),
    });
    const run = await runResearch({ userId: shop.userId, brandId: shop.brandId, trigger: "manual", now: NOW }, baseDeps(ai));
    expect(run!.status).toBe("done");
    const cards = await rows<{ title: string }>(db, "select title from public.trend_cards where brand_id = $1", [shop.brandId]);
    expect(cards).toHaveLength(1);
    expect(run!.sourcesCount).toBe(1);
  });

  it("never lets a card exist without a dated source (an undated card from the model is dropped)", async () => {
    const { ai } = scriptedAi({
      plan: [web("only one")],
      grounded: () => groundedAnswer("Fine", "n", "2026-10-14"),
      cards: (f) => [simpleCard(["f99"], "Invented"), simpleCard([f[0].id], "Real")],
    });
    await runResearch({ userId: shop.userId, brandId: shop.brandId, trigger: "manual", now: NOW }, baseDeps(ai));
    expect((await rows<{ title: string }>(db, "select title from public.trend_cards where brand_id = $1", [shop.brandId])).map((c) => c.title)).toEqual(["Real"]);
  });

  it("a payment ID never reaches any prompt, whether typed in the focus, a competitor name, the audience or saved for the brand", async () => {
    await rows(db, "insert into public.payment_ids (brand_id, scheme, address, payee_name, status, confirmed_at) values ($1, 'upi', 'secret.shop@oksbi', 'Corner Bakery', 'active', now())", [shop.brandId]);
    await rows(db, "update public.brand_memory set audience = 'Customers who pay to owner.pay@ybl', category = 'bakery, pay secret.shop@oksbi' where brand_id = $1", [shop.brandId]);
    await saveResearchSettings(shop.userId, shop.brandId, { focus: "UPI shop.upi@paytm weekend cakes", on: true });
    await createCompetitor(shop.userId, shop.brandId, { name: "Rival rival.pay@axl", website: "https://rival.example.com" }, { resolver: dnsOk });
    const { ai, rec } = scriptedAi({
      plan: [web("pay secret.shop@oksbi cakes"), web("cakes trend")],
      grounded: () => groundedAnswer("Fine", "n", "2026-10-14"),
      site: { findings: [{ topic: "Rival", note: "pay at rival.pay@axl" }], page_date: "2026-10-12" },
      cards: (f) => f.map((x) => simpleCard([x.id])),
    });
    const site = { ...okSite(), pages: [{ url: "https://rival.example.com/", title: "Pay secret.shop@oksbi now", metaDescription: "", text: "Send money to rival.pay@axl or secret.shop@oksbi" }] };
    await runResearch({ userId: shop.userId, brandId: shop.brandId, trigger: "manual", now: NOW }, baseDeps(ai, { loadSite: async () => site }));
    expect(rec.prompts.length).toBeGreaterThan(5);
    const all = rec.prompts.join("\n");
    for (const id of ["secret.shop@oksbi", "owner.pay@ybl", "shop.upi@paytm", "rival.pay@axl"]) expect(all).not.toContain(id);
    expect(all).toContain("[payment ID removed]");
    // Nor in what was saved.
    const saved = JSON.stringify(await rows(db, "select * from public.trend_cards where brand_id = $1", [shop.brandId])) + JSON.stringify(await rows(db, "select * from public.post_ideas where brand_id = $1", [shop.brandId]));
    expect(saved).not.toMatch(/@oksbi|@ybl|@paytm|@axl/);
  });
});

describe("caps", () => {
  it("over the weekly research cap: status 'capped', no model call, no usage event, no cards", async () => {
    const shop = await makeShop(db);
    await spendResearch(shop.brandId, RESEARCH_WEEKLY_CAP_USD - 0.02);
    const { ai, rec } = scriptedAi({ plan: [web("x")] });
    const run = await runResearch({ userId: shop.userId, brandId: shop.brandId, trigger: "manual", now: NOW }, baseDeps(ai));
    expect(run).toMatchObject({ status: "capped", error: "research_cap", costUsd: 0 });
    expect(rec).toMatchObject({ planCalls: 0, groundedCalls: 0, siteCalls: 0, cardsCalls: 0 });
    expect(rec.prompts).toEqual([]);
    expect((await usage(shop.brandId)).length).toBe(1); // only the one we seeded
    expect(await count("trend_cards", shop.brandId)).toBe(0);
  });

  it("last week's research spend does not count against this week", async () => {
    const shop = await makeShop(db);
    await spendResearch(shop.brandId, RESEARCH_WEEKLY_CAP_USD, new Date("2026-10-08T10:00:00Z"));
    const { ai, rec } = scriptedAi({ plan: [web("x")], grounded: () => groundedAnswer("T", "n", "2026-10-14"), cards: (f) => f.map((x) => simpleCard([x.id])) });
    const run = await runResearch({ userId: shop.userId, brandId: shop.brandId, trigger: "manual", now: NOW }, baseDeps(ai));
    expect(run!.status).toBe("done");
    expect(rec.planCalls).toBe(1);
  });

  it("trims the number of searches to what the week's remaining budget allows, and never spends past the cap", async () => {
    const shop = await makeShop(db);
    await spendResearch(shop.brandId, 0.3); // 0.2 left: planner + cards + about 4 grounded queries
    const { ai, rec } = scriptedAi({
      plan: Array.from({ length: MAX_QUERIES }, (_, i) => web(`query ${i}`)),
      grounded: (q) => groundedAnswer(`T ${q}`, "n", "2026-10-14", `https://s.example.com/${encodeURIComponent(q)}`),
      cards: (f) => f.map((x) => simpleCard([x.id])),
    });
    const run = await runResearch({ userId: shop.userId, brandId: shop.brandId, trigger: "manual", now: NOW }, baseDeps(ai));
    expect(run!.status).toBe("done");
    expect(rec.groundedCalls).toBeLessThan(MAX_QUERIES);
    expect(rec.groundedCalls).toBeGreaterThanOrEqual(1);
    expect(0.3 + run!.costUsd).toBeLessThanOrEqual(RESEARCH_WEEKLY_CAP_USD + 1e-9);
  });

  it("a full run's estimate is under the $0.50 approval limit and the weekly research cap", () => {
    expect(estimateRunUsd()).toBeLessThan(0.5);
    expect(estimateRunUsd({ sites: 5 })).toBeLessThan(RESEARCH_WEEKLY_CAP_USD);
    expect(MIN_RUN_USD).toBeLessThan(0.1);
  });

  it("the daily AI cap stops a run; post-making spend does not (research has its own budget)", async () => {
    const daily = await makeShop(db);
    await rows(db, "update public.brands set daily_generation_cap = 1 where id = $1", [daily.brandId]);
    await rows(db, "insert into public.usage_events (brand_id, kind, usd, created_at) values ($1, 'rewrite', 0, $2)", [daily.brandId, NOW.toISOString()]);
    const { ai: ai1, rec: rec1 } = scriptedAi({ plan: [web("x")] });
    expect(await runResearch({ userId: daily.userId, brandId: daily.brandId, trigger: "manual", now: NOW }, baseDeps(ai1))).toMatchObject({ status: "capped", error: "daily_cap" });
    expect(rec1.planCalls).toBe(0);

    const weekly = await makeShop(db);
    await rows(db, "insert into public.usage_events (brand_id, kind, usd, created_at) values ($1, 'weekly_batch', 0.48, $2)", [weekly.brandId, NOW.toISOString()]);
    const { ai: ai2, rec: rec2 } = scriptedAi({ plan: [web("x")] });
    expect((await runResearch({ userId: weekly.userId, brandId: weekly.brandId, trigger: "manual", now: NOW }, baseDeps(ai2)))!.status).not.toBe("capped");
    expect(rec2.planCalls).toBe(1);
  });

  it("research and Brand Face spend are left out of the post-making weekly total and the daily call count", async () => {
    const shop = await makeShop(db);
    await rows(db, "insert into public.usage_events (brand_id, kind, usd, created_at) values ($1, 'research', 0.45, $2), ($1, 'face_create', 1.2, $2), ($1, 'post_copy', 0.02, $2)", [shop.brandId, NOW.toISOString()]);
    const { weekCost } = await import("@/lib/usage/weekly");
    const { weekStartFor } = await import("@/lib/occasions/dates");
    expect(await weekCost(shop.brandId, weekStartFor(NOW, "Asia/Kolkata"), "Asia/Kolkata")).toBeCloseTo(0.02, 6);
    const { countUsageToday } = await import("@/lib/usage");
    expect(await countUsageToday(shop.brandId, NOW)).toBe(2); // research + post_copy; face_create not counted
  });

  it(`"Research now" is limited to ${MANUAL_RUNS_PER_WEEK} a week`, async () => {
    const shop = await makeShop(db);
    const { ai, rec } = scriptedAi({ plan: [web("x")], grounded: () => groundedAnswer("T", "n", "2026-10-14"), cards: (f) => f.map((x) => simpleCard([x.id])), usd: { grounded: 0.01, plan: 0.001, cards: 0.001 } });
    const go = () => runResearch({ userId: shop.userId, brandId: shop.brandId, trigger: "manual", now: NOW }, baseDeps(ai));
    expect((await go())!.status).toBe("done");
    expect((await go())!.status).toBe("done");
    const third = await go();
    expect(third).toMatchObject({ status: "capped", error: "manual_limit" });
    expect(rec.planCalls).toBe(2);
  });
});

describe("who may run it, and the weekly switch", () => {
  it("a user from another brand cannot start a run; neither can a caller with no identity", async () => {
    const a = await makeShop(db);
    const b = await makeShop(db);
    const { ai, rec } = scriptedAi({ plan: [web("x")] });
    await expect(runResearch({ userId: b.userId, brandId: a.brandId, trigger: "manual", now: NOW }, baseDeps(ai))).rejects.toBeInstanceOf(BrandAccessError);
    await expect(runResearch({ brandId: a.brandId, trigger: "manual", now: NOW }, baseDeps(ai))).rejects.toBeInstanceOf(BrandAccessError);
    expect(rec.planCalls).toBe(0);
    expect(await count("research_runs", a.brandId)).toBe(0);
  });

  it("the scheduled run skips a brand that switched research off, and runs once per week", async () => {
    const shop = await makeShop(db);
    await saveResearchSettings(shop.userId, shop.brandId, { focus: "", on: false });
    const { ai, rec } = scriptedAi({ plan: [web("x")], grounded: () => groundedAnswer("T", "n", "2026-10-14"), cards: (f) => f.map((x) => simpleCard([x.id])) });
    expect(await runResearch({ service: true, brandId: shop.brandId, trigger: "weekly", now: NOW }, baseDeps(ai))).toBeNull();
    expect(rec.planCalls).toBe(0);

    await saveResearchSettings(shop.userId, shop.brandId, { focus: "", on: true });
    const first = await runResearch({ service: true, brandId: shop.brandId, trigger: "weekly", now: NOW }, baseDeps(ai));
    expect(first!.status).toBe("done");
    expect((await usage(shop.brandId))[0].user_id).toBeNull();
    const again = await runResearch({ service: true, brandId: shop.brandId, trigger: "weekly", now: NOW }, baseDeps(ai));
    expect(again!.id).toBe(first!.id);
    expect(rec.planCalls).toBe(1);
  });
});

describe("failures", () => {
  it("every search failing marks the run failed; the cost of what was spent is still recorded", async () => {
    const shop = await makeShop(db);
    const { ai } = scriptedAi({ plan: [web("a"), web("b")], grounded: () => new Error("boom") });
    const run = await runResearch({ userId: shop.userId, brandId: shop.brandId, trigger: "manual", now: NOW }, baseDeps(ai));
    expect(run!.status).toBe("failed");
    expect(run!.error).toBeTruthy();
    expect(await count("trend_cards", shop.brandId)).toBe(0);
    expect((await usage(shop.brandId)).map((e) => e.kind)).toEqual(["research"]);
  });

  it("a planner failure that already cost money is recorded", async () => {
    const shop = await makeShop(db);
    const { ai } = scriptedAi({});
    const failing = {
      ...ai,
      json: vi.fn(async () => {
        throw new AiError("invalid_output", "bad", [{ model: "m", ms: 1, inputTokens: 1, outputTokens: 1, usd: 0.004 }]);
      }),
    } as unknown as typeof ai;
    const run = await runResearch({ userId: shop.userId, brandId: shop.brandId, trigger: "manual", now: NOW }, baseDeps(failing));
    expect(run).toMatchObject({ status: "failed", error: "ai_invalid_output" });
    expect(run!.costUsd).toBeCloseTo(0.004, 4);
    expect(Number((await usage(shop.brandId))[0].usd)).toBeCloseTo(0.004, 4);
  });

  it("a source that fails is skipped and the run still finishes with the rest", async () => {
    const shop = await makeShop(db);
    await createCompetitor(shop.userId, shop.brandId, { name: "Rival", website: "https://rival.example.com" }, { resolver: dnsOk });
    const { ai } = scriptedAi({ plan: [web("a")], grounded: () => groundedAnswer("T", "n", "2026-10-14"), cards: (f) => f.map((x) => simpleCard([x.id])) });
    const run = await runResearch({ userId: shop.userId, brandId: shop.brandId, trigger: "manual", now: NOW }, baseDeps(ai, { loadSite: async () => { throw new Error("site down"); } }));
    expect(run!.status).toBe("done");
    expect(await count("trend_cards", shop.brandId)).toBe(1);
  });
});
