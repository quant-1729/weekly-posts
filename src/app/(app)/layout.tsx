import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell/app-shell";
import { TweenLoader } from "@/components/tween/TweenLoader";
import { getCurrentUser, signOut } from "@/lib/auth";
import { PATHNAME_HEADER } from "@/lib/auth/public-paths";
import { getCurrentBrand, needsSetup } from "@/lib/brand/current";
import { isTweenEnabled } from "@/lib/tween/bundle";

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

  // Tween, the guide (M-1): signed-in app pages only. Off with "enabled": false in src/content/tween.json or TWEEN_ENABLED=0.
  const tween = isTweenEnabled();

  return (
    <AppShell businessName={brand && !setupNeeded ? brand.name : null} signOutAction={signOutAction} overlay={tween ? <TweenLoader /> : undefined}>
      {children}
    </AppShell>
  );
}
