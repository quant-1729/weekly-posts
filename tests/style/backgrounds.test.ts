import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { BrandAccessError } from "@/lib/brand/current";
import type { MockDb } from "@/lib/db/mock";
import { FORMAT_SIZE } from "@/lib/design/types";
import type { ImagenFn, ImagenRequest } from "@/lib/ai/imagen";
import { IMAGEN_USD_PER_IMAGE, ESTIMATED_BACKGROUND_USD } from "@/lib/ai/imagen-price";
import { IMAGEN_NEGATIVE } from "@/lib/ai/prompts/v3";
import { createMockStorage } from "@/lib/storage/mock";
import type { Storage } from "@/lib/storage/types";
import {
  backgroundPalette,
  backgroundStorageKey,
  cropToFormat,
  generateBackground,
  geminiTextCheck,
  getBackgroundFor,
  paletteHash,
  type TextCheckFn,
} from "@/lib/style/backgrounds";
import { DailyCapError } from "@/lib/usage";
import { WEEKLY_NEW_BACKGROUNDS, WeeklyCapError } from "@/lib/usage/caps";
import { closeTestDb, createBrandFor, createUser, openTestDb } from "../brand/helpers";
import { KIT, clearBrand, png } from "./helpers";

let db: MockDb;
let root: string;
let storage: Storage;
let owner: string;
let outsider: string;
let brand: string;
let otherBrand: string;

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "pm-bg-"));
  storage = createMockStorage(root);
  db = await openTestDb();
  owner = (await createUser(db)).id;
  outsider = (await createUser(db)).id;
  brand = await createBrandFor(db, owner, "Corner Bakery");
  otherBrand = await createBrandFor(db, outsider, "Other Shop");
});
afterAll(async () => {
  await closeTestDb(db);
  await rm(root, { recursive: true, force: true });
});
beforeEach(async () => {
  await clearBrand(db, brand);
  await clearBrand(db, otherBrand);
  await storage.removePrefix("brand-assets", `${brand}/backgrounds`);
});

const PALETTE = ["#1f4e9c", "#f59e0b", "#ffffff"];
const IMAGEN_USD = IMAGEN_USD_PER_IMAGE["imagen-4.0-generate-001"];

function fakeImagen() {
  const calls: ImagenRequest[] = [];
  const fn: ImagenFn = async (req) => {
    calls.push(req);
    return { bytes: await png("#336699", 64), mimeType: "image/png", model: "imagen-4.0-generate-001", usd: IMAGEN_USD };
  };
  return { fn, calls };
}
const checks = (...answers: boolean[]) => {
  let i = 0;
  const spy = vi.fn<TextCheckFn>(async () => ({ hasText: answers[Math.min(i++, answers.length - 1)], usd: 0.001 }));
  return spy;
};
const usage = () =>
  db.withAdmin((tx) => tx.query<{ kind: string; usd: string }>("select kind::text as kind, usd from public.usage_events where brand_id = $1 order by created_at", [brand]));
const rows = () => db.withAdmin((tx) => tx.query<Record<string, unknown>>("select * from public.backgrounds where brand_id = $1", [brand]));

const make = (deps: Parameters<typeof generateBackground>[1], over: Partial<Parameters<typeof generateBackground>[0]> = {}) =>
  generateBackground({ userId: owner, brandId: brand, themeId: "bold_sale", palette: PALETTE, mode: "light", leaveSpace: "center", variant: 0, ...over }, { storage, ...deps });

