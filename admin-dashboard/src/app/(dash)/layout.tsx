import { requireAdmin } from "@/lib/session";
import { signOutAction } from "../actions";
import { NavLinks } from "@/components/nav-links";
import { btnSecondary } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function DashLayout({ children }: { children: React.ReactNode }) {
  const admin = await requireAdmin();
  return (
    <div className="mx-auto flex min-h-screen max-w-[1600px] flex-col px-6 py-4">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-4">
          <span className="text-sm font-medium text-title">Weekly Posts admin</span>
          <NavLinks />
        </div>
        <form action={signOutAction} className="flex items-center gap-3">
          <span className="text-xs text-desc">{admin}</span>
          <button type="submit" className={btnSecondary}>
            Sign out
          </button>
        </form>
      </div>
      <main className="flex-1">{children}</main>
      <footer className="mt-10 border-t border-divider pt-4 text-xs text-desc">
        IP geolocation by{" "}
        <a className="underline" href="https://db-ip.com" rel="noopener noreferrer" target="_blank">
          DB-IP
        </a>{" "}
        (CC BY 4.0). Times are UTC.
      </footer>
    </div>
  );
}
