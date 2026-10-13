import Link from "next/link";
import { redirect } from "next/navigation";
import { CheckinCard } from "@/components/results/checkin-card";
import { ReviewReplyCard } from "@/components/results/review-reply-card";
import { getCurrentUser } from "@/lib/auth";
import { getCurrentBrand } from "@/lib/brand/current";
import { fill, s } from "@/lib/i18n/strings";
import { formatDayMonth } from "@/lib/links/format";
import { loadCheckinCard } from "@/lib/results/checkin";
import { clicksPhrase, postsPhrase } from "@/lib/results/format";
import { buildSummary, type PostClicks } from "@/lib/results/summary";

export const dynamic = "force-dynamic";
// The page hosts the review-reply server action: its 9 s AI budget must not meet a platform default.
export const maxDuration = 30;

const r = s.results;
const channelName = (c: string | null) => (s.week.channels as Record<string, string>)[c ?? ""] ?? "";

function ClickList({ heading, rows }: { heading: string; rows: PostClicks[] }) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-stone-700">{heading}</h3>
      {rows.length === 0 ? (
        <p className="text-sm text-stone-600">{r.clicksNoneList}</p>
      ) : (
        <ul className="divide-y divide-stone-200">
          {rows.map((c) => (
            <li key={c.postId} className="flex items-start justify-between gap-3 py-2 text-sm">
              <span className="min-w-0">
                <span className="block break-words font-medium">{c.topic}</span>
                <span className="block text-stone-600">
                  {[channelName(c.channel), c.day ? formatDayMonth(c.day) : ""].filter(Boolean).join(" · ")}
                </span>
              </span>
              <span className="shrink-0 font-medium">{clicksPhrase(c.clicks)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Results (Req 21): this month against last, time saved, clicks, check-ins, and what is not measured. */
export default async function Page() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const brand = await getCurrentBrand(user.id);
  if (!brand || !brand.setupCompleted) redirect("/setup");

  const now = new Date();
  const [summary, card] = await Promise.all([buildSummary(user.id, brand.id, now), loadCheckinCard(user.id, brand.id, now)]);
  const showCard = card.hadPosts || card.answer !== null;

  return (
    <section className="space-y-5">
      <h1 className="text-xl font-bold">{r.title}</h1>

      {showCard && <CheckinCard weekStart={card.weekStart} initial={card.answer} />}

      {summary.empty ? (
        <p className="rounded-lg border border-stone-200 p-4 text-stone-700">{r.empty}</p>
      ) : (
        <>
          <section aria-labelledby="res-shared" className="space-y-2">
            <h2 id="res-shared" className="font-semibold">
              {r.sharedTitle}
            </h2>
            <p>{summary.shared.line}</p>
            <dl className="grid grid-cols-2 gap-2 text-center">
              <div className="rounded-lg border border-stone-200 p-3">
                <dt className="text-sm text-stone-600">{r.thisMonth}</dt>
                <dd className="text-lg font-bold">{postsPhrase(summary.shared.thisMonth)}</dd>
              </div>
              <div className="rounded-lg border border-stone-200 p-3">
                <dt className="text-sm text-stone-600">{r.lastMonth}</dt>
                <dd className="text-lg font-bold">{postsPhrase(summary.shared.lastMonth)}</dd>
              </div>
            </dl>
          </section>

          <section aria-labelledby="res-time" className="space-y-1">
            <h2 id="res-time" className="font-semibold">
              {r.timeTitle}
            </h2>
            {summary.time.needsMinutes ? (
              <p>
                <Link href="/brand#settings" className="text-[#B93A15] underline">
                  {summary.time.prompt}
                </Link>
              </p>
            ) : (
              <>
                <p>{summary.time.line}</p>
                <p className="text-sm text-stone-600">
                  {fill(r.timeBasis, { posts: postsPhrase(summary.shared.thisMonth), minutes: summary.time.minutesPerPost ?? 0 })}
                </p>
              </>
            )}
          </section>

          <section aria-labelledby="res-clicks" className="space-y-3">
            <h2 id="res-clicks" className="font-semibold">
              {r.clicksTitle}
            </h2>
            <p>{summary.clicks.line}</p>
            {summary.clicks.totalLastMonth > 0 && (
              <p className="text-sm text-stone-600">{fill(r.clicksTotalLast, { clicks: clicksPhrase(summary.clicks.totalLastMonth) })}</p>
            )}
            <ClickList heading={`${r.clicksPerPost}: ${summary.thisMonth.name}`} rows={summary.clicks.thisMonth} />
            <ClickList heading={`${r.clicksPerPost}: ${summary.lastMonth.name}`} rows={summary.clicks.lastMonth} />
            <p className="text-sm text-stone-600" title={summary.clicks.footnote}>
              {summary.clicks.footnote}
            </p>
          </section>

          <section aria-labelledby="res-checkins" className="space-y-2">
            <h2 id="res-checkins" className="font-semibold">
              {r.checkinsTitle}
            </h2>
            <ul className="divide-y divide-stone-200">
              {summary.checkins.map((c) => (
                <li key={c.weekStart} className="flex justify-between gap-3 py-2 text-sm">
                  <span className="text-stone-600">{fill(r.checkinsWeek, { date: formatDayMonth(c.weekStart) })}</span>
                  <span className={c.answer ? "font-medium" : "text-stone-500"}>{c.label}</span>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}

      <p className="rounded-lg bg-stone-100 p-3 text-sm text-stone-700">{summary.notMeasured}</p>

      <ReviewReplyCard />
    </section>
  );
}
