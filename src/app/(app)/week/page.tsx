import { redirect } from "next/navigation";
import { CheckinCard } from "@/components/results/checkin-card";
import { WeekView } from "@/components/week/week-view";
import { getCurrentUser } from "@/lib/auth";
import { getCurrentBrand } from "@/lib/brand/current";
import { s } from "@/lib/i18n/strings";
import { loadCheckinCard } from "@/lib/results/checkin";
import { brandTimezone, buttonWeekStart } from "@/lib/weekly/schedule";
import { loadWeekView } from "@/lib/weekly/view";

export const dynamic = "force-dynamic";
// "Generate now" claims the batch and keeps working after the response (V-10);
// the view polls this route's action while it runs.
export const maxDuration = 300;

/** This week's posts (V-10). Approve, edit, skip and share come in V-16/V-17. */
export default async function Page() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const brand = await getCurrentBrand(user.id);
  if (!brand || !brand.setupCompleted) redirect("/setup");

  const timezone = (await brandTimezone(brand.id)) ?? "UTC";
  const weekStart = buttonWeekStart(new Date(), timezone);
  const initial = await loadWeekView(user.id, brand.id, weekStart);
  // V-19: one-tap check-in for last week, until it is answered.
  const checkin = await loadCheckinCard(user.id, brand.id, new Date());

  return (
    <section className="space-y-4">
      <h1 className="text-xl font-bold">{s.brandV2.week.title}</h1>
      {checkin.hadPosts && checkin.answer === null && <CheckinCard weekStart={checkin.weekStart} initial={null} />}
      <WeekView initial={initial} />
    </section>
  );
}
