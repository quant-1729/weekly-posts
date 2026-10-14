import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { BrandAccessError } from "@/lib/brand/current";
import type { MockDb } from "@/lib/db/mock";
import { brandKitSchema, DEFAULT_KIT, FONT_CHOICES, THEME_IDS } from "@/lib/design/types";
import { contrastRatio, contrastWarnings, readableVersion } from "@/lib/kit/contrast";
import { DEFAULT_COLORS, deriveBackground, kitFromColors } from "@/lib/kit/defaults";
import { availableFontFaces, fontFaceCss } from "@/lib/kit/fonts";
import { KitValidationError } from "@/lib/kit/schema";
import { getBrandKit, getTypeDefault, saveBrandKit, saveTypeDefault } from "@/lib/kit/service";
import { closeTestDb, createBrandFor, createUser, openTestDb } from "../brand/helpers";

let db: MockDb;
let owner: string;
let outsider: string;
let brand: string;

beforeAll(async () => {
  db = await openTestDb();
  owner = (await createUser(db)).id;
  outsider = (await createUser(db)).id;
});
afterAll(async () => {
  await closeTestDb(db);
});
beforeEach(async () => {
  brand = await createBrandFor(db, owner, "Corner Bakery");
});

const row = () =>
  db.withAdmin(async (tx) => (await tx.query<{ colors: Record<string, string>; kit: Record<string, unknown>; logo_path: string | null }>("select colors, kit, logo_path from public.brand_memory where brand_id = $1", [brand]))[0]);

describe("getBrandKit", () => {
  it("gives a valid default kit to a brand with nothing set", async () => {
    const kit = await getBrandKit(owner, brand);
    expect(brandKitSchema.safeParse(kit).success).toBe(true);
    expect(kit.colors).toMatchObject(DEFAULT_COLORS);
    expect(kit.colors.background).toBe(DEFAULT_COLORS.secondary); // light mode: the light second colour
    expect(kit.fonts).toEqual(DEFAULT_KIT.fonts);
    expect(kit.style).toEqual(DEFAULT_KIT.style);
    expect(kit.themeId).toBe("clean");
    expect(kit.textLogo).toBe(true);
    expect(kit.mascot).toBe(false);
    expect(kit.source).toBe("default");
  });

  it("merges the colours column, the stored kit and the defaults", async () => {
    await db.withAdmin((tx) =>
      tx.query(
        `update public.brand_memory set colors = '{"primary":"#b5121b","secondary":"#fff4e0","accent":"#f2a900"}'::jsonb,
           kit = '{"fonts":{"headline":"serif","body":"sans"},"themeId":"festive"}'::jsonb, mascot_in_posts = true where brand_id = $1`,
        [brand],
      ),
    );
    const kit = await getBrandKit(owner, brand);
    expect(kit.colors).toEqual({ primary: "#B5121B", secondary: "#FFF4E0", accent: "#F2A900", background: "#FFF4E0" }); // light: the light secondary
    expect(kit.fonts.headline).toBe("serif");
    expect(kit.themeId).toBe("festive");
    expect(kit.style).toEqual(DEFAULT_KIT.style); // not stored: default
    expect(kit.mascot).toBe(true); // comes from the mascot setting, not the kit
  });

  it("derives a dark background in dark mode and keeps a stored one", async () => {
    await db.withAdmin((tx) =>
      tx.query(`update public.brand_memory set colors = '{"primary":"#1F4E9C","secondary":"#EAF1FB","accent":"#F59E0B"}'::jsonb, kit = '{"style":{"corners":"sharp","mode":"dark","energy":"calm"}}'::jsonb where brand_id = $1`, [brand]),
    );
    const dark = await getBrandKit(owner, brand);
    expect(dark.style.mode).toBe("dark");
    expect(dark.colors.background).toBe(deriveBackground({ primary: "#1F4E9C" }, "dark"));
    expect(contrastRatio(dark.colors.background, "#FFFFFF")).toBeGreaterThan(12);

    await db.withAdmin((tx) => tx.query(`update public.brand_memory set colors = colors || '{"background":"#102030"}'::jsonb where brand_id = $1`, [brand]));
    expect((await getBrandKit(owner, brand)).colors.background).toBe("#102030");
  });

  it("drops a bad stored field instead of failing", async () => {
    await db.withAdmin((tx) =>
      tx.query(`update public.brand_memory set colors = '{"primary":"red","accent":"#00ff00"}'::jsonb, kit = '{"themeId":"nope","textLogo":false,"fonts":{"headline":"comic"}}'::jsonb where brand_id = $1`, [brand]),
    );
    const kit = await getBrandKit(owner, brand);
    expect(brandKitSchema.safeParse(kit).success).toBe(true);
    expect(kit.themeId).toBe("clean");
    expect(kit.textLogo).toBe(false);
    expect(kit.fonts).toEqual(DEFAULT_KIT.fonts);
    expect(kit.colors.primary).toBe(DEFAULT_COLORS.primary);
    expect(kit.colors.accent).toBe("#00FF00");
  });

  it("refuses a user who is not a member", async () => {
    await expect(getBrandKit(outsider, brand)).rejects.toBeInstanceOf(BrandAccessError);
  });
});

