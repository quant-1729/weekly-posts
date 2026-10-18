// The signed-in page frame (fish-style theme): a 224 px sidebar and 52 px top bar from 768 px, a drawer sidebar plus the
// bottom nav below 768 px, and a minimal shell during setup. Rendered to HTML with react-dom/server; vitest runs in the
// node environment, so the breakpoints are checked through the responsive classes, and Tween's geometry through
// tests/tween/motion.test.ts.
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const jar = vi.hoisted(() => ({ path: { value: "/week" } }));
vi.mock("next/navigation", () => ({ usePathname: () => jar.path.value }));

import { AppShell } from "@/components/app-shell/app-shell";
import { isActive, isNavActive, pageTitle, phoneNavItems, sidebarBrand, sidebarMain, sidebarTop, wideNavItems } from "@/components/app-shell/nav-items";
import { Sidebar } from "@/components/app-shell/sidebar";
import { TopBar } from "@/components/app-shell/top-bar";
import { BottomNav } from "@/components/bottom-nav";
import { s } from "@/lib/i18n/strings";

const signOut = async () => undefined;
const props = { businessName: "Corner Bakery", signOutAction: signOut };
const topBarProps = { ...props, expanded: true, onToggle: () => undefined };

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
  it("the phone nav has four destinations: Create, Queue, Brand, Results", () => {
    expect(phoneNavItems.map((i) => i.href)).toEqual(["/create", "/week", "/brand", "/results"]);
    expect(phoneNavItems.map((i) => i.label)).toEqual(["Create", "Queue", "Brand", "Results"]);
  });
  it("the sidebar has a top block (Create a post, Plan a week, Queue), the everyday pages, and a Brand group (Brand, Connections)", () => {
    expect(sidebarTop.map((i) => [i.href, i.label])).toEqual([
      ["/create", "Create a post"],
      ["/plan", "Plan a week"],
      ["/week", "Queue"],
    ]);
    expect(sidebarMain.map((i) => [i.href, i.label])).toEqual([
      ["/home", "Home"],
      ["/ideas", "Ideas"],
      ["/results", "Results"],
      ["/history", "History"],
    ]);
    expect(sidebarBrand.map((i) => [i.href, i.label])).toEqual([
      ["/brand", "Brand"],
      ["/connections", "Connections"],
    ]);
    expect(wideNavItems.map((i) => i.href)).toEqual(["/create", "/plan", "/week", "/home", "/ideas", "/results", "/history", "/brand", "/connections"]);
  });
  it("Ideas is in the sidebar (and so the phone drawer) after Home, not in the phone bottom nav", () => {
    expect(sidebarMain.map((i) => i.href).slice(0, 2)).toEqual(["/home", "/ideas"]);
    expect(phoneNavItems.map((i) => i.href)).not.toContain("/ideas");
    expect(pageTitle("/ideas")).toBe("Ideas");
  });
  it("the mascot is reached from the Brand page, not from the sidebar or the bottom nav", () => {
    expect(wideNavItems.map((i) => i.href)).not.toContain("/mascot");
    expect(phoneNavItems.map((i) => i.href)).not.toContain("/mascot");
  });
  it("a page is active on its own path and below it, not on a path that merely starts the same", () => {
    expect(isActive("/week", "/week")).toBe(true);
    expect(isActive("/review/abc", "/review")).toBe(true);
    expect(isActive("/weekend", "/week")).toBe(false);
  });
  it("Brand stays lit on the mascot screen, and Create through all five steps", () => {
    expect(isNavActive("/mascot", "/brand")).toBe(true);
    expect(isNavActive("/create/abc/review", "/create")).toBe(true);
    expect(isNavActive("/history", "/brand")).toBe(false);
  });
  it("the top bar title names the page", () => {
    expect(pageTitle("/home")).toBe("Home");
    expect(pageTitle("/create/abc/design")).toBe("Create a post");
    expect(pageTitle("/week")).toBe("Queue");
    expect(pageTitle("/week/settings")).toBe("Queue settings");
    expect(pageTitle("/mascot")).toBe("Mascot");
  });
});

