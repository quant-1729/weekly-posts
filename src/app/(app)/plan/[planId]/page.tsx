import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AutomatePanel } from "@/components/plan/automate";
import { DayFlags } from "@/components/plan/day-flags";
import { ScheduleSummary } from "@/components/plan/schedule-summary";
import { badge } from "@/components/ui";
import { StageBar } from "@/components/plan/stage-bar";
import { getCurrentUser } from "@/lib/auth";
import { getCurrentBrand } from "@/lib/brand/current";
import { getDb } from "@/lib/db";
import { getPlan, planStatus } from "@/lib/plans/service";
import { dayBadge, postLine, summarize } from "@/lib/plans/status";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const CHANNEL: Record<string, string> = { instagram: "Instagram", facebook: "Facebook", whatsapp: "WhatsApp status", linkedin: "LinkedIn", gbp: "Google Business", youtube: "YouTube" };

/** Plan a week, stage 3 of 3: every day's post, its checks, and its slot; approve and schedule the week in one go. */
export default async function Page({ params }: { params: Promise<{ planId: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const brand = await getCurrentBrand(user.id);
  if (!brand || !brand.setupCompleted) redirect("/setup");
  const { planId } = await params;
  const plan = await getPlan(user.id, brand.id, planId);
  if (!plan) notFound();
  const days = await planStatus(user.id, brand.id, plan);
  const connected = await getDb().withUser(user.id, (tx) => tx.query<{ provider: string }>("select provider::text as provider from public.channel_connections where brand_id = $1 and status = 'active'", [brand.id])).catch(() => [] as { provider: string }[]);
  const live = new Set(connected.map((c) => c.provider));
  const designed = days.every((d) => d.posts.length > 0 && d.posts.every((p) => p.image));
  const summary = summarize(days);
  return (
    <section className="mx-auto w-full max-w-page-xl pb-8">
      <StageBar current="automate" planId={plan.id} />
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-section text-title">Your week, on autopilot</h1>
          <p className="mt-1 text-[14px] leading-5 text-desc">
            Each post goes out at <strong className="text-ink">{plan.settings.time}</strong> on its day:{" "}
            {plan.settings.channels.map((c) => `${CHANNEL[c] ?? c} (${live.has(c === "whatsapp" ? "whatsapp" : c) ? "published for you" : "emailed to you, ready to share"})`).join(", ")}.
          </p>
        </div>
        <Link href={`/plan/${plan.id}/design`} className="rounded-full px-4 py-2 text-[13px] text-sub ring-1 ring-line-input hover:bg-fill-active">
          Back to the studio
        </Link>
      </div>
      <ScheduleSummary days={days} live={live} />
      {!designed ? (
        <p className="mb-4 rounded-2xl bg-warn-bg px-4 py-3 text-[13.5px] text-warn-tx ring-1 ring-warn-bd">The posts are not drawn yet. Open the studio and press “Use for all days”.</p>
      ) : null}
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" data-plan-cards>
        {days.map((d) => {
          const p = d.posts[0];
          const b = dayBadge(d);
          return (
            <li key={d.date} id={`plan-day-${d.date}`} className="scroll-mt-20 overflow-hidden rounded-[20px] border border-line-light bg-white" data-plan-day={d.date} data-day-state={b.state}>
              <div className="relative bg-well">
                {p?.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.image} alt={`${d.label} post`} className="w-full" />
                ) : (
                  <div className="flex aspect-[4/5] items-center justify-center text-[13px] text-desc">Not drawn yet</div>
                )}
                <span className="absolute bottom-3 left-3 rounded-full bg-white/95 px-2.5 py-1 text-[12px] font-semibold text-ink shadow-sm">{d.label}</span>
              </div>
              <div className="space-y-2 p-3.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[15px] font-semibold text-ink">{d.offer}</span>
                  {b.state === "needs_look" ? (
                    <a href={`#flags-${d.date}`} className={badge(b.tone)} data-day-badge>
                      {b.label}
                    </a>
                  ) : (
                    <span className={badge(b.tone)} data-day-badge>
                      {b.label}
                    </span>
                  )}
                </div>
                <p className="line-clamp-3 text-[12.5px] leading-[18px] text-desc">{p?.caption || "The caption is written when the post is drawn."}</p>
                <ul className="space-y-0.5 text-[12px] text-sub" data-day-posts>
                  {d.posts.map((x) => (
                    <li key={x.id}>{postLine(x, CHANNEL[x.channel] ?? x.channel, live)}</li>
                  ))}
                </ul>
                {b.state === "needs_look" ? <DayFlags briefId={d.briefId} date={d.date} posts={d.posts.map((x) => ({ id: x.id, channel: x.channel, openFlags: x.openFlags }))} /> : null}
                <Link href={`/create/${d.briefId}/review`} className="inline-block text-[12.5px] font-medium text-ink underline underline-offset-4">
                  Review captions
                </Link>
              </div>
            </li>
          );
        })}
      </ul>
      <AutomatePanel planId={plan.id} summary={summary} time={plan.settings.time} />
    </section>
  );
}
