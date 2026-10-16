"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NavIcon } from "@/components/app-shell/nav-icon";
import { isNavActive, isSetupPath, phoneNavItems } from "@/components/app-shell/nav-items";
import { s } from "@/lib/i18n/strings";

/** The phone bottom bar (below 768 px): Create, Queue, Brand, Results. The active one gets a soft pill behind its icon. */
export function BottomNav() {
  const pathname = usePathname();
  // Setup is a focused flow: nothing to tap away to until the profile is saved.
  if (isSetupPath(pathname)) return null;
  return (
    <nav aria-label={s.nav.label} className="fixed inset-x-0 bottom-0 z-10 h-[60px] border-t border-divider bg-cream px-2 md:hidden">
      <ul className="grid h-full grid-cols-4">
        {phoneNavItems.map((item) => {
          const active = isNavActive(pathname, item.href);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`flex h-full flex-col items-center justify-center gap-0.5 text-badge ${active ? "text-title" : "text-desc"}`}
              >
                <span className={`grid h-7 w-12 place-items-center rounded-full ${active ? "bg-fill-active" : ""}`}>
                  <NavIcon d={item.icon} className={`h-5 w-5 ${active ? "text-coral" : ""}`} />
                </span>
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
