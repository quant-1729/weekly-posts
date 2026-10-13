import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined, push: () => undefined }) }));
vi.mock("@/app/(app)/brand/actions", () => ({ addOwnerDateAction: vi.fn(), removeOwnerDateAction: vi.fn() }));

import { DatesPanel } from "@/components/brand/dates-section";
import { UpcomingList } from "@/components/brand/upcoming-list";
import { BrandAccessError } from "@/lib/brand/current";
import type { MockDb } from "@/lib/db/mock";
import { fill, s } from "@/lib/i18n/strings";
import { getUpcoming, upcomingWeeks, UPCOMING_WEEKS } from "@/lib/memory/upcoming";
import { addOwnerDate, listOwnerDates, OwnerDateValidationError, removeOwnerDate } from "@/lib/occasions/owner-dates";
import { closeTestDb, createBrandFor, createUser, openTestDb } from "../brand/helpers";

let db: MockDb;
let owner: string;
let outsider: string;
let brand: string;

beforeAll(async () => {
  db = await openTestDb();
  owner = (await createUser(db)).id;
  outsider = (await createUser(db)).id;
  brand = await createBrandFor(db, owner, "Corner Bakery");
  await db.withAdmin((tx) =>
    tx.query("update public.brand_memory set country = 'GB', region = 'GB-ENG', timezone = 'Europe/London', category = 'bakery' where brand_id = $1", [brand]),
  );
});
afterAll(async () => {
  await closeTestDb(db);
});
beforeEach(async () => {
  await db.withAdmin((tx) => tx.query("delete from public.owner_dates where brand_id = $1", [brand]));
});

// Tuesday 13 October 2026 in London.
const NOW = new Date("2026-10-13T09:00:00Z");

describe("your dates: add, list, remove", () => {
  it("adds a date with a name and 'every year', lists it, and removes it", async () => {
    const yearly = await addOwnerDate(owner, brand, { date: "2019-11-12", name: "Shop anniversary", yearly: true });
    const once = await addOwnerDate(owner, brand, { date: "2026-12-12", name: "Open day", yearly: false });
    expect(await listOwnerDates(owner, brand)).toEqual([
      { id: yearly.id, date: "2019-11-12", name: "Shop anniversary", yearly: true },
      { id: once.id, date: "2026-12-12", name: "Open day", yearly: false },
    ]);
    expect(await removeOwnerDate(owner, brand, yearly.id)).toBe(true);
    expect((await listOwnerDates(owner, brand)).map((d) => d.name)).toEqual(["Open day"]);
  });

  it("validates the name and the date", async () => {
    await expect(addOwnerDate(owner, brand, { date: "2026-13-01", name: "Bad date" })).rejects.toBeInstanceOf(OwnerDateValidationError);
    await expect(addOwnerDate(owner, brand, { date: "2026-12-01", name: "" })).rejects.toMatchObject({ field: "name" });
    expect(await listOwnerDates(owner, brand)).toEqual([]);
  });

  it("is members only", async () => {
    await expect(listOwnerDates(outsider, brand)).rejects.toBeInstanceOf(BrandAccessError);
    await expect(addOwnerDate(outsider, brand, { date: "2026-12-01", name: "Nope" })).rejects.toBeInstanceOf(BrandAccessError);
    await expect(removeOwnerDate(outsider, brand, "11111111-1111-4111-8111-111111111111")).rejects.toBeInstanceOf(BrandAccessError);
    await expect(getUpcoming(outsider, brand, NOW)).rejects.toBeInstanceOf(BrandAccessError);
  });

  it("the panel lists dates with 'every year' and has the add form", async () => {
    const d = await addOwnerDate(owner, brand, { date: "2019-11-12", name: "Shop anniversary" });
    const html = renderToString(createElement(DatesPanel, { brandId: brand, dates: await listOwnerDates(owner, brand) }));
    expect(html).toContain("Shop anniversary");
    expect(html).toContain("12 Nov");
    expect(html).toContain(`(${s.brandV2.dates.everyYear})`);
    expect(html).toContain(s.brandV2.dates.add);
    expect(html).toContain('type="date"');
    expect(html).toContain(s.brandV2.dates.yearly);
    expect(html).toContain(s.brandV2.dates.remove);
    expect(renderToString(createElement(DatesPanel, { brandId: brand, dates: [] }))).toContain(s.brandV2.dates.empty);
    await removeOwnerDate(owner, brand, d.id);
  });
});

