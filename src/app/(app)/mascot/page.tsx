import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getCurrentBrand } from "@/lib/brand/current";
import { s } from "@/lib/i18n/strings";
import { mascotDownloads } from "@/lib/mascot/paths";
import { getMascotScreen, refreshSheetIfStale } from "@/lib/mascot/service";
import { MascotScreen } from "./mascot-screen";

export const dynamic = "force-dynamic";
// Saving draws the sheet and 14 pose files.
export const maxDuration = 60;

export default async function Page() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const brand = await getCurrentBrand(user.id);
  if (!brand || !brand.setupCompleted) redirect("/setup");

  // The files follow the brand's colours: draw them again when the colours changed since.
  await refreshSheetIfStale(user.id, brand.id);
  const screen = await getMascotScreen(user.id, brand.id);

  return (
    <section className="space-y-4">
      <div>
        <h1 className="text-xl font-bold md:text-2xl">{s.mascot.title}</h1>
        <p className="text-stone-600">{s.mascot.intro}</p>
      </div>
      <p className="rounded-lg bg-emerald-50 px-3 py-2 text-emerald-900">{s.mascot.ownership}</p>
      <MascotScreen
        brandId={brand.id}
        eligibility={{ eligible: screen.eligibility.eligible, reason: screen.eligibility.reason, canOverride: screen.eligibility.canOverride }}
        mascot={screen.mascot}
        inPosts={screen.inPosts}
        brandColors={screen.brandColors}
        downloads={screen.mascot ? mascotDownloads(brand.id, screen.mascot.id, screen.mascot.name) : []}
      />
    </section>
  );
}
