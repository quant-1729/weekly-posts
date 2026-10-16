import { describe, expect, it } from "vitest";
import { validateCards, screenIdea, confidenceFor } from "@/lib/ideas/cards";
import type { ScoredFinding } from "@/lib/ideas/findings";
import { FLAG_PREFIX, stripClaims } from "@/lib/ideas/strip";
import type { TrendSource } from "@/lib/ideas/types";
import { WINDOW, simpleCard } from "./helpers";

const src = (url: string, date: string): TrendSource => ({ url, title: "t", site: new URL(url).host, publishedAt: date, kind: "web" });
const finding = (id: string, sources: TrendSource[], extra: Partial<ScoredFinding> = {}): ScoredFinding => ({ id, topic: `Topic ${id}`, note: "n", kind: "trend", velocity: null, score: 50, sources, ...extra });
const o = { window: WINDOW, regulated: "none" as const, wordsToAvoid: [] as string[] };

describe("removing research claims from idea text", () => {
  it('"20% off cakes till 31 Oct, best in town" loses its numbers and claims, with a flag for each', () => {
    const r = stripClaims("20% off cakes till 31 Oct, best in town");
    expect(r.text).not.toMatch(/\d/);
    expect(r.text.toLowerCase()).not.toContain("best");
    expect(r.text.toLowerCase()).not.toContain("oct");
    expect(r.text).toContain("cakes");
    expect(r.flags.length).toBeGreaterThanOrEqual(3);
    expect(r.flags.every((x) => x.startsWith(FLAG_PREFIX))).toBe(true);
    expect(r.flags.join(" ")).toMatch(/percentage/);
    expect(r.flags.join(" ")).toMatch(/date/);
    expect(r.flags.join(" ")).toMatch(/claim/);
  });

  const cases: [string, RegExp][] = [
    ["Loaves from £4.50 each", /£|4\.50/],
    ["Only $5 for a slice", /\$|5/],
    ["Pay Rs 500 and get a box", /500/],
    ["A 4.8 star rated shop", /4\.8|star/i],
    ["Rated 4.5/5 by customers", /4\.5/],
    ["Over 10,000 happy customers", /10,000/],
    ["Our cakes are guaranteed fresh", /guarantee/i],
    ["The cheapest cakes around", /cheapest/i],
    ["We are No.1 for cupcakes", /no\.?\s?1/i],
    ["Open until 2026-10-31", /2026/],
    ["Sale on 31/10/2026", /31/],
    ["Join us on October 31st for tastings", /october|31/i],
    ["Buy one get one free on pies", /buy one/i],
    ["Call 0113 496 0000 to order", /0113|496/],
    ["Visit www.example.com for details", /example/],
    ["Three flavours to try", /three/i],
  ];
  for (const [text, bad] of cases) {
    it(`removes the detail from "${text}"`, () => {
      const r = stripClaims(text);
      expect(r.text).not.toMatch(bad);
      expect(r.flags.length).toBeGreaterThan(0);
    });
  }

  it("leaves a clean description alone and adds no flags", () => {
    const r = stripClaims("A post about our autumn bakes, inviting people to come in and try them. [your offer]");
    expect(r.text).toBe("A post about our autumn bakes, inviting people to come in and try them. [your offer]");
    expect(r.flags).toEqual([]);
  });

  it("does not turn 'one' (an article) or a festival name into a removal", () => {
    expect(stripClaims("A post for the one day everyone visits at Diwali").flags).toEqual([]);
  });
});

describe("screening an idea (strip, then the deterministic guardrail)", () => {
  it("keeps a description after removing details, with the flags", () => {
    const r = screenIdea("A post about our Diwali boxes with 20% off until 31 Oct, the best in town, for early orders", { regulated: "none", wordsToAvoid: [] });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.text).not.toMatch(/\d|best/i);
      expect(r.flags.length).toBeGreaterThanOrEqual(3);
    }
  });

  it("drops an idea that uses a word the owner avoids", () => {
    expect(screenIdea("A post about our cheap and cheerful lunches for the office", { regulated: "none", wordsToAvoid: ["cheerful"] })).toEqual({ ok: false, reason: "avoid_word" });
  });

  it("drops an outcome promise for a regulated brand and removes the phrase for others", () => {
    const text = "A post about our new service, a permanent solution for tired legs, for walk-in customers";
    expect(screenIdea(text, { regulated: "health", wordsToAvoid: [] })).toEqual({ ok: false, reason: "regulated_claim" });
    const plain = screenIdea(text, { regulated: "none", wordsToAvoid: [] });
    expect(plain.ok).toBe(true);
    if (plain.ok) {
      expect(plain.text.toLowerCase()).not.toContain("permanent solution");
      expect(plain.flags.join(" ")).toMatch(/claim/);
    }
  });

  it("drops a description that is nothing once the details are gone, and one holding a payment ID", () => {
    expect(screenIdea("20% off £5 till 31 Oct", { regulated: "none", wordsToAvoid: [] })).toMatchObject({ ok: false, reason: "too_short" });
    expect(screenIdea("A post asking people to pay owner@okbank for the cakes please", { regulated: "none", wordsToAvoid: [] })).toEqual({ ok: false, reason: "payment_id" });
  });
});

