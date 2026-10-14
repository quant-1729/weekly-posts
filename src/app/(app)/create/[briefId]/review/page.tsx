import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ReviewScreen } from "@/components/create/review-screen";
import { StepBar } from "@/components/create/steps";
import { primaryButton } from "@/components/ui";
import { getCurrentUser } from "@/lib/auth";
import { getCurrentBrand } from "@/lib/brand/current";
import { getBrief } from "@/lib/briefs/service";
import { loadReviewData } from "@/lib/create";
import { s } from "@/lib/i18n/strings";

export const dynamic = "force-dynamic";

/** Create a post, step 3 of 4 (Review): the posts with all their sizes and captions, the "Please check" flags, approve. */
export default async function Page({ params }: PageProps<"/create/[briefId]/review">) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const brand = await getCurrentBrand(user.id);
  if (!brand || !brand.setupCompleted) redirect("/setup");

  const { briefId } = await params;
  const brief = await getBrief(user.id, brand.id, briefId);
  if (!brief) notFound();
  const data = await loadReviewData(user.id, brand.id, brief.id);

  const t = s.create.review;
  return (
    <section className="space-y-4 md:max-w-4xl">
      <h1 className="text-xl font-bold md:text-2xl">{s.create.title}</h1>
      <StepBar current="review" />
      <h2 className="text-lg font-bold">{t.title}</h2>
      {data && data.posts.every((p) => p.designed) ? (
        <ReviewScreen data={data} />
      ) : (
        <div className="space-y-3 rounded-2xl border border-stone-200 bg-white p-4" data-review-empty>
          <p>{t.noPosts}</p>
          <Link href={`/create/${brief.id}/design`} className={`${primaryButton} inline-block text-center`}>
            {t.chooseDesign}
          </Link>
        </div>
      )}
    </section>
  );
}
