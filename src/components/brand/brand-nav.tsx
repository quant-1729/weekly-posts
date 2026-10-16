"use client";

import { useEffect, useState } from "react";
import { s } from "@/lib/i18n/strings";

export type BrandPill = { id: string; label: string };

/** Opens the section a link or hash points to (a closed <details> would otherwise just scroll to its title). */
function openSection(id: string): HTMLElement | null {
  const el = document.getElementById(id);
  if (el instanceof HTMLDetailsElement) el.open = true;
  return el;
}

/**
 * The row of section pills at the top of the Brand page. Plain `#id` links work without JavaScript; with it, a pill
 * opens its section and scrolls it into view, the pill for the section being read is marked, and a link from another
 * page (/brand#settings) opens that section too.
 */
export function BrandNav({ pills }: { pills: BrandPill[] }) {
  const [current, setCurrent] = useState<string | null>(pills[0]?.id ?? null);

  useEffect(() => {
    const fromHash = () => {
      const id = window.location.hash.slice(1);
      if (!id || !pills.some((p) => p.id === id)) return;
      const el = openSection(id);
      el?.scrollIntoView({ block: "start" });
      setCurrent(id);
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, [pills]);

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const seen = new Map<string, boolean>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) seen.set(e.target.id, e.isIntersecting);
        const first = pills.find((p) => seen.get(p.id));
        if (first) setCurrent(first.id);
      },
      { rootMargin: "-64px 0px -60% 0px" },
    );
    for (const p of pills) {
      const el = document.getElementById(p.id);
      if (el) io.observe(el);
    }
    return () => io.disconnect();
  }, [pills]);

  return (
    <nav
      aria-label={s.brandV2.pills.label}
      className="sticky top-[52px] z-10 -mx-4 mb-4 overflow-x-auto bg-cream/95 px-4 py-2 backdrop-blur-sm [scrollbar-width:none] md:-mx-6 md:px-6 [&::-webkit-scrollbar]:hidden"
    >
      <ul className="flex gap-1.5">
        {pills.map((p) => (
          <li key={p.id} className="shrink-0">
            <a
              href={`#${p.id}`}
              aria-current={current === p.id ? "true" : undefined}
              onClick={(e) => {
                const el = openSection(p.id);
                if (!el) return;
                e.preventDefault();
                el.scrollIntoView({ behavior: "smooth", block: "start" });
                window.history.replaceState(null, "", `#${p.id}`);
                setCurrent(p.id);
              }}
              className={`inline-flex h-8 items-center rounded-full px-3.5 text-ui max-md:h-11 ${current === p.id ? "bg-ink text-white" : "text-desc hover:bg-fill-active hover:text-title"}`}
            >
              {p.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
