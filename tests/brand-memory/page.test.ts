import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Children, createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToString } from "react-dom/server";

const jar = vi.hoisted(() => {
  const store = new Map<string, string>();
  const path = { value: "/brand" as string | null };
  return {
    store,
    path,
    api: {
      get: (name: string) => (store.has(name) ? { name, value: store.get(name)! } : undefined),
      set: (name: string, value: string) => void store.set(name, value),
      delete: (name: string) => void store.delete(name),
    },
  };
});
vi.mock("next/headers", () => ({
  cookies: async () => jar.api,
  headers: async () => new Headers(jar.path.value ? { "x-pathname": jar.path.value } : {}),
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
  useRouter: () => ({ refresh: () => undefined, push: () => undefined }),
  usePathname: () => jar.path.value ?? "/",
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/app/(app)/brand/actions", () => ({
  addFactAction: vi.fn(),
  editFactAction: vi.fn(),
  removeFactAction: vi.fn(),
  rereadWebsiteAction: vi.fn(),
  applyWebsiteLogoAction: vi.fn(),
  saveColorsAction: vi.fn(),
  addOwnerDateAction: vi.fn(),
  removeOwnerDateAction: vi.fn(),
  saveSettingsAction: vi.fn(),
}));
vi.mock("@/components/uploads/actions", () => ({
  removePhotoAction: vi.fn(),
  setHasPeopleAction: vi.fn(),
  addPastPostTextAction: vi.fn(),
  updatePastPostTextAction: vi.fn(),
  removePastPostAction: vi.fn(),
  addWordToAvoidAction: vi.fn(),
  dismissAvoidSuggestionAction: vi.fn(),
  updateVoiceAction: vi.fn(),
  refreshVoiceNowAction: vi.fn(),
}));

import AppLayout from "@/app/(app)/layout";
import Page from "@/app/(app)/brand/page";
import WeekPage from "@/app/(app)/week/page";
import { BottomNav } from "@/components/bottom-nav";
import { DatesBlock, FactsBlock, LookBlock, SettingsBlock, WebsiteLookExtras } from "@/components/brand/blocks";
import { BrandSection } from "@/components/brand/section";
import { UploadsSection, VoiceSection } from "@/components/uploads/uploads-section";
import { PATHNAME_HEADER } from "@/lib/auth/public-paths";
import { SESSION_COOKIE, signSession } from "@/lib/auth/session";
import type { MockDb } from "@/lib/db/mock";
import { s } from "@/lib/i18n/strings";
import { closeTestDb, createBrandFor, createUser, openTestDb } from "../brand/helpers";

let db: MockDb;
let owner: string;
let brand: string;
let newcomer: string;

beforeAll(async () => {
  db = await openTestDb();
  owner = (await createUser(db)).id;
  newcomer = (await createUser(db)).id;
  brand = await createBrandFor(db, owner, "Corner Bakery");
  await db.withAdmin(async (tx) => {
    await tx.query(
      `update public.brand_memory set business_name = 'Corner Bakery', category = 'Bread and cakes', audience = 'Locals', country = 'GB',
              timezone = 'Europe/London', tone = 'friendly', minutes_per_post = 20, setup_completed_at = now() where brand_id = $1`,
      [brand],
    );
    await tx.query(
      `insert into public.brand_facts (brand_id, kind, label, value, source_type, source_ref, source_quote) values
        ($1, 'price', 'Loaf', '£4.50', 'website', 'https://cornerbakery.example/menu', 'Loaf £4.50'),
        ($1, 'product', 'What we sell', 'Bread and cakes', 'setup', 'what_sell', 'Bread and cakes')`,
      [brand],
    );
  });
});
afterAll(async () => {
  await closeTestDb(db);
});
beforeEach(async () => {
  jar.path.value = "/brand";
  jar.store.set(SESSION_COOKIE, await signSession({ id: owner, email: "owner@example.com" }));
});

/** Walks an element tree and returns the elements of a given type. */
function find(node: ReactNode, match: (el: ReactElement) => boolean, out: ReactElement[] = []): ReactElement[] {
  Children.forEach(node, (child) => {
    if (!isValidElement(child)) return;
    if (match(child)) out.push(child);
    find((child.props as { children?: ReactNode }).children, match, out);
  });
  return out;
}

describe("bottom nav", () => {
  it("shows This week, History, Results and Brand, in that order, and no Create or Plan", () => {
    const html = renderToString(createElement(BottomNav));
    const labels = [...html.matchAll(/<a [^>]*href="([^"]+)"[^>]*>.*?<\/svg>([^<]+)<\/a>/g)].map((m) => [m[1], m[2]]);
    expect(labels).toEqual([
      ["/week", "This week"],
      ["/history", "History"],
      ["/results", "Results"],
      ["/brand", "Brand"],
    ]);
    expect(html).not.toContain("/create");
    expect(html).not.toContain("/plan");
    expect(html).toContain('aria-current="page"'); // /brand is the current page
  });

  it("is hidden during setup", () => {
    jar.path.value = "/setup";
    expect(renderToString(createElement(BottomNav))).toBe("");
  });
});

describe("header: one business per account", () => {
  it("shows the business name, no brand switcher, and the nav", async () => {
    const layout = await AppLayout({ children: createElement("p", null, "page body") });
    const html = renderToString(layout as ReactElement);
    expect(html).toContain("Corner Bakery");
    expect(html).toContain("page body");
    expect(html).not.toMatch(/aria-haspopup|aria-expanded/); // the switcher's menu button
    expect(html).toContain(s.nav.thisWeek);
    expect(html).toContain(s.signOut);
  });

  it("keeps sending a new owner to setup", async () => {
    jar.store.set(SESSION_COOKIE, await signSession({ id: newcomer, email: "new@example.com" }));
    jar.path.value = "/brand";
    await expect(AppLayout({ children: null })).rejects.toThrow("REDIRECT:/setup");
    expect(PATHNAME_HEADER).toBe("x-pathname");
  });
});

