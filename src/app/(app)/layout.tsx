import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { BottomNav } from "@/components/bottom-nav";
import { getCurrentUser, signOut } from "@/lib/auth";
import { PATHNAME_HEADER } from "@/lib/auth/public-paths";
import { getCurrentBrand, needsSetup } from "@/lib/brand/current";
import { s } from "@/lib/i18n/strings";

async function signOutAction() {
  "use server";
  await signOut();
  redirect("/login");
}

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // The proxy only checks the cookie; confirm the user really exists.
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  // No brand yet (or setup not finished): every app page except /setup sends the owner to /setup.
  const brand = await getCurrentBrand(user.id);
  const setupNeeded = needsSetup(brand);
  const pathname = (await headers()).get(PATHNAME_HEADER);
  if (setupNeeded && pathname !== null && pathname !== "/setup" && !pathname.startsWith("/setup/")) {
    redirect("/setup");
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col bg-white shadow-sm">
      <header className="flex items-center justify-between gap-2 border-b border-stone-200 px-4 py-3">
        <span className="text-lg font-bold text-[#E4572E]">{s.appName}</span>
        {/* One business per account: the name is plain text. The switcher component is kept but not shown. */}
        {brand && !setupNeeded && <span className="min-w-0 flex-1 truncate text-center text-sm font-medium text-stone-700">{brand.name}</span>}
        <form action={signOutAction}>
          <button type="submit" className="text-sm text-stone-600 underline">
            {s.signOut}
          </button>
        </form>
      </header>
      <main className="flex-1 px-4 pb-24 pt-4">{children}</main>
      <BottomNav />
    </div>
  );
}
