import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BrandAccessError } from "@/lib/brand/current";
import { BriefIncompleteError, BriefNotFoundError, BriefValidationError } from "@/lib/briefs/errors";
import { createBrief, defaultBlocks, getBrief, listBriefs, updateBrief } from "@/lib/briefs/service";
import { createContact } from "@/lib/contacts/service";
import type { MockDb } from "@/lib/db/mock";
import { createUsp, setUspActive, updateUsp } from "@/lib/usps/service";
import type { Usp } from "@/lib/usps/types";
import { closeDb, makeOwner, openDb, type Owner } from "../helpers/details";

let db: MockDb;
let a: Owner;
let b: Owner;
let discount: Usp;
let reviews: Usp;
let custom: Usp;
let custom2: Usp;
let bUsp: Usp;
let photoA: string;
let photoB: string;

const NOW = new Date("2026-10-14T12:00:00Z");

beforeAll(async () => {
  db = await openDb();
  a = await makeOwner(db, { name: "Corner Bakery", country: "GB", timezone: "Europe/London" });
  b = await makeOwner(db, { name: "Harbour Dental", country: "US", timezone: "America/Los_Angeles" });
  discount = await createUsp(a.userId, a.brandId, { kind: "discount", title: "20% off cakes", details: { percent: 20, on: "cakes" } });
  reviews = await createUsp(a.userId, a.brandId, { kind: "reviews", title: "4.8 on Google", details: { rating: 4.8, count: 230, platform: "Google" } });
  custom = await createUsp(a.userId, a.brandId, { kind: "custom", title: "Family run", details: {} });
  custom2 = await createUsp(a.userId, a.brandId, { kind: "custom", title: "Open late", details: {} });
  bUsp = await createUsp(b.userId, b.brandId, { kind: "custom", title: "Painless", details: {} });
  const photo = (o: Owner) =>
    db.withUser(o.userId, async (tx) => (await tx.query<{ id: string }>("insert into public.photos (brand_id, storage_path) values ($1, $2) returning id", [o.brandId, `photos/${o.brandId}/${randomUUID()}.jpg`]))[0].id);
  photoA = await photo(a);
  photoB = await photo(b);
});
afterAll(() => closeDb(db));

const fails = async (fn: () => Promise<unknown>) => fn().then(() => false, () => true);

