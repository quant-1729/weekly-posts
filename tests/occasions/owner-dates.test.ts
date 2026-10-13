import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { MockDb } from "@/lib/db/mock";
import { BrandAccessError } from "@/lib/brand/current";
import { addOwnerDate, listOwnerDates, OwnerDateValidationError, removeOwnerDate } from "@/lib/occasions/owner-dates";
import { getOccasions } from "@/lib/occasions";
import { closeTestDb, createBrandFor, createUser, openTestDb } from "../brand/helpers";

let db: MockDb;
let owner: string, stranger: string;
let brand: string, otherBrand: string;

beforeAll(async () => {
  db = await openTestDb();
  owner = (await createUser(db)).id;
  stranger = (await createUser(db)).id;
  brand = await createBrandFor(db, owner, "Corner Bakery");
  otherBrand = await createBrandFor(db, stranger, "Harbour Dental");
});

afterAll(async () => {
  await closeTestDb(db);
});

describe("owner dates CRUD", () => {
  it("adds, lists and removes a date as the brand member", async () => {
    const a = await addOwnerDate(owner, brand, { date: "2020-11-12", name: "  Shop   anniversary " });
    expect(a).toMatchObject({ date: "2020-11-12", name: "Shop anniversary", yearly: true });
    const b = await addOwnerDate(owner, brand, { date: "2026-11-14", name: "Open day", yearly: false });
    expect(b.yearly).toBe(false);

    const list = await listOwnerDates(owner, brand);
    expect(list.map((d) => d.name)).toEqual(["Shop anniversary", "Open day"]);
    expect(list[0].date).toBe("2020-11-12"); // a plain YYYY-MM-DD string, not a Date

    expect(await removeOwnerDate(owner, brand, a.id)).toBe(true);
    expect(await removeOwnerDate(owner, brand, a.id)).toBe(false); // already gone
    expect((await listOwnerDates(owner, brand)).map((d) => d.name)).toEqual(["Open day"]);
    await removeOwnerDate(owner, brand, b.id);
  });

  it("feeds getOccasions", async () => {
    const d = await addOwnerDate(owner, brand, { date: "2019-11-12", name: "Shop anniversary" });
    const list = getOccasions({ country: "GB", weekStart: "2026-11-09", ownerDates: await listOwnerDates(owner, brand) });
    expect(list.find((o) => o.source === "owner")).toMatchObject({ name: "Shop anniversary", date: "2026-11-12" });
    await removeOwnerDate(owner, brand, d.id);
  });

  it("validates the name and the date", async () => {
    await expect(addOwnerDate(owner, brand, { date: "2026-11-12", name: "   " })).rejects.toBeInstanceOf(OwnerDateValidationError);
    await expect(addOwnerDate(owner, brand, { date: "2026-11-12", name: "x".repeat(121) })).rejects.toMatchObject({ field: "name" });
    await expect(addOwnerDate(owner, brand, { date: "2026-02-30", name: "Bad" })).rejects.toMatchObject({ field: "date" });
    await expect(addOwnerDate(owner, brand, { date: "12/11/2026", name: "Bad" })).rejects.toMatchObject({ field: "date" });
    expect(await listOwnerDates(owner, brand)).toEqual([]);
  });

  it("keeps a non-member out: no read, no write, no delete", async () => {
    const mine = await addOwnerDate(owner, brand, { date: "2026-12-01", name: "Private sale" });

    await expect(listOwnerDates(stranger, brand)).rejects.toBeInstanceOf(BrandAccessError);
    await expect(addOwnerDate(stranger, brand, { date: "2026-12-02", name: "Intruder" })).rejects.toBeInstanceOf(BrandAccessError);
    await expect(removeOwnerDate(stranger, brand, mine.id)).rejects.toBeInstanceOf(BrandAccessError);
    await expect(listOwnerDates(owner, "not-a-uuid")).rejects.toBeInstanceOf(BrandAccessError);

    // The stranger cannot use their own brand id to reach this brand's row either.
    expect(await removeOwnerDate(stranger, otherBrand, mine.id)).toBe(false);

    expect((await listOwnerDates(owner, brand)).map((d) => d.name)).toEqual(["Private sale"]);
    expect(await listOwnerDates(stranger, otherBrand)).toEqual([]);
    await removeOwnerDate(owner, brand, mine.id);
  });

  it("row-level security alone also blocks a non-member (without the app check)", async () => {
    const mine = await addOwnerDate(owner, brand, { date: "2026-12-03", name: "RLS check" });
    const seen = await db.withUser(stranger, (tx) => tx.query(`select id from public.owner_dates where brand_id = $1`, [brand]));
    expect(seen).toEqual([]);
    await expect(
      db.withUser(stranger, (tx) => tx.query(`insert into public.owner_dates (brand_id, date, name) values ($1, '2026-12-04', 'x')`, [brand])),
    ).rejects.toThrow();
    const del = await db.withUser(stranger, (tx) => tx.query(`delete from public.owner_dates where id = $1 returning id`, [mine.id]));
    expect(del).toEqual([]);
    await removeOwnerDate(owner, brand, mine.id);
  });
});
