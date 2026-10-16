import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ReviewScreen } from "@/components/create/review-screen";
import { StepBar } from "@/components/create/steps";
import { cardClass, primaryButton } from "@/components/ui";
import { getCurrentUser } from "@/lib/auth";
import { getCurrentBrand } from "@/lib/brand/current";
import { getBrief } from "@/lib/briefs/service";
import { loadReviewData } from "@/lib/create";
import { s } from "@/lib/i18n/strings";

export const dynamic = "force-dynamic";

/** Create a post, step 4 of 5 (Review): the posts with all their sizes and captions, the "Please check" flags, approve. */
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
    <section className="mx-auto w-full max-w-page-md">
      <h1 className="sr-only">{t.title}</h1>
      <StepBar current="review" />
      {data && data.posts.every((p) => p.designed) ? (
        <ReviewScreen data={data} />
      ) : (
        <div className={`space-y-3 ${cardClass}`} data-review-empty>
          <p>{t.noPosts}</p>
          <Link href={`/create/${brief.id}/design`} className={primaryButton}>
            {t.chooseDesign}
          </Link>
        </div>
      )}
    </section>
  );
}
