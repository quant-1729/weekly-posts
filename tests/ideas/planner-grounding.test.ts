import { describe, expect, it } from "vitest";
import type { IdeasBrandContext } from "@/lib/ai/prompts/ideas";
import { IDEAS_PLAN_SYSTEM } from "@/lib/ai/prompts/ideas";
import { GROUNDED_REQUEST_USD } from "@/lib/ai/client";
import { cleanQueries, planQueries } from "@/lib/ideas/planner";
import { SOURCE_DATES_REQUEST, extractJsonObject, kindForQuery, parseGroundedAnswer, runGroundedQuery, siteOf } from "@/lib/ideas/search";
import { MAX_QUERIES } from "@/lib/ideas/types";
import { WINDOW, groundedAnswer, scriptedAi } from "./helpers";

const brand: IdeasBrandContext = {
  name: "Corner Bakery",
  category: "bakery and cakes",
  sells: "bakery and cakes",
  city: "Leeds",
  country: "United Kingdom",
  language: "en",
  audience: "Families",
  regulated: "none",
  competitors: [{ name: "Rival Bakes", website: null, instagram: null }],
  focus: null,
};

const q = (text: string, source: "web" | "youtube" = "web") => ({ q: text, source, why: "because" });

describe("the search planner", () => {
  it("keeps at most MAX_QUERIES, de-duplicated, with long queries cut to 12 words", () => {
    const raw = [q("bakery trends Leeds"), q("Bakery trends leeds"), ...Array.from({ length: 12 }, (_, i) => q(`query number ${i}`)), q("one two three four five six seven eight nine ten eleven twelve thirteen fourteen")];
    const out = cleanQueries(raw, { max: MAX_QUERIES, regulated: "none" });
    expect(out).toHaveLength(MAX_QUERIES);
    expect(out.filter((x) => x.q.toLowerCase() === "bakery trends leeds")).toHaveLength(1);
    expect(cleanQueries([raw[raw.length - 1]], { max: 5, regulated: "none" })[0].q.split(" ")).toHaveLength(12);
  });

  it("allows 'reddit' in two queries and video queries in two", () => {
    const raw = [q("a reddit one"), q("b reddit two"), q("c reddit three"), q("v one", "youtube"), q("v two", "youtube"), q("v three", "youtube")];
    const out = cleanQueries(raw, { max: 8, regulated: "none" });
    expect(out.map((x) => x.q)).toEqual(["a reddit one", "b reddit two", "v one", "v two"]);
  });

  it("drops links, email addresses and payment IDs from searches", () => {
    const out = cleanQueries([q("see https://x.example.com"), q("mail me@example.com"), q("pay owner@okbank please"), q("autumn cakes")], { max: 8, regulated: "none" });
    expect(out.map((x) => x.q)).toEqual(["autumn cakes"]);
  });

  it("never searches for cures, treatments, returns or legal outcomes for a regulated brand", () => {
    const raw = [q("best treatment for back pain"), q("miracle cure clinic"), q("high returns investment tips"), q("how to win a case fast"), q("clinic opening hours trends")];
    expect(cleanQueries(raw, { max: 8, regulated: "health" }).map((x) => x.q)).toEqual(["clinic opening hours trends"]);
    expect(cleanQueries(raw, { max: 8, regulated: "none" })).toHaveLength(5);
  });

  it("plans through the model with the planner prompt and returns the cleaned list and its cost", async () => {
    const { ai, rec } = scriptedAi({ plan: [q("autumn bakes Leeds"), q("harvest festival Leeds"), q("autumn bakes Leeds")], usd: { plan: 0.003 } });
    const plan = await planQueries(brand, WINDOW, { maxQueries: 6, brandId: "b" }, ai);
    expect(plan.queries.map((x) => x.q)).toEqual(["autumn bakes Leeds", "harvest festival Leeds"]);
    expect(plan.usd).toBeCloseTo(0.003);
    expect(rec.prompts[0]).toBe(IDEAS_PLAN_SYSTEM);
    expect(rec.prompts[1]).toContain(`WINDOW: ${WINDOW.start} to ${WINDOW.end}`);
  });
});

describe("the date window", () => {
  it("is 30 days back from today in the brand's time zone", () => {
    expect(WINDOW).toEqual({ start: "2026-09-15", end: "2026-10-15" });
  });
});

