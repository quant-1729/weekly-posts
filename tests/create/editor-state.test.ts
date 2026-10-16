import { describe, expect, it } from "vitest";
import {
  DEFAULT_CTA,
  applyDescription,
  blockLines,
  datesText,
  defaultChannels,
  draftFromBrief,
  draftKey,
  draftToInput,
  emptyDraft,
  endsInText,
  formatsForChannels,
  missingForNext,
  tickedTypes,
  toggleAllChannels,
  toggleAllTypes,
  toggleType,
  qrTargetUrl,
  type EditorDraft,
  type LibraryUsp,
} from "@/lib/briefs/editor-state";
import { POST_TYPES, type Brief } from "@/lib/briefs/types";
import type { ContactPoint } from "@/lib/contacts/types";
import { NEEDS_CONFIRMATION } from "@/lib/usps/types";

const contact = (kind: ContactPoint["kind"], value: string, display: string | null = null, extra: Partial<ContactPoint> = {}): ContactPoint => ({
  id: `${kind}-${value}`,
  brandId: "b",
  kind,
  value,
  display,
  details: {},
  isDefault: true,
  verifiedAt: null,
  source: "owner",
  ...extra,
});

const discount: LibraryUsp = { id: "u-discount", kind: "discount", title: "20% off cakes", confirmed: false };
const rating: LibraryUsp = { id: "u-rating", kind: "reviews", title: "4.8 on Google", confirmed: false };
const family: LibraryUsp = { id: "u-family", kind: "custom", title: "Family run", confirmed: false };

const base = (patch: Partial<EditorDraft> = {}): EditorDraft => ({ ...emptyDraft({ blocks: { phone: true }, language: "en", channels: ["instagram"] }), ...patch });

describe("call to action defaults", () => {
  it("every post type has one, and it is a real option", () => {
    for (const t of POST_TYPES) expect(DEFAULT_CTA[t]).toBeTruthy();
    expect(DEFAULT_CTA.offer).toBe("visit");
    expect(DEFAULT_CTA.hiring).toBe("call");
  });
});

describe("draftToInput", () => {
  it("is null until a post type is chosen (nothing to autosave)", () => {
    expect(draftToInput(base())).toBeNull();
    expect(draftKey(base())).toBe("null");
  });

  it("builds the service input, dropping extras without a main point and a link QR without a link", () => {
    const input = draftToInput(base({ postType: "offer", secondaryUspIds: [family.id], qr: { mode: "link", target: "website", url: "  " }, language: "", endsOn: "2026-10-20" }));
    expect(input).toMatchObject({ postType: "offer", primaryUspId: null, secondaryUspIds: [], qr: null, language: null, startsOn: null, endsOn: "2026-10-20", channels: ["instagram"] });
  });

  it("carries a link QR and a payment QR", () => {
    expect(draftToInput(base({ postType: "brand", qr: { mode: "link", target: "map", url: " https://maps.example/x " } }))?.qr).toEqual({ kind: "link", target: "map", url: "https://maps.example/x" });
    expect(draftToInput(base({ postType: "brand", qr: { mode: "payment", paymentId: "3f1a8e0c-1111-4222-8333-444455556666" } }))?.qr).toEqual({ kind: "payment", paymentId: "3f1a8e0c-1111-4222-8333-444455556666" });
  });

  it("a saved brief becomes a draft and back to the same input", () => {
    const brief: Brief = {
      id: "x", brandId: "b", postType: "event", primaryUspId: null, secondaryUspIds: [], uspSnapshot: [], cta: "book", blocks: { phone: true, dates: true },
      qr: { kind: "link", target: "booking", url: "https://book.example/" }, photoId: null, language: "hi", startsOn: "2026-10-20", endsOn: "2026-10-21", openEnded: false,
      timezone: "Asia/Kolkata", channels: ["facebook"], notes: null, status: "draft",
    };
    const d = draftFromBrief(brief);
    expect(d).toMatchObject({ postType: "event", cta: "book", ctaChosen: true, qr: { mode: "link", target: "booking", url: "https://book.example/" }, language: "hi" });
    expect(draftToInput(d)).toMatchObject({ postType: "event", cta: "book", startsOn: "2026-10-20", endsOn: "2026-10-21", channels: ["facebook"] });
  });

  it("the description round-trips as the brief's notes (trimmed; empty becomes null)", () => {
    expect(emptyDraft({ blocks: {}, language: "en", channels: [] }).notes).toBe("");
    expect(draftToInput(base({ postType: "brand", notes: "  20% off cakes this weekend.  " }))?.notes).toBe("20% off cakes this weekend.");
    expect(draftToInput(base({ postType: "brand", notes: "   " }))?.notes).toBeNull();
    const brief: Brief = {
      id: "x", brandId: "b", postType: "brand", primaryUspId: null, secondaryUspIds: [], uspSnapshot: [], cta: null, blocks: {}, qr: null, photoId: null, language: null,
      startsOn: null, endsOn: null, openEnded: false, timezone: null, channels: [], notes: "Our new loaf is here", status: "draft",
    };
    expect(draftFromBrief(brief).notes).toBe("Our new loaf is here");
    expect(draftFromBrief({ ...brief, notes: null }).notes).toBe("");
    expect(draftToInput(draftFromBrief(brief))?.notes).toBe("Our new loaf is here");
    // Typing a description changes the autosave key.
    expect(draftKey(base({ postType: "brand", notes: "a" }))).not.toBe(draftKey(base({ postType: "brand", notes: "ab" })));
  });
});

