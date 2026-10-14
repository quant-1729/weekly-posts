"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { s } from "@/lib/i18n/strings";
import { focusRing, isActive, isSetupPath, wideNavItems } from "./nav-items";

/** Tablet navigation (768 to 1023 px): app name, the destinations, Sign out, in one bar across the top. Hidden elsewhere and during setup. */
export function TopBar({ businessName, signOutAction }: { businessName: string | null; signOutAction: () => Promise<void> }) {
  const pathname = usePathname();
  if (isSetupPath(pathname)) return null;
  return (
    <header className="hidden border-b border-stone-200 bg-white md:block lg:hidden">
      <div className="flex items-center gap-4 px-8 py-3">
        <span className="text-lg font-bold text-[#E4572E]">{s.appName}</span>
        {businessName && (
          <span className="min-w-0 max-w-[14rem] truncate text-sm font-medium text-stone-700" title={businessName}>
            {businessName}
          </span>
        )}
        <form action={signOutAction} className="ml-auto">
          <button type="submit" className={`min-h-11 rounded-lg px-3 text-sm text-stone-700 hover:bg-stone-100 ${focusRing}`}>
            {s.signOut}
          </button>
        </form>
      </div>
      <nav aria-label={s.nav.label} className="px-8">
        <ul className="flex gap-1">
          {wideNavItems.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`block min-h-11 border-b-2 px-4 py-2.5 text-base ${focusRing} ${
                    active ? "border-[#E4572E] font-semibold text-[#B93A15]" : "border-transparent text-stone-700 hover:text-stone-900"
                  }`}
                >
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </header>
  );
}
