// The signed-in page frame (decision D10): sidebar from 1024 px, top bar from 768 px, bottom nav below 768 px, and a
// minimal shell during setup. Rendered to HTML with react-dom/server; vitest runs in the node environment, so the
// breakpoints are checked through the responsive classes, and the geometry through tests/tween/motion.test.ts.
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const jar = vi.hoisted(() => ({ path: { value: "/week" } }));
vi.mock("next/navigation", () => ({ usePathname: () => jar.path.value }));

import { AppShell } from "@/components/app-shell/app-shell";
import { isActive, phoneNavItems, wideNavItems } from "@/components/app-shell/nav-items";
import { Sidebar } from "@/components/app-shell/sidebar";
import { TopBar } from "@/components/app-shell/top-bar";
import { BottomNav } from "@/components/bottom-nav";
import { s } from "@/lib/i18n/strings";

const signOut = async () => undefined;
const props = { businessName: "Corner Bakery", signOutAction: signOut };

/** [href, label] of every link inside the first <nav> of the html. */
function navLinks(html: string): string[][] {
  const nav = /<nav\b[\s\S]*?<\/nav>/.exec(html)?.[0] ?? "";
  return [...nav.matchAll(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)].map((m) => [m[1]!, m[2]!.replace(/<[^>]+>/g, "").trim()]);
}
const current = (html: string) => [...html.matchAll(/<a [^>]*aria-current="page"[^>]*href="([^"]+)"|<a [^>]*href="([^"]+)"[^>]*aria-current="page"/g)].map((m) => m[1] ?? m[2]);

beforeEach(() => {
  jar.path.value = "/week";
});

describe("nav items", () => {
  it("the phone nav has four destinations; the sidebar and top bar add Create first, the mascot and Connections", () => {
    expect(phoneNavItems.map((i) => i.href)).toEqual(["/week", "/brand", "/results", "/history"]);
    expect(phoneNavItems.map((i) => i.label)).toEqual(["Queue", "Brand", "Results", "History"]);
    expect(wideNavItems.map((i) => i.href)).toEqual(["/create", "/week", "/brand", "/mascot", "/results", "/history", "/connections"]);
    expect(wideNavItems.map((i) => i.label)).toEqual(["Create", "Queue", "Brand", "Mascot", "Results", "History", "Connections"]);
  });
  it("Create is the first item on wide screens; on phones it is a button on the Queue page, not a fifth tab", () => {
    expect(wideNavItems[0]).toMatchObject({ href: "/create", label: "Create" });
    expect(phoneNavItems.map((i) => i.href)).not.toContain("/create");
  });
  it("a page is active on its own path and below it, not on a path that merely starts the same", () => {
    expect(isActive("/week", "/week")).toBe(true);
    expect(isActive("/review/abc", "/review")).toBe(true);
    expect(isActive("/weekend", "/week")).toBe(false);
  });
});

describe("sidebar (1024 px and up)", () => {
  it("lists the destinations, the app name, the business, and a Sign out form", () => {
    const html = renderToString(createElement(Sidebar, props));
    expect(navLinks(html)).toEqual([
      ["/create", s.nav.create],
      ["/week", s.nav.queue],
      ["/brand", s.nav.brand],
      ["/mascot", s.nav.mascot],
      ["/results", s.nav.results],
      ["/history", s.nav.history],
      ["/connections", s.nav.connections],
    ]);
    expect(html).toContain(s.appName);
    expect(html).toContain("Corner Bakery");
    expect(html).toMatch(/<form[^>]*>[\s\S]*<button[^>]*type="submit"[^>]*>[\s\S]*Sign out[\s\S]*<\/button>/);
    expect(html).toContain(`aria-label="${s.nav.label}"`);
    expect(html).toContain("data-app-sidebar"); // Tween keeps out of this column
    expect(html).toMatch(/class="hidden [^"]*lg:flex/); // shown from 1024 px only
  });
  it("marks only the current page, with aria-current, and has a visible keyboard focus ring", () => {
    jar.path.value = "/brand";
    const html = renderToString(createElement(Sidebar, props));
    expect(current(html)).toEqual(["/brand"]);
    expect(html).toContain("focus-visible:outline");
    jar.path.value = "/review/abc"; // not a nav destination
    expect(current(renderToString(createElement(Sidebar, props)))).toEqual([]);
    jar.path.value = "/mascot";
    expect(current(renderToString(createElement(Sidebar, props)))).toEqual(["/mascot"]);
    jar.path.value = "/connections";
    expect(current(renderToString(createElement(Sidebar, props)))).toEqual(["/connections"]);
  });
  it("is empty during setup", () => {
    jar.path.value = "/setup";
    expect(renderToString(createElement(Sidebar, props))).toBe("");
  });
  it("leaves out the business name when there is none yet", () => {
    const html = renderToString(createElement(Sidebar, { ...props, businessName: null }));
    expect(html).not.toContain("Corner Bakery");
    expect(html).toContain(s.appName);
  });
});

