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
});

describe("missingForNext (B-8)", () => {
  it("asks for the type first", () => {
    expect(missingForNext(base(), [], NEEDS_CONFIRMATION).map((m) => m.key)).toEqual(["postType"]);
  });

  it("an offer needs a main point, an end date and a call to action, each as a one-line question", () => {
    const m = missingForNext(base({ postType: "offer" }), [discount], NEEDS_CONFIRMATION);
    expect(m.map((x) => x.key)).toEqual(["primaryUsp", "dates", "cta"]);
    for (const x of m) expect(x.question.split("\n")).toHaveLength(1);
    expect(m[1].question).toBe("Until when is the offer on?");
  });

  it("an offer whose main point is not a discount, price or free extra still needs the 'how much'", () => {
    const m = missingForNext(base({ postType: "offer", primaryUspId: family.id, cta: "visit", endsOn: "2026-10-20" }), [family], NEEDS_CONFIRMATION);
    expect(m.map((x) => x.key)).toEqual(["primaryUsp"]);
  });

  it("is empty for a complete offer, and a brand post needs nothing", () => {
    expect(missingForNext(base({ postType: "offer", primaryUspId: discount.id, cta: "visit", endsOn: "2026-10-20" }), [discount], NEEDS_CONFIRMATION)).toEqual([]);
    expect(missingForNext(base({ postType: "brand" }), [], NEEDS_CONFIRMATION)).toEqual([]);
  });

  it("a chosen claim that needs the owner's confirmation blocks until confirmed", () => {
    const d = base({ postType: "brand", primaryUspId: rating.id });
    const m = missingForNext(d, [rating], NEEDS_CONFIRMATION);
    expect(m).toEqual([{ key: "confirm", question: 'Confirm "4.8 on Google" in the selling points before using it.' }]);
    expect(missingForNext(d, [{ ...rating, confirmed: true }], NEEDS_CONFIRMATION)).toEqual([]);
    // A kind that doesn't need confirming never blocks.
    expect(missingForNext(base({ postType: "brand", primaryUspId: family.id }), [family], NEEDS_CONFIRMATION)).toEqual([]);
  });

  it("a link QR needs its link", () => {
    expect(missingForNext(base({ postType: "brand", qr: { mode: "link", target: "website", url: "" } }), [], NEEDS_CONFIRMATION).map((m) => m.key)).toEqual(["qr"]);
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
  it("fills what the answer carries and leaves the rest alone", () => {
    const before = base({ cta: "scan", ctaChosen: true, language: "en", blocks: { phone: true, whatsapp: true } });
    const after = applyDescription(before, { brief: { postType: "offer", primaryUspId: discount.id, secondaryUspIds: [family.id], endsOn: "2026-10-18" } });
    expect(after).toMatchObject({ postType: "offer", primaryUspId: discount.id, secondaryUspIds: [family.id], endsOn: "2026-10-18", cta: "scan", language: "en" });
    expect(after.blocks).toEqual({ phone: true, whatsapp: true, dates: true });
  });

  it("starts the CTA from the post type unless the owner chose one, and applies named blocks and language", () => {
    expect(applyDescription(base(), { brief: { postType: "hiring" } }).cta).toBe("call");
    const named = applyDescription(base({ blocks: { phone: true, whatsapp: true } }), { brief: { postType: "brand", cta: "whatsapp", blocks: { phone: false, whatsapp: true }, language: "hi" } });
    expect(named).toMatchObject({ cta: "whatsapp", ctaChosen: true, language: "hi", blocks: { phone: false, whatsapp: true } });
  });

  it("an extra point never repeats the main one", () => {
    const d = applyDescription(base(), { brief: { postType: "offer", primaryUspId: discount.id, secondaryUspIds: [discount.id, family.id] } });
    expect(d.secondaryUspIds).toEqual([family.id]);
  });
});
