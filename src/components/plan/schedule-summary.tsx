import Link from "next/link";
import { alertClass } from "@/components/ui";
import { allScheduled, dayStateOf, postLine, summarize, type DayLike } from "@/lib/plans/status";

const CHANNEL: Record<string, string> = { instagram: "Instagram", facebook: "Facebook", whatsapp: "WhatsApp status", linkedin: "LinkedIn", gbp: "Google Business", youtube: "YouTube" };

/**
 * The success panel at the top of the Automate page. It is worked out from what is stored (the queue rows of the plan's
 * posts), so it is still there after a reload. Nothing is shown until at least one day is in the queue.
 */
export function ScheduleSummary({ days, live }: { days: DayLike[]; live: ReadonlySet<string> }) {
  const sum = summarize(days);
  if (sum.scheduled === 0) return null;
  const done = allScheduled(sum);
  const queued = days.filter((d) => ["scheduled", "published"].includes(dayStateOf(d.posts)));
  const look = days.filter((d) => dayStateOf(d.posts) === "needs_look");
  const other = days.filter((d) => ["attention", "not_drawn", "skipped"].includes(dayStateOf(d.posts)));
  return (
    <section className={`mb-5 ${alertClass("ok")} !p-5`} role="status" aria-label="Scheduling result" data-schedule-summary data-complete={done ? "true" : "false"}>
      <div className="flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-ok-tx text-white" aria-hidden="true">
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12.5l4.5 4.5L19 7.5" />
          </svg>
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[18px] font-semibold text-title" data-summary-title>
            {done ? "Your week is scheduled" : `${sum.scheduledPosts} post${sum.scheduledPosts === 1 ? "" : "s"} scheduled`}
          </h2>
          <ul className="mt-2 space-y-0.5 text-[13.5px] leading-5 text-sub" data-summary-list>
            {queued.flatMap((d) =>
              d.posts.map((p) => (
                <li key={p.id}>
                  <span className="font-medium text-ink">{d.label}</span> · {postLine(p, CHANNEL[p.channel] ?? p.channel, live)}
                </li>
              )),
            )}
          </ul>
          {look.length > 0 ? (
            <div className="mt-3" data-summary-look>
              <p className="text-[14px] font-medium text-warn-deep">
                {look.length} day{look.length === 1 ? " needs" : "s need"} a look: {look.map((d) => d.label).join(", ")}
              </p>
              <div className="mt-1.5 flex flex-wrap gap-2">
                {look.map((d) => (
                  <a key={d.date} href={`#plan-day-${d.date}`} className="rounded-full bg-white px-3 py-1.5 text-[13px] font-medium text-ink ring-1 ring-warn-bd hover:bg-hover">
                    Open {d.label}
                  </a>
                ))}
              </div>
            </div>
          ) : null}
          {other.length > 0 ? (
            <p className="mt-2 text-[13px] text-desc">
              Not scheduled: {other.map((d) => d.label).join(", ")}. See the day cards below.
            </p>
          ) : null}
          <Link href="/week" className="mt-3 inline-flex items-center rounded-full bg-ink px-5 py-2.5 text-[14px] font-medium text-white hover:bg-ink-2" data-open-queue>
            Open queue
          </Link>
        </div>
      </div>
    </section>
  );
}
