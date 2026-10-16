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
  // Owner change 2026-10-15: Details no longer asks for selling points, a call to action or dates. A post needs a
  // description (or, for briefs from before, a main point); no type requires more.
  it("no post type requires a main point, dates or a call to action any more", () => {
    for (const type of POST_TYPES) expect(REQUIRED_BY_TYPE[type], type).toEqual([]);
  });

  it("an empty brief of any type asks for a description, as one line", () => {
    for (const type of POST_TYPES) {
      expect(checkCompleteness(brief(type)), type).toEqual([{ key: "description", question: s.brief.questions.description }]);
      expect(s.brief.questions.description).not.toContain("\n");
    }
  });

  it("a description is enough for every type", () => {
    for (const type of POST_TYPES) expect(keys(brief(type, { notes: "20% off all cakes this weekend. Call to order." })), type).toEqual([]);
  });

  it("a blank description does not count", () => {
    expect(keys(brief("offer", { notes: "   " }))).toEqual(["description"]);
  });

  it("an older brief with a main point and no description is still complete", () => {
    expect(keys(brief("offer", { primaryUspId: "u", uspSnapshot: [snap("discount")] }))).toEqual([]);
    expect(keys(brief("testimonial", { primaryUspId: "u", uspSnapshot: [snap("reviews")] }))).toEqual([]);
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
