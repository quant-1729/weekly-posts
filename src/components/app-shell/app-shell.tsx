"use client";

import { usePathname } from "next/navigation";
import { BottomNav } from "@/components/bottom-nav";
import { s } from "@/lib/i18n/strings";
import { isSetupPath } from "./nav-items";
import { Sidebar } from "./sidebar";
import { TopBar } from "./top-bar";

/**
 * The signed-in page frame (decision D10, desktop first).
 *  - 1024 px and up: a left sidebar and a main area up to 1200 px wide.
 *  - 768 to 1023 px: a top bar with the destinations, and the same main area.
 *  - Below 768 px: the phone layout, a 480 px column with a header and the bottom nav.
 * During setup the shell is minimal: the app name and Sign out only, no navigation.
 * Server-rendered pages come in as `children`; `overlay` is Tween, mounted by the layout (it needs room at the bottom of the page).
 */
export function AppShell({
  businessName,
  signOutAction,
  overlay,
  children,
}: {
  businessName: string | null;
  signOutAction: () => Promise<void>;
  overlay?: React.ReactNode;
  children?: React.ReactNode;
}) {
  const pathname = usePathname();
  const minimal = isSetupPath(pathname);

  return (
    <div className="mx-auto flex min-h-dvh w-full flex-col bg-white shadow-sm max-md:max-w-[480px] md:bg-stone-50 md:shadow-none lg:flex-row">
      <Sidebar businessName={businessName} signOutAction={signOutAction} />
      <div className="flex min-h-dvh min-w-0 flex-1 flex-col">
        {/* Phone header, and the only header during setup (at every width). */}
        <header className={`items-center justify-between gap-2 border-b border-stone-200 bg-white px-4 py-3 ${minimal ? "flex md:px-8" : "flex md:hidden"}`}>
          <span className="text-lg font-bold text-[#E4572E]">{s.appName}</span>
          {/* One business per account: the name is plain text. The switcher component is kept but not shown. */}
          {businessName && !minimal && <span className="min-w-0 flex-1 truncate text-center text-sm font-medium text-stone-700">{businessName}</span>}
          <form action={signOutAction}>
            <button type="submit" className="text-sm text-stone-600 underline">
              {s.signOut}
            </button>
          </form>
        </header>
        <TopBar businessName={businessName} signOutAction={signOutAction} />
        <main
          data-app-main
          className={`mx-auto w-full max-w-[1200px] flex-1 px-4 pt-4 md:px-8 md:pt-8 lg:px-10 ${overlay ? "pb-40 md:pb-36" : "pb-24 md:pb-12"}`}
        >
          {children}
        </main>
        <BottomNav />
      </div>
      {overlay}
    </div>
  );
}