describe("sidebar (768 px and up; a drawer on phones)", () => {
  it("lists the destinations in groups, with the app name; sign out lives in the account menu", () => {
    const html = renderToString(createElement(Sidebar));
    expect(navLinks(html)).toEqual([
      ["/create", s.nav.createPost],
      ["/plan", "Plan a week"],
      ["/week", s.nav.queue],
      ["/home", s.nav.home],
      ["/ideas", s.nav.ideas],
      ["/results", s.nav.results],
      ["/history", s.nav.history],
      ["/brand", s.nav.brand],
      ["/connections", s.nav.connections],
    ]);
    expect(html).toContain(s.appName);
    expect(html).toContain(s.nav.brandGroup); // the "Brand" group label
    expect(html).toContain(`aria-label="${s.nav.label}"`);
    expect(html).toContain("data-app-sidebar"); // Tween keeps out of this column
    expect(html).toContain("md:sticky"); // beside the page from 768 px
    expect(html).toContain("-translate-x-full"); // a closed drawer on phones
    expect(html).toContain("md:w-56"); // 224 px
  });
  it("marks only the current page, with aria-current", () => {
    jar.path.value = "/brand";
    expect(current(renderToString(createElement(Sidebar)))).toEqual(["/brand"]);
    jar.path.value = "/review/abc"; // not a nav destination
    expect(current(renderToString(createElement(Sidebar)))).toEqual([]);
    jar.path.value = "/mascot"; // part of Brand
    expect(current(renderToString(createElement(Sidebar)))).toEqual(["/brand"]);
    jar.path.value = "/connections";
    expect(current(renderToString(createElement(Sidebar)))).toEqual(["/connections"]);
    jar.path.value = "/create/abc/schedule";
    expect(current(renderToString(createElement(Sidebar)))).toEqual(["/create"]); // Create stays lit through the five steps
  });
  it("is hidden from keyboards when it is closed (inert), and open when the drawer is open", () => {
    expect(renderToString(createElement(Sidebar, { hidden: true }))).toContain("inert");
    const open = renderToString(createElement(Sidebar, { drawerOpen: true }));
    expect(open).toContain("translate-x-0");
    expect(open).not.toContain("inert");
  });
  it("is empty during setup", () => {
    jar.path.value = "/setup";
    expect(renderToString(createElement(Sidebar))).toBe("");
  });
});

describe("top bar", () => {
  it("has the toggle, the page title and the account menu with a Sign out form", () => {
    jar.path.value = "/history";
    const html = renderToString(createElement(TopBar, topBarProps));
    expect(html).toContain(`aria-label="${s.nav.toggleSidebar}"`);
    expect(html).toContain('aria-expanded="true"');
    expect(html).toMatch(/data-page-title[^>]*>History</);
    expect(html).toContain("Corner Bakery");
    expect(html).toMatch(/<form[^>]*>[\s\S]*<button[^>]*type="submit"[^>]*>[\s\S]*Sign out[\s\S]*<\/button>/);
    expect(html).toContain("h-[52px]");
  });
  it("shows the initials of the business in the account pill", () => {
    expect(renderToString(createElement(TopBar, topBarProps))).toContain(">CB<");
    expect(renderToString(createElement(TopBar, { ...topBarProps, businessName: null }))).toContain(">WP<");
  });
});

describe("bottom nav (phones)", () => {
  it("has its four items and is hidden from 768 px", () => {
    const html = renderToString(createElement(BottomNav));
    expect(navLinks(html)).toEqual([
      ["/create", "Create"],
      ["/week", "Queue"],
      ["/brand", "Brand"],
      ["/results", "Results"],
    ]);
    expect(html).not.toContain("/connections"); // reached from the sidebar drawer
    expect(html).toContain("md:hidden");
    expect(html).toContain('aria-current="page"');
  });
  it("is empty during setup", () => {
    jar.path.value = "/setup";
    expect(renderToString(createElement(BottomNav))).toBe("");
  });
});

describe("app shell", () => {
  const shell = () => renderToString(createElement(AppShell, props, createElement("p", null, "page body")));

  it("carries the page, the sidebar, the top bar and the bottom nav", () => {
    const html = shell();
    expect(html).toContain("page body");
    expect(html).toContain("data-app-sidebar");
    expect((html.match(/<nav /g) ?? []).length).toBe(2); // sidebar and bottom nav: CSS shows the bottom nav on phones only
    expect((html.match(/Sign out/g) ?? []).length).toBe(1); // in the account menu, a form so it works without JavaScript
    expect((html.match(/<form /g) ?? []).length).toBe(1);
    expect(html).toContain("data-app-main");
    expect(html).toContain("<header"); // the top bar
    expect(html).toContain("Queue"); // the page title for /week
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

  it("has no floating Tween pill of its own", () => {
    expect(shell()).not.toMatch(/Ask Tween|data-tween-pill/);
  });
});