describe("reading a grounded answer", () => {
  it("builds sources from the grounding metadata (link, title, site) with the model's per-source date", () => {
    const g = {
      text: "```json\n" + JSON.stringify({ findings: [{ topic: "Pumpkin loaves", note: "Pumpkin loaves are everywhere.", source_indexes: [0, 1] }], source_dates: [{ index: 0, date: "2026-10-10" }, { index: 1, date: "2026-10-01" }] }) + "\n```",
      chunks: [
        { uri: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc", title: "foodnews.example.com", domain: "" },
        { uri: "https://blog.example.org/pumpkin", title: "Pumpkin season", domain: "blog.example.org" },
      ],
      supports: [],
      stats: null,
    };
    const { findings, drops } = parseGroundedAnswer(g, WINDOW, "trend");
    expect(drops).toEqual({ undated: 0, outOfWindow: 0, findings: 0 });
    expect(findings).toHaveLength(1);
    expect(findings[0].sources).toEqual([
      { url: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc", title: "foodnews.example.com", site: "foodnews.example.com", publishedAt: "2026-10-10", kind: "web" },
      { url: "https://blog.example.org/pumpkin", title: "Pumpkin season", site: "blog.example.org", publishedAt: "2026-10-01", kind: "web" },
    ]);
  });

  it("drops a source with no date, a malformed date or a date outside the window; a finding with no source left goes too", () => {
    const g = {
      text: JSON.stringify({
        findings: [
          { topic: "No date", note: "n1", source_indexes: [0] },
          { topic: "Too old", note: "n2", source_indexes: [1] },
          { topic: "In the future", note: "n3", source_indexes: [2] },
          { topic: "Vague date", note: "n4", source_indexes: [3] },
          { topic: "Good one", note: "n5", source_indexes: [4, 0] },
        ],
        source_dates: [{ index: 1, date: "2026-08-01" }, { index: 2, date: "2026-11-30" }, { index: 3, date: "October" }, { index: 4, date: WINDOW.start }],
      }),
      chunks: Array.from({ length: 5 }, (_, i) => ({ uri: `https://s${i}.example.com/x`, title: `s${i}.example.com`, domain: `s${i}.example.com` })),
      supports: [],
      stats: null,
    };
    const { findings, drops } = parseGroundedAnswer(g, WINDOW, "trend");
    expect(findings.map((f) => f.topic)).toEqual(["Good one"]);
    expect(findings[0].sources.map((s) => s.url)).toEqual(["https://s4.example.com/x"]); // the undated index 0 is not kept
    expect(drops.findings).toBe(4);
    expect(drops.outOfWindow).toBe(2);
    expect(drops.undated).toBe(2);
  });

  it("drops a source whose link is not a web link", () => {
    const g = { text: JSON.stringify({ findings: [{ topic: "T", note: "n", source_indexes: [0] }], source_dates: [{ index: 0, date: "2026-10-10" }] }), chunks: [{ uri: "javascript:alert(1)", title: "x", domain: "" }], supports: [], stats: null };
    expect(parseGroundedAnswer(g, WINDOW, "trend").findings).toEqual([]);
  });

  it("falls back to the grounding supports when the model's indexes are missing, and to nothing when they say nothing", () => {
    const base = {
      chunks: [{ uri: "https://a.example.com/1", title: "a.example.com", domain: "a.example.com" }],
      stats: null,
    };
    const answer = JSON.stringify({ findings: [{ topic: "Pumpkin loaves trending", note: "Pumpkin loaves trending in bakeries", source_indexes: [] }], source_dates: [{ index: 0, date: "2026-10-10" }] });
    const withSupport = { ...base, text: answer, supports: [{ text: "Pumpkin loaves are trending in bakeries this autumn", chunkIndices: [0] }] };
    expect(parseGroundedAnswer(withSupport, WINDOW, "trend").findings).toHaveLength(1);
    expect(parseGroundedAnswer({ ...base, text: answer, supports: [] }, WINDOW, "trend").findings).toHaveLength(0);
  });

  it("returns nothing for text that is not the expected JSON", () => {
    for (const text of ["", "sorry, no results", "{ not json", JSON.stringify({ findings: "x" })]) {
      expect(parseGroundedAnswer({ text, chunks: [], supports: [], stats: null }, WINDOW, "trend").findings).toEqual([]);
    }
    expect(extractJsonObject('Here: {"a": 1} thanks')).toEqual({ a: 1 });
  });

  it("names the site from the domain, else a domain-like title, else the link host, never Google's redirect host", () => {
    expect(siteOf({ uri: "https://x.example.com/p", title: "A headline", domain: "WWW.Example.com" })).toBe("example.com");
    expect(siteOf({ uri: "https://vertexaisearch.cloud.google.com/r/1", title: "news.example.com", domain: "" })).toBe("news.example.com");
    expect(siteOf({ uri: "https://www.shop.example.com/p", title: "A headline", domain: "" })).toBe("shop.example.com");
    expect(siteOf({ uri: "https://vertexaisearch.cloud.google.com/r/1", title: "A headline", domain: "" })).toBe("web");
  });

  it("gives a finding the kind its query implies", () => {
    expect(kindForQuery({ q: "Rival Bakes new menu", source: "web", why: "competitor news" }, ["Rival Bakes"])).toBe("competitor");
    expect(kindForQuery({ q: "diwali events Leeds", source: "web", why: "festivals" }, [])).toBe("seasonal");
    expect(kindForQuery({ q: "sourdough trends", source: "web", why: "what is trending" }, [])).toBe("trend");
  });

  it("a grounded call asks for the source dates, uses the search prompt and costs the grounding price on top of tokens", async () => {
    const { ai, rec } = scriptedAi({ grounded: () => groundedAnswer("Pumpkin loaves", "Loaves are trending.") });
    const res = await runGroundedQuery(brand, { q: "pumpkin loaves", source: "web", why: "w" }, WINDOW, { brandId: "b", kind: "trend" }, ai);
    expect(res.findings).toHaveLength(1);
    expect(rec.prompts[1]).toContain(SOURCE_DATES_REQUEST);
    expect(rec.prompts[1]).toContain("SEARCH: pumpkin loaves");
    expect(res.usd).toBeGreaterThanOrEqual(GROUNDED_REQUEST_USD);
  });

  it("keeps the grounded price in one constant", () => {
    expect(GROUNDED_REQUEST_USD).toBe(0.035);
  });
});
