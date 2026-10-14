import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createBrief, updateBrief } from "@/lib/briefs/service";
import type { Brief } from "@/lib/briefs/types";
import { loadCreateBrand } from "@/lib/create/brand";
import { CTA_DEFAULT_TEXT, QR_LABEL, briefFormats, channelFormats, contentFromBrief, factsForBrief, offerLineFor, primaryFormat } from "@/lib/create/content";
import type { CreateBrand, DesignWords } from "@/lib/create/types";
import type { MockDb } from "@/lib/db/mock";
import { QrContentError } from "@/lib/qr";
import { createUsp, setUspConfirmed } from "@/lib/usps/service";
import { closeDb, openDb } from "../../helpers/details";
import { BASE_URL, NOW, cleanup, makeBakery, readyBrief, type Bakery } from "./helpers";

let db: MockDb;
let b: Bakery;
let brand: CreateBrand;

const words: DesignWords = { headline: "Cake week at Corner Bakery", subline: "Fresh every morning", ctaText: "Visit us today", bubble: "Come say hi!" };

beforeAll(async () => {
  db = await openDb();
  b = await makeBakery(db);
  await setUspConfirmed(b.userId, b.brandId, b.usps.best.id, true);
  brand = await loadCreateBrand(b.userId, b.brandId);
});
afterAll(async () => {
  cleanup(b);
  await closeDb(db);
});

describe("contentFromBrief per post type", () => {
  it("an offer: the main point, the dates, the CTA, the contact lines the brief switched on", async () => {
    const brief = await readyBrief(b, { secondaryUspIds: [b.usps.rating.id, b.usps.delivery.id] });
    const c = await contentFromBrief(brief, brand, words, { postCode: "abc1234", baseUrl: BASE_URL });
    expect(c.headline).toBe(words.headline);
    expect(c.primary).toEqual({ kind: "discount", text: "20% off cakes" });
    expect(c.secondary).toEqual([
      { kind: "reviews", text: "4.8 on Google" },
      { kind: "delivery", text: "Free delivery in London" },
    ]);
    expect(c.offerLine).toBe("Till 20 Oct");
    expect(c.cta).toEqual({ kind: "visit", text: "Visit us today" });
    expect(c.blocks.map((x) => x.kind)).toEqual(["phone", "website", "address"]);
    expect(c.blocks[0].text).toContain("7946 0958");
    expect(c.qr).toBeNull(); // never a QR the owner did not ask for
    expect(c.bubble).toBe(""); // the mascot is off
  });

  it("drops the primary line when the headline already says it, and uses the standard CTA wording when the copy has none", async () => {
    const brief = await readyBrief(b);
    const c = await contentFromBrief(brief, brand, { ...words, headline: "20% off cakes", ctaText: "" }, { postCode: "abc1234" });
    expect(c.primary).toBeNull();
    expect(c.cta?.text).toBe(CTA_DEFAULT_TEXT.visit);
  });

  it("an open-ended offer has no end text; a start date alone says 'From'", async () => {
    const open = await readyBrief(b, { endsOn: null, openEnded: true, blocks: { phone: true, dates: true } });
    expect(open.openEnded).toBe(true);
    expect((await contentFromBrief(open, brand, words, { postCode: "abc1234" })).offerLine).toBeNull();
    const started = await updateBrief(b.userId, b.brandId, open.id, { startsOn: "2026-10-15" }, { now: NOW });
    expect((await contentFromBrief(started, brand, words, { postCode: "abc1234" })).offerLine).toBe("From 15 Oct");
  });

  it("shows the amount from the details when the title does not, and keeps 'up to' only when the owner said so", async () => {
    const sale = await createUsp(b.userId, b.brandId, { kind: "discount", title: "Cake sale", details: { percent: 25, on: "cakes", upTo: true } });
    const brief = await readyBrief(b, { primaryUspId: sale.id });
    expect(offerLineFor(brief, "en")).toBe("Up to 25% off · Till 20 Oct");
    const price = await readyBrief(b, { postType: "new_product", primaryUspId: b.usps.price.id, endsOn: null });
    expect(offerLineFor(price, "en")).toBeNull(); // "Loaf from £4.50" already shows the figure
  });

  it("falls back to the discount's own validity when the brief has no dates", async () => {
    const dated = await createUsp(b.userId, b.brandId, { kind: "discount", title: "Half term deal", details: { percent: 10, on: "buns", validFrom: "2026-10-26", validTo: "2026-10-30" } });
    const brief = await readyBrief(b, { postType: "new_product", primaryUspId: dated.id, endsOn: null });
    expect(offerLineFor(brief, "en")).toBe("10% off · From 26 Oct to 30 Oct");
  });

  it("the dates block off removes the dates line", async () => {
    const brief = await readyBrief(b, { blocks: { phone: true, dates: false } });
    expect(offerLineFor(brief, "en")).toBeNull();
  });

  const types: Array<[string, Record<string, unknown>]> = [
    ["new_product", { postType: "new_product", primaryUspId: undefined, cta: "order", endsOn: null }],
    ["event", { postType: "event", startsOn: "2026-10-18", endsOn: "2026-10-18", cta: "book", primaryUspId: null }],
    ["announcement", { postType: "announcement", startsOn: "2026-10-20", endsOn: null, primaryUspId: null, cta: null }],
    ["occasion", { postType: "occasion", primaryUspId: null, cta: null, endsOn: null }],
    ["testimonial", { postType: "testimonial", primaryUspId: "rating", cta: null, endsOn: null }],
    ["hiring", { postType: "hiring", primaryUspId: null, cta: "call", endsOn: null }],
    ["brand", { postType: "brand", primaryUspId: "best", cta: "visit", endsOn: null }],
  ];
  for (const [type, patch] of types) {
    it(`builds content for a ${type} post`, async () => {
      const p = { ...patch };
      if (p.primaryUspId === "rating") p.primaryUspId = b.usps.rating.id;
      else if (p.primaryUspId === "best") p.primaryUspId = b.usps.best.id;
      else if (p.primaryUspId === undefined) p.primaryUspId = b.usps.delivery.id;
      const brief = await readyBrief(b, p);
      const c = await contentFromBrief(brief, brand, words, { postCode: "abc1234" });
      expect(c.headline).toBe(words.headline);
      expect(c.cta === null).toBe(brief.cta === null);
      expect(c.primary === null).toBe(brief.primaryUspId === null);
      for (const blk of c.blocks) expect(blk.text.length).toBeGreaterThan(0);
      if (type === "event") expect(c.offerLine).toBe("From 18 Oct to 18 Oct");
      if (type === "announcement") expect(c.offerLine).toBe("From 20 Oct");
    });
  }
});

