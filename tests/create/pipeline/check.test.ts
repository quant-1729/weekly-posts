import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { updateBrief } from "@/lib/briefs/service";
import type { Brief } from "@/lib/briefs/types";
import { loadCreateBrand } from "@/lib/create/brand";
import { approvalCheck, blockersFromReport, carryDecisions, checkPost, checkPosts } from "@/lib/create/check";
import type { CreateBrand, DesignWords } from "@/lib/create/types";
import type { MockDb } from "@/lib/db/mock";
import type { Flag } from "@/lib/guardrail";
import { setUspConfirmed } from "@/lib/usps/service";
import { closeDb, openDb } from "../../helpers/details";
import { NOW, cleanup, makeBakery, readyBrief, type Bakery } from "./helpers";

let db: MockDb;
let b: Bakery;
let brand: CreateBrand;
let offer: Brief; // 20% off cakes, until 20 Oct, phone + website + address

const good: DesignWords = { headline: "20% off cakes", subline: "", ctaText: "Visit us", bubble: "" };

const check = (brief: Brief, caption: string, words: Partial<DesignWords> = {}, hashtags: string[] = []) =>
  checkPost({ userId: b.userId, brandId: b.brandId, brief, brand, words: { ...good, ...words }, post: { channel: "instagram", caption, hashtags }, now: NOW });

const texts = (flags: Flag[]) => flags.filter((f) => f.status === "open").map((f) => f.text.toLowerCase());

beforeAll(async () => {
  db = await openDb();
  b = await makeBakery(db);
  brand = await loadCreateBrand(b.userId, b.brandId);
  offer = await readyBrief(b);
});
afterAll(async () => {
  cleanup(b);
  await closeDb(db);
});

describe("checkPost", () => {
  it("a caption that only says what the brief says passes", async () => {
    const r = await check(offer, "20% off cakes until 20 Oct at 12 High Street. Call +44 20 7946 0958 or see bakery.example.com.");
    expect(texts(r.flags)).toEqual([]);
    expect(r.blocking).toBe(false);
    expect(r.aiChecked).toBe(true);
  });

  it("an invented price is flagged", async () => {
    const r = await check(offer, "Fresh cakes for only £3.99 this week!");
    expect(r.blocking).toBe(true);
    expect(r.flags.some((f) => f.kind === "price" && f.text.includes("3.99") && f.field === "caption")).toBe(true);
  });

  it("an invented price on the picture's headline is flagged too", async () => {
    const r = await check(offer, "Cake week.", { headline: "Cakes from £2.50" });
    expect(r.flags.some((f) => f.kind === "price" && f.field === "image_text.headline")).toBe(true);
  });

  it("'up to' is flagged unless the owner said it, and passes when the discount says it", async () => {
    const r = await check(offer, "Get up to 20% off cakes until 20 Oct.");
    expect(texts(r.flags).some((t) => t.includes("up to"))).toBe(true);
    const upTo = await readyBrief(b, { primaryUspId: b.usps.upTo.id });
    const ok = await check(upTo, "Get up to 30% off pastries until 20 Oct.", { headline: "Up to 30% off pastries" });
    expect(texts(ok.flags).some((t) => t.includes("up to"))).toBe(false);
    expect(ok.blocking).toBe(false);
  });

  it("an unconfirmed 'best' is flagged; once the owner confirmed the claim it passes", async () => {
    const brief = await readyBrief(b, { postType: "brand", primaryUspId: b.usps.best.id, cta: "visit", endsOn: null });
    const before = await check(brief, "Come and taste the best cakes in town.", { headline: "Best cakes in town" });
    expect(before.blocking).toBe(true);
    expect(before.flags.some((f) => /best/i.test(f.text))).toBe(true);
    expect(before.flags.some((f) => f.field === "image_text.headline")).toBe(true);

    await setUspConfirmed(b.userId, b.brandId, b.usps.best.id, true);
    const confirmed = await updateBrief(b.userId, b.brandId, brief.id, {}, { now: NOW });
    expect(confirmed.uspSnapshot[0].confirmed).toBe(true);
    const after = await check(confirmed, "Come and taste the best cakes in town.", { headline: "Best cakes in town" });
    expect(after.flags.filter((f) => /best/i.test(f.text))).toEqual([]);
    expect(after.blocking).toBe(false);
  });

  it("a rating needs the platform and count the owner entered", async () => {
    const brief = await readyBrief(b, { postType: "testimonial", primaryUspId: b.usps.rating.id, cta: "visit", endsOn: null });
    await setUspConfirmed(b.userId, b.brandId, b.usps.rating.id, true);
    const withUsp = await updateBrief(b.userId, b.brandId, brief.id, {}, { now: NOW });
    const wrong = await check(withUsp, "Rated 4.9 stars by our customers.");
    expect(wrong.blocking).toBe(true);
    const right = await check(withUsp, "Rated 4.8 on Google by 230 reviews.", { headline: "4.8 on Google" });
    expect(right.blocking).toBe(false);
  });

  it("a phone number that is not the brand's is flagged", async () => {
    const r = await check(offer, "Order now on +44 20 7946 0999");
    expect(r.flags.some((f) => f.kind === "phone")).toBe(true);
  });

  it("a payment ID in a caption is flagged: it is only ever printed next to its QR", async () => {
    const r = await check(offer, "Pay us at corner.bakery@okhdfcbank please");
    expect(r.blocking).toBe(true);
    expect(r.flags.some((f) => /okhdfcbank/.test(f.text))).toBe(true);
  });

  it("a payment QR needs its 'Scan to pay' label and the payee line; a post that says 'scan' with no QR is flagged", async () => {
    const noQr = await check(offer, "Scan to pay at the counter", { ctaText: "Scan to pay" });
    expect(noQr.flags.some((f) => /scan/i.test(f.text) || f.kind === "claim")).toBe(true);
    const pay = await readyBrief(b, { qr: { kind: "payment", paymentId: b.paymentId }, cta: "scan" });
    const ok = await check(pay, "20% off cakes until 20 Oct.", { ctaText: "Scan to pay" });
    expect(texts(ok.flags).filter((t) => t.includes("scan") || t.includes("qr"))).toEqual([]);
  });

  it("checks several channels in one go, each with its own caption", async () => {
    const res = await checkPosts({
      userId: b.userId,
      brandId: b.brandId,
      brief: offer,
      brand,
      words: good,
      posts: [
        { channel: "instagram", caption: "20% off cakes until 20 Oct.", hashtags: [] },
        { channel: "whatsapp", caption: "Cakes for only £1.99", hashtags: [] },
        { channel: "youtube", caption: "20% off cakes", hashtags: [] },
      ],
      now: NOW,
    });
    expect(res.map((r) => r.blocking)).toEqual([false, true, false]);
  });

  it("a regulated reminder never blocks, and a 'facts not checked' flag does (the AI check failed)", async () => {
    const res = await checkPost({
      userId: b.userId,
      brandId: b.brandId,
      brief: offer,
      brand,
      words: good,
      post: { channel: "instagram", caption: "20% off cakes", hashtags: [] },
      now: NOW,
      aiFixture: () => {
        throw new Error("model down");
      },
    });
    expect(res.aiChecked).toBe(false);
    expect(res.blocking).toBe(true);
  });
});

