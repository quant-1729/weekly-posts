import { fill, s } from "@/lib/i18n/strings";
import { formatDate } from "@/lib/memory/messages";
import type { UpcomingWeek } from "@/lib/memory/upcoming";

const t = s.brandV2.dates;

/** The next 8 weeks of occasions, week by week, read-only, with the sensitive days marked. */
export function UpcomingList({ weeks }: { weeks: UpcomingWeek[] }) {
  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-lg font-semibold">{t.upcomingTitle}</h3>
        <p className="text-sm text-stone-600">{t.upcomingIntro}</p>
      </div>
      <ol className="space-y-3">
        {weeks.map((w) => (
          <li key={w.weekStart} data-week={w.weekStart}>
            <p className="text-sm font-semibold text-stone-700">{fill(t.weekOf, { date: formatDate(w.weekStart, false) })}</p>
            {w.occasions.length === 0 ? (
              <p className="text-sm text-stone-500">{t.nothing}</p>
            ) : (
              <ul className="mt-1 space-y-1">
                {w.occasions.map((o) => (
                  <li key={o.key} className="flex flex-wrap items-center gap-2 rounded-lg border border-stone-200 px-3 py-2 text-sm">
                    <span className="font-medium">{o.name}</span>
                    <span className="text-stone-600">{formatDate(o.date, false)}</span>
                    {o.source === "owner" && <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs">{t.yours}</span>}
                    {o.sensitive && (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900" title={t.sensitiveHint}>
                        {t.sensitive}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
