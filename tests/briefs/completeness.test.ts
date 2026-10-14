import { describe, expect, it } from "vitest";
import { checkCompleteness, uspLimitWarnings, type FormatFamily } from "@/lib/briefs/completeness";
import { POST_TYPES, REQUIRED_BY_TYPE, USP_LIMITS, type Brief, type PostType, type UspSnapshot } from "@/lib/briefs/types";
import { s } from "@/lib/i18n/strings";

const snap = (kind: UspSnapshot["kind"], role: UspSnapshot["role"] = "primary"): UspSnapshot => ({ uspId: `u-${kind}`, kind, title: "t", details: {}, confirmed: false, role });

function brief(postType: PostType, o: Partial<Brief> = {}): Brief {
  return {
    id: "b1",
    brandId: "brand",
    postType,
    primaryUspId: null,
    secondaryUspIds: [],
    uspSnapshot: [],
    cta: null,
    blocks: {},
    qr: null,
    photoId: null,
    language: "en",
    startsOn: null,
    endsOn: null,
    openEnded: false,
    timezone: "UTC",
    channels: [],
    notes: null,
    status: "draft",
    ...o,
  };
}

const keys = (b: Brief) => checkCompleteness(b).map((m) => m.key);

describe("checkCompleteness", () => {
  it("asks for exactly what REQUIRED_BY_TYPE lists on an empty brief", () => {
    for (const type of POST_TYPES) expect(keys(brief(type)), type).toEqual([...REQUIRED_BY_TYPE[type]]);
  });

  it("every missing item has a one-line question", () => {
    for (const type of POST_TYPES) {
      for (const m of checkCompleteness(brief(type))) {
        expect(m.question.length, `${type}/${m.key}`).toBeGreaterThan(10);
        expect(m.question).not.toContain("\n");
      }
    }
    expect(checkCompleteness(brief("offer")).map((m) => m.question)).toEqual([
      s.brief.questions.primaryUsp.offer,
      s.brief.questions.dates.offer,
      s.brief.questions.cta.default,
    ]);
  });

  it("an offer needs a main point that says how much, and an end date", () => {
    const base = { primaryUspId: "u", cta: "visit" as const, endsOn: "2026-10-20" };
    expect(keys(brief("offer", { ...base, uspSnapshot: [snap("discount")] }))).toEqual([]);
    expect(keys(brief("offer", { ...base, uspSnapshot: [snap("price")] }))).toEqual([]);
    expect(keys(brief("offer", { ...base, uspSnapshot: [snap("free_extra")] }))).toEqual([]);
    expect(checkCompleteness(brief("offer", { ...base, uspSnapshot: [snap("reviews")] }))).toEqual([{ key: "primaryUsp", question: s.brief.offerNeedsAmount }]);
    expect(keys(brief("offer", { ...base, endsOn: null, startsOn: "2026-10-15", uspSnapshot: [snap("discount")] }))).toEqual(["dates"]); // "until when" is the end
  });

  it("an event is complete with a start or an end date and a call to action", () => {
    expect(keys(brief("event", { startsOn: "2026-10-20", cta: "book" }))).toEqual([]);
    expect(keys(brief("event", { endsOn: "2026-10-20", cta: "book" }))).toEqual([]);
    expect(keys(brief("event", { cta: "book" }))).toEqual(["dates"]);
    expect(keys(brief("event", { startsOn: "2026-10-20" }))).toEqual(["cta"]);
  });

  it("the other types", () => {
    expect(keys(brief("new_product", { primaryUspId: "u" }))).toEqual(["cta"]);
    expect(keys(brief("new_product", { primaryUspId: "u", cta: "order" }))).toEqual([]);
    expect(keys(brief("announcement", { startsOn: "2026-12-24" }))).toEqual([]);
    expect(keys(brief("testimonial", { primaryUspId: "u" }))).toEqual([]);
    expect(keys(brief("hiring"))).toEqual(["cta"]);
    expect(keys(brief("occasion"))).toEqual([]);
    expect(keys(brief("brand"))).toEqual([]);
  });
});

describe("uspLimitWarnings", () => {
  const formats = Object.keys(USP_LIMITS) as FormatFamily[];

  it("one main and two extra fit square, portrait and story but not thumbnail, banner or link", () => {
    const b = { primaryUspId: "p", secondaryUspIds: ["s1", "s2"] };
    expect(uspLimitWarnings(b, formats).map((w) => w.format)).toEqual(["thumbnail", "banner", "link"]);
    expect(uspLimitWarnings(b, ["square", "portrait", "story"])).toEqual([]);
  });

  it("one main and one extra fit every format", () => {
    expect(uspLimitWarnings({ primaryUspId: "p", secondaryUspIds: ["s1"] }, formats)).toEqual([]);
    expect(uspLimitWarnings({ primaryUspId: null, secondaryUspIds: [] }, formats)).toEqual([]);
  });

  it("more than the limit warns, offers a carousel and names the format", () => {
    const [w] = uspLimitWarnings({ primaryUspId: "p", secondaryUspIds: ["a", "b", "c"] }, ["square", "square"]);
    expect(w).toMatchObject({ format: "square", secondary: 3, limit: { primary: 1, secondary: 2 }, offerCarousel: true });
    expect(w.message).toContain("Too many points make the post hard to read");
    expect(w.message).toContain("square");
    expect(uspLimitWarnings({ primaryUspId: "p", secondaryUspIds: ["a", "b", "c"] }, ["square", "square"])).toHaveLength(1);
  });
});