describe("generateBackground", () => {
  it("generates once with our prompt, negative prompt and a square aspect, checks for text, stores it, and records the row and usage", async () => {
    const img = fakeImagen();
    const check = checks(false);
    const r = await make({ generate: img.fn, checkText: check });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.cached).toBe(false);
    expect(r.attempts).toBe(1);
    expect(img.calls).toHaveLength(1);
    expect(img.calls[0].negativePrompt).toBe(IMAGEN_NEGATIVE);
    expect(img.calls[0].aspectRatio).toBe("1:1");
    expect(img.calls[0].prompt).toContain("Abstract background texture");
    expect(img.calls[0].prompt).toContain("#1f4e9c");
    expect(check).toHaveBeenCalledTimes(1);

    const stored = await storage.get("brand-assets", backgroundStorageKey(brand, "bold_sale", paletteHash(PALETTE, "light"), 0));
    expect(stored).not.toBeNull();
    const [row] = await rows();
    expect(row).toMatchObject({ theme_id: "bold_sale", variant: 0, model: "imagen-4.0-generate-001", width: 64, height: 64 });
    expect(String(row.storage_path)).toBe(`brand-assets/${brand}/backgrounds/bold_sale-${paletteHash(PALETTE, "light")}-v0.png`);
    expect(Number(row.usd)).toBeCloseTo(IMAGEN_USD + 0.001, 6);

    const u = await usage();
    expect(u.map((x) => x.kind)).toEqual(["image"]);
    expect(Number(u[0].usd)).toBeCloseTo(IMAGEN_USD + 0.001, 6);
  });

  it("returns the stored file on a repeat and makes no AI call", async () => {
    const img = fakeImagen();
    const check = checks(false);
    await make({ generate: img.fn, checkText: check });
    const again = await make({ generate: img.fn, checkText: check });
    expect(again.ok && again.cached).toBe(true);
    expect(img.calls).toHaveLength(1);
    expect(check).toHaveBeenCalledTimes(1);
    expect(await usage()).toHaveLength(1);
    expect(await rows()).toHaveLength(1);
  });

  it("makes a new one for another theme, palette or variant, and the same colours in another case share one", async () => {
    const img = fakeImagen();
    const check = checks(false);
    await make({ generate: img.fn, checkText: check });
    await make({ generate: img.fn, checkText: check }, { themeId: "premium" });
    await make({ generate: img.fn, checkText: check }, { palette: ["#000000", ...PALETTE] });
    await make({ generate: img.fn, checkText: check }, { variant: 1 });
    expect(img.calls).toHaveLength(4);
    await make({ generate: img.fn, checkText: check }, { palette: PALETTE.map((c) => c.toUpperCase()) });
    expect(img.calls).toHaveLength(4);
  });

  it("generates again when the stored file has gone missing", async () => {
    const img = fakeImagen();
    await make({ generate: img.fn, checkText: checks(false) });
    await storage.remove("brand-assets", backgroundStorageKey(brand, "bold_sale", paletteHash(PALETTE, "light"), 0));
    const r = await make({ generate: img.fn, checkText: checks(false) });
    expect(r.ok && r.cached).toBe(false);
    expect(img.calls).toHaveLength(2);
    expect(await rows()).toHaveLength(1);
  });

  it("discards an image with text and retries once with another seed", async () => {
    const img = fakeImagen();
    const r = await make({ generate: img.fn, checkText: checks(true, false) });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.attempts).toBe(2);
    expect(img.calls).toHaveLength(2);
    expect(img.calls[0].seed).not.toBe(img.calls[1].seed);
    expect(await rows()).toHaveLength(1);
    // both images were billed
    const u = await usage();
    expect(u.map((x) => x.kind)).toEqual(["image", "image"]);
    expect(r.usd).toBeCloseTo(IMAGEN_USD + 0.001, 6);
  });

  it("gives up after the retry also has text: nothing stored, both attempts billed", async () => {
    const img = fakeImagen();
    const r = await make({ generate: img.fn, checkText: checks(true, true, true) });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("text_found");
    expect(r.attempts).toBe(2);
    expect(img.calls).toHaveLength(2);
    expect(await rows()).toHaveLength(0);
    expect(await storage.list("brand-assets", `${brand}/backgrounds`)).toEqual([]);
    expect((await usage()).map((x) => x.kind)).toEqual(["image", "image"]);
    expect(r.usd).toBeCloseTo(2 * (IMAGEN_USD + 0.001), 6);
  });

  it("does not use an image it could not check", async () => {
    const img = fakeImagen();
    const r = await make({
      generate: img.fn,
      checkText: async () => {
        throw new Error("vision down");
      },
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("check_failed");
    expect(img.calls).toHaveLength(1);
    expect(await rows()).toHaveLength(0);
    expect((await usage()).length).toBe(1);
  });

  it("returns a failure (and records nothing) when Imagen itself fails", async () => {
    const r = await make({
      generate: async () => {
        throw new Error("403 permission denied");
      },
      checkText: checks(false),
    });
    expect(r).toMatchObject({ ok: false, reason: "failed", usd: 0 });
    expect(await usage()).toEqual([]);
  });

  it("is unavailable in fixture mode without an injected generator, and calls nothing", async () => {
    const check = checks(false);
    const r = await make({ checkText: check });
    expect(r).toMatchObject({ ok: false, reason: "unavailable", attempts: 0 });
    expect(check).not.toHaveBeenCalled();
    expect(await usage()).toEqual([]);
  });

  it("stops at the weekly limit of new backgrounds before calling Imagen", async () => {
    for (let i = 0; i < WEEKLY_NEW_BACKGROUNDS; i++) {
      await db.withAdmin((tx) => tx.query("insert into public.usage_events (brand_id, user_id, kind, usd) values ($1, $2, 'image', 0.01)", [brand, owner]));
    }
    const img = fakeImagen();
    await expect(make({ generate: img.fn, checkText: checks(false) })).rejects.toBeInstanceOf(WeeklyCapError);
    expect(img.calls).toHaveLength(0);
  });

  it("a cached background is still returned at the weekly limit", async () => {
    const img = fakeImagen();
    await make({ generate: img.fn, checkText: checks(false) });
    for (let i = 0; i < WEEKLY_NEW_BACKGROUNDS; i++) {
      await db.withAdmin((tx) => tx.query("insert into public.usage_events (brand_id, user_id, kind, usd) values ($1, $2, 'image', 0.01)", [brand, owner]));
    }
    const r = await make({ generate: img.fn, checkText: checks(false) });
    expect(r.ok && r.cached).toBe(true);
  });

  it("stops the retry (but keeps the cost) when the week's limit is reached after the first image", async () => {
    for (let i = 0; i < WEEKLY_NEW_BACKGROUNDS - 1; i++) {
      await db.withAdmin((tx) => tx.query("insert into public.usage_events (brand_id, user_id, kind, usd) values ($1, $2, 'image', 0.01)", [brand, owner]));
    }
    const img = fakeImagen();
    const r = await make({ generate: img.fn, checkText: checks(true, false) });
    expect(img.calls).toHaveLength(1);
    expect(r).toMatchObject({ ok: false, reason: "text_found", attempts: 1 });
  });

  it("stops at the daily limit", async () => {
    await db.withAdmin((tx) => tx.query("update public.brands set daily_generation_cap = 0 where id = $1", [brand]));
    const img = fakeImagen();
    await expect(make({ generate: img.fn, checkText: checks(false) })).rejects.toBeInstanceOf(DailyCapError);
    expect(img.calls).toHaveLength(0);
    await db.withAdmin((tx) => tx.query("update public.brands set daily_generation_cap = 50 where id = $1", [brand]));
  });

  it("refuses someone who is not a member", async () => {
    const img = fakeImagen();
    await expect(
      generateBackground({ userId: outsider, brandId: brand, themeId: "clean", palette: PALETTE, mode: "light" }, { storage, generate: img.fn, checkText: checks(false) }),
    ).rejects.toBeInstanceOf(BrandAccessError);
    expect(img.calls).toHaveLength(0);
  });
});

