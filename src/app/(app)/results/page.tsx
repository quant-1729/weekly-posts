import Link from "next/link";
import { redirect } from "next/navigation";
import { alertClass, cardClass, linkButton, wellClass } from "@/components/ui";
import { CheckinCard } from "@/components/results/checkin-card";
import { ReviewReplyCard } from "@/components/results/review-reply-card";
import { getCurrentUser } from "@/lib/auth";
import { getCurrentBrand } from "@/lib/brand/current";
import { fill, s } from "@/lib/i18n/strings";
import { scanCopy } from "@/lib/qr/copy";
import { formatDayMonth } from "@/lib/links/format";
import { loadCheckinCard } from "@/lib/results/checkin";
import { clicksPhrase, postsPhrase } from "@/lib/results/format";
import { buildSummary, type PostClicks } from "@/lib/results/summary";

export const dynamic = "force-dynamic";
// The page hosts the review-reply server action: its 9 s AI budget must not meet a platform default.
export const maxDuration = 30;

const r = s.results;
const channelName = (c: string | null) => (s.week.channels as Record<string, string>)[c ?? ""] ?? "";

function ClickList({ heading, rows, phrase = clicksPhrase }: { heading: string; rows: PostClicks[]; phrase?: (n: number) => string }) {
  return (
    <div>
      <h3 className="text-ui text-title">{heading}</h3>
      {rows.length === 0 ? (
        <p className="text-[13px] leading-[18px] text-desc">{r.clicksNoneList}</p>
      ) : (
        <ul className="divide-y divide-divider">
          {rows.map((c) => (
            <li key={c.postId} className="flex items-start justify-between gap-3 py-2 text-[14px] leading-5">
              <span className="min-w-0">
                <span className="block break-words text-title">{c.topic}</span>
                <span className="block text-note text-desc">
                  {[channelName(c.channel), c.day ? formatDayMonth(c.day) : ""].filter(Boolean).join(" · ")}
                </span>
              </span>
              <span className={`shrink-0 ${"rounded-full bg-ok-bg px-2 py-0.5 text-badge text-ok-tx"}`}>{phrase(c.clicks)}</span>
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
    <section className="mx-auto w-full max-w-page-lg space-y-4">
      <h1 className="sr-only">{r.title}</h1>

      {showCard && <CheckinCard weekStart={card.weekStart} initial={card.answer} />}

      {summary.empty ? (
        <div className={`${cardClass} border-dashed text-center`}>
          <p className="py-6 text-[14px] leading-5 text-desc">{r.empty}</p>
        </div>
      ) : (
        <div className="space-y-4 lg:grid lg:grid-cols-2 lg:items-start lg:gap-4 lg:space-y-0">
          <section aria-labelledby="res-shared" className={`space-y-2 ${cardClass}`}>
            <h2 id="res-shared" className="text-card-title text-title">
              {r.sharedTitle}
            </h2>
            <p className="text-[14px] leading-5">{summary.shared.line}</p>
            <dl className="grid grid-cols-2 gap-2 text-center">
              <div className={wellClass}>
                <dt className="text-note text-desc">{r.thisMonth}</dt>
                <dd className="text-[22px] font-medium leading-8 tabular-nums text-title">{postsPhrase(summary.shared.thisMonth)}</dd>
              </div>
              <div className={wellClass}>
                <dt className="text-note text-desc">{r.lastMonth}</dt>
                <dd className="text-[22px] font-medium leading-8 tabular-nums text-title">{postsPhrase(summary.shared.lastMonth)}</dd>
              </div>
            </dl>
          </section>

          <section aria-labelledby="res-time" className={`space-y-1 ${cardClass}`}>
            <h2 id="res-time" className="text-card-title text-title">
              {r.timeTitle}
            </h2>
            {summary.time.needsMinutes ? (
              <p>
                <Link href="/brand#settings" className={`${linkButton} text-coral-dark`}>
                  {summary.time.prompt}
                </Link>
              </p>
            ) : (
              <>
                <p className="text-[22px] font-medium leading-8 text-title">{summary.time.line}</p>
                <p className="text-[13px] leading-[18px] text-desc">
                  {fill(r.timeBasis, { posts: postsPhrase(summary.shared.thisMonth), minutes: summary.time.minutesPerPost ?? 0 })}
                </p>
              </>
            )}
          </section>

          <section aria-labelledby="res-clicks" className={`space-y-3 ${cardClass}`}>
            <h2 id="res-clicks" className="text-card-title text-title">
              {r.clicksTitle}
            </h2>
            <p className="text-[14px] leading-5">{summary.clicks.line}</p>
            {summary.clicks.totalLastMonth > 0 && (
              <p className="text-[13px] leading-[18px] text-desc">{fill(r.clicksTotalLast, { clicks: clicksPhrase(summary.clicks.totalLastMonth) })}</p>
            )}
            <ClickList heading={`${r.clicksPerPost}: ${summary.thisMonth.name}`} rows={summary.clicks.thisMonth} />
            <ClickList heading={`${r.clicksPerPost}: ${summary.lastMonth.name}`} rows={summary.clicks.lastMonth} />
            <p className="text-[13px] leading-[18px] text-desc" title={summary.clicks.footnote}>
              {summary.clicks.footnote}
            </p>
          </section>

          <section aria-labelledby="res-scans" className={`space-y-3 ${cardClass}`}>
            <h2 id="res-scans" className="text-card-title text-title">
              {scanCopy.title}
            </h2>
            <p className="text-[14px] leading-5">{summary.scans.line}</p>
            {summary.scans.totalLastMonth > 0 && <p className="text-[13px] leading-[18px] text-desc">{scanCopy.totalLast(summary.scans.totalLastMonth)}</p>}
            {(summary.scans.totalThisMonth > 0 || summary.scans.totalLastMonth > 0) && (
              <>
                <ClickList heading={`${scanCopy.perPost}: ${summary.thisMonth.name}`} rows={summary.scans.thisMonth} phrase={scanCopy.phrase} />
                <ClickList heading={`${scanCopy.perPost}: ${summary.lastMonth.name}`} rows={summary.scans.lastMonth} phrase={scanCopy.phrase} />
              </>
            )}
            <p className="text-[13px] leading-[18px] text-desc">{summary.scans.footnote}</p>
          </section>

          <section aria-labelledby="res-checkins" className={`space-y-2 ${cardClass}`}>
            <h2 id="res-checkins" className="text-card-title text-title">
              {r.checkinsTitle}
            </h2>
            <ul className="divide-y divide-divider">
              {summary.checkins.map((c) => (
                <li key={c.weekStart} className="flex justify-between gap-3 py-2 text-sm">
                  <span className="text-desc">{fill(r.checkinsWeek, { date: formatDayMonth(c.weekStart) })}</span>
                  <span className={c.answer ? "text-title" : "text-desc"}>{c.label}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}

      <p className={alertClass("grey")}>{summary.notMeasured}</p>

      <ReviewReplyCard />
    </section>
  );
}