describe("missingForNext (B-8)", () => {
  it("asks for the type first", () => {
    expect(missingForNext(base(), [], NEEDS_CONFIRMATION).map((m) => m.key)).toEqual(["postType"]);
  });

  it("asks for a description when there are no notes and no main point, as one line", () => {
    for (const type of POST_TYPES) {
      const m = missingForNext(base({ postType: type }), [], NEEDS_CONFIRMATION);
      expect(m.map((x) => x.key)).toEqual(["description"]);
      expect(m[0].question).not.toContain("\n");
    }
    expect(missingForNext(base({ postType: "offer", notes: "   " }), [], NEEDS_CONFIRMATION).map((m) => m.key)).toEqual(["description"]);
  });

  it("a description is enough for any type: selling points, dates and a call to action are no longer asked", () => {
    for (const type of POST_TYPES) expect(missingForNext(base({ postType: type, notes: "Cakes, 20% off this weekend" }), [], NEEDS_CONFIRMATION)).toEqual([]);
  });

  it("a chosen claim that needs the owner's confirmation blocks until confirmed", () => {
    const d = base({ postType: "brand", notes: "x", primaryUspId: rating.id });
    const m = missingForNext(d, [rating], NEEDS_CONFIRMATION);
    expect(m).toEqual([{ key: "confirm", question: 'Confirm "4.8 on Google" in the selling points before using it.' }]);
    expect(missingForNext(d, [{ ...rating, confirmed: true }], NEEDS_CONFIRMATION)).toEqual([]);
    // A kind that doesn't need confirming never blocks.
    expect(missingForNext(base({ postType: "brand", notes: "x", primaryUspId: family.id }), [family], NEEDS_CONFIRMATION)).toEqual([]);
  });

  it("a link QR needs its link", () => {
    expect(missingForNext(base({ postType: "brand", notes: "x", qr: { mode: "link", target: "website", url: "" } }), [], NEEDS_CONFIRMATION).map((m) => m.key)).toEqual(["qr"]);
  });
});

describe("formats and the carousel warning inputs", () => {
  it("maps channels to the format families they use", () => {
    expect(formatsForChannels(["instagram"])).toEqual(["square", "portrait"]);
    expect(formatsForChannels(["youtube", "instagram"])).toEqual(["thumbnail", "square", "portrait"]);
    expect(formatsForChannels([])).toEqual(["square"]);
  });
  it("starts from the channels the brand has an account for, else Instagram", () => {
    expect(defaultChannels([])).toEqual(["instagram"]);
    expect(defaultChannels([contact("facebook", "cornerbakery")])).toEqual(["facebook"]);
    expect(defaultChannels([contact("instagram", "corner"), contact("facebook", "cornerbakery")])).toEqual(["instagram", "facebook"]);
  });
});