describe("create and snapshot", () => {
  it("freezes the chosen USPs, primary first, and a library edit later does not change the brief", async () => {
    const brief = await createBrief(a.userId, a.brandId, {
      postType: "offer",
      primaryUspId: discount.id,
      secondaryUspIds: [reviews.id, custom.id],
      cta: "visit",
      endsOn: "2026-10-20",
    }, { now: NOW });
    expect(brief.uspSnapshot.map((u) => [u.title, u.role, u.kind])).toEqual([
      ["20% off cakes", "primary", "discount"],
      ["4.8 on Google", "secondary", "reviews"],
      ["Family run", "secondary", "custom"],
    ]);
    expect(brief).toMatchObject({ status: "draft", timezone: "Europe/London", language: "en", endsOn: "2026-10-20", startsOn: null });

    await updateUsp(a.userId, a.brandId, discount.id, { kind: "discount", title: "50% off cakes", details: { percent: 50, on: "cakes" } });
    expect((await getBrief(a.userId, a.brandId, brief.id))?.uspSnapshot[0]).toMatchObject({ title: "20% off cakes", details: { percent: 20 } });

    // Saving something else keeps the frozen copy; choosing a new USP freezes it from the library now.
    const notes = await updateBrief(a.userId, a.brandId, brief.id, { notes: "  Say it warmly  " }, { now: NOW });
    expect(notes.notes).toBe("Say it warmly");
    expect(notes.uspSnapshot[0].title).toBe("20% off cakes");
    const swapped = await updateBrief(a.userId, a.brandId, brief.id, { secondaryUspIds: [custom2.id, reviews.id] }, { now: NOW });
    expect(swapped.uspSnapshot.map((u) => u.title)).toEqual(["20% off cakes", "Open late", "4.8 on Google"]);

    // Only an explicit refresh pulls the library's changes in.
    const fresh = await updateBrief(a.userId, a.brandId, brief.id, {}, { now: NOW, refreshUsps: true });
    expect(fresh.uspSnapshot[0]).toMatchObject({ title: "50% off cakes", details: { percent: 50 } });
  });

  it("keeps the frozen copy when the USP is later removed or deleted", async () => {
    const u = await createUsp(a.userId, a.brandId, { kind: "custom", title: "Short lived", details: {} });
    const brief = await createBrief(a.userId, a.brandId, { postType: "brand", primaryUspId: u.id }, { now: NOW });
    await setUspActive(a.userId, a.brandId, u.id, false);
    await db.withUser(a.userId, (tx) => tx.query("delete from public.usps where id = $1", [u.id]));
    const after = await updateBrief(a.userId, a.brandId, brief.id, { notes: "x" }, { now: NOW }).catch((e) => e);
    // The row's primary_usp_id was cleared by the foreign key, so the brief now has no primary USP.
    expect(after).toMatchObject({ primaryUspId: null, postType: "brand" });
  });

  it("checks the USP choice", async () => {
    const bad = (input: object) => createBrief(a.userId, a.brandId, { postType: "brand", ...input }, { now: NOW });
    await expect(bad({ secondaryUspIds: [custom.id] })).rejects.toMatchObject({ fieldErrors: { secondaryUspIds: "usp_secondary_without_primary" } });
    await expect(bad({ primaryUspId: custom.id, secondaryUspIds: [custom.id] })).rejects.toMatchObject({ fieldErrors: { secondaryUspIds: "usp_duplicate" } });
    await expect(bad({ primaryUspId: discount.id, secondaryUspIds: [reviews.id, custom.id, custom2.id] })).rejects.toMatchObject({ fieldErrors: { secondaryUspIds: "too_many_secondary" } });
    await expect(bad({ primaryUspId: randomUUID() })).rejects.toMatchObject({ fieldErrors: { primaryUspId: "usp_unknown" } });
    await expect(bad({ primaryUspId: bUsp.id })).rejects.toMatchObject({ fieldErrors: { primaryUspId: "usp_unknown" } }); // another brand's
    await expect(bad({ primaryUspId: "nope" })).rejects.toBeInstanceOf(BriefValidationError);
    const off = await createUsp(a.userId, a.brandId, { kind: "custom", title: "Off", details: {} });
    await setUspActive(a.userId, a.brandId, off.id, false);
    await expect(bad({ primaryUspId: off.id })).rejects.toMatchObject({ fieldErrors: { primaryUspId: "usp_unknown" } });
    await expect(createBrief(a.userId, a.brandId, { postType: "party" }, { now: NOW })).rejects.toMatchObject({ fieldErrors: { postType: "invalid" } });
    await expect(createBrief(a.userId, a.brandId, {}, { now: NOW })).rejects.toBeInstanceOf(BriefValidationError);
  });
});