describe("saveBrandKit", () => {
  it("writes colours to colors and the rest to kit, marks the owner as the source, and leaves the logo alone", async () => {
    await db.withAdmin((tx) => tx.query("update public.brand_memory set logo_path = $2 where brand_id = $1", [brand, `brand-assets/${brand}/logo.png`]));
    const saved = await saveBrandKit(owner, brand, {
      colors: { primary: "#1a6b54", accent: "#f2a900" },
      fonts: { headline: "serif" },
      style: { mode: "dark" },
      themeId: "premium",
      textLogo: false,
    });
    expect(saved.source).toBe("owner");
    expect(saved.colors.primary).toBe("#1A6B54");
    expect(saved.fonts).toEqual({ headline: "serif", body: "sans" });
    expect(saved.style).toEqual({ corners: "rounded", mode: "dark", energy: "calm" });
    expect(saved.themeId).toBe("premium");
    expect(saved.textLogo).toBe(false);

    const r = await row();
    expect(r.colors).toEqual({ primary: "#1A6B54", accent: "#F2A900" }); // only what was sent
    expect(r.kit).toMatchObject({ source: "owner", themeId: "premium", textLogo: false, fonts: { headline: "serif", body: "sans" } });
    expect(r.kit).not.toHaveProperty("colors");
    expect(r.logo_path).toBe(`brand-assets/${brand}/logo.png`);
    expect(await getBrandKit(owner, brand)).toEqual(saved);
  });

  it("keeps earlier edits and other colour keys when a later patch touches one thing", async () => {
    await saveBrandKit(owner, brand, { colors: { primary: "#1A6B54", secondary: "#E8F4EF", accent: "#B46B1A" }, themeId: "fresh" });
    const after = await saveBrandKit(owner, brand, { fonts: { body: "rounded" } });
    expect(after.themeId).toBe("fresh");
    expect(after.colors).toMatchObject({ primary: "#1A6B54", secondary: "#E8F4EF", accent: "#B46B1A" });
    expect(after.fonts.body).toBe("rounded");
  });

  it("lets an importer say where the kit came from", async () => {
    expect((await saveBrandKit(owner, brand, { themeId: "local" }, { source: "website" })).source).toBe("website");
  });

  it("validates the patch and writes nothing when it is bad", async () => {
    const before = await row();
    for (const bad of [{ colors: { primary: "red" } }, { fonts: { headline: "comic" } }, { themeId: "neon" }, { style: { mode: "blue" } }, { mascot: true }, { source: "owner" }, { colors: { primary: "#112233", extra: "#ffffff" } }]) {
      await expect(saveBrandKit(owner, brand, bad)).rejects.toBeInstanceOf(KitValidationError);
    }
    expect(await row()).toEqual(before);
    await expect(saveBrandKit(owner, brand, { colors: { primary: "red" } })).rejects.toMatchObject({ fieldErrors: { "colors.primary": "invalid_color" } });
  });

  it("is limited to the members of the brand by row-level security", async () => {
    await expect(saveBrandKit(outsider, brand, { themeId: "premium" })).rejects.toBeInstanceOf(BrandAccessError);
    // Even with the membership check skipped, the database refuses the outsider.
    const seen = await db.withUser(outsider, async (tx) => {
      const visible = await tx.query("select brand_id from public.brand_memory where brand_id = $1", [brand]);
      const updated = await tx.query(`update public.brand_memory set kit = '{"themeId":"premium"}'::jsonb where brand_id = $1 returning brand_id`, [brand]);
      return { visible: visible.length, updated: updated.length };
    });
    expect(seen).toEqual({ visible: 0, updated: 0 });
    expect((await row()).kit).toEqual({});
  });
});