describe("block lines show the real text", () => {
  const contacts = [
    contact("phone", "+442079460958", "+44 20 7946 0958"),
    contact("phone", "+442079460000", "+44 20 7946 0000", { isDefault: false }),
    contact("website", "https://bakery.example.com/", "bakery.example.com"),
    contact("instagram", "cornerbakery", "@cornerbakery"),
  ];

  it("uses the default contact of each kind, and null where the brand has none", () => {
    const lines = blockLines({ contacts, hasLogo: true, startsOn: "", endsOn: "" });
    const text = Object.fromEntries(lines.map((l) => [l.key, l.text]));
    expect(text).toMatchObject({ logo: "Your logo", phone: "+44 20 7946 0958", website: "bakery.example.com", instagram: "@cornerbakery", whatsapp: null, address: null, dates: null });
    expect(lines.find((l) => l.key === "whatsapp")?.addHref).toBe("/brand#contacts");
    expect(lines.find((l) => l.key === "logo")?.addHref).toBe("/brand#look");
    expect(blockLines({ contacts, hasLogo: false, startsOn: "", endsOn: "" }).find((l) => l.key === "logo")?.text).toBeNull();
  });

  it("writes the dates the way the post will", () => {
    expect(datesText("2026-10-15", "2026-10-20")).toBe("From 15 Oct to 20 Oct");
    expect(datesText("", "2026-10-20")).toBe("Till 20 Oct");
    expect(datesText("2026-10-15", "")).toBe("From 15 Oct");
    expect(datesText("", "")).toBeNull();
    expect(blockLines({ contacts, hasLogo: false, startsOn: "", endsOn: "2026-10-20" }).find((l) => l.key === "dates")?.text).toBe("Till 20 Oct");
  });
});

describe("QR link targets", () => {
  it("are prefilled from the contacts", () => {
    const contacts = [
      contact("website", "https://bakery.example.com/", "bakery.example.com"),
      contact("whatsapp", "+442079460958", "+44 20 7946 0958", { details: { link: "https://wa.me/442079460958" } }),
      contact("map", "https://maps.example/corner"),
    ];
    expect(qrTargetUrl("website", contacts)).toBe("https://bakery.example.com/");
    expect(qrTargetUrl("whatsapp", contacts)).toBe("https://wa.me/442079460958");
    expect(qrTargetUrl("map", contacts)).toBe("https://maps.example/corner");
    expect(qrTargetUrl("booking", contacts)).toBe("");
    expect(qrTargetUrl("custom", contacts)).toBe("");
    expect(qrTargetUrl("whatsapp", [contact("whatsapp", "+442079460958")])).toBe("https://wa.me/442079460958");
  });
});

describe("Ends in N days", () => {
  it("counts whole days in the business's calendar", () => {
    expect(endsInText("2026-10-14", "2026-10-19")).toBe("Ends in 5 days");
    expect(endsInText("2026-10-14", "2026-10-15")).toBe("Ends tomorrow");
    expect(endsInText("2026-10-14", "2026-10-14")).toBe("Ends today");
    expect(endsInText("2026-10-14", "2026-10-13")).toBe("This end date has passed");
    expect(endsInText("2026-10-14", "")).toBe("No end date");
    expect(endsInText("2026-12-30", "2027-01-02")).toBe("Ends in 3 days");
  });
});

describe("applyDescription", () => {
  it("sets the type, call to action, blocks and language, but no longer selling points or dates", () => {
    const before = base({ cta: "scan", ctaChosen: true, language: "en", blocks: { phone: true, whatsapp: true } });
    const after = applyDescription(before, { brief: { postType: "offer", primaryUspId: discount.id, secondaryUspIds: [family.id], startsOn: "2026-10-15", endsOn: "2026-10-18" } });
    expect(after).toMatchObject({ postType: "offer", primaryUspId: null, secondaryUspIds: [], startsOn: "", endsOn: "", cta: "scan", language: "en" });
    expect(after.blocks).toEqual({ phone: true, whatsapp: true });
  });

  it("leaves the owner's own description alone", () => {
    expect(applyDescription(base({ notes: "my words" }), { brief: { postType: "brand" } }).notes).toBe("my words");
  });

  it("starts the CTA from the post type unless the owner chose one, and applies named blocks and language", () => {
    expect(applyDescription(base(), { brief: { postType: "hiring" } }).cta).toBe("call");
    const named = applyDescription(base({ blocks: { phone: true, whatsapp: true } }), { brief: { postType: "brand", cta: "whatsapp", blocks: { phone: false, whatsapp: true }, language: "hi" } });
    expect(named).toMatchObject({ cta: "whatsapp", ctaChosen: true, language: "hi", blocks: { phone: false, whatsapp: true } });
  });
});

