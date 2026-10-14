import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { DesignBody, DesignLoading } from "@/components/create/design-body";
import { StepBar } from "@/components/create/steps";
import { getCurrentUser } from "@/lib/auth";
import { getCurrentBrand } from "@/lib/brand/current";
import { getBrief } from "@/lib/briefs/service";
import { s } from "@/lib/i18n/strings";

export const dynamic = "force-dynamic";
// Writing the words and drawing three options can take a while on the first visit.
export const maxDuration = 120;

/** Create a post, step 2 of 4 (Design): three options, quick edits, "Use this design". A brief of another business is "not found". */
export default async function Page({ params }: PageProps<"/create/[briefId]/design">) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const brand = await getCurrentBrand(user.id);
  if (!brand || !brand.setupCompleted) redirect("/setup");

  const { briefId } = await params;
  const brief = await getBrief(user.id, brand.id, briefId);
  if (!brief) notFound();

  return (
    <section className="space-y-4 md:max-w-5xl">
      <h1 className="text-xl font-bold md:text-2xl">{s.create.title}</h1>
      <StepBar current="design" />
      <h2 className="text-lg font-bold">{s.create.design.title}</h2>
      <Suspense fallback={<DesignLoading />}>
        <DesignBody userId={user.id} brandId={brand.id} briefId={brief.id} />
      </Suspense>
    </section>
  );
}
