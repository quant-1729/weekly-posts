import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getCurrentBrand } from "@/lib/brand/current";
import { s } from "@/lib/i18n/strings";
import { getMascotEligibility, getMascotScreen } from "@/lib/mascot/service";
import { mascotDownloads } from "@/lib/mascot/paths";
import { MascotScreen } from "./mascot-screen";

export const dynamic = "force-dynamic";
// Making concepts calls the AI (a second call if some ideas are rejected).
export const maxDuration = 60;

export default async function Page() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const brand = await getCurrentBrand(user.id);
  if (!brand || !brand.setupCompleted) redirect("/setup");

  const [eligibility, screen] = await Promise.all([
    getMascotEligibility(user.id, brand.id),
    getMascotScreen(user.id, brand.id),
  ]);

  return (
    <section className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">{s.mascot.title}</h1>
        <p className="text-stone-600">{s.mascot.intro}</p>
      </div>
      <p className="rounded-lg bg-emerald-50 px-3 py-2 text-emerald-900">{s.mascot.ownership}</p>
      <MascotScreen
        eligibility={{ eligible: eligibility.eligible, reason: eligibility.reason, canOverride: eligibility.canOverride }}
        active={screen.active}
        downloads={screen.active ? mascotDownloads(brand.id, screen.active.id, screen.active.name) : []}
        concepts={screen.concepts}
      />
    </section>
  );
}
