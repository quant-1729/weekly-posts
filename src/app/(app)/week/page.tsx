import { redirect } from "next/navigation";
import { IdeaSuggestions } from "@/components/ideas/idea-suggestions";
import { QueueScreen } from "@/components/queue/queue-screen";
import { CheckinCard } from "@/components/results/checkin-card";
import { WeekView } from "@/components/week/week-view";
import { getCurrentUser } from "@/lib/auth";
import { getCurrentBrand } from "@/lib/brand/current";
import { s } from "@/lib/i18n/strings";
import { topIdeaSuggestions } from "@/lib/ideas/suggest";
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
  const [queue, initial, checkin, ideas] = await Promise.all([
    loadQueueView(user.id, brand.id),
    loadWeekView(user.id, brand.id, weekStart),
    // V-19: one-tap check-in for last week, until it is answered.
    loadCheckinCard(user.id, brand.id, new Date()),
    // R-7: up to two unused ideas as suggestions. A problem here never stops the Queue from showing.
    topIdeaSuggestions(user.id, brand.id, new Date()).catch(() => []),
  ]);

  return (
    <section className="mx-auto w-full max-w-page-xl space-y-8">
      {/* The top bar names the page; the heading stays for screen readers. The intro line is the page's one sentence of help. */}
      <div>
        <h1 className="sr-only">{s.queue.title}</h1>
        <p className="text-[14px] leading-5 text-desc">{s.queue.intro}</p>
      </div>
      {checkin.hadPosts && checkin.answer === null && <CheckinCard weekStart={checkin.weekStart} initial={null} />}
      <QueueScreen initial={queue} brandId={brand.id} />
      <section className="space-y-4 border-t border-divider pt-8" aria-label={s.queue.sections.weekly} data-weekly-suggestions>
        <h2 className="text-section text-title">{s.brandV2.week.title}</h2>
        <IdeaSuggestions suggestions={ideas} />
        <WeekView initial={initial} />
      </section>
    </section>
  );
}