describe("the database keeps a brief inside its brand", () => {
  it("rejects a USP or photo of another brand even when the library check is skipped", async () => {
    const insert = (cols: string, vals: unknown[]) =>
      db.withAdmin((tx) => tx.query(`insert into public.post_briefs (brand_id, post_type, ${cols}) values ($1, 'brand', ${vals.map((_, i) => `$${i + 2}`).join(", ")})`, [a.brandId, ...vals]));
    await expect(insert("primary_usp_id", [bUsp.id])).rejects.toThrow(/foreign key|violates/i);
    await expect(insert("photo_id", [photoB])).rejects.toThrow(/foreign key|violates/i);
    await insert("primary_usp_id, photo_id", [discount.id, photoA]); // the same brand's are fine
  });

  it("refuses a photo that is not in the library through the service", async () => {
    await expect(createBrief(a.userId, a.brandId, { postType: "brand", photoId: photoB }, { now: NOW })).rejects.toMatchObject({ fieldErrors: { photoId: "photo_unknown" } });
    const ok = await createBrief(a.userId, a.brandId, { postType: "brand", photoId: photoA }, { now: NOW });
    expect(ok.photoId).toBe(photoA);
  });

  it("another brand's owner can neither read nor write a brand's briefs", async () => {
    const brief = await createBrief(a.userId, a.brandId, { postType: "brand" }, { now: NOW });
    await expect(getBrief(b.userId, a.brandId, brief.id)).rejects.toBeInstanceOf(BrandAccessError);
    await expect(listBriefs(b.userId, a.brandId)).rejects.toBeInstanceOf(BrandAccessError);
    await expect(createBrief(b.userId, a.brandId, { postType: "brand" }, { now: NOW })).rejects.toBeInstanceOf(BrandAccessError);
    await expect(updateBrief(b.userId, b.brandId, brief.id, { notes: "x" }, { now: NOW })).rejects.toBeInstanceOf(BriefNotFoundError); // not found in their own brand
    expect(await db.withUser(b.userId, (tx) => tx.query("select id from public.post_briefs where brand_id = $1", [a.brandId]))).toEqual([]);
    expect(await fails(() => db.withUser(b.userId, (tx) => tx.query("insert into public.post_briefs (brand_id, post_type) values ($1, 'brand')", [a.brandId])))).toBe(true);
    expect(await db.withUser(b.userId, (tx) => tx.query("update public.post_briefs set notes = 'x' where id = $1 returning id", [brief.id]))).toEqual([]);
    expect(await db.withUser(b.userId, (tx) => tx.query("delete from public.post_briefs where id = $1 returning id", [brief.id]))).toEqual([]);
  });
});