describe("/week page", () => {
  it("shows the week view (V-10) under the page title", async () => {
    const html = renderToString((await WeekPage()) as ReactElement);
    expect(html).toContain(s.brandV2.week.title);
    expect(html).toContain("Generate this week"); // the full string has an apostrophe React escapes
  });

  it("needs a signed-in owner with a finished setup", async () => {
    jar.store.delete(SESSION_COOKIE);
    await expect(WeekPage()).rejects.toThrow("REDIRECT:/login");
  });
});

describe("/brand page", () => {
  it("has eight collapsible sections in order, with the facts open", async () => {
    const page = (await Page()) as ReactElement;
    const sections = find(page, (el) => el.type === BrandSection);
    expect(sections.map((el) => (el.props as { title: string }).title)).toEqual([
      "Your facts",
      "Your voice",
      "Logo and colours",
      "Your mascot",
      "Photos and past posts",
      "Your dates",
      "Settings",
      "Your data",
    ]);
    expect(sections.map((el) => Boolean((el.props as { defaultOpen?: boolean }).defaultOpen))).toEqual([true, false, false, false, false, false, false, false]);
    // V-5's UploadsSection is mounted (photos and past posts), and the voice card has its own section
    expect(find(page, (el) => el.type === UploadsSection)).toHaveLength(1);
    expect(find(page, (el) => el.type === VoiceSection)).toHaveLength(1);
    // each section is plain <details>/<summary>, so it collapses without JavaScript
    const html = renderToString(createElement(BrandSection, { id: "x", title: "T" }, "body"));
    expect(html).toMatch(/^<details/);
    expect(html).toContain("<summary");
  });

  it("sends a signed-out visitor to sign in and an unfinished setup to /setup", async () => {
    jar.store.delete(SESSION_COOKIE);
    await expect(Page()).rejects.toThrow("REDIRECT:/login");
    jar.store.set(SESSION_COOKIE, await signSession({ id: newcomer, email: "new@example.com" }));
    await expect(Page()).rejects.toThrow("REDIRECT:/setup");
  });

  it("renders every section with its data", async () => {
    const ids = { userId: owner, brandId: brand };
    const facts = renderToString((await FactsBlock(ids)) as ReactElement);
    expect(facts).toContain("£4.50");
    expect(facts).toContain(s.brandV2.facts.source.website);
    expect(facts).toContain(s.brandV2.facts.source.setup);
    expect(facts).toContain("https://cornerbakery.example/menu");

    const look = renderToString((await LookBlock(ids)) as ReactElement);
    expect(look).toContain(s.brandV2.look.logoTitle);
    expect(look).toContain(s.brandV2.look.colorsTitle);

    const dates = renderToString((await DatesBlock(ids)) as ReactElement);
    expect(dates).toContain(s.brandV2.dates.upcomingTitle);
    expect(dates.split("data-week=").length - 1).toBe(8);

    const settings = renderToString((await SettingsBlock(ids)) as ReactElement);
    expect(settings).toContain(s.brandV2.settings.regulatedTitle);
    expect(settings).toContain("We think: None");

    const uploads = renderToString((await UploadsSection({ ...ids, voice: false, heading: false })) as ReactElement);
    expect(uploads).toContain(s.uploads.photos.title);
    expect(uploads).toContain(s.uploads.pastPosts.title);
    expect(uploads).not.toContain(s.uploads.voice.title);
    const voice = renderToString((await VoiceSection(ids)) as ReactElement);
    expect(voice).toContain(s.uploads.voice.title);
  });

  it("offers 'Use the logo from your website?' only when the website was read and there is no logo", async () => {
    const { rememberWebsiteAssets, forgetWebsiteAssets } = await import("@/lib/memory/look");
    await db.withAdmin((tx) =>
      tx.query("update public.brand_memory set website_url = 'https://cornerbakery.example/', website_status = 'ok', logo_path = null where brand_id = $1", [brand]),
    );
    rememberWebsiteAssets(brand, "https://cornerbakery.example/", {
      logoCandidates: [{ url: "https://cornerbakery.example/logo.png", source: "img" }],
      themeColor: "#1a6b54",
    });
    const ids = { userId: owner, brandId: brand };
    const offer = renderToString((await WebsiteLookExtras({ ...ids, hasLogo: false, colors: {} })) as ReactElement);
    expect(offer).toContain("Use the logo from your website?");
    expect(offer).toContain(s.brandV2.look.colorsFromWebsite);
    expect(offer).toContain("#1A6B54");

    const withLogo = await WebsiteLookExtras({ ...ids, hasLogo: true, colors: { primary: "#1A6B54", secondary: "#E8F4EF", accent: "#B46B1A" } });
    const html = withLogo ? renderToString(withLogo as ReactElement) : "";
    expect(html).not.toContain("Use the logo from your website?");

    await db.withAdmin((tx) => tx.query("update public.brand_memory set website_url = null, website_status = 'none' where brand_id = $1", [brand]));
    forgetWebsiteAssets(brand);
    expect(await WebsiteLookExtras({ ...ids, hasLogo: false, colors: {} })).toBeNull();
  });
});