describe("several post types (main + extras)", () => {
  it("the first ticked type is the main one, the rest are extras in tick order", () => {
    let d = base();
    d = toggleType(d, "new_product");
    d = toggleType(d, "offer");
    d = toggleType(d, "event");
    expect(d).toMatchObject({ postType: "new_product", extraPostTypes: ["offer", "event"], cta: DEFAULT_CTA.new_product });
    expect(draftToInput(d)).toMatchObject({ postType: "new_product", extraPostTypes: ["offer", "event"] });
    expect(tickedTypes(d)).toEqual(["new_product", "offer", "event"]);
  });

  it("unticking the main type promotes the next ticked one; unticking an extra keeps the main", () => {
    let d = (["new_product", "offer", "event"] as const).reduce((x, t) => toggleType(x, t), base());
    d = toggleType(d, "offer");
    expect(d).toMatchObject({ postType: "new_product", extraPostTypes: ["event"] });
    d = toggleType(d, "new_product");
    expect(d).toMatchObject({ postType: "event", extraPostTypes: [], cta: DEFAULT_CTA.event });
    d = toggleType(d, "event");
    expect(d).toMatchObject({ postType: null, extraPostTypes: [], cta: null });
    expect(draftToInput(d)).toBeNull();
  });

  it("a call to action the owner chose is kept when the main type changes", () => {
    const d = toggleType(base({ postType: "offer", cta: "call", ctaChosen: true }), "offer");
    expect(d.postType).toBeNull();
    expect(d.cta).toBe("call");
  });

  it("select all ticks all 8 keeping the earlier order, and clears them when all are ticked", () => {
    let d = toggleType(toggleType(base(), "hiring"), "event");
    d = toggleAllTypes(d);
    expect(tickedTypes(d)).toHaveLength(POST_TYPES.length);
    expect(d.postType).toBe("hiring");
    expect(d.extraPostTypes[0]).toBe("event");
    expect(d.extraPostTypes).not.toContain("hiring");
    expect(new Set(tickedTypes(d)).size).toBe(8);
    d = toggleAllTypes(d);
    expect(d).toMatchObject({ postType: null, extraPostTypes: [] });
  });

  it("select all for channels", () => {
    const options = ["instagram", "facebook", "whatsapp"];
    expect(toggleAllChannels(["instagram"], options)).toEqual(["instagram", "facebook", "whatsapp"]);
    expect(toggleAllChannels(options, options)).toEqual([]);
    expect(toggleAllChannels(["youtube", ...options], options)).toEqual(["youtube"]);
  });

  it("loads extras from the brief and applyDescription changes the main type only", () => {
    const brief = { id: "x", brandId: "b", postType: "new_product", extraPostTypes: ["offer"], primaryUspId: null, secondaryUspIds: [], uspSnapshot: [], cta: null, blocks: {}, qr: null, photoId: null, language: "en", startsOn: null, endsOn: null, openEnded: false, timezone: null, channels: [], notes: null, status: "draft" } as Brief;
    const d = draftFromBrief(brief);
    expect(d.extraPostTypes).toEqual(["offer"]);
    expect(applyDescription(d, { brief: { postType: "offer" } as never })).toMatchObject({ postType: "offer", extraPostTypes: [] });
    expect(applyDescription(d, { brief: { postType: "event" } as never })).toMatchObject({ postType: "event", extraPostTypes: ["offer"] });
  });
});

describe("copy cache key", () => {
  it("changes when the extra types change, and stays the same when there are none", async () => {
    const { briefFingerprint } = await import("@/lib/create/posts");
    const brief = { id: "x", brandId: "b", postType: "new_product", primaryUspId: null, secondaryUspIds: [], uspSnapshot: [], cta: null, blocks: {}, qr: null, photoId: null, language: "en", startsOn: null, endsOn: null, openEnded: false, timezone: null, channels: [], notes: "n", status: "draft" } as Brief;
    const none = briefFingerprint(brief);
    expect(briefFingerprint({ ...brief, extraPostTypes: [] })).toBe(none);
    expect(briefFingerprint({ ...brief, extraPostTypes: ["offer"] })).not.toBe(none);
    expect(briefFingerprint({ ...brief, extraPostTypes: ["offer"] })).not.toBe(briefFingerprint({ ...brief, extraPostTypes: ["event"] }));
  });
});
