import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BrandAccessError } from "@/lib/brand/current";
import {
  ContactDuplicateError,
  ContactNotFoundError,
  ContactValidationError,
} from "@/lib/contacts/errors";
import {
  createContact,
  deleteContact,
  ensureContactsImported,
  hasAnyContacts,
  importContactsFromFacts,
  isReachable,
  listContacts,
  listDefaultContacts,
  setContactDefault,
  updateContact,
  verifyContact,
} from "@/lib/contacts/service";
import type { MockDb } from "@/lib/db/mock";
import type { FetchEnv, Transport } from "@/lib/website/fetch";
import { addFact, closeDb, makeOwner, openDb, type Owner } from "../helpers/details";

let db: MockDb;
let a: Owner;
let b: Owner;

beforeAll(async () => {
  db = await openDb();
  a = await makeOwner(db, { name: "Corner Bakery", country: "GB" });
  b = await makeOwner(db, { name: "Harbour Dental", country: "US", timezone: "America/Los_Angeles" });
});
afterAll(() => closeDb(db));

/** A fake network: every host resolves to a public address and answers with `status` and `type`. */
function fakeNet(status: number, type = "text/html; charset=utf-8"): FetchEnv & { calls: string[] } {
  const calls: string[] = [];
  const transport: Transport = async (req) => {
    calls.push(req.url.href);
    return {
      status,
      headers: { "content-type": type },
      readBody: async () => ({ body: Buffer.from("<html></html>"), truncated: false }),
      destroy: () => {},
    };
  };
  return { transport, resolver: async () => [{ address: "93.184.216.34", family: 4 }], calls };
}

