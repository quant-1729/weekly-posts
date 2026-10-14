import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PostCopy } from "@/lib/ai/schemas-v3";
import { loadCreateBrand } from "@/lib/create/brand";
import { contentFromBrief, repeatsLines, significantWords, stripDatePhrase, wordOverlap } from "@/lib/create/content";
import { validateCopy } from "@/lib/create/copy";
import type { CreateBrand, DesignWords } from "@/lib/create/types";
import type { MockDb } from "@/lib/db/mock";
import { createUsp } from "@/lib/usps/service";
import { closeDb, openDb } from "../../helpers/details";
import { cleanup, makeBakery, readyBrief, type Bakery } from "./helpers";

let db: MockDb;
let b: Bakery;
let brand: CreateBrand;
let suit: string; // the live example: "15% off all suit stitching till 31 October"
let delivery: string;

beforeAll(async () => {
  db = await openDb();
  b = await makeBakery(db);
  brand = await loadCreateBrand(b.userId, b.brandId);
  suit = (await createUsp(b.userId, b.brandId, { kind: "discount", title: "15% off all suit stitching till 31 October", details: { percent: 15, on: "suit stitching" } })).id;
  delivery = (await createUsp(b.userId, b.brandId, { kind: "delivery", title: "Free pickup and delivery until 31 Oct", details: { promise: "Free pickup and delivery", area: "Indore" } })).id;
});
afterAll(async () => {
  cleanup(b);
  await closeDb(db);
});

const live: DesignWords = { headline: "15% Off All Suit Stitching", subline: "Special offer valid till 31 October.", ctaText: "Visit us", bubble: "" };

describe("the live example: the same fact four times on one design", () => {
  it("says the offer once: headline, the date in the offer line, no repeated main point, no repeated subline", async () => {
    const brief = await readyBrief(b, { primaryUspId: suit, secondaryUspIds: [delivery], endsOn: "2026-10-31" });
    const c = await contentFromBrief(brief, brand, live, { postCode: "abc1234" });
    expect(c.headline).toBe("15% Off All Suit Stitching");
    expect(c.primary).toBeNull(); // the headline already carries it
    expect(c.offerLine).toBe("Till 31 Oct");
    expect(c.subline).toBe("");
    // The secondary point keeps its words, minus the date the offer line shows.
    expect(c.secondary).toEqual([{ kind: "delivery", text: "Free pickup and delivery" }]);
  });

  it("keeps the main point when the headline says something else, but without its date", async () => {
    const brief = await readyBrief(b, { primaryUspId: suit, endsOn: "2026-10-31" });
    const c = await contentFromBrief(brief, brand, { ...live, headline: "Festival wardrobe sorted", subline: "Tailored to your measurements" }, { postCode: "abc1234" });
    expect(c.primary).toEqual({ kind: "discount", text: "15% off all suit stitching" });
    expect(c.subline).toBe("Tailored to your measurements");
    expect(c.offerLine).toBe("Till 31 Oct");
  });

  it("leaves the USP's words alone when the post shows no date (open-ended offer)", async () => {
    const brief = await readyBrief(b, { primaryUspId: suit, endsOn: null, openEnded: true });
    const c = await contentFromBrief(brief, brand, { ...live, headline: "Festival wardrobe sorted" }, { postCode: "abc1234" });
    expect(c.primary?.text).toBe("15% off all suit stitching till 31 October");
    expect(c.offerLine).toBeNull();
  });

  it("the copy check drops a subline that repeats the headline or the dates, and says so", async () => {
    const brief = await readyBrief(b, { primaryUspId: suit, endsOn: "2026-10-31" });
    const raw: PostCopy = { headline: live.headline, subline: live.subline, cta_text: "Visit us", captions: [{ channel: "instagram", text: "Suits." }], hashtags: [], bubble: "", pose: "" };
    const ctx = { brief, brandName: "Corner Bakery", language: "en", channels: ["instagram"], mascot: false, contactLines: [] };
    const r = validateCopy(raw, ctx);
    expect(r.subline).toBe("");
    expect(r.fixes).toContain("subline_repeats");
    expect(validateCopy({ ...raw, subline: "Free pickup and delivery in Indore" }, ctx).subline).toBe("Free pickup and delivery in Indore");
  });
});

describe("the helpers", () => {
  it("compare words, not letters: months, ordinals, plurals, case and punctuation do not matter", () => {
    expect(significantWords("Special offer valid till 31st October!")).toEqual(["31", "oct"]);
    expect(wordOverlap("Valid till 31 October", ["Till 31 Oct"])).toBe(1);
    expect(wordOverlap("Cakes, cakes & more", ["20% off cake"])).toBeCloseTo(2 / 3);
    expect(repeatsLines("15% OFF suit stitching", ["15% off all suit stitching"])).toBe(true);
    expect(repeatsLines("Free delivery", ["15% off all suit stitching"])).toBe(false);
    expect(repeatsLines("", ["x"])).toBe(false);
  });

  it("cut only a trailing date phrase", () => {
    expect(stripDatePhrase("15% off all suit stitching till 31 October")).toBe("15% off all suit stitching");
    expect(stripDatePhrase("Free delivery, until Sunday")).toBe("Free delivery");
    expect(stripDatePhrase("Open daily by appointment")).toBe("Open daily by appointment");
    expect(stripDatePhrase("Valid till 31 Oct")).toBe("Valid till 31 Oct"); // nothing else would be left
    expect(stripDatePhrase("Fresh bread 9 to 5")).toBe("Fresh bread 9 to 5");
  });
});

describe("no fact twice on one design (property over the pipeline fixtures)", () => {
  const headlines = ["15% Off All Suit Stitching", "Festival wardrobe sorted", "Cake week is here", "Suit stitching offer", "Free delivery this week"];
  const sublines = ["", "Special offer valid till 31 October.", "Valid until 31 Oct", "15% off suit stitching", "Free pickup and delivery", "Tailored to you", "Fresh every morning"];

  it("for every combination, no line mostly repeats another", async () => {
    const brief = await readyBrief(b, { primaryUspId: suit, secondaryUspIds: [delivery], endsOn: "2026-10-31" });
    let checked = 0;
    for (const headline of headlines) {
      for (const subline of sublines) {
        const c = await contentFromBrief(brief, brand, { headline, subline, ctaText: "Visit us", bubble: "" }, { postCode: "abc1234" });
        const label = `${headline} / ${subline}`;
        const lines = [c.headline, c.primary?.text ?? "", c.offerLine ?? "", c.subline, ...c.secondary.map((s) => s.text)];
        // The date is in the offer line only.
        for (const l of [c.primary?.text ?? "", c.subline, ...c.secondary.map((s) => s.text)]) expect(significantWords(l).includes("oct"), label).toBe(false);
        // The main point is shown only when the headline does not already carry it.
        if (c.primary) expect(repeatsLines(c.primary.text, [c.headline]), label).toBe(false);
        // The subline is shown only when it adds words.
        if (c.subline) expect(repeatsLines(c.subline, [c.headline, c.primary?.text ?? "", c.offerLine ?? ""]), label).toBe(false);
        expect(lines.filter(Boolean).length).toBeGreaterThan(0);
        checked++;
      }
    }
    expect(checked).toBe(headlines.length * sublines.length);
  });
});