describe("the next 8 weeks of occasions", () => {
  it("lists 8 weeks from this Monday, week by week, with the owner's date in its week", async () => {
    await addOwnerDate(owner, brand, { date: "2019-11-12", name: "Shop anniversary" });
    const weeks = await getUpcoming(owner, brand, NOW);
    expect(UPCOMING_WEEKS).toBe(8);
    expect(weeks.map((w) => w.weekStart)).toEqual([
      "2026-10-12", "2026-10-19", "2026-10-26", "2026-11-02", "2026-11-09", "2026-11-16", "2026-11-23", "2026-11-30",
    ]);
    const find = (name: string) => weeks.find((w) => w.occasions.some((o) => o.name === name));
    expect(find("Shop anniversary")?.weekStart).toBe("2026-11-09");
    expect(find("Halloween")?.weekStart).toBe("2026-10-26");
    expect(find("Black Friday")?.weekStart).toBe("2026-11-23");
    const mine = weeks.flatMap((w) => w.occasions).find((o) => o.name === "Shop anniversary")!;
    expect(mine).toMatchObject({ date: "2026-11-12", source: "owner", sensitive: false });
  });

  it("marks sensitive days", () => {
    const weeks = upcomingWeeks({ country: "GB", region: "GB-ENG", timezone: "Europe/London", category: "bakery", ownerDates: [], now: NOW });
    const remembrance = weeks.flatMap((w) => w.occasions).find((o) => /remembrance/i.test(o.name))!;
    expect(remembrance.date).toBe("2026-11-08");
    expect(remembrance.sensitive).toBe(true);
    const halloween = weeks.flatMap((w) => w.occasions).find((o) => o.name === "Halloween")!;
    expect(halloween.sensitive).toBe(false);

    const html = renderToString(createElement(UpcomingList, { weeks }));
    expect(html).toContain(s.brandV2.dates.upcomingTitle);
    expect(html.split(s.brandV2.dates.sensitive).length - 1).toBeGreaterThanOrEqual(1);
    expect(html).toContain("Remembrance Sunday");
    expect(html).toContain(fill(s.brandV2.dates.weekOf, { date: "12 Oct" }));
    expect(html.split("data-week=").length - 1).toBe(8);
    expect(html).toContain(s.brandV2.dates.nothing); // empty weeks say so
  });

  it("leaves out days already past, and uses the brand's time zone for 'today'", () => {
    const late = new Date("2026-10-31T23:30:00Z"); // already 1 Nov in Auckland, still 31 Oct in London
    const london = upcomingWeeks({ country: "GB", region: null, timezone: "Europe/London", category: null, ownerDates: [], now: late });
    expect(london.flatMap((w) => w.occasions).some((o) => o.name === "Halloween")).toBe(true);
    const auckland = upcomingWeeks({ country: "NZ", region: null, timezone: "Pacific/Auckland", category: null, ownerDates: [], now: late });
    expect(auckland[0].weekStart).toBe("2026-10-26");
    expect(auckland.flatMap((w) => w.occasions).some((o) => o.name === "Halloween")).toBe(false);
  });

  it("works for a brand with no country yet: only the owner's dates", () => {
    const weeks = upcomingWeeks({
      country: null,
      region: null,
      timezone: "UTC",
      category: null,
      ownerDates: [{ date: "2026-11-02", name: "Staff day", yearly: false }],
      now: NOW,
    });
    expect(weeks).toHaveLength(8);
    expect(weeks.flatMap((w) => w.occasions).find((o) => o.name === "Staff day")?.date).toBe("2026-11-02");
  });
});
