"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { s } from "@/lib/i18n/strings";
import { phoneNavItems } from "@/components/app-shell/nav-items";

export function BottomNav() {
  const pathname = usePathname();
  // Setup is a focused flow: nothing to tap away to until the profile is saved.
  if (pathname === "/setup" || pathname.startsWith("/setup/")) return null;
  return (
    <nav
      aria-label={s.nav.label}
      className="fixed inset-x-0 bottom-0 z-10 border-t border-stone-200 bg-white md:hidden"
    >
      <ul className="mx-auto flex max-w-[480px]">
        {phoneNavItems.map((item) => {
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