describe("top bar (768 to 1023 px)", () => {
  it("has the same destinations and a Sign out form, and shows only between md and lg", () => {
    jar.path.value = "/history";
    const html = renderToString(createElement(TopBar, props));
    expect(navLinks(html).map((l) => l[0])).toEqual(["/create", "/week", "/brand", "/mascot", "/results", "/history", "/connections"]);
    expect(current(html)).toEqual(["/history"]);
    expect(html).toContain("Sign out");
    expect(html).toMatch(/class="hidden [^"]*md:block lg:hidden/);
  });
  it("is empty during setup", () => {
    jar.path.value = "/setup/x";
    expect(renderToString(createElement(TopBar, props))).toBe("");
  });
});

describe("bottom nav (phones)", () => {
  it("keeps its four items and is hidden from 768 px", () => {
    const html = renderToString(createElement(BottomNav));
    expect(navLinks(html)).toEqual([
      ["/week", "Queue"],
      ["/brand", "Brand"],
      ["/results", "Results"],
      ["/history", "History"],
    ]);
    expect(html).not.toContain("/connections"); // reached from the Brand page on phones
    expect(html).toContain("md:hidden");
    expect(html).toContain('aria-current="page"');
  });
});

describe("app shell", () => {
  const shell = () => renderToString(createElement(AppShell, props, createElement("p", null, "page body")));

  it("carries the page, the sidebar, the top bar, the phone header and the bottom nav", () => {
    const html = shell();
    expect(html).toContain("page body");
    expect(html).toContain("data-app-sidebar");
    expect((html.match(/<nav /g) ?? []).length).toBe(3); // sidebar, top bar, bottom nav: CSS shows one at a time
    expect((html.match(/Sign out/g) ?? []).length).toBe(3); // each with a form, so it works without JavaScript
    expect((html.match(/<form /g) ?? []).length).toBe(3);
    expect(html).toContain("data-app-main");
    expect(html).toContain("max-w-[1200px]"); // the main area is up to 1200 px wide
    expect(html).toContain("max-md:max-w-[480px]"); // the phone column is kept below 768 px
  });

  it("shows the business name in the phone header", () => {
    expect(shell()).toMatch(/<header[^>]*md:hidden[^>]*>[\s\S]*Corner Bakery/);
  });

  it("is minimal during setup: the app name and Sign out, no navigation", () => {
    jar.path.value = "/setup";
    const html = shell();
    expect(html).toContain("page body");
    expect(html).not.toContain("<nav");
    expect(html).not.toContain("data-app-sidebar");
    expect((html.match(/<form /g) ?? []).length).toBe(1);
    expect(html).toContain("Sign out");
    expect(html).toContain(s.appName);
  });

  it("puts the overlay (Tween) in the frame and leaves room for it at the bottom of the page", () => {
    const withOverlay = renderToString(createElement(AppShell, { ...props, overlay: createElement("i", { id: "ov" }) }, createElement("p", null, "x")));
    expect(withOverlay).toContain('id="ov"');
    expect(withOverlay).toContain("pb-40");
    expect(shell()).toContain("pb-24");
  });
});
