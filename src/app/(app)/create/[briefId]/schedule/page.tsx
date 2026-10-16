import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ScheduleScreen } from "@/components/create/schedule-screen";
import { StepBar } from "@/components/create/steps";
import { linkButton } from "@/components/ui";
import { getCurrentUser } from "@/lib/auth";
import { getCurrentBrand } from "@/lib/brand/current";
import { getBrief } from "@/lib/briefs/service";
import { loadReviewData } from "@/lib/create";
import { s } from "@/lib/i18n/strings";
import { loadScheduleStep } from "@/lib/queue";

export const dynamic = "force-dynamic";

/**
 * Create a post, step 5 of 5 (Schedule): the slot proposed for each approved channel post (S-1), with Confirm,
 * "Post now" and "Pick another time". Approved posts can still be downloaded or shared by hand.
 */
export default async function Page({ params }: PageProps<"/create/[briefId]/schedule">) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const brand = await getCurrentBrand(user.id);
  if (!brand || !brand.setupCompleted) redirect("/setup");

  const { briefId } = await params;
  const brief = await getBrief(user.id, brand.id, briefId);
  if (!brief) notFound();
  const [data, step] = await Promise.all([loadReviewData(user.id, brand.id, brief.id), loadScheduleStep(user.id, brand.id, brief.id)]);
  const approved = (data?.posts ?? []).filter((p) => p.status === "approved" || p.status === "posted");

  return (
    <section className="mx-auto w-full max-w-page-sm">
      <h1 className="sr-only">{s.create.schedule.title}</h1>
      <StepBar current="schedule" />
      <ScheduleScreen briefId={brief.id} initial={step} posts={approved} />
      <Link href="/create" className={`${linkButton} mt-2`}>
        {s.create.schedule.another}
      </Link>
    </section>
  );
}
