import { s } from "@/lib/i18n/strings";

export type NavItem = { href: string; label: string; icon: string };

const create: NavItem = { href: "/create", label: s.nav.create, icon: "M12 5v14M5 12h14" };
// "Queue" is the old "This week" page; phase 3 turns it into the real posting queue.
const queue: NavItem = { href: "/week", label: s.nav.queue, icon: "M5 5h14v14H5zM5 10h14M9 3v4M15 3v4" };
const history: NavItem = { href: "/history", label: s.nav.history, icon: "M12 7v5l3 2M4 12a8 8 0 1 0 2.5-5.8M4 4v4h4" };
const results: NavItem = { href: "/results", label: s.nav.results, icon: "M5 20V11M12 20V5M19 20v-7" };
const brand: NavItem = { href: "/brand", label: s.nav.brand, icon: "M4 20V9l8-5 8 5v11zM9 20v-6h6v6" };
const mascot: NavItem = {
  href: "/mascot",
  label: s.nav.mascot,
  icon: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM9 10h.01M15 10h.01M8.5 14.5c1 1.2 2.1 1.8 3.5 1.8s2.5-.6 3.5-1.8",
};

const connections: NavItem = {
  href: "/connections",
  label: s.nav.connections,
  icon: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1",
};

/**
 * The phone bottom nav: the four everyday destinations. Connections and the mascot are reached from the
 * header of the Brand page.
 */
export const phoneNavItems: NavItem[] = [queue, brand, results, history];
/** The sidebar and the tablet top bar have room for all seven; Create comes first. On phones it is a button on the Queue page. */
export const wideNavItems: NavItem[] = [create, queue, brand, mascot, results, history, connections];

/** Setup is a focused flow: no navigation until the profile is saved. */
export const isSetupPath = (pathname: string): boolean => pathname === "/setup" || pathname.startsWith("/setup/");

export const isActive = (pathname: string, href: string): boolean => pathname === href || pathname.startsWith(`${href}/`);

/** The keyboard focus ring shared by the shell's links and buttons. */
export const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#E4572E]";
