"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { s } from "@/lib/i18n/strings";

const items = [
  { href: "/week", label: s.nav.thisWeek, icon: "M5 5h14v14H5zM5 10h14M9 3v4M15 3v4" },
  { href: "/history", label: s.nav.history, icon: "M12 7v5l3 2M4 12a8 8 0 1 0 2.5-5.8M4 4v4h4" },
  { href: "/results", label: s.nav.results, icon: "M5 20V11M12 20V5M19 20v-7" },
  { href: "/brand", label: s.nav.brand, icon: "M4 20V9l8-5 8 5v11zM9 20v-6h6v6" },
];

export function BottomNav() {
  const pathname = usePathname();
  // Setup is a focused flow: nothing to tap away to until the profile is saved.
  if (pathname === "/setup" || pathname.startsWith("/setup/")) return null;
  return (
    <nav
      aria-label={s.nav.label}
      className="fixed inset-x-0 bottom-0 z-10 border-t border-stone-200 bg-white"
    >
      <ul className="mx-auto flex max-w-[480px]">
        {items.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`flex flex-col items-center gap-0.5 py-2 text-xs ${
                  active ? "font-semibold text-[#E4572E]" : "text-stone-600"
                }`}
              >
                <svg
                  viewBox="0 0 24 24"
                  className="h-6 w-6"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d={item.icon} />
                </svg>
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