describe("kitFromColors", () => {
  it.each([
    ["charcoal (dark, quiet)", "#222831", "premium", "serif"],
    ["saffron (warm, loud)", "#E4572E", "bold_sale", "condensed"],
    ["green", "#1B7F3B", "fresh", "rounded"],
    ["purple", "#7B2D8E", "playful", "rounded"],
    ["blue", "#1F4E9C", "clean", "sans"],
    ["near black", "#0B0B0B", "minimal_dark", "sans"],
  ])("%s", (_name, primary, theme, headline) => {
    const kit = kitFromColors({ primary });
    expect(kit.themeId).toBe(theme);
    expect(kit.fonts.headline).toBe(headline);
    expect(kit.source).toBe("default");
    expect(brandKitSchema.safeParse(kit).success).toBe(true);
  });

  it("is dark for the minimal dark theme, and always valid, even with nothing or junk", () => {
    const dark = kitFromColors({ primary: "#0B0B0B" });
    expect(dark.style.mode).toBe("dark");
    expect(contrastRatio(dark.colors.background, "#FFFFFF")).toBeGreaterThan(12);
    for (const input of [undefined, null, {}, { primary: "nope" }, { primary: "#fff" }]) {
      expect(brandKitSchema.safeParse(kitFromColors(input)).success).toBe(true);
    }
    expect(THEME_IDS).toContain(kitFromColors({ primary: "#E4572E" }).themeId);
  });
});

describe("contrast warnings", () => {
  it("is quiet when the primary colour reads on the background", () => {
    expect(contrastWarnings({ primary: "#1F4E9C", background: "#FFFFFF" })).toEqual([]);
  });

  it("warns under 3:1 and suggests a fix that works", () => {
    const [w] = contrastWarnings({ primary: "#F5E663", background: "#FFFFFF" });
    expect(w.ratio).toBeLessThan(3);
    expect(w.min).toBe(3);
    expect(contrastRatio(w.suggestion.primary, "#FFFFFF")).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(w.suggestion.background, "#F5E663")).toBeGreaterThanOrEqual(3);
  });

  it("lightens the primary on a dark background", () => {
    const [w] = contrastWarnings({ primary: "#1B2A41", background: "#101820" });
    expect(w).toBeDefined();
    expect(contrastRatio(w.suggestion.primary, "#101820")).toBeGreaterThanOrEqual(3);
    expect(readableVersion("#1B2A41", "#101820")).toBe(w.suggestion.primary);
  });
});