describe("QR content", () => {
  it("a link QR encodes the post's own short link and is labelled 'Scan to visit'", async () => {
    const brief = await readyBrief(b, { qr: { kind: "link", target: "website", url: "https://bakery.example.com" }, cta: "scan" });
    const c = await contentFromBrief(brief, brand, words, { postCode: "abc1234", baseUrl: BASE_URL });
    expect(c.qr).toEqual({ text: `${BASE_URL}/r/abc1234?q=1`, label: QR_LABEL.visit });
  });

  it("a link QR without a short-link code is refused", async () => {
    const brief = await readyBrief(b, { qr: { kind: "link", target: "website", url: "https://bakery.example.com" } });
    await expect(contentFromBrief(brief, brand, words, { baseUrl: BASE_URL })).rejects.toBeInstanceOf(QrContentError);
  });

  it("an active payment QR holds exactly the confirmed ID and prints the payee", async () => {
    const brief = await readyBrief(b, { qr: { kind: "payment", paymentId: b.paymentId } });
    const c = await contentFromBrief(brief, brand, words, { postCode: "abc1234" });
    expect(c.qr?.label).toBe(QR_LABEL.pay);
    expect(c.qr?.text).toBe("upi://pay?pa=corner.bakery@okhdfcbank&pn=Corner%20Bakery&cu=INR");
    expect(c.qr?.payment).toEqual({ address: "corner.bakery@okhdfcbank", payeeName: "Corner Bakery" });
  });

  it("a payment QR whose ID is no longer active throws, so the post is blocked", async () => {
    const brief = await readyBrief(b, { qr: { kind: "payment", paymentId: b.paymentId } });
    await db.withAdmin((tx) => tx.query("update public.payment_ids set status = 'retired' where id = $1", [b.paymentId]));
    try {
      await expect(contentFromBrief(brief, brand, words, { postCode: "abc1234" })).rejects.toMatchObject({ name: "QrContentError", reason: "payment_not_active" });
    } finally {
      await db.withAdmin((tx) => tx.query("update public.payment_ids set status = 'active' where id = $1", [b.paymentId]));
    }
  });
});

