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

/** Create a post, step 3 of 5 (Design): three options in the centre, the editing panel on the right, "Use this design". A brief of another business is "not found". */
export default async function Page({ params }: PageProps<"/create/[briefId]/design">) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const brand = await getCurrentBrand(user.id);
  if (!brand || !brand.setupCompleted) redirect("/setup");

  const { briefId } = await params;
  const brief = await getBrief(user.id, brand.id, briefId);
  if (!brief) notFound();

  return (
    <section className="mx-auto w-full max-w-page-xl">
      <h1 className="sr-only">{s.create.design.title}</h1>
      <StepBar current="design" />
      <Suspense fallback={<DesignLoading />}>
        <DesignBody userId={user.id} brandId={brand.id} briefId={brief.id} />
      </Suspense>
    </section>
  );
}
