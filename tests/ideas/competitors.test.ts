import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BrandAccessError } from "@/lib/brand/current";
import type { MockDb } from "@/lib/db/mock";
import {
  CompetitorError,
  ResearchSettingsError,
  createCompetitor,
  deleteCompetitor,
  getResearchSettings,
  listCompetitors,
  saveResearchSettings,
  updateCompetitor,
  validateCompetitor,
} from "@/lib/ideas/competitors";
import { normalizeYoutubeHandle } from "@/lib/ideas/competitors";
import { MAX_COMPETITORS } from "@/lib/ideas/types";
import { closeDb, dnsOk, makeShop, openDb, rows, type Shop } from "./helpers";

let db: MockDb;
let a: Shop;
let b: Shop;

beforeAll(async () => {
  db = await openDb();
  a = await makeShop(db, { name: "Shop A" });
  b = await makeShop(db, { name: "Shop B" });
});
afterAll(async () => {
  await closeDb(db);
});

const opts = { resolver: dnsOk };
const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return null;
  } catch (e) {
    return e instanceof CompetitorError ? e.code : String(e);
  }
};

describe("validating a competitor", () => {
  it("needs a name of 1 to 80 characters", async () => {
    expect(await code(validateCompetitor({ name: "  " }, opts))).toBe("name");
    expect(await code(validateCompetitor({ name: "x".repeat(81) }, opts))).toBe("name");
    expect((await validateCompetitor({ name: "  Rival   Bakes " }, opts)).name).toBe("Rival Bakes");
  });

  it("accepts a public https website, adds https:// and upgrades http://", async () => {
    expect((await validateCompetitor({ name: "R", website: "rival.example.com" }, opts)).website).toBe("https://rival.example.com/");
    expect((await validateCompetitor({ name: "R", website: "http://rival.example.com/menu" }, opts)).website).toBe("https://rival.example.com/menu");
  });

  it("refuses private, local, credentialed and non-web addresses, and names that do not resolve", async () => {
    for (const bad of ["http://localhost:3000", "https://192.168.1.5/", "https://10.0.0.1", "https://user:pw@rival.example.com", "ftp://rival.example.com", "javascript:alert(1)", "not a url", "https://169.254.169.254/latest"]) {
      expect(await code(validateCompetitor({ name: "R", website: bad }, opts)), bad).toBe("website");
    }
    const nxdomain = async () => {
      throw new Error("ENOTFOUND");
    };
    expect(await code(validateCompetitor({ name: "R", website: "https://nope.example.com" }, { resolver: nxdomain }))).toBe("website");
    const privateDns = async () => [{ address: "10.1.2.3" }];
    expect(await code(validateCompetitor({ name: "R", website: "https://sneaky.example.com" }, { resolver: privateDns }))).toBe("website");
  });

  it("reads Instagram handles from @name, name and profile links, and refuses the rest", async () => {
    for (const ok of ["@Rival.Bakes", "rival.bakes", "https://www.instagram.com/rival.bakes/", "instagram.com/rival.bakes?hl=en"]) {
      expect((await validateCompetitor({ name: "R", instagram: ok }, opts)).instagramHandle, ok).toBe("rival.bakes");
    }
    for (const bad of ["a b", "https://www.instagram.com/p/ABC123/", "x".repeat(31), "@@@", "https://example.com/rival"]) {
      expect(await code(validateCompetitor({ name: "R", instagram: bad }, opts)), bad).toBe("instagram");
    }
  });

  it("reads YouTube handles and channel ids", () => {
    expect(normalizeYoutubeHandle("@RivalBakes")).toBe("@rivalbakes");
    expect(normalizeYoutubeHandle("https://www.youtube.com/@rivalbakes")).toBe("@rivalbakes");
    expect(normalizeYoutubeHandle("https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv")).toBe("UCabcdefghijklmnopqrstuv");
    expect(normalizeYoutubeHandle("https://example.com/@rival")).toBeNull();
    expect(normalizeYoutubeHandle("a b")).toBeNull();
  });
});

