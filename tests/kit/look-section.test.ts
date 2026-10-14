import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement, type ReactElement } from "react";
import { renderToString } from "react-dom/server";

const jar = vi.hoisted(() => {
  const store = new Map<string, string>();
  return {
    store,
    api: {
      get: (name: string) => (store.has(name) ? { name, value: store.get(name)! } : undefined),
      set: (name: string, value: string) => void store.set(name, value),
      delete: (name: string) => void store.delete(name),
    },
  };
});
vi.mock("next/headers", () => ({ cookies: async () => jar.api, headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined, push: () => undefined }), usePathname: () => "/brand" }));

import { chooseLogoVariantAction, saveKitAction } from "@/app/(app)/brand/kit-actions";
import { LookBlock } from "@/components/brand/blocks";
import { KitEditor, LogoExtras } from "@/components/brand/look-kit";
import { SESSION_COOKIE, signSession } from "@/lib/auth/session";
import type { MockDb } from "@/lib/db/mock";
import { THEME_IDS, type BrandKit } from "@/lib/design/types";
import { kitCopy } from "@/lib/kit/copy";
import { getBrandKit } from "@/lib/kit/service";
import type { LogoInfo } from "@/lib/logo";
import { closeTestDb, createBrandFor, createUser, openTestDb } from "../brand/helpers";

let db: MockDb;
let owner: string;
let outsider: string;
let brand: string;

async function signIn(userId: string | null) {
  if (userId === null) jar.store.delete(SESSION_COOKIE);
  else jar.store.set(SESSION_COOKIE, await signSession({ id: userId, email: `${userId.slice(0, 6)}@example.com` }));
}

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
  await signIn(owner);
});

const KIT: BrandKit = {
  colors: { primary: "#1F4E9C", secondary: "#EAF1FB", accent: "#F59E0B", background: "#EAF1FB" },
  fonts: { headline: "serif", body: "sans" },
  style: { corners: "rounded", mode: "light", energy: "calm" },
  themeId: "premium",
  textLogo: true,
  mascot: false,
  source: "owner",
};

const render = (el: ReactElement) => renderToString(el);