describe("font files", () => {
  it("lists the regular and bold file of each role from what is shipped, and nothing for roles without one", () => {
    const faces = availableFontFaces(["NotoSans_400Regular.ttf", "NotoSans_500Medium.ttf", "NotoSans_700Bold.ttf", "NotoSansArabic_700Bold.ttf", "PlayfairDisplay_700Bold.ttf", "ArchivoBlack_400Regular.ttf", "OFL-NotoSans.txt", "../x.ttf"]);
    expect(faces.map((f) => [f.role, f.file, f.weight])).toEqual([
      ["sans", "NotoSans_400Regular.ttf", 400],
      ["sans", "NotoSans_700Bold.ttf", 700],
      ["serif", "PlayfairDisplay_700Bold.ttf", 700],
      ["display", "ArchivoBlack_400Regular.ttf", 400],
    ]);
    const css = fontFaceCss(faces);
    expect(css).toContain('font-family:"kit-serif"');
    expect(css).toContain("/api/fonts/PlayfairDisplay_700Bold.ttf");
  });

  it("finds a file for every role in the shipped folder", () => {
    const roles = new Set(availableFontFaces().map((f) => f.role));
    expect([...roles].sort()).toEqual([...FONT_CHOICES].sort());
  });
});

describe("per-type design defaults (G-7)", () => {
  const choice = { themeId: "bold_sale", layoutId: "bold-stripe", scheme: "dark" } as const;

  it("saves one type, leaves the kit's own theme, fonts and source alone, and keeps other types", async () => {
    await saveBrandKit(owner, brand, { themeId: "premium", fonts: { headline: "serif" } }, { source: "website" });
    const before = await getBrandKit(owner, brand);
    expect(await getTypeDefault(owner, brand, "offer")).toBeNull();
    expect(await saveTypeDefault(owner, brand, "offer", choice)).toEqual(choice);
    await saveTypeDefault(owner, brand, "event", { themeId: "festive", layoutId: "festive-a", scheme: "light" });
    expect(await getTypeDefault(owner, brand, "offer")).toEqual(choice);
    expect(await getTypeDefault(owner, brand, "event")).toEqual({ themeId: "festive", layoutId: "festive-a", scheme: "light" });
    expect(await getTypeDefault(owner, brand, "hiring")).toBeNull();
    expect(await getBrandKit(owner, brand)).toEqual(before); // theme, fonts, style, source unchanged
    const kit = (await row()).kit;
    expect(kit).toMatchObject({ themeId: "premium", source: "website", fonts: { headline: "serif" } });
    // A later kit save keeps the defaults.
    await saveBrandKit(owner, brand, { textLogo: false });
    expect(await getTypeDefault(owner, brand, "offer")).toEqual(choice);
  });

  it("replaces the same type's earlier choice", async () => {
    await saveTypeDefault(owner, brand, "offer", choice);
    await saveTypeDefault(owner, brand, "offer", { ...choice, scheme: "light" });
    expect((await getTypeDefault(owner, brand, "offer"))?.scheme).toBe("light");
  });

  it("refuses a theme, scheme, layout or post type that does not exist, and writes nothing", async () => {
    for (const [type, bad] of [
      ["offer", { ...choice, themeId: "nope" }],
      ["offer", { ...choice, scheme: "pink" }],
      ["offer", { ...choice, layoutId: "" }],
      ["offer", { themeId: "clean" }],
      ["not_a_type", choice],
    ] as const) {
      await expect(saveTypeDefault(owner, brand, type as never, bad)).rejects.toBeInstanceOf(KitValidationError);
    }
    expect((await row()).kit).toEqual({});
  });

  it("a stored value that is not valid reads as no default; someone outside the brand can neither read nor write", async () => {
    await db.withAdmin((tx) => tx.query(`update public.brand_memory set kit = '{"typeDefaults": {"offer": {"themeId": "gone"}}}'::jsonb where brand_id = $1`, [brand]));
    expect(await getTypeDefault(owner, brand, "offer")).toBeNull();
    await expect(saveTypeDefault(outsider, brand, "offer", choice)).rejects.toBeInstanceOf(BrandAccessError);
    await expect(getTypeDefault(outsider, brand, "offer")).rejects.toBeInstanceOf(BrandAccessError);
  });
});
