import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import type { ReactElement } from "react";

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined }), redirect: () => undefined }));
vi.mock("@/app/(app)/brand/details-actions", () => ({
  createUspAction: vi.fn(),
  updateUspAction: vi.fn(),
  removeUspAction: vi.fn(),
  reorderUspsAction: vi.fn(),
  confirmUspAction: vi.fn(),
  createContactAction: vi.fn(),
  updateContactAction: vi.fn(),
  setContactDefaultAction: vi.fn(),
  removeContactAction: vi.fn(),
  checkContactLinkAction: vi.fn(),
}));

import { ContactsBlock, UspsBlock } from "@/components/brand/details-blocks";
import { createContact, listContacts } from "@/lib/contacts/service";
import type { MockDb } from "@/lib/db/mock";
import { listUsps } from "@/lib/usps/service";
import { addFact, closeDb, makeOwner, openDb, type Owner } from "../helpers/details";

let db: MockDb;
let o: Owner;

beforeAll(async () => {
  db = await openDb();
  o = await makeOwner(db, { name: "Corner Bakery", country: "GB", city: "Leeds", website: "https://bakery.example.com" });
  await addFact(db, o, { kind: "claim", value: "Baked fresh every morning", source: "website" });
  await addFact(db, o, { kind: "price", label: "Sourdough loaf", value: "£4.50", source: "setup" });
  await addFact(db, o, { kind: "phone", value: "020 7946 0958", source: "website" });
  await addFact(db, o, { kind: "address", value: "12 High Street, Leeds", source: "website" });
});
afterAll(() => closeDb(db));

const html = async (el: Promise<ReactElement>) => renderToString(await el);

describe("Brand page sections", () => {
  it("shows suggested selling points, with the confirm box for claims that need one", async () => {
    expect(await listUsps(o.userId, o.brandId)).toHaveLength(0);
    const out = await html(UspsBlock({ userId: o.userId, brandId: o.brandId }));
    expect(await listUsps(o.userId, o.brandId)).toHaveLength(2); // seeded on first view
    expect(out).toContain("Baked fresh every morning");
    expect(out).toContain("Sourdough loaf £4.50");
    expect(out).toContain("Suggested from your website");
    expect(out).toContain("From your setup answers");
    expect(out).toContain("I confirm this is true");
    expect(out).toContain("Posts will not use this until you confirm it.");
    expect(out).toContain("Add a selling point");
    expect(out).toContain("Move up");
    await html(UspsBlock({ userId: o.userId, brandId: o.brandId }));
    expect(await listUsps(o.userId, o.brandId)).toHaveLength(2); // not seeded twice
  });

  it("shows the contact set with international phone format, badges and the show-on-posts switch", async () => {
    const out = await html(ContactsBlock({ userId: o.userId, brandId: o.brandId }));
    const list = await listContacts(o.userId, o.brandId);
    expect(list.map((c) => c.kind)).toEqual(["phone", "website", "address"]);
    expect(out).toContain("+44 20 7946 0958");
    expect(out).toContain("+442079460958");
    expect(out).toContain("bakery.example.com");
    expect(out).toContain("12 High Street, Leeds");
    expect(out).toContain("Not checked yet");
    expect(out).toContain("Check link");
    expect(out).toContain("Show on new posts");
    expect(out).toContain("From your website");
    expect(out).toContain("Add a contact detail");
  });

  it("shows a verified link as such", async () => {
    const c = await createContact(o.userId, o.brandId, { kind: "booking", value: "book.example.com", label: "Book a table" });
    await db.withUser(o.userId, (tx) => tx.query("update public.contact_points set verified_at = now() where id = $1", [c.id]));
    const out = await html(ContactsBlock({ userId: o.userId, brandId: o.brandId }));
    expect(out).toContain("Book a table");
    expect(out).toContain("Link works");
  });
});