describe("formats", () => {
  it("each channel has its sizes, the main one first", () => {
    expect(channelFormats("instagram")).toEqual(["square", "portrait"]);
    expect(channelFormats("facebook")).toEqual(["square"]);
    expect(channelFormats("whatsapp")).toEqual(["vertical"]);
    expect(channelFormats("youtube")).toEqual(["thumbnail"]);
    expect(briefFormats(["instagram", "facebook", "whatsapp", "youtube"])).toEqual(["square", "portrait", "vertical", "thumbnail"]);
    expect(primaryFormat(["whatsapp", "instagram"])).toBe("vertical");
    expect(briefFormats([])).toEqual(["square"]);
  });
});

describe("factsForBrief", () => {
  let brief: Brief;
  beforeAll(async () => {
    brief = await createBrief(
      b.userId,
      b.brandId,
      {
        postType: "offer",
        primaryUspId: b.usps.discount.id,
        secondaryUspIds: [b.usps.best.id, b.usps.rating.id],
        cta: "visit",
        endsOn: "2026-10-20",
        startsOn: "2026-10-15",
        blocks: { phone: true, website: true, hours: false, address: true, dates: true },
        channels: ["instagram"],
        status: "ready",
      },
      { now: NOW },
    );
  });

  it("holds every USP of the brief with its figures, and says which claims the owner confirmed", () => {
    const facts = factsForBrief(brief, brand);
    const text = (kind: string) => facts.filter((f) => f.kind === kind).map((f) => f.value).join(" | ");
    expect(facts.some((f) => f.value.includes("20% off cakes") && f.kind === "offer")).toBe(true);
    const best = facts.find((f) => f.value.includes("Best cakes in town"));
    expect(best?.value).toContain("confirmed by the owner");
    const rating = facts.find((f) => f.value.includes("4.8 on Google"));
    expect(rating?.value).toContain("4.8 out of 5");
    expect(rating?.value).toContain("230 reviews");
    expect(rating?.value).not.toContain("confirmed by the owner"); // not confirmed
    expect(text("offer")).toContain("20% off");
  });

  it("holds the contact lines exactly as shown and the dates, and not the lines switched off", () => {
    const facts = factsForBrief(brief, brand);
    expect(facts.some((f) => f.kind === "phone" && f.value.includes("7946 0958"))).toBe(true);
    expect(facts.some((f) => f.label === "Website" && f.value.includes("bakery.example.com"))).toBe(true);
    expect(facts.some((f) => f.kind === "address" && f.value.includes("12 High Street"))).toBe(true);
    expect(facts.some((f) => f.kind === "hours")).toBe(false);
    const dates = facts.find((f) => f.label === "Offer dates");
    expect(dates?.value).toContain("From 15 Oct to 20 Oct");
    expect(dates?.value).toContain("2026-10-20");
  });

  it("continues the brand's fact ids, in order, with none repeated", () => {
    const facts = factsForBrief(brief, brand);
    expect(facts.slice(0, brand.facts.length)).toEqual(brand.facts);
    expect(facts.map((f) => f.id)).toEqual(facts.map((_, i) => `f${i + 1}`));
    expect(new Set(facts.map((f) => f.id)).size).toBe(facts.length);
  });

  it("an open-ended brief has no end date fact", async () => {
    const open = await readyBrief(b, { endsOn: null, openEnded: true });
    expect(factsForBrief(open, brand).some((f) => f.label === "Offer dates")).toBe(false);
  });
});
