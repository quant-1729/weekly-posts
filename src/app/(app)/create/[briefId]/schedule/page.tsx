import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ScheduleScreen } from "@/components/create/schedule-screen";
import { StepBar } from "@/components/create/steps";
import { getCurrentUser } from "@/lib/auth";
import { getCurrentBrand } from "@/lib/brand/current";
import { getBrief } from "@/lib/briefs/service";
import { loadReviewData } from "@/lib/create";
import { s } from "@/lib/i18n/strings";
import { loadScheduleStep } from "@/lib/queue";

export const dynamic = "force-dynamic";

/**
 * Create a post, step 4 of 4 (Schedule): the slot proposed for each approved channel post (S-1), with Confirm,
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
    <section className="space-y-4 md:max-w-3xl">
      <h1 className="text-xl font-bold md:text-2xl">{s.create.title}</h1>
      <StepBar current="schedule" />
      <h2 className="text-lg font-bold">{s.create.schedule.title}</h2>
      <ScheduleScreen briefId={brief.id} initial={step} posts={approved} />
      <Link href="/create" className="inline-block py-2 text-sm text-stone-600 underline">
        {s.create.schedule.another}
      </Link>
    </section>
  );
}
