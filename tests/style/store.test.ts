import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { MockDb } from "@/lib/db/mock";
import { BrandAccessError } from "@/lib/brand/current";
import { getBrandKit } from "@/lib/kit/service";
import { suggestKit } from "@/lib/style/kit";
import { fixtureStyleRead } from "@/lib/style/read";
import { loadCurrentKit, saveKit } from "@/lib/style/store";
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
  await db.withAdmin((tx) => tx.query("update public.brand_memory set category = 'bakery' where brand_id = $1", [brand]));
});
afterAll(async () => closeTestDb(db));

describe("saving the suggested kit ('Keep my look')", () => {
  it("loads the current kit with the words the prompt needs", async () => {
    const ctx = await loadCurrentKit(owner, brand);
    expect(ctx.brandName).toBe("Corner Bakery");
    expect(ctx.sells).toBe("bakery");
    expect(ctx.kit.source).toBe("default");
  });

  it("saves colours, fonts, style, theme and source, and leaves the logo and mascot settings alone", async () => {
    const { kit: current } = await loadCurrentKit(owner, brand);
    const suggestion = suggestKit({ ...fixtureStyleRead(["#C0392B"]), theme: "premium", headline_font: "serif", mode: "light" }, current, "mixed");
    await saveKit(owner, brand, suggestion);
    const after = await getBrandKit(owner, brand);
    expect(after.colors).toEqual(suggestion.colors);
    expect(after.fonts).toEqual({ headline: "serif", body: "sans" });
    expect(after.themeId).toBe("premium");
    expect(after.source).toBe("mixed");
    expect(after.textLogo).toBe(current.textLogo);
    expect(after.mascot).toBe(current.mascot);
  });

  it("rejects an invalid kit and a non-member", async () => {
    const { kit } = await loadCurrentKit(owner, brand);
    await expect(saveKit(owner, brand, { ...kit, themeId: "nope" })).rejects.toThrow();
    await expect(saveKit(outsider, brand, kit)).rejects.toBeInstanceOf(BrandAccessError);
    await expect(loadCurrentKit(outsider, brand)).rejects.toBeInstanceOf(BrandAccessError);
  });
});
