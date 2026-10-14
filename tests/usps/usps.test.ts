import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BrandAccessError } from "@/lib/brand/current";
import type { MockDb } from "@/lib/db/mock";
import { UspLimitError, UspNotFoundError, UspValidationError } from "@/lib/usps/errors";
import { parseUsp } from "@/lib/usps/schema";
import {
  MAX_ACTIVE_USPS,
  createUsp,
  deleteUsp,
  ensureUspsSeeded,
  getUsp,
  hasAnyUsps,
  listUsps,
  reorderUsps,
  seedUspsFromFacts,
  setUspActive,
  setUspConfirmed,
  updateUsp,
  uspFromFact,
} from "@/lib/usps/service";
import { parsePrice } from "@/lib/usps/currency";
import { USP_KINDS, type UspKind } from "@/lib/usps/types";
import { addFact, closeDb, makeOwner, openDb, type Owner } from "../helpers/details";

let db: MockDb;
let a: Owner;
let b: Owner;

beforeAll(async () => {
  db = await openDb();
  a = await makeOwner(db, { name: "Corner Bakery" });
  b = await makeOwner(db, { name: "Harbour Dental" });
});
afterAll(() => closeDb(db));

// One good and one bad example per kind.
const GOOD: Record<UspKind, Record<string, unknown>> = {
  discount: { percent: 20, on: "all cakes", upTo: false, validFrom: "2026-10-15", validTo: "2026-10-20" },
  price: { item: "Sourdough loaf", price: { amount: 4.5, currency: "GBP" }, unit: "loaf" },
  quality: { claim: "Stone-baked daily", evidence: "Our own ovens" },
  reviews: { rating: 4.8, count: 230, platform: "Google" },
  delivery: { promise: "Same-day delivery", area: "Indore", conditions: "Orders before noon" },
  guarantee: { length: "2 years", terms: "Parts and labour" },
  experience: { years: 12, credential: "Master baker" },
  free_extra: { what: "Free coffee", conditions: "With any cake" },
  custom: {},
};
const BAD: Record<UspKind, Record<string, unknown>> = {
  discount: { on: "all cakes" }, // no percent or amount
  price: { item: "Loaf", price: { amount: -1, currency: "GBP" } },
  quality: { claim: "" },
  reviews: { rating: 7, count: 10, platform: "Google" },
  delivery: { promise: "Fast" }, // area missing
  guarantee: { length: "" },
  experience: {}, // neither years nor credential
  free_extra: { what: "" },
  custom: {},
};

describe("parseUsp", () => {
  it.each(USP_KINDS)("accepts a good %s", (kind) => {
    const r = parseUsp({ kind, title: "A point", details: GOOD[kind] });
    expect(r.ok).toBe(true);
  });

  it.each(USP_KINDS.filter((k) => k !== "custom"))("rejects a bad %s with a field error", (kind) => {
    const r = parseUsp({ kind, title: "A point", details: BAD[kind] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.fieldErrors).some((k) => k.startsWith("details"))).toBe(true);
  });

  it("custom needs only a title", () => {
    expect(parseUsp({ kind: "custom", title: "Family run since 1990", details: {} }).ok).toBe(true);
    expect(parseUsp({ kind: "custom", title: "   ", details: {} })).toMatchObject({ ok: false, fieldErrors: { title: "required" } });
  });

  it("checks the title: trimmed, 1 to 60 characters", () => {
    const ok = parseUsp({ kind: "custom", title: "  Hello  ", details: {} });
    expect(ok.ok && ok.data.title).toBe("Hello");
    expect(parseUsp({ kind: "custom", title: "x".repeat(60), details: {} }).ok).toBe(true);
    expect(parseUsp({ kind: "custom", title: "x".repeat(61), details: {} })).toMatchObject({ ok: false, fieldErrors: { title: "too_long" } });
  });

  it("rejects an unknown kind and a discount that ends before it starts", () => {
    expect(parseUsp({ kind: "nope", title: "x", details: {} })).toMatchObject({ ok: false, fieldErrors: { kind: "invalid" } });
    const r = parseUsp({ kind: "discount", title: "x", details: { percent: 10, on: "all", validFrom: "2026-10-20", validTo: "2026-10-15" } });
    expect(r.ok).toBe(false);
  });

  it("drops keys the kind does not have", () => {
    const r = parseUsp({ kind: "quality", title: "x", details: { claim: "Fresh", hacked: true } });
    expect(r.ok && r.data.details).toEqual({ claim: "Fresh" });
  });
});

