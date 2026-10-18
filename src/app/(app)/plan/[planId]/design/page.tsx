import { notFound, redirect } from "next/navigation";
import { StageBar } from "@/components/plan/stage-bar";
import { PlanStudio } from "@/components/plan/plan-studio";
import { getCurrentUser } from "@/lib/auth";
import { getCurrentBrand } from "@/lib/brand/current";
import { getPlan } from "@/lib/plans/service";
import { loadStudioPage } from "@/lib/studio/service";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Plan a week, stage 2 of 3: one design for every day in the studio (each day keeps its own offer). */
export default async function Page({ params }: { params: Promise<{ planId: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const brand = await getCurrentBrand(user.id);
  if (!brand || !brand.setupCompleted) redirect("/setup");
  const { planId } = await params;
  const plan = await getPlan(user.id, brand.id, planId);
  if (!plan || plan.days.length === 0) notFound();
  const page = await loadStudioPage({ userId: user.id, brandId: brand.id, briefId: plan.days[0].briefId });
  if (!page) notFound();
  const first = plan.days[0];
  return (
    <section className="mx-auto w-full">
      <h1 className="sr-only">Design your week</h1>
      <StageBar current="design" planId={plan.id} />
      <PlanStudio
        planId={plan.id}
        brandId={brand.id}
        page={{ ...page, input: { ...page.input, content: { ...page.input.content, headline: first.headline ?? page.input.content.headline, offer: first.offer, offerNote: first.offerNote } } }}
        initial={plan.studio}
        days={plan.days.map((d) => ({ date: d.date, label: d.label, offer: d.offer, offerNote: d.offerNote, headline: d.headline }))}
      />
    </section>
  );
}
