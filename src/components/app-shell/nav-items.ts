import { s } from "@/lib/i18n/strings";

export type NavItem = { href: string; label: string; icon: string };

const home: NavItem = { href: "/home", label: s.nav.home, icon: "M4 11l8-7 8 7v8a1 1 0 0 1-1 1h-4v-6h-6v6H5a1 1 0 0 1-1-1z" };
const ideas: NavItem = { href: "/ideas", label: s.nav.ideas, icon: "M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2V16h5v-.1c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z" };
const create: NavItem = { href: "/create", label: s.nav.createPost, icon: "M12 5v14M5 12h14" };
/** The phone bottom bar has room for a short label. */
const createShort: NavItem = { ...create, label: s.nav.create };
// "Queue" is the old "This week" page; phase 3 turns it into the real posting queue.
const queue: NavItem = { href: "/week", label: s.nav.queue, icon: "M4 5.5a3.5 3.5 0 0 1 3.5-3.5h9A3.5 3.5 0 0 1 20 5.5V17a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3zM4 10h16M9 3v4M15 3v4" };
const history: NavItem = { href: "/history", label: s.nav.history, icon: "M4 12a8 8 0 1 0 2.6-5.9M4 4v4h4M12 8v4l3 2" };
const results: NavItem = { href: "/results", label: s.nav.results, icon: "M5 20v-9M12 20V5M19 20v-6" };
const brand: NavItem = {
  href: "/brand",
  label: s.nav.brand,
  icon: "M12 4a8 8 0 1 0 0 16c1.2 0 1.8-.8 1.8-1.7 0-1.2-1-1.5-1-2.6 0-.9.7-1.5 1.6-1.5H16a4 4 0 0 0 4-4c0-3.5-3.6-6.2-8-6.2zM8 11h.01M12 8h.01M16 10.5h.01",
};
const connections: NavItem = {
  href: "/connections",
  label: s.nav.connections,
  icon: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3A4 4 0 0 0 11 18.7l1-1",
};

/**
 * The phone bottom nav: the four everyday destinations. History, Connections and the mascot are in the drawer
 * (History, Connections) or on the Brand page (mascot).
 */
export const phoneNavItems: NavItem[] = [createShort, queue, brand, results];

/** The sidebar's first block: the main action and the queue. */
export const sidebarTop: NavItem[] = [create, queue];
/** Then the everyday pages. */
export const sidebarMain: NavItem[] = [home, ideas, results, history];
/** Under the "Brand" group label. The mascot is reached from the Brand page. */
export const sidebarBrand: NavItem[] = [brand, connections];
/** Every destination the sidebar links to, in order. */
export const wideNavItems: NavItem[] = [...sidebarTop, ...sidebarMain, ...sidebarBrand];

/** Setup is a focused flow: no navigation until the profile is saved. */
export const isSetupPath = (pathname: string): boolean => pathname === "/setup" || pathname.startsWith("/setup/");

export const isActive = (pathname: string, href: string): boolean => pathname === href || pathname.startsWith(`${href}/`);

/** The sidebar's active item: Create stays lit through all five steps, Brand while on the mascot screen. */
export function isNavActive(pathname: string, href: string): boolean {
  if (href === "/brand") return isActive(pathname, "/brand") || isActive(pathname, "/mascot");
  if (href === "/week") return isActive(pathname, "/week") || isActive(pathname, "/plan");
  return isActive(pathname, href);
}

/** The small page title in the top bar. */
export function pageTitle(pathname: string): string {
  const table: Array<[string, string]> = [
    ["/home", s.nav.home],
    ["/ideas", s.nav.ideas],
    ["/create", s.nav.createPost],
    ["/week", s.nav.queue],
    ["/plan", s.nav.plan],
    ["/results", s.nav.results],
    ["/history", s.nav.history],
    ["/review", s.nav.history],
    ["/brand", s.nav.brand],
    ["/mascot", s.nav.mascot],
    ["/connections", s.nav.connections],
  ];
  return table.find(([prefix]) => isActive(pathname, prefix))?.[1] ?? s.appName;
}

/** The keyboard focus ring shared by the shell's links and buttons (the global ring in globals.css does the same; kept for explicit use). */
export const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-coral";
