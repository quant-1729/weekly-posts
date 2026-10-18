"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { s } from "@/lib/i18n/strings";
import { DemoPill } from "./demo-pill";
import { NavIcon } from "./nav-icon";
import { pageTitle } from "./nav-items";

const SIDEBAR_ICON = "M5 4.5h14a1.5 1.5 0 0 1 1.5 1.5v12A1.5 1.5 0 0 1 19 19.5H5A1.5 1.5 0 0 1 3.5 18V6A1.5 1.5 0 0 1 5 4.5zM9.5 4.5v15";
const menuItem = "flex h-9 w-full items-center gap-2 rounded-lg px-2.5 text-left text-ui text-sub hover:bg-fill-active hover:text-title max-md:h-11";

function initials(name: string | null): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "WP";
  return (parts.length === 1 ? parts[0]!.slice(0, 2) : parts[0]![0]! + parts[1]![0]!).toUpperCase();
}

/**
 * The 52 px top bar: the sidebar toggle, a small page title and the account pill. The pill's menu holds Sign out
 * (a form, so it works without JavaScript) and the small account links.
 */
export function TopBar({
  businessName,
  demo = false,
  signOutAction,
  controls = "app-sidebar",
  expanded,
  onToggle,
}: {
  businessName: string | null;
  demo?: boolean;
  signOutAction: () => Promise<void>;
  controls?: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  const pathname = usePathname();
  const menu = useRef<HTMLDetailsElement>(null);

  // Close the account menu on navigation, outside click and Escape.
  useEffect(() => {
    if (menu.current) menu.current.open = false;
  }, [pathname]);
  useEffect(() => {
    const onDown = (e: Event) => {
      const el = menu.current;
      if (el?.open && e.target instanceof Node && !el.contains(e.target)) el.open = false;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && menu.current?.open) {
        menu.current.open = false;
        menu.current.querySelector("summary")?.focus();
      }
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    <header className="sticky top-0 z-20 flex h-[52px] shrink-0 items-center gap-1 bg-cream py-2 pl-2 pr-3">
      <button
        type="button"
        aria-label={s.nav.toggleSidebar}
        aria-controls={controls}
        aria-expanded={expanded}
        onClick={onToggle}
        className="inline-grid h-9 w-9 shrink-0 place-items-center rounded-full text-sub hover:bg-fill-active max-md:h-11 max-md:w-11"
      >
        <NavIcon d={SIDEBAR_ICON} />
      </button>
      <span data-page-title className="ml-1 min-w-0 truncate text-page-title text-title">
        {pageTitle(pathname)}
      </span>
      <span className="flex-1" />
      {demo && <DemoPill />}
      <details ref={menu} className="relative">
        <summary
          aria-label={s.nav.account}
          className="flex h-9 cursor-pointer items-center gap-2 rounded-full border border-line bg-white py-0 pl-[5px] pr-2.5 text-ui text-sub shadow-card hover:bg-hover max-md:h-11 max-md:w-11 max-md:justify-center max-md:p-0"
        >
          <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-coral-tint text-[10px] font-medium leading-none tracking-wide text-coral-dark" aria-hidden="true">
            {initials(businessName)}
          </span>
          {businessName && <span className="max-w-40 truncate max-md:hidden">{businessName}</span>}
          <NavIcon d="M6 9l6 6 6-6" className="h-4 w-4 max-md:hidden" />
        </summary>
        <div className="absolute right-0 top-11 z-50 min-w-52 rounded-card border border-line bg-white p-1.5 shadow-dialog">
          {businessName && <p className="truncate px-2.5 pb-1 pt-1.5 text-note text-helper">{businessName}</p>}
          <Link href="/brand#settings" className={menuItem}>
            {s.nav.brand}
          </Link>
          <Link href="/terms" className={menuItem}>
            {s.account.termsLink}
          </Link>
          <form action={signOutAction}>
            <button type="submit" className={menuItem}>
              {s.signOut}
            </button>
          </form>
        </div>
      </details>
    </header>
  );
}