describe("USP library service", () => {
  it("creates, lists, edits, reorders, removes and deletes", async () => {
    const one = await createUsp(a.userId, a.brandId, { kind: "discount", title: "20% off cakes", details: GOOD.discount });
    const two = await createUsp(a.userId, a.brandId, { kind: "reviews", title: "4.8 on Google", details: GOOD.reviews });
    const three = await createUsp(a.userId, a.brandId, { kind: "custom", title: "Family run", details: {} });
    expect(one).toMatchObject({ source: "owner", confirmed: false, active: true, sourceRef: null });
    expect((await listUsps(a.userId, a.brandId)).map((u) => u.title)).toEqual(["20% off cakes", "4.8 on Google", "Family run"]);

    const edited = await updateUsp(a.userId, a.brandId, one.id, { kind: "discount", title: "25% off cakes", details: { ...GOOD.discount, percent: 25 } });
    expect(edited.title).toBe("25% off cakes");
    expect((edited.details as { percent: number }).percent).toBe(25);

    await reorderUsps(a.userId, a.brandId, [three.id, two.id]);
    expect((await listUsps(a.userId, a.brandId)).map((u) => u.id)).toEqual([three.id, two.id, one.id]);

    await setUspActive(a.userId, a.brandId, two.id, false);
    expect((await listUsps(a.userId, a.brandId)).map((u) => u.id)).toEqual([three.id, one.id]);
    expect((await listUsps(a.userId, a.brandId, { includeInactive: true })).length).toBe(3);
    await setUspActive(a.userId, a.brandId, two.id, true);

    expect(await deleteUsp(a.userId, a.brandId, three.id)).toBe(true);
    expect(await getUsp(a.userId, a.brandId, three.id)).toBeNull();
    expect(await deleteUsp(a.userId, a.brandId, three.id)).toBe(false);
  });

  it("validates on create and update, and writes nothing on a bad input", async () => {
    await expect(createUsp(a.userId, a.brandId, { kind: "reviews", title: "x", details: BAD.reviews })).rejects.toBeInstanceOf(UspValidationError);
    const u = await createUsp(a.userId, a.brandId, { kind: "custom", title: "Keep me", details: {} });
    await expect(updateUsp(a.userId, a.brandId, u.id, { kind: "custom", title: "", details: {} })).rejects.toBeInstanceOf(UspValidationError);
    expect((await getUsp(a.userId, a.brandId, u.id))?.title).toBe("Keep me");
    await expect(updateUsp(a.userId, a.brandId, "00000000-0000-4000-8000-000000000000", { kind: "custom", title: "x", details: {} })).rejects.toBeInstanceOf(UspNotFoundError);
  });

  it("sets confirmed only through setUspConfirmed, and editing the claim clears it", async () => {
    // A caller cannot smuggle `confirmed: true` in on create or update.
    const q = await createUsp(a.userId, a.brandId, { kind: "quality", title: "Best bread in town", details: { claim: "Best bread in town" }, confirmed: true });
    expect(q.confirmed).toBe(false);
    const sure = await setUspConfirmed(a.userId, a.brandId, q.id, true);
    expect(sure.confirmed).toBe(true);
    const same = await updateUsp(a.userId, a.brandId, q.id, { kind: "quality", title: "Best bread in town", details: { claim: "Best bread in town" }, confirmed: false });
    expect(same.confirmed).toBe(true); // nothing changed, nothing written
    const changed = await updateUsp(a.userId, a.brandId, q.id, { kind: "quality", title: "Great bread", details: { claim: "Great bread" }, confirmed: true });
    expect(changed.confirmed).toBe(false);
    expect((await setUspConfirmed(a.userId, a.brandId, q.id, true)).confirmed).toBe(true);
    expect((await setUspConfirmed(a.userId, a.brandId, q.id, false)).confirmed).toBe(false);
  });

  it("refuses to confirm a kind that needs no confirmation", async () => {
    const d = await createUsp(a.userId, a.brandId, { kind: "discount", title: "10% off", details: { percent: 10, on: "bread" } });
    await expect(setUspConfirmed(a.userId, a.brandId, d.id, true)).rejects.toBeInstanceOf(UspValidationError);
  });

  it("caps the active points per brand", async () => {
    const c = await makeOwner(db, { name: "Many Points" });
    for (let i = 0; i < MAX_ACTIVE_USPS; i++) {
      await db.withUser(c.userId, (tx) =>
        tx.query("insert into public.usps (brand_id, kind, title, sort) values ($1, 'custom', $2, $3)", [c.brandId, `Point ${i}`, i]),
      );
    }
    await expect(createUsp(c.userId, c.brandId, { kind: "custom", title: "One too many", details: {} })).rejects.toBeInstanceOf(UspLimitError);
  });
});