describe("the Look section on the brand page", () => {
  it("renders the logo, colours, fonts, style, themes and text-logo option from the saved kit", async () => {
    await db.withAdmin((tx) => tx.query(`update public.brand_memory set kit = '{"themeId":"festive","fonts":{"headline":"serif","body":"sans"}}'::jsonb where brand_id = $1`, [brand]));
    const html = render((await LookBlock({ userId: owner, brandId: brand })) as ReactElement);
    expect(html).toContain("Logo");
    expect(html).toContain("Colours");
    // four colour pickers
    for (const name of ["primary", "secondary", "accent", "background"]) expect(html).toContain(`data-color="${name}"`);
    // fonts: headline and body, each with a sample of the business name and a line of text
    expect(html).toContain(kitCopy.fonts.headline);
    expect(html).toContain(kitCopy.fonts.body);
    expect(html.split("data-font-sample=").length - 1).toBe(2);
    expect(html).toContain("Corner Bakery");
    expect(html).toContain(kitCopy.fonts.sample);
    // style: three two-way toggles
    for (const label of [kitCopy.style.corners, kitCopy.style.mode, kitCopy.style.energy]) {
      expect(html).toContain(label.label);
      expect(html).toContain(Object.values(label).filter((v) => v !== label.label)[0]);
    }
    // nine themes with name and description; the saved one is pressed
    for (const id of THEME_IDS) {
      expect(html).toContain(`data-theme="${id}"`);
      expect(html).toContain(kitCopy.themes.names[id]);
    }
    expect(html).toMatch(/aria-pressed="true"[^>]*data-theme="festive"/);
    // text logo option, a drawn preview (no logo yet), and the link to the mascot page
    expect(html).toContain(kitCopy.textLogo.label);
    expect(html).toContain("data-text-logo-preview");
    expect(html).toContain('href="/mascot"');
    // the one save button
    expect(html).toContain(">Save my look<");
  });

  it("shows role names when no font files are shipped for a role, and loads the font when there is one", () => {
    const base = { brandId: brand, kit: KIT, logoPalette: null, hasLogo: false, businessName: "Corner Bakery", textLogoSvg: null };
    const none = render(createElement(KitEditor, { ...base, fontFaces: [] }));
    expect(none).not.toContain("@font-face");
    expect(none).toContain(kitCopy.fonts.roles.serif);
    const withFont = render(createElement(KitEditor, { ...base, fontFaces: [{ role: "serif", family: "kit-serif", file: "PlayfairDisplay_700Bold.ttf", weight: 700 }] }));
    expect(withFont).toContain("@font-face");
    expect(withFont).toContain("/api/fonts/PlayfairDisplay_700Bold.ttf");
    expect(withFont).toContain("kit-serif");
  });

  it("leaves a slot for a theme preview image and uses it when given", () => {
    const base = { brandId: brand, kit: KIT, logoPalette: null, hasLogo: false, businessName: "Corner Bakery", fontFaces: [], textLogoSvg: null };
    const html = render(createElement(KitEditor, { ...base, themePreviews: { premium: "/previews/premium.png" } }));
    expect(html).toContain('src="/previews/premium.png"');
    expect(html.split("data-theme-preview-slot").length - 1).toBe(8);
  });

  it("warns when the main colour is hard to read on the background and offers the fix", () => {
    const bad: BrandKit = { ...KIT, colors: { ...KIT.colors, primary: "#F5E663", background: "#FFFFFF" } };
    const html = render(createElement(KitEditor, { brandId: brand, kit: bad, logoPalette: null, hasLogo: false, businessName: "x", fontFaces: [], textLogoSvg: null }));
    expect(html).toContain("data-contrast-warning");
    expect(html).toContain("hard to read");
    expect(render(createElement(KitEditor, { brandId: brand, kit: KIT, logoPalette: null, hasLogo: false, businessName: "x", fontFaces: [], textLogoSvg: null }))).not.toContain("data-contrast-warning");
  });

  it("hides the text-logo preview once there is a logo", () => {
    const html = render(createElement(KitEditor, { brandId: brand, kit: KIT, logoPalette: null, hasLogo: true, businessName: "x", fontFaces: [], textLogoSvg: "<svg></svg>" }));
    expect(html).not.toContain("data-text-logo-preview");
  });

  it("shows the low-resolution warning and the two logo versions", () => {
    const logo: LogoInfo = {
      logoPath: `brand-assets/${brand}/logo.png`,
      hasChoice: true,
      active: "without_background",
      originalFile: `brand-assets/${brand}/logo-original.png`,
      cleanFile: `brand-assets/${brand}/logo-clean.png`,
      width: 200,
      height: 180,
      lowResolution: true,
    };
    const html = render(createElement(LogoExtras, { brandId: brand, logo, report: null, onChosen: () => undefined }));
    expect(html).toContain("data-logo-warning");
    expect(html).toContain("200 x 180");
    expect(html).toContain(kitCopy.logo.useWith);
    expect(html).toContain(kitCopy.logo.useWithout);
    const kept = render(createElement(LogoExtras, { brandId: brand, logo: { ...logo, hasChoice: false, lowResolution: false }, report: { width: 900, height: 700, lowResolution: false, background: "kept", message: kitCopy.logo.kept, active: "with_background" }, onChosen: () => undefined }));
    expect(kept).toContain("We kept your logo as it is");
    expect(kept).not.toContain("data-logo-warning");
  });
});

describe("the Look section's actions", () => {
  it("saves the kit as the signed-in owner and marks it as theirs", async () => {
    const r = await saveKitAction(brand, { colors: { primary: "#1a6b54", secondary: "#E8F4EF", accent: "#B46B1A", background: "#E8F4EF" }, fonts: { headline: "serif", body: "rounded" }, style: { corners: "sharp", mode: "light", energy: "bold" }, themeId: "premium", textLogo: false });
    expect(r.ok).toBe(true);
    const kit = await getBrandKit(owner, brand);
    expect(kit).toMatchObject({ source: "owner", themeId: "premium", textLogo: false, fonts: { headline: "serif", body: "rounded" }, style: { corners: "sharp", energy: "bold" } });
    expect(kit.colors.primary).toBe("#1A6B54");
  });

  it("says what is wrong, and refuses a signed-out visitor or someone else's brand", async () => {
    expect(await saveKitAction(brand, { colors: { primary: "green" } })).toMatchObject({ ok: false, code: "validation", fieldErrors: { "colors.primary": "invalid_color" } });
    expect(await saveKitAction(brand, { themeId: "neon" })).toMatchObject({ ok: false, code: "validation" });
    expect((await getBrandKit(owner, brand)).themeId).toBe("clean");
    await signIn(outsider);
    expect(await saveKitAction(brand, { themeId: "premium" })).toMatchObject({ ok: false, code: "not_found" });
    await signIn(null);
    expect(await saveKitAction(brand, { themeId: "premium" })).toMatchObject({ ok: false });
    expect(await chooseLogoVariantAction(brand, "with_background")).toMatchObject({ ok: false });
  });

  it("refuses an unknown logo version", async () => {
    expect(await chooseLogoVariantAction(brand, "sideways")).toMatchObject({ ok: false });
    expect(await chooseLogoVariantAction(brand, "without_background")).toMatchObject({ ok: false, message: kitCopy.logo.failed }); // no logo uploaded
  });
});
