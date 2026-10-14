import Link from "next/link";
import { redirect } from "next/navigation";
import { QueueScreen } from "@/components/queue/queue-screen";
import { CheckinCard } from "@/components/results/checkin-card";
import { WeekView } from "@/components/week/week-view";
import { getCurrentUser } from "@/lib/auth";
import { getCurrentBrand } from "@/lib/brand/current";
import { s } from "@/lib/i18n/strings";
import { loadQueueView } from "@/lib/queue/view";
import { loadCheckinCard } from "@/lib/results/checkin";
import { brandTimezone, buttonWeekStart } from "@/lib/weekly/schedule";
import { loadWeekView } from "@/lib/weekly/view";

export const dynamic = "force-dynamic";
// "Generate now" claims the batch and keeps working after the response (V-10);
// the view polls this route's action while it runs.
export const maxDuration = 300;

/**
 * The Queue (PRD v3 S-1 to S-6; C-24): what is coming up and when, what needs the owner (missed, failed, expired),
 * approved posts ready to schedule, and the queue settings. The weekly suggestions of v2 stay below as the
 * source of ideas ("This week").
 */
export default async function Page() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const brand = await getCurrentBrand(user.id);
  if (!brand || !brand.setupCompleted) redirect("/setup");

  const timezone = (await brandTimezone(brand.id)) ?? "UTC";
  const weekStart = buttonWeekStart(new Date(), timezone);
  const [queue, initial, checkin] = await Promise.all([
    loadQueueView(user.id, brand.id),
    loadWeekView(user.id, brand.id, weekStart),
    // V-19: one-tap check-in for last week, until it is answered.
    loadCheckinCard(user.id, brand.id, new Date()),
  ]);

  return (
    <section className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold md:text-2xl">{s.queue.title}</h1>
          <p className="text-stone-600">{s.queue.intro}</p>
        </div>
        {/* Phones have no Create tab (the bottom nav keeps four items); wider screens list it in the navigation. */}
        <Link href="/create" data-create-button className="inline-flex min-h-11 shrink-0 items-center rounded-lg bg-[#E4572E] px-4 py-2 font-semibold text-white md:hidden">
          {s.create.title}
        </Link>
      </div>
      {checkin.hadPosts && checkin.answer === null && <CheckinCard weekStart={checkin.weekStart} initial={null} />}
      <QueueScreen initial={queue} />
      <section className="space-y-4 border-t border-stone-200 pt-6" aria-label={s.queue.sections.weekly} data-weekly-suggestions>
        <h2 className="text-lg font-bold">{s.brandV2.week.title}</h2>
        <WeekView initial={initial} />
      </section>
    </section>
  );
}