describe("the card reviewer", () => {
  const good = finding("f1", [src("https://a.example.com/1", "2026-10-10")]);

  it("keeps a card that cites a dated source, with the sources from the findings", () => {
    const out = validateCards([simpleCard(["f1"])], [good], o);
    expect(out.cards).toHaveLength(1);
    expect(out.cards[0].sources).toEqual([good.sources[0]]);
    expect(out.cards[0].ideas[0]).toMatchObject({ postType: "announcement", format: "single" });
  });

  it("drops a card whose findings have no dated source inside the window", () => {
    const undated = finding("f1", [{ ...src("https://a.example.com/1", "2026-10-10"), publishedAt: "" }]);
    const old = finding("f2", [src("https://a.example.com/2", "2026-07-01")]);
    const out = validateCards([simpleCard(["f1"]), simpleCard(["f2"])], [undated, old], o);
    expect(out.cards).toEqual([]);
    expect(out.droppedCards).toEqual(["no_dated_source", "no_dated_source"]);
  });

  it("drops a card that cites no known finding, or none at all", () => {
    expect(validateCards([simpleCard(["f99"]), simpleCard([])], [good], o).droppedCards).toEqual(["unknown_findings", "unknown_findings"]);
  });

  it("drops a card whose title, summary or why is empty or longer than the database allows", () => {
    const base = simpleCard(["f1"]);
    const out = validateCards(
      [{ ...base, title: "" }, { ...base, title: "x".repeat(121) }, { ...base, summary: "x".repeat(601) }, { ...base, why_it_matters: "x".repeat(401) }, { ...base, title: "x".repeat(120) }],
      [good],
      o,
    );
    expect(out.droppedCards).toEqual(["bad_title", "bad_title", "bad_summary", "bad_why"]);
    expect(out.cards).toHaveLength(1);
  });

  it("drops ideas with a post type that does not exist, and a card left with no idea", () => {
    const base = simpleCard(["f1"]);
    const out = validateCards([{ ...base, ideas: [{ ...base.ideas[0], post_type: "giveaway" }] }], [good], o);
    expect(out.cards).toEqual([]);
    expect(out.droppedIdeas).toEqual(["bad_post_type"]);
    expect(out.droppedCards).toEqual(["no_ideas"]);
  });

  it("uses a finding in only one card", () => {
    const out = validateCards([simpleCard(["f1"], "First"), simpleCard(["f1"], "Second")], [good], o);
    expect(out.cards.map((c) => c.title)).toEqual(["First"]);
    expect(out.droppedCards).toEqual(["duplicate_findings"]);
  });

  it("strips the idea descriptions inside a card and keeps the flags on the idea", () => {
    const base = simpleCard(["f1"]);
    const out = validateCards([{ ...base, ideas: [{ ...base.ideas[0], description: "20% off cakes till 31 Oct, best in town, for everyone who walks in" }] }], [good], o);
    expect(out.cards[0].ideas[0].description).not.toMatch(/\d|best/i);
    expect(out.cards[0].ideas[0].flags.length).toBeGreaterThanOrEqual(3);
  });

  it("keeps at most MAX_CARDS and at most IDEAS_PER_CARD ideas, best score first", () => {
    const findings = Array.from({ length: 8 }, (_, i) => finding(`f${i + 1}`, [src(`https://s${i}.example.com/1`, "2026-10-10")], { score: i }));
    const cards = findings.map((x) => ({ ...simpleCard([x.id], `Card ${x.id}`), ideas: Array.from({ length: 5 }, () => simpleCard([x.id]).ideas[0]) }));
    const out = validateCards(cards, findings, o);
    expect(out.cards).toHaveLength(5);
    expect(out.cards[0].title).toBe("Card f8");
    expect(out.cards[0].ideas).toHaveLength(3);
  });

  it("only lets a card be 'high' with two independent sources", () => {
    const one = [src("https://a.example.com/1", "2026-10-10")];
    const two = [...one, src("https://b.example.com/1", "2026-10-11")];
    const sameSite = [...one, src("https://a.example.com/2", "2026-10-11")];
    expect(confidenceFor("high", one)).toBe("medium");
    expect(confidenceFor("high", sameSite)).toBe("medium");
    expect(confidenceFor("high", two)).toBe("high");
    expect(confidenceFor("nonsense", two)).toBe("low");
  });

  it("makes a card of competitor findings a competitor card", () => {
    const comp = finding("f1", [src("https://a.example.com/1", "2026-10-10")], { kind: "competitor" });
    expect(validateCards([simpleCard(["f1"])], [comp], o).cards[0].kind).toBe("competitor");
  });
});
