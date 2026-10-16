import Link from "next/link";
import { redirect } from "next/navigation";
import { CompetitorsRecent } from "@/components/ideas/competitors-recent";
import { ResearchBar } from "@/components/ideas/research-bar";
import { TrendCard } from "@/components/ideas/trend-card";
import { alertClass, cardClass, linkButton } from "@/components/ui";
import { getCurrentUser } from "@/lib/auth";
import { getCurrentBrand } from "@/lib/brand/current";
import { fill, s } from "@/lib/i18n/strings";
import { formatDayMonth } from "@/lib/links/format";
import { MANUAL_RUNS_PER_WEEK } from "@/lib/ideas/types";
import { loadIdeasView } from "@/lib/ideas/view";

export const dynamic = "force-dynamic";
// "Research now" runs inside a server action on this page: a run can take about a minute.
export const maxDuration = 300;

const t = s.ideas.page;

/** "today", "yesterday", "3 days ago", or the date. */
function whenLabel(iso: string, now: Date): string {
  const days = Math.floor((now.getTime() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  return formatDayMonth(iso.slice(0, 10));
}

/**
 * Ideas (R-6): what is trending for the business, as a few cards with sources and post ideas. "Make this post" starts
 * a draft in Create a post; nothing is made or sent without the owner.
 */
export default async function Page({ searchParams }: { searchParams?: Promise<{ e?: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const brand = await getCurrentBrand(user.id);
  if (!brand || !brand.setupCompleted) redirect("/setup");

  const now = new Date();
  const [view, query] = await Promise.all([loadIdeasView(user.id, brand.id, now), searchParams ?? Promise.resolve({} as { e?: string })]);
  const cost = `$${view.runCostUsd.toFixed(2)}`;
  const disabledText = view.disabled ? fill(t.disabled[view.disabled], { max: MANUAL_RUNS_PER_WEEK }) : null;

  let empty: React.ReactNode = null;
  if (view.cards.length === 0 && !view.running) {
    if (!view.researchOn) {
      empty = (
        <>
          {t.emptyOff}{" "}
          <Link href="/brand#competitors" className={linkButton}>
            {t.emptyOffLink}
          </Link>
        </>
      );
    } else if (view.lastRunAt === null) empty = t.emptyNoRun;
    else if (view.runMadeCards) empty = t.emptyDismissed;
    else empty = t.emptyNone;
  }

  return (
    <section className="mx-auto w-full max-w-page-lg space-y-4">
      <h1 className="sr-only">{t.title}</h1>
      <ResearchBar
        lastRunLabel={view.lastRunAt ? whenLabel(view.lastRunAt, now) : null}
        runsLeft={view.runsLeft}
        runsMax={view.runsMax}
        costLabel={cost}
        disabledReason={disabledText}
        running={view.running}
      />
      {query.e && (
        <p role="alert" className={alertClass("err")}>
          {t.errors.generic}
        </p>
      )}
      {empty && (
        <p className={`${cardClass} text-[14px] leading-5 text-desc`} data-ideas-empty>
          {empty}
        </p>
      )}
      {view.cards.map((card) => (
        <TrendCard key={card.id} card={card} />
      ))}
      <CompetitorsRecent competitors={view.competitors} />
    </section>
  );
}
