"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { s } from "@/lib/i18n/strings";
import { NavIcon } from "./nav-icon";
import { focusRing, isActive, isSetupPath, wideNavItems } from "./nav-items";

/**
 * Desktop navigation (1024 px and up): the app name and business at the top, the destinations, Sign out at the bottom.
 * Plain links and a form, so it works without JavaScript. Hidden below 1024 px and during setup. Tween reads
 * `data-app-sidebar` to stay out of this column.
 */
export function Sidebar({ businessName, signOutAction }: { businessName: string | null; signOutAction: () => Promise<void> }) {
  const pathname = usePathname();
  if (isSetupPath(pathname)) return null;
  return (
    <aside data-app-sidebar className="hidden border-r border-stone-200 bg-white lg:sticky lg:top-0 lg:flex lg:h-dvh lg:w-64 lg:shrink-0 lg:flex-col lg:px-4 lg:py-6">
      <div className="px-2">
        <p className="text-xl font-bold text-[#E4572E]">{s.appName}</p>
        {businessName && (
          <p className="mt-1 truncate text-sm font-medium text-stone-700" title={businessName}>
            {businessName}
          </p>
        )}
      </div>
      <nav aria-label={s.nav.label} className="mt-8 flex-1">
        <ul className="space-y-1">
          {wideNavItems.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`flex min-h-11 items-center gap-3 rounded-lg px-3 py-2 text-base ${focusRing} ${
                    active ? "bg-[#E4572E]/10 font-semibold text-[#B93A15]" : "text-stone-700 hover:bg-stone-100"
                  }`}
                >
                  <NavIcon d={item.icon} className="h-5 w-5 shrink-0" />
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <form action={signOutAction} className="border-t border-stone-200 pt-4">
        <button type="submit" className={`min-h-11 w-full rounded-lg px-3 py-2 text-left text-base text-stone-700 hover:bg-stone-100 ${focusRing}`}>
          {s.signOut}
        </button>
      </form>
    </aside>
  );
}
