"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { BottomNav } from "@/components/bottom-nav";
import { s } from "@/lib/i18n/strings";
import { DemoPill } from "./demo-pill";
import { Mark } from "./nav-icon";
import { isSetupPath } from "./nav-items";
import { Sidebar } from "./sidebar";
import { TopBar } from "./top-bar";

const PHONE_QUERY = "(min-width: 768px)";

/**
 * The signed-in page frame (fish-style theme, docs/design/11-theme-fish-style.md).
 *  - 768 px and up: a 224 px borderless sidebar on the cream page, a 52 px top bar (toggle, small title, account pill),
 *    and the page. The toggle collapses the sidebar.
 *  - Below 768 px: the sidebar is a drawer opened from the toggle, and the bottom nav stays.
 * During setup the shell is minimal: the app name and Sign out only, no navigation.
 * Server-rendered pages come in as `children`; `overlay` is Tween, mounted by the layout (it needs room at the bottom of the page).
 */
export function AppShell({
  businessName,
  demo = false,
  signOutAction,
  overlay,
  children,
}: {
  businessName: string | null;
  /** A demo session (docs/15-demo-login.md): a "Demo" pill shows in the header. */
  demo?: boolean;
  signOutAction: () => Promise<void>;
  overlay?: React.ReactNode;
  children?: React.ReactNode;
}) {
  const pathname = usePathname();
  const minimal = isSetupPath(pathname);
  // The first render matches the server (wide, sidebar open); the real width is read after mount.
  const [wide, setWide] = useState(true);
  // A manual toggle wins; otherwise the Design Studio folds the sidebar away (it needs the whole width) and other pages open it.
  const [manual, setManual] = useState<{ studio: boolean; value: boolean } | null>(null);
  // The drawer is open for the page it was opened on, so going to another page closes it.
  const [drawerAt, setDrawerAt] = useState<string | null>(null);
  const drawer = drawerAt === pathname;

  useEffect(() => {
    const mq = window.matchMedia(PHONE_QUERY);
    const sync = () => {
      setWide(mq.matches);
      if (mq.matches) setDrawerAt(null);
    };
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    if (!drawer) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDrawerAt(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [drawer]);

  // The Design Studio needs the whole width: the sidebar folds away there (the top-bar toggle still opens it).
  const studio = /^\/(create|plan)\/[^/]+\/design\/?$/.test(pathname ?? "");
  const collapsed = manual && manual.studio === studio ? manual.value : studio;

  const toggle = useCallback(() => {
    if (wide) setManual({ studio, value: !collapsed });
    else setDrawerAt((at) => (at === pathname ? null : pathname));
  }, [wide, pathname, studio, collapsed]);
  const closeDrawer = useCallback(() => setDrawerAt(null), []);

  if (minimal) {
    return (
      <div className="flex min-h-dvh w-full flex-col bg-cream">
        <header className="mx-auto flex h-[52px] w-full max-w-page-sm items-center justify-between gap-2 px-4">
          <span className="flex items-center gap-2 text-[15px] font-medium leading-5 text-title">
            <Mark />
            {s.appName}
            {demo && <DemoPill />}
          </span>
          <form action={signOutAction}>
            <button type="submit" className="inline-flex min-h-11 items-center text-ui text-sub underline underline-offset-4 hover:text-title">
              {s.signOut}
            </button>
          </form>
        </header>
        <main data-app-main className={`mx-auto w-full max-w-page-sm flex-1 px-4 pb-12 pt-2 ${overlay ? "pb-40" : ""}`}>
          {children}
        </main>
        {overlay}
      </div>
    );
  }

  const sidebarHidden = wide ? collapsed : !drawer;
  return (
    <div className="flex min-h-dvh w-full bg-cream">
      <Sidebar drawerOpen={drawer} collapsed={collapsed} hidden={sidebarHidden} onNavigate={closeDrawer} />
      {drawer && <button type="button" tabIndex={-1} aria-label={s.nav.closeMenu} onClick={closeDrawer} className="fixed inset-0 z-30 bg-title/30 md:hidden" />}
      <div className="flex min-h-dvh min-w-0 flex-1 flex-col">
        <TopBar businessName={businessName} demo={demo} signOutAction={signOutAction} expanded={wide ? !collapsed : drawer} onToggle={toggle} />
        <main data-app-main className={`mx-auto w-full max-w-[1600px] flex-1 px-4 pt-2 md:px-6 ${overlay ? "pb-40 md:pb-36" : "pb-24 md:pb-12"}`}>
          {children}
        </main>
        <BottomNav />
      </div>
      {studio ? null : overlay}
    </div>
  );
}