describe("what blocks approval", () => {
  const flag = (over: Partial<Flag>): Flag => ({ id: "f1", text: "£3.99", kind: "price", field: "caption", layer: "code", regulated: false, highlight: true, status: "open", decided_at: null, ...over });
  const design = (blockers: ReturnType<typeof blockersFromReport>) => ({ blockers });

  it("open flags block; confirmed or removed ones do not; the regulated reminder never does", () => {
    expect(approvalCheck({ flags: [flag({})], design: design([]), themeId: "clean" }).ok).toBe(false);
    expect(approvalCheck({ flags: [flag({ status: "confirmed" }), flag({ id: "f2", status: "removed" }), flag({ id: "f3", kind: "regulated_reminder" })], design: design([]), themeId: "clean" }).ok).toBe(true);
  });

  it("text that did not fit, and a QR that does not decode to its content, block", () => {
    const over = blockersFromReport("square", { overflow: ["headline"], dropped: [], contrast: [], safeZone: [], qr: null });
    expect(over).toEqual([{ format: "square", code: "overflow", detail: "headline" }]);
    const bad = blockersFromReport("portrait", { overflow: [], dropped: [], contrast: [], safeZone: [], qr: { ok: false, decoded: "upi://pay?pa=someone.else@bank" } });
    expect(bad).toEqual([{ format: "portrait", code: "qr_mismatch", detail: "upi://pay?pa=someone.else@bank" }]);
    expect(blockersFromReport("square", { overflow: [], dropped: ["x"], contrast: [], safeZone: [], qr: { ok: true, decoded: "x" } })).toEqual([]);
    expect(approvalCheck({ flags: [], design: design(over), themeId: "clean" })).toMatchObject({ ok: false, blockers: over });
  });

  it("a post with no design cannot be approved", () => {
    expect(approvalCheck({ flags: [], design: null, themeId: null })).toMatchObject({ ok: false, noDesign: true });
  });

  it("a claim the owner already confirmed stays confirmed after a re-check", () => {
    const next = carryDecisions([flag({}), flag({ id: "f9", text: "50%" })], [flag({ status: "confirmed", decided_at: "2026-10-14T10:00:00Z" })]);
    expect(next.map((f) => f.status)).toEqual(["confirmed", "open"]);
  });
});