describe("getBackgroundFor", () => {
  it("is null in fixture mode, even when a background is stored (the engine draws its own)", async () => {
    const { colors, mode } = backgroundPalette(KIT);
    await generateBackground({ userId: owner, brandId: brand, themeId: "clean", palette: colors, mode }, { storage, generate: fakeImagen().fn, checkText: checks(false) });
    expect(await getBackgroundFor(owner, brand, "clean", KIT, "square", { storage })).toBeNull();
  });

  it("never generates: nothing is called and nothing recorded", async () => {
    expect(await getBackgroundFor(owner, brand, "premium", KIT, "vertical", { storage })).toBeNull();
    expect(await usage()).toEqual([]);
  });

  it("returns the stored background cropped to the format when Imagen is switched on", async () => {
    vi.stubEnv("AI_MODE", "live");
    vi.stubEnv("GOOGLE_GENAI_USE_VERTEXAI", "true");
    vi.stubEnv("GOOGLE_CLOUD_PROJECT", "test-project");
    try {
      const { colors, mode } = backgroundPalette(KIT);
      await generateBackground({ userId: owner, brandId: brand, themeId: "clean", palette: colors, mode }, { storage, generate: fakeImagen().fn, checkText: checks(false) });
      for (const format of ["square", "vertical", "banner", "thumbnail"] as const) {
        const buf = await getBackgroundFor(owner, brand, "clean", KIT, format, { storage });
        expect(buf).not.toBeNull();
        const meta = await sharp(buf!).metadata();
        expect([meta.width, meta.height]).toEqual([FORMAT_SIZE[format].width, FORMAT_SIZE[format].height]);
      }
      // another theme has no background: null, not an error, and no generation
      expect(await getBackgroundFor(owner, brand, "festive", KIT, "square", { storage })).toBeNull();
      // a member of another brand gets nothing
      expect(await getBackgroundFor(outsider, brand, "clean", KIT, "square", { storage })).toBeNull();
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("helpers", () => {
  it("cropToFormat fills the format exactly", async () => {
    const out = await cropToFormat(await png("#336699", 100), "portrait");
    const meta = await sharp(out).metadata();
    expect([meta.width, meta.height]).toEqual([1080, 1350]);
  });

  it("the palette hash is stable, ignores letter case, and changes with the mode", () => {
    expect(paletteHash(["#AA0000", "#00FF00"], "light")).toBe(paletteHash(["#aa0000", "#00ff00"], "light"));
    expect(paletteHash(["#aa0000"], "light")).not.toBe(paletteHash(["#aa0000"], "dark"));
    expect(paletteHash(["#aa0000"], "light")).toHaveLength(16);
  });

  it("keeps the Imagen price in one table, and the weekly estimate covers one image plus the check", () => {
    expect(ESTIMATED_BACKGROUND_USD).toBeGreaterThanOrEqual(IMAGEN_USD);
  });

  it("the default text check answers 'no text' under fixtures (no AI call)", async () => {
    expect(await geminiTextCheck(await png("#336699", 64))).toEqual({ hasText: false, usd: 0 });
  });
});

describe("row-level security on backgrounds", () => {
  it("members see their brand's backgrounds; others see none and cannot add or change any", async () => {
    await make({ generate: fakeImagen().fn, checkText: checks(false) });
    const own = await db.withUser(owner, (tx) => tx.query("select id from public.backgrounds where brand_id = $1", [brand]));
    expect(own).toHaveLength(1);
    const seen = await db.withUser(outsider, (tx) => tx.query("select id from public.backgrounds where brand_id = $1", [brand]));
    expect(seen).toHaveLength(0);
    await expect(
      db.withUser(outsider, (tx) =>
        tx.query(
          `insert into public.backgrounds (brand_id, theme_id, palette_hash, variant, storage_path, width, height, model)
           values ($1, 'clean', 'x', 0, 'brand-assets/x', 1, 1, 'm')`,
          [brand],
        ),
      ),
    ).rejects.toThrow();
    const updated = await db.withUser(outsider, (tx) => tx.query("update public.backgrounds set usd = 9 where brand_id = $1 returning id", [brand]));
    expect(updated).toHaveLength(0);
    const removed = await db.withUser(outsider, (tx) => tx.query("delete from public.backgrounds where brand_id = $1 returning id", [brand]));
    expect(removed).toHaveLength(0);
    // still there
    expect(await rows()).toHaveLength(1);
  });
});
