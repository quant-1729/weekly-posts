"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/", label: "Overview" },
  { href: "/devices", label: "Devices" },
  { href: "/users", label: "Users" },
  { href: "/activity", label: "Activity" },
  { href: "/generations", label: "Generations" },
];

/** The only client component: it just highlights the current page. It receives and fetches no data. */
export function NavLinks() {
  const path = usePathname() ?? "/";
  return (
    <nav aria-label="Main" className="flex flex-wrap gap-1">
      {ITEMS.map((i) => {
        const active = i.href === "/" ? path === "/" : path === i.href || path.startsWith(`${i.href}/`);
        return (
          <Link
            key={i.href}
            href={i.href}
            aria-current={active ? "page" : undefined}
            className={`inline-flex h-9 items-center rounded-full px-4 text-sm font-medium ${
              active ? "bg-fill-active text-title" : "text-sub hover:bg-fill-active"
            }`}
          >
            {i.label}
          </Link>
        );
      })}
    </nav>
  );
}
