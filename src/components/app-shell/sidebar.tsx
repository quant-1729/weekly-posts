"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { s } from "@/lib/i18n/strings";
import { Mark, NavIcon } from "./nav-icon";
import { isNavActive, isSetupPath, sidebarBrand, sidebarMain, sidebarTop, type NavItem } from "./nav-items";

const item = "flex h-9 items-center gap-2 rounded-full px-2 text-ui text-sub hover:bg-fill-active max-md:h-11";

function NavLink({ it, pathname, primary = false, onNavigate }: { it: NavItem; pathname: string; primary?: boolean; onNavigate: () => void }) {
  const active = isNavActive(pathname, it.href);
  return (
    <Link
      href={it.href}
      aria-current={active ? "page" : undefined}
      onClick={onNavigate}
      className={`${item} ${primary ? "bg-white text-title shadow-tab hover:bg-hover" : ""} ${active && !primary ? "bg-fill-active text-title" : ""}`}
    >
      <NavIcon d={it.icon} className={`h-5 w-5 shrink-0 ${primary ? "text-coral" : ""}`} />
      {it.label}
    </Link>
  );
}

/**
 * The left sidebar (224 px, borderless, on the cream page). A grouped block with "Create a post" and "Queue", then the
 * everyday pages, then a "Brand" group. At 768 px and up it sits beside the page (and the top-bar toggle collapses it);
 * on phones it is a drawer that slides in from the toggle. Plain links, so it works without JavaScript.
 * Tween reads `data-app-sidebar` to stay out of this column.
 */
export function Sidebar({
  id = "app-sidebar",
  drawerOpen = false,
  collapsed = false,
  hidden = false,
  onNavigate = () => undefined,
}: {
  id?: string;
  /** Phone drawer is open. */
  drawerOpen?: boolean;
  /** Desktop sidebar was collapsed with the toggle. */
  collapsed?: boolean;
  /** Not reachable right now (closed drawer on a phone, or collapsed): keeps focus out of it. */
  hidden?: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  if (isSetupPath(pathname)) return null;
  return (
    <aside
      id={id}
      data-app-sidebar
      inert={hidden || undefined}
      className={`fixed inset-y-0 left-0 z-40 flex w-68 flex-col overflow-y-auto bg-cream pb-3 shadow-dialog transition-transform duration-200 md:sticky md:top-0 md:z-auto md:h-dvh md:w-56 md:shrink-0 md:translate-x-0 md:shadow-none ${
        drawerOpen ? "translate-x-0" : "-translate-x-full"
      } ${collapsed ? "md:hidden" : ""}`}
    >
      <Link href="/home" onClick={onNavigate} className="flex h-[52px] shrink-0 items-center gap-2 px-4 text-[15px] font-medium leading-5 text-title">
        <Mark />
        {s.appName}
      </Link>
      <nav aria-label={s.nav.label} className="flex min-h-0 flex-1 flex-col">
        <ul className="mx-2 mb-2 mt-1 flex flex-col gap-0.5 rounded-block bg-fill-group p-1">
          {sidebarTop.map((it, i) => (
            <li key={it.href}>
              <NavLink it={it} pathname={pathname} primary={i === 0} onNavigate={onNavigate} />
            </li>
          ))}
        </ul>
        <ul className="flex flex-col gap-0.5 px-2">
          {sidebarMain.map((it) => (
            <li key={it.href}>
              <NavLink it={it} pathname={pathname} onNavigate={onNavigate} />
            </li>
          ))}
        </ul>
        <p className="px-4 pb-1 pt-4 text-group text-helper">{s.nav.brandGroup}</p>
        <ul className="flex flex-col gap-0.5 px-2">
          {sidebarBrand.map((it) => (
            <li key={it.href}>
              <NavLink it={it} pathname={pathname} onNavigate={onNavigate} />
            </li>
          ))}
        </ul>
      </nav>
    </aside>
  );
}
