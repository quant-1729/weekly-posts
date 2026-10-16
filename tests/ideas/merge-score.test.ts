import { describe, expect, it } from "vitest";
import type { GatheredFinding } from "@/lib/ideas/findings";
import { brandKeywords, mergeFindings, rankFindings, scoreFinding } from "@/lib/ideas/merge";
import type { TrendSource } from "@/lib/ideas/types";
import { WINDOW } from "./helpers";

const src = (url: string, date: string, extra: Partial<TrendSource> = {}): TrendSource => ({ url, title: "t", site: new URL(url).host, publishedAt: date, kind: "web", ...extra });
const f = (topic: string, note: string, sources: TrendSource[], extra: Partial<GatheredFinding> = {}): GatheredFinding => ({ topic, note, sources, kind: "trend", velocity: null, ...extra });
const ctx = { window: WINDOW, keywords: brandKeywords({ sells: "bakery and cakes", category: "bakery and cakes", city: "Leeds", focus: null }) };

describe("merging findings", () => {
  it("joins findings about the same story and their sources, once per link", () => {
    const merged = mergeFindings([
      f("Pumpkin loaves trending", "A", [src("https://a.example.com/1", "2026-10-10")]),
      f("Trending pumpkin loaves", "B", [src("https://b.example.com/1", "2026-10-12"), src("https://a.example.com/1", "2026-10-10")]),
      f("Harvest festival in Leeds", "C", [src("https://c.example.com/1", "2026-10-11")]),
    ]);
    expect(merged).toHaveLength(2);
    const pumpkin = merged.find((m) => m.topic.toLowerCase().includes("pumpkin"))!;
    expect(pumpkin.sources.map((s) => s.url).sort()).toEqual(["https://a.example.com/1", "https://b.example.com/1"]);
  });

  it("does not join different stories, and a story with a trend source is a trend", () => {
    expect(mergeFindings([f("Vegan cakes demand", "A", [src("https://a.example.com/1", "2026-10-10")]), f("Vegan sausage rolls", "B", [src("https://b.example.com/1", "2026-10-10")])])).toHaveLength(2);
    const merged = mergeFindings([
      f("Rival launches pumpkin loaf", "A", [src("https://a.example.com/1", "2026-10-10")], { kind: "competitor" }),
      f("Pumpkin loaf launches everywhere", "B", [src("https://b.example.com/1", "2026-10-11")], { kind: "trend" }),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].kind).toBe("trend");
  });

  it("is deterministic: any input order gives the same ids, scores and order", () => {
    const list = [
      f("Pumpkin loaves trending", "A", [src("https://a.example.com/1", "2026-10-10")]),
      f("Trending pumpkin loaves", "B", [src("https://b.example.com/1", "2026-10-12")]),
      f("Harvest festival in Leeds", "C", [src("https://c.example.com/1", "2026-10-11")]),
      f("Vegan cakes demand", "D", [src("https://d.example.com/1", "2026-10-01", { engagement: { likes: 500, comments: 40 } })]),
      f("Sourdough starter kits", "E", [src("https://e.example.com/1", "2026-09-20")]),
    ];
    const a = rankFindings(list, ctx);
    const b = rankFindings([...list].reverse(), ctx);
    const c = rankFindings([list[2], list[4], list[0], list[3], list[1]], ctx);
    expect(b).toEqual(a);
    expect(c).toEqual(a);
    expect(a.map((x) => x.id)).toEqual(["f1", "f2", "f3", "f4"]);
    expect([...a].sort((x, y) => y.score - x.score).map((x) => x.id)).toEqual(a.map((x) => x.id));
  });
});

describe("scoring", () => {
  it("stays between 0 and 100", () => {
    const best = f("Bakery cakes Leeds", "bakery and cakes in Leeds", [src("https://a.example.com/1", WINDOW.end, { engagement: { likes: 1e7, comments: 1e6, views: 1e9 } })], { velocity: 5000 });
    const worst = f("Unrelated thing", "nothing", [src("https://a.example.com/1", WINDOW.start)]);
    const hi = scoreFinding(best, ctx);
    const lo = scoreFinding(worst, ctx);
    expect(hi).toBeLessThanOrEqual(100);
    expect(hi).toBeGreaterThan(90);
    expect(lo).toBeGreaterThanOrEqual(0);
    expect(lo).toBeLessThan(5);
  });

  it("prefers newer sources", () => {
    const fresh = f("Bakery trend", "bakery", [src("https://a.example.com/1", "2026-10-14")]);
    const stale = f("Bakery trend", "bakery", [src("https://a.example.com/1", "2026-09-20")]);
    expect(scoreFinding(fresh, ctx)).toBeGreaterThan(scoreFinding(stale, ctx));
  });

  it("adds velocity only when there is a snapshot to compare with", () => {
    const none = f("Bakery trend", "bakery", [src("https://a.example.com/1", "2026-10-10")]);
    const rising = { ...none, velocity: 60 };
    const falling = { ...none, velocity: -30 };
    expect(scoreFinding(rising, ctx)).toBeGreaterThan(scoreFinding(none, ctx));
    expect(scoreFinding(falling, ctx)).toBe(scoreFinding(none, ctx));
  });

  it("scales engagement on a log scale, and ignores it below the relevance floor", () => {
    const base = f("Bakery cakes", "bakery cakes", [src("https://a.example.com/1", "2026-10-10", { engagement: { likes: 10 } })]);
    const mid = f("Bakery cakes", "bakery cakes", [src("https://a.example.com/1", "2026-10-10", { engagement: { likes: 1000 } })]);
    const big = f("Bakery cakes", "bakery cakes", [src("https://a.example.com/1", "2026-10-10", { engagement: { likes: 100000 } })]);
    const d1 = scoreFinding(mid, ctx) - scoreFinding(base, ctx);
    const d2 = scoreFinding(big, ctx) - scoreFinding(mid, ctx);
    expect(d1).toBeGreaterThan(0);
    expect(d2).toBeGreaterThan(0);
    expect(d2).toBeLessThan(d1 * 1.5); // a hundred times more likes does not give a hundred times more score
    // A viral but unrelated finding gets no engagement credit.
    const viralOffTopic = f("Celebrity news", "gossip", [src("https://a.example.com/1", "2026-10-10", { engagement: { views: 1e8 } })]);
    const quietOffTopic = f("Celebrity news", "gossip", [src("https://a.example.com/1", "2026-10-10")]);
    expect(scoreFinding(viralOffTopic, ctx)).toBe(scoreFinding(quietOffTopic, ctx));
  });

  it("gives a finding that fits what the brand sells a higher score", () => {
    const fits = f("Cakes trend", "cakes and bakery", [src("https://a.example.com/1", "2026-10-10")]);
    const other = f("Plumbing trend", "pipes", [src("https://a.example.com/1", "2026-10-10")]);
    expect(scoreFinding(fits, ctx)).toBeGreaterThan(scoreFinding(other, ctx));
  });

  it("keeps only the best findings when there are many", () => {
    const names = ["sourdough", "pretzels", "croissants", "macarons", "brownies", "eclairs", "scones", "muffins", "bagels", "donuts"];
    const many = names.map((n, i) => f(`${n} craze`, `note ${i}`, [src(`https://s${i}.example.com/1`, "2026-10-10")]));
    expect(rankFindings(many, ctx, 5)).toHaveLength(5);
  });
});