describe("seedUspsFromFacts", () => {
  it("turns price, offer and claim facts into unconfirmed USPs with the fact's source, and is idempotent", async () => {
    const c = await makeOwner(db, { name: "Seed Cafe", country: "GB" });
    const price = await addFact(db, c, { kind: "price", label: "Sourdough loaf", value: "£4.50", source: "website" });
    const offer = await addFact(db, c, { kind: "offer", value: "20% off cakes", source: "setup" });
    const claim = await addFact(db, c, { kind: "claim", value: "Baked fresh every morning", source: "owner" });
    const plain = await addFact(db, c, { kind: "offer", value: "Free coffee with any cake", source: "website" });
    const upload = await addFact(db, c, { kind: "price", label: "Menu", value: "See the menu", source: "upload" });
    await addFact(db, c, { kind: "product", value: "Bread", source: "website" }); // not a USP kind
    await addFact(db, c, { kind: "claim", value: "x".repeat(200), source: "website" }); // too long for a post line
    await addFact(db, c, { kind: "offer", value: "Old offer", source: "website", active: false }); // inactive

    expect(await hasAnyUsps(c.userId, c.brandId)).toBe(false);
    expect(await seedUspsFromFacts(c.brandId, c.userId)).toEqual({ created: 5 });
    expect(await seedUspsFromFacts(c.brandId, c.userId)).toEqual({ created: 0 });

    const list = await listUsps(c.userId, c.brandId);
    const by = (ref: string) => list.find((u) => u.sourceRef === ref)!;
    expect(by(price)).toMatchObject({ kind: "price", source: "website", confirmed: false, title: "Sourdough loaf £4.50" });
    expect(by(price).details).toMatchObject({ item: "Sourdough loaf", price: { amount: 4.5, currency: "GBP" } });
    expect(by(offer)).toMatchObject({ kind: "discount", source: "setup" });
    expect(by(offer).details).toMatchObject({ percent: 20, on: "cakes" });
    expect(by(claim)).toMatchObject({ kind: "quality", source: "owner", confirmed: false });
    expect(by(plain)).toMatchObject({ kind: "custom", source: "website" });
    expect(by(upload)).toMatchObject({ kind: "custom", source: "owner" }); // "See the menu" is not a price: kept as words
    expect(list.every((u) => u.confirmed === false)).toBe(true);
    expect(list).toHaveLength(5);
  });

  it("does not suggest again a point the owner removed, and ensureUspsSeeded runs only on an empty library", async () => {
    const c = await makeOwner(db, { name: "Seed Two" });
    await addFact(db, c, { kind: "claim", value: "Family run", source: "website" });
    expect(await ensureUspsSeeded(c.userId, c.brandId)).toEqual({ created: 1 });
    const [u] = await listUsps(c.userId, c.brandId);
    await setUspActive(c.userId, c.brandId, u.id, false);
    expect(await seedUspsFromFacts(c.brandId, c.userId)).toEqual({ created: 0 });
    await addFact(db, c, { kind: "claim", value: "Open late", source: "website" });
    expect(await ensureUspsSeeded(c.userId, c.brandId)).toEqual({ created: 0 }); // the library is not empty
    expect(await seedUspsFromFacts(c.brandId, c.userId)).toEqual({ created: 1 });
  });

  it("keeps the seeded link after the owner edits the point, so it is not suggested twice", async () => {
    const c = await makeOwner(db, { name: "Seed Three" });
    const f = await addFact(db, c, { kind: "claim", value: "Fresh daily", source: "website" });
    await seedUspsFromFacts(c.brandId, c.userId);
    const [u] = await listUsps(c.userId, c.brandId);
    const edited = await updateUsp(c.userId, c.brandId, u.id, { kind: "quality", title: "Fresh every day", details: { claim: "Fresh every day" } });
    expect(edited).toMatchObject({ source: "owner", sourceRef: f });
    expect(await seedUspsFromFacts(c.brandId, c.userId)).toEqual({ created: 0 });
  });

  it("reads prices only when the whole text is one price", () => {
    expect(parsePrice("£4.50")).toEqual({ amount: 4.5, currency: "GBP" });
    expect(parsePrice("Rs 1,200")).toEqual({ amount: 1200, currency: "INR" });
    expect(parsePrice("$12", "AU")).toEqual({ amount: 12, currency: "AUD" });
    expect(parsePrice("9.99 EUR")).toEqual({ amount: 9.99, currency: "EUR" });
    expect(parsePrice("from £4.50 to £6")).toBeNull();
    expect(parsePrice("free")).toBeNull();
    expect(uspFromFact({ kind: "claim", label: null, value: "x".repeat(61) })).toBeNull();
  });
});

describe("USP row-level security", () => {
  it("another brand's owner can neither read nor write a brand's USPs", async () => {
    const mine = await createUsp(a.userId, a.brandId, { kind: "custom", title: "Mine only", details: {} });

    // The library refuses on membership.
    await expect(listUsps(b.userId, a.brandId)).rejects.toBeInstanceOf(BrandAccessError);
    await expect(createUsp(b.userId, a.brandId, { kind: "custom", title: "Intruder", details: {} })).rejects.toBeInstanceOf(BrandAccessError);

    // The database refuses on its own, even if the check above were skipped.
    const seen = await db.withUser(b.userId, (tx) => tx.query("select id from public.usps where brand_id = $1", [a.brandId]));
    expect(seen).toEqual([]);
    await expect(
      db.withUser(b.userId, (tx) => tx.query("insert into public.usps (brand_id, kind, title) values ($1, 'custom', 'Intruder')", [a.brandId])),
    ).rejects.toThrow();
    const changed = await db.withUser(b.userId, (tx) => tx.query("update public.usps set title = 'Hacked' where id = $1 returning id", [mine.id]));
    expect(changed).toEqual([]);
    const gone = await db.withUser(b.userId, (tx) => tx.query("delete from public.usps where id = $1 returning id", [mine.id]));
    expect(gone).toEqual([]);
    expect((await getUsp(a.userId, a.brandId, mine.id))?.title).toBe("Mine only");
  });
});