describe("contact service", () => {
  it("creates normalised contacts in the brand's country and lists them by kind", async () => {
    const phone = await createContact(a.userId, a.brandId, { kind: "phone", value: "020 7946 0958" });
    await createContact(a.userId, a.brandId, { kind: "website", value: "Bakery.example.com" });
    await createContact(a.userId, a.brandId, { kind: "email", value: "Hello@Bakery.example.com", isDefault: false });
    expect(phone).toMatchObject({ value: "+442079460958", display: "+44 20 7946 0958", isDefault: true, source: "owner", verifiedAt: null });

    const list = await listContacts(a.userId, a.brandId);
    expect(list.map((c) => c.kind)).toEqual(["phone", "website", "email"]);
    expect(list[1].value).toBe("https://bakery.example.com");
    expect(list[2]).toMatchObject({ value: "hello@bakery.example.com", isDefault: false });
    expect((await listDefaultContacts(a.userId, a.brandId)).map((c) => c.kind)).toEqual(["phone", "website"]);
  });

  it("reads a US brand's numbers as US numbers", async () => {
    const c = await createContact(b.userId, b.brandId, { kind: "phone", value: "(415) 555-2671" });
    expect(c.value).toBe("+14155552671");
  });

  it("rejects bad input with field codes and writes nothing", async () => {
    const before = (await listContacts(a.userId, a.brandId)).length;
    await expect(createContact(a.userId, a.brandId, { kind: "phone", value: "12345" })).rejects.toMatchObject({ fieldErrors: { value: "invalid_phone" } });
    await expect(createContact(a.userId, a.brandId, { kind: "website", value: "javascript:alert(1)" })).rejects.toBeInstanceOf(ContactValidationError);
    await expect(createContact(a.userId, a.brandId, { kind: "website", value: "http://127.0.0.1" })).rejects.toBeInstanceOf(ContactValidationError);
    await expect(createContact(a.userId, a.brandId, { kind: "email", value: "nope" })).rejects.toMatchObject({ fieldErrors: { value: "invalid_email" } });
    await expect(createContact(a.userId, a.brandId, { kind: "fax", value: "1" })).rejects.toBeInstanceOf(ContactValidationError);
    expect((await listContacts(a.userId, a.brandId)).length).toBe(before);
  });

  it("refuses duplicates (after normalising) and a second hours entry", async () => {
    await expect(createContact(a.userId, a.brandId, { kind: "phone", value: "+44 20 7946 0958" })).rejects.toBeInstanceOf(ContactDuplicateError);
    const days = { mon: [{ open: "09:00", close: "17:00" }], tue: [{ open: "09:00", close: "17:00" }] };
    const hours = await createContact(a.userId, a.brandId, { kind: "hours", days });
    expect(hours).toMatchObject({ kind: "hours", display: "Mon-Tue 9:00-17:00, Wed-Sun closed" });
    await expect(createContact(a.userId, a.brandId, { kind: "hours", days: { mon: [{ open: "10:00", close: "12:00" }] } })).rejects.toMatchObject({ single: true });
    // Editing it works.
    const edited = await updateContact(a.userId, a.brandId, hours.id, { days: { sat: [{ open: "10:00", close: "14:00" }] } });
    expect(edited.display).toBe("Mon-Fri closed, Sat 10:00-14:00, Sun closed");
  });

  it("edits keep the kind, clear verification when the value changes, and toggle the default", async () => {
    const site = await createContact(a.userId, a.brandId, { kind: "booking", value: "book.example.com/table" });
    const checked = await verifyContact(a.userId, a.brandId, site.id, fakeNet(200));
    expect(checked?.reachable).toBe(true);
    expect((await listContacts(a.userId, a.brandId)).find((c) => c.id === site.id)?.verifiedAt).toMatch(/^\d{4}-\d\d-\d\dT/);

    const same = await updateContact(a.userId, a.brandId, site.id, { kind: "phone", value: "book.example.com/table", isDefault: false });
    expect(same).toMatchObject({ kind: "booking", isDefault: false });
    expect(same.verifiedAt).not.toBeNull(); // the address did not change
    const moved = await updateContact(a.userId, a.brandId, site.id, { value: "book.example.com/new" });
    expect(moved).toMatchObject({ value: "https://book.example.com/new", verifiedAt: null, isDefault: false });
    expect((await setContactDefault(a.userId, a.brandId, site.id, true)).isDefault).toBe(true);

    await expect(updateContact(a.userId, a.brandId, site.id, { value: "not valid" })).rejects.toBeInstanceOf(ContactValidationError);
    expect(await deleteContact(a.userId, a.brandId, site.id)).toBe(true);
    await expect(updateContact(a.userId, a.brandId, site.id, { value: "x.example.com" })).rejects.toBeInstanceOf(ContactNotFoundError);
  });

  it("syncs the Instagram contact with brand memory", async () => {
    await createContact(a.userId, a.brandId, { kind: "instagram", value: "https://instagram.com/Corner.Bakery" });
    const mem = () => db.withUser(a.userId, (tx) => tx.query<{ h: string; s: string }>("select instagram_handle as h, instagram_handle_source as s from public.brand_memory where brand_id = $1", [a.brandId]));
    expect(await mem()).toEqual([{ h: "corner.bakery", s: "owner" }]);
    const [ig] = (await listContacts(a.userId, a.brandId)).filter((c) => c.kind === "instagram");
    await updateContact(a.userId, a.brandId, ig.id, { value: "@bakery.leeds" });
    expect(await mem()).toEqual([{ h: "bakery.leeds", s: "owner" }]);
  });
});

describe("reachability", () => {
  it("counts a page that answers; never throws", async () => {
    expect(await isReachable("https://ok.example.com", fakeNet(200))).toBe(true);
    expect(await isReachable("https://moved.example.com", fakeNet(301))).toBe(true);
    expect(await isReachable("https://gone.example.com", fakeNet(404))).toBe(false);
    expect(await isReachable("https://broken.example.com", fakeNet(500))).toBe(false);
    expect(await isReachable("https://doc.example.com", fakeNet(200, "application/pdf"))).toBe(true); // there, but not a web page
    expect(await isReachable("https://nowhere.example.com", { resolver: async () => { throw new Error("nxdomain"); } })).toBe(false);
    expect(await isReachable("http://127.0.0.1/", {})).toBe(false); // the SSRF rules apply
  });

  it("clears verified_at when the page stops answering, and ignores contacts that are not links", async () => {
    const c = await createContact(b.userId, b.brandId, { kind: "map", value: "maps.example.com/place" });
    expect((await verifyContact(b.userId, b.brandId, c.id, fakeNet(200)))?.reachable).toBe(true);
    expect(await verifyContact(b.userId, b.brandId, c.id, fakeNet(404))).toEqual({ reachable: false, verifiedAt: null });
    const [phone] = (await listContacts(b.userId, b.brandId)).filter((x) => x.kind === "phone");
    const net = fakeNet(200);
    expect(await verifyContact(b.userId, b.brandId, phone.id, net)).toBeNull();
    expect(net.calls).toEqual([]);
  });
});