describe("QR, blocks, language, channels and notes", () => {
  async function paymentId(o: Owner, status: "pending" | "active"): Promise<string> {
    return db.withAdmin(async (tx) => {
      const [r] = await tx.query<{ id: string }>(
        `insert into public.payment_ids (brand_id, scheme, address, payee_name, status, confirmed_at)
         values ($1, 'upi', $2, 'Corner Bakery', $3, ${status === "active" ? "now()" : "null"}) returning id`,
        [o.brandId, `shop${randomUUID().slice(0, 6)}@okbank`, status],
      );
      return r.id;
    });
  }

  it("accepts a payment QR only for an active payment ID of the same brand", async () => {
    const active = await paymentId(a, "active");
    const pending = await paymentId(a, "pending");
    const others = await paymentId(b, "active");
    const ok = await createBrief(a.userId, a.brandId, { postType: "brand", qr: { kind: "payment", paymentId: active } }, { now: NOW });
    expect(ok.qr).toEqual({ kind: "payment", paymentId: active });
    for (const id of [pending, others, randomUUID()]) {
      await expect(createBrief(a.userId, a.brandId, { postType: "brand", qr: { kind: "payment", paymentId: id } }, { now: NOW })).rejects.toMatchObject({ fieldErrors: { qr: "payment_not_active" } });
    }
    await expect(createBrief(a.userId, a.brandId, { postType: "brand", qr: { kind: "payment", paymentId: active, amount: -5 } }, { now: NOW })).rejects.toMatchObject({ fieldErrors: { qr: "invalid_qr" } });
    expect((await updateBrief(a.userId, a.brandId, ok.id, { qr: null }, { now: NOW })).qr).toBeNull();
  });

  it("accepts a link QR with a public https URL only", async () => {
    const ok = await createBrief(a.userId, a.brandId, { postType: "brand", qr: { kind: "link", target: "website", url: "http://bakery.example.com/#top" } }, { now: NOW });
    expect(ok.qr).toEqual({ kind: "link", target: "website", url: "https://bakery.example.com" });
    for (const url of ["javascript:alert(1)", "https://127.0.0.1/x", "ftp://example.com", "https://user:pw@example.com"]) {
      await expect(createBrief(a.userId, a.brandId, { postType: "brand", qr: { kind: "link", target: "custom", url } }, { now: NOW })).rejects.toMatchObject({ fieldErrors: { qr: expect.stringMatching(/invalid_/) } });
    }
    await expect(createBrief(a.userId, a.brandId, { postType: "brand", qr: { kind: "scan" } }, { now: NOW })).rejects.toBeInstanceOf(BriefValidationError);
  });

  it("defaults blocks from the brand's default contacts, and keeps blocks the owner sets", async () => {
    const c = await makeOwner(db, { name: "Blocks Cafe", country: "GB" });
    expect(await defaultBlocks(c.userId, c.brandId)).toEqual({});
    await createContact(c.userId, c.brandId, { kind: "phone", value: "020 7946 0958" });
    await createContact(c.userId, c.brandId, { kind: "website", value: "cafe.example.com" });
    await createContact(c.userId, c.brandId, { kind: "email", value: "hi@cafe.example.com", isDefault: false });
    await db.withUser(c.userId, (tx) => tx.query("update public.brand_memory set logo_path = 'brand-assets/x/logo.png' where brand_id = $1", [c.brandId]));
    expect(await defaultBlocks(c.userId, c.brandId)).toEqual({ logo: true, phone: true, website: true });

    const dated = await createBrief(c.userId, c.brandId, { postType: "event", startsOn: "2026-10-20" }, { now: NOW });
    expect(dated.blocks).toEqual({ logo: true, phone: true, website: true, dates: true });
    const own = await createBrief(c.userId, c.brandId, { postType: "brand", blocks: { phone: false, email: true } }, { now: NOW });
    expect(own.blocks).toEqual({ phone: false, email: true });
    await expect(createBrief(c.userId, c.brandId, { postType: "brand", blocks: { phone: "yes" } }, { now: NOW })).rejects.toMatchObject({ fieldErrors: { blocks: "invalid_blocks" } });
    await expect(createBrief(c.userId, c.brandId, { postType: "brand", blocks: { fax: true } }, { now: NOW })).rejects.toMatchObject({ fieldErrors: { blocks: "invalid_blocks" } });
  });

  it("checks language, channels, CTA and notes", async () => {
    const ok = await createBrief(a.userId, a.brandId, { postType: "brand", language: "hi", channels: ["instagram", "facebook", "instagram"], cta: "scan", notes: "n".repeat(2000) }, { now: NOW });
    expect(ok).toMatchObject({ language: "hi", channels: ["instagram", "facebook"], cta: "scan" });
    const bad = (input: object) => createBrief(a.userId, a.brandId, { postType: "brand", ...input }, { now: NOW });
    await expect(bad({ language: "english please" })).rejects.toMatchObject({ fieldErrors: { language: "invalid_language" } });
    await expect(bad({ channels: ["tiktok"] })).rejects.toMatchObject({ fieldErrors: { channels: "invalid_channel" } });
    await expect(bad({ cta: "shout" })).rejects.toMatchObject({ fieldErrors: { cta: "invalid" } });
    await expect(bad({ notes: "n".repeat(2001) })).rejects.toMatchObject({ fieldErrors: { notes: "notes_too_long" } });
  });

  it("lists newest first and gets by id", async () => {
    const list = await listBriefs(a.userId, a.brandId, { limit: 3 });
    expect(list).toHaveLength(3);
    expect((await getBrief(a.userId, a.brandId, list[0].id))?.id).toBe(list[0].id);
    expect(await getBrief(a.userId, a.brandId, "nope")).toBeNull();
    expect(await getBrief(a.userId, a.brandId, randomUUID())).toBeNull();
  });
});

describe("ready needs a complete brief", () => {
  it("blocks status ready until the missing items are given", async () => {
    const draft = await createBrief(a.userId, a.brandId, { postType: "offer" }, { now: NOW });
    const err = await updateBrief(a.userId, a.brandId, draft.id, { status: "ready" }, { now: NOW }).catch((e) => e);
    expect(err).toBeInstanceOf(BriefIncompleteError);
    expect((err as BriefIncompleteError).missing.map((m) => m.key)).toEqual(["primaryUsp", "dates", "cta"]);
    expect((await getBrief(a.userId, a.brandId, draft.id))?.status).toBe("draft");
    const ready = await updateBrief(a.userId, a.brandId, draft.id, { primaryUspId: discount.id, endsOn: "2026-10-31", cta: "visit", status: "ready" }, { now: NOW });
    expect(ready.status).toBe("ready");
  });
});