describe("the competitors service", () => {
  it("creates, lists, updates and deletes", async () => {
    const c = await createCompetitor(a.userId, a.brandId, { name: "Rival Bakes", website: "rival.example.com", instagram: "@rival.bakes" }, opts);
    expect(c).toMatchObject({ name: "Rival Bakes", website: "https://rival.example.com/", instagramHandle: "rival.bakes", youtubeHandle: null });
    expect((await listCompetitors(a.userId, a.brandId)).map((x) => x.name)).toEqual(["Rival Bakes"]);

    const u = await updateCompetitor(a.userId, a.brandId, c.id, { name: "Rival Bakery", website: "", instagram: "", youtube: "@rivalbakery" }, opts);
    expect(u).toMatchObject({ name: "Rival Bakery", website: null, instagramHandle: null, youtubeHandle: "@rivalbakery" });

    await deleteCompetitor(a.userId, a.brandId, c.id);
    expect(await listCompetitors(a.userId, a.brandId)).toEqual([]);
    expect(await code(deleteCompetitor(a.userId, a.brandId, c.id))).toBe("not_found");
    expect(await code(updateCompetitor(a.userId, a.brandId, "not-a-uuid", { name: "x" }, opts))).toBe("not_found");
  });

  it("stops at MAX_COMPETITORS", async () => {
    for (let i = 0; i < MAX_COMPETITORS; i++) await createCompetitor(a.userId, a.brandId, { name: `Rival ${i}` }, opts);
    expect(await code(createCompetitor(a.userId, a.brandId, { name: "One too many" }, opts))).toBe("limit");
    expect(await listCompetitors(a.userId, a.brandId)).toHaveLength(MAX_COMPETITORS);
    await rows(db, "delete from public.competitors where brand_id = $1", [a.brandId]);
  });

  it("another brand's member cannot list, add to, change or delete them", async () => {
    const c = await createCompetitor(a.userId, a.brandId, { name: "Rival" }, opts);
    await expect(listCompetitors(b.userId, a.brandId)).rejects.toBeInstanceOf(BrandAccessError);
    await expect(createCompetitor(b.userId, a.brandId, { name: "Spy" }, opts)).rejects.toBeInstanceOf(BrandAccessError);
    await expect(deleteCompetitor(b.userId, a.brandId, c.id)).rejects.toBeInstanceOf(BrandAccessError);
    // Asking as B for A's id inside B's own brand finds nothing either.
    expect(await code(deleteCompetitor(b.userId, b.brandId, c.id))).toBe("not_found");
    expect(await code(updateCompetitor(b.userId, b.brandId, c.id, { name: "Hacked" }, opts))).toBe("not_found");
    expect((await listCompetitors(a.userId, a.brandId))[0].name).toBe("Rival");
  });
});

describe("row-level security on the new tables", () => {
  it("every Ideas table has it switched on", async () => {
    const r = await rows<{ relname: string; relrowsecurity: boolean }>(
      db,
      `select relname, relrowsecurity from pg_class where relnamespace = 'public'::regnamespace
         and relname in ('competitors', 'research_runs', 'trend_cards', 'post_ideas', 'competitor_snapshots', 'post_metrics', 'growth_reports')`,
    );
    expect(r).toHaveLength(7);
    expect(r.every((x) => x.relrowsecurity)).toBe(true);
  });

  it("another brand's user reads nothing, whatever they ask for", async () => {
    const asB = <T,>(sql: string, p: unknown[] = []) => db.withUser(b.userId, (tx) => tx.query<T>(sql, p));
    expect(await asB("select id from public.competitors")).toHaveLength(0);
    expect(await asB("select id from public.competitors where brand_id = $1", [a.brandId])).toHaveLength(0);
    await expect(asB("insert into public.competitors (brand_id, name) values ($1, 'Spy')", [a.brandId])).rejects.toThrow();
    expect(await asB("update public.competitors set name = 'x' where brand_id = $1 returning id", [a.brandId])).toHaveLength(0);
    expect(await asB("delete from public.competitors where brand_id = $1 returning id", [a.brandId])).toHaveLength(0);
    expect(await rows(db, "select id from public.competitors where brand_id = $1", [a.brandId])).toHaveLength(1);
  });
});

describe("research settings (focus and the weekly switch)", () => {
  it("defaults to on with no focus, and saves a one-line focus", async () => {
    expect(await getResearchSettings(a.userId, a.brandId)).toEqual({ focus: null, on: true });
    const saved = await saveResearchSettings(a.userId, a.brandId, { focus: "  wedding\n cakes  ", on: false });
    expect(saved).toEqual({ focus: "wedding cakes", on: false });
    expect(await getResearchSettings(a.userId, a.brandId)).toEqual({ focus: "wedding cakes", on: false });
    expect((await saveResearchSettings(a.userId, a.brandId, { focus: "   ", on: true })).focus).toBeNull();
  });

  it("refuses a focus over 200 characters and a switch that is not a boolean", async () => {
    await expect(saveResearchSettings(a.userId, a.brandId, { focus: "x".repeat(201), on: true })).rejects.toBeInstanceOf(ResearchSettingsError);
    await expect(saveResearchSettings(a.userId, a.brandId, { focus: "", on: "yes" })).rejects.toBeInstanceOf(ResearchSettingsError);
  });

  it("cannot be changed from another brand", async () => {
    await expect(saveResearchSettings(b.userId, a.brandId, { focus: "spy", on: false })).rejects.toBeInstanceOf(BrandAccessError);
    expect((await getResearchSettings(b.userId, b.brandId)).focus).toBeNull();
  });
});