describe("importContactsFromFacts", () => {
  it("fills the contact set from facts and brand memory, once", async () => {
    const c = await makeOwner(db, { name: "Import Cafe", country: "GB", city: "Leeds", website: "https://import.example.com" });
    await db.withUser(c.userId, (tx) =>
      tx.query("update public.brand_memory set whatsapp_number = '07911 123456', instagram_handle = 'import.cafe', instagram_handle_source = 'website' where brand_id = $1", [c.brandId]),
    );
    await addFact(db, c, { kind: "phone", value: "Call us on 0113 496 0000", source: "website" });
    await addFact(db, c, { kind: "phone", value: "not a number", source: "website" });
    await addFact(db, c, { kind: "email", value: "Hello@Import.example.com", source: "setup" });
    await addFact(db, c, { kind: "address", value: "12 High Street, Leeds LS1 4AB", source: "website" });
    await addFact(db, c, { kind: "hours", value: "Mon-Sat 9 to 5", source: "setup" });
    await addFact(db, c, { kind: "hours", value: "Old hours", source: "setup", active: false });

    expect(await hasAnyContacts(c.userId, c.brandId)).toBe(false);
    const first = await importContactsFromFacts(c.brandId, c.userId);
    expect(first.created).toBe(7);
    expect(await importContactsFromFacts(c.brandId, c.userId)).toEqual({ created: 0 });

    const list = await listContacts(c.userId, c.brandId);
    const one = (k: string) => list.find((x) => x.kind === k)!;
    expect(one("phone")).toMatchObject({ value: "+441134960000", source: "website" });
    expect(one("website")).toMatchObject({ value: "https://import.example.com", source: "setup" });
    expect(one("whatsapp")).toMatchObject({ value: "+447911123456" });
    expect(one("instagram")).toMatchObject({ value: "import.cafe", source: "website" });
    expect(one("email")).toMatchObject({ value: "hello@import.example.com", source: "setup" });
    expect(one("address")).toMatchObject({ display: "12 High Street, Leeds LS1 4AB", isDefault: true });
    expect(one("hours")).toMatchObject({ value: "Mon-Sat 9 to 5", details: { imported: true } });
    expect(list.filter((x) => x.kind === "phone")).toHaveLength(1);
  });

  it("website contacts of a kind the owner already has a default for are kept but not shown on posts by default", async () => {
    const c = await makeOwner(db, { name: "Dup Defaults", country: "GB" });
    await createContact(c.userId, c.brandId, { kind: "phone", value: "+44 20 7946 0000" });
    await createContact(c.userId, c.brandId, { kind: "email", value: "owner@dup.example.com", isDefault: false });
    await addFact(db, c, { kind: "phone", value: "0113 496 0000", source: "website" });
    await addFact(db, c, { kind: "phone", value: "+44 20 7946 0000", source: "website" }); // the owner's own number: skipped
    await addFact(db, c, { kind: "email", value: "hello@dup.example.com", source: "website" });
    await addFact(db, c, { kind: "address", value: "12 High Street, Leeds LS1 4AB", source: "website" });
    await addFact(db, c, { kind: "address", value: "9 Low Road, Leeds LS2 7AB", source: "website" });
    expect(await importContactsFromFacts(c.brandId, c.userId)).toEqual({ created: 4 });

    const list = await listContacts(c.userId, c.brandId);
    // Found by value, not position: the list is ordered by display text.
    const phones = list.filter((x) => x.kind === "phone");
    expect(phones).toHaveLength(2);
    expect(phones.find((p) => p.value === "+442079460000")).toMatchObject({ isDefault: true, source: "owner" });
    expect(phones.find((p) => p.value === "+441134960000")).toMatchObject({ isDefault: false, source: "website" });
    // The owner's email is switched off, so the website one may be the default.
    expect(list.find((x) => x.value === "hello@dup.example.com")?.isDefault).toBe(true);
    // Two website addresses: only the first is shown by default.
    // Found by text: rows imported together share a timestamp, so their list order is not fixed.
    const addresses = list.filter((x) => x.kind === "address");
    expect(addresses).toHaveLength(2);
    expect(addresses.find((x) => x.display === "12 High Street, Leeds LS1 4AB")).toMatchObject({ isDefault: true });
    expect(addresses.find((x) => x.display === "9 Low Road, Leeds LS2 7AB")).toMatchObject({ isDefault: false });
  });

  it("createContact takes a source of owner (default) or setup, and nothing else", async () => {
    const c = await makeOwner(db, { name: "Sources", country: "GB" });
    expect((await createContact(c.userId, c.brandId, { kind: "email", value: "a@src.example.com" })).source).toBe("owner");
    expect((await createContact(c.userId, c.brandId, { kind: "email", value: "b@src.example.com", source: "setup" })).source).toBe("setup");
    expect((await createContact(c.userId, c.brandId, { kind: "email", value: "c@src.example.com", source: "website" } as never)).source).toBe("owner");
  });

  it("falls back to the city as a hidden address, and ensureContactsImported runs only on an empty set", async () => {
    const c = await makeOwner(db, { name: "City Only", country: "GB", city: "Leeds" });
    expect(await ensureContactsImported(c.userId, c.brandId)).toEqual({ created: 1 });
    expect(await listContacts(c.userId, c.brandId)).toMatchObject([{ kind: "address", display: "Leeds", isDefault: false, details: { cityOnly: true } }]);
    await addFact(db, c, { kind: "email", value: "hi@city.example.com" });
    expect(await ensureContactsImported(c.userId, c.brandId)).toEqual({ created: 0 });
    expect(await importContactsFromFacts(c.brandId, c.userId)).toEqual({ created: 1 });
  });

  it("imports only once per brand: an owner who deletes every contact isn't refilled on the next visit", async () => {
    const c = await makeOwner(db, { name: "Deleted All", country: "GB", city: "York" });
    await addFact(db, c, { kind: "email", value: "hi@deleted.example.com" });
    expect((await ensureContactsImported(c.userId, c.brandId)).created).toBeGreaterThan(0);
    for (const x of await listContacts(c.userId, c.brandId)) await deleteContact(c.userId, c.brandId, x.id);
    expect(await listContacts(c.userId, c.brandId)).toEqual([]);
    // A later visit (past the same-visit grace period): nothing comes back.
    await db.withAdmin((tx) => tx.query("update public.brand_memory set details_seeded_at = now() - interval '2 minutes' where brand_id = $1", [c.brandId]));
    expect(await ensureContactsImported(c.userId, c.brandId)).toEqual({ created: 0 });
    expect(await listContacts(c.userId, c.brandId)).toEqual([]);
  });

  it("does not add the city when there is a real address", async () => {
    const c = await makeOwner(db, { name: "Has Address", country: "GB", city: "Leeds" });
    await addFact(db, c, { kind: "address", value: "1 The Row, Leeds", source: "owner" });
    await importContactsFromFacts(c.brandId, c.userId);
    const list = await listContacts(c.userId, c.brandId);
    expect(list.map((x) => x.display)).toEqual(["1 The Row, Leeds"]);
  });
});

describe("contact row-level security", () => {
  it("another brand's owner can neither read nor write a brand's contacts", async () => {
    const [mine] = await listContacts(a.userId, a.brandId);
    await expect(listContacts(b.userId, a.brandId)).rejects.toBeInstanceOf(BrandAccessError);
    await expect(createContact(b.userId, a.brandId, { kind: "email", value: "x@example.com" })).rejects.toBeInstanceOf(BrandAccessError);
    expect(await db.withUser(b.userId, (tx) => tx.query("select id from public.contact_points where brand_id = $1", [a.brandId]))).toEqual([]);
    await expect(
      db.withUser(b.userId, (tx) => tx.query("insert into public.contact_points (brand_id, kind, value) values ($1, 'email', 'x@example.com')", [a.brandId])),
    ).rejects.toThrow();
    expect(await db.withUser(b.userId, (tx) => tx.query("update public.contact_points set value = 'x' where id = $1 returning id", [mine.id]))).toEqual([]);
    expect(await db.withUser(b.userId, (tx) => tx.query("delete from public.contact_points where id = $1 returning id", [mine.id]))).toEqual([]);
    expect(await deleteContact(b.userId, a.brandId, mine.id).catch(() => "refused")).toBe("refused");
  });
});
