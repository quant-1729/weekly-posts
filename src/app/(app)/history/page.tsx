import Link from "next/link";
import { redirect } from "next/navigation";
import { cardClass, chipClass, inputClass, labelClass, primaryButton, secondaryButton } from "@/components/ui";
import { getCurrentUser } from "@/lib/auth";
import { getCurrentBrand } from "@/lib/brand/current";
import { s } from "@/lib/i18n/strings";
import { DEFAULT_PAGE_SIZE, listPosts } from "@/lib/posts/history";
import {
  HISTORY_LANGUAGES,
  RANGE_PRESETS,
  dateWindow,
  historyHref,
  parseHistoryFilters,
} from "@/lib/posts/history-filters";
import { HistoryList } from "./history-list";

export const dynamic = "force-dynamic";

/**
 * Past posts of the current brand (R13), newest first. Filters live in the URL
 * (?range=, ?date=, ?lang=) so a reload keeps them. Links, not client state.
 */
export default async function Page({ searchParams }: PageProps<"/history">) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const brand = await getCurrentBrand(user.id);
  if (!brand || !brand.setupCompleted) redirect("/setup");

  const filters = parseHistoryFilters(await searchParams);
  const { from, to } = dateWindow(filters);
  const page = await listPosts(user.id, brand.id, { from, to, language: filters.language, limit: DEFAULT_PAGE_SIZE });
  const filtered = filters.range !== "all" || filters.date !== null || filters.language !== null;

  return (
    <section className="mx-auto w-full max-w-page-xl space-y-4">
      <h1 className="sr-only">{s.history.title}</h1>

      <div role="group" aria-label={s.history.filtersLabel} className="space-y-3 md:flex md:flex-wrap md:items-start md:gap-x-12 md:gap-y-3 md:space-y-0">
        <div>
          <p className={labelClass}>{s.history.dateLabel}</p>
          <div className="flex flex-wrap gap-2">
            {RANGE_PRESETS.map((r) => (
              <Link
                key={r}
                href={historyHref({ ...filters, range: r, date: null })}
                aria-current={filters.date === null && filters.range === r ? "true" : undefined}
                className={`${chipClass(filters.date === null && filters.range === r)} flex items-center`}
              >
                {s.history.ranges[r]}
              </Link>
            ))}
          </div>
          <form method="get" action="/history" className="mt-2 flex max-w-sm items-center gap-2 md:max-w-md">
            {filters.language && <input type="hidden" name="lang" value={filters.language} />}
            <label htmlFor="history-date" className="sr-only">
              {s.history.pickDateLabel}
            </label>
            <input
              id="history-date"
              type="date"
              name="date"
              required
              defaultValue={filters.date ?? ""}
              className={`${inputClass} flex-1`}
            />
            <button type="submit" className={secondaryButton}>
              {s.history.showDate}
            </button>
          </form>
        </div>

        <div>
          <p className={labelClass}>{s.history.languageLabel}</p>
          <div className="flex flex-wrap gap-2">
            {[null, ...HISTORY_LANGUAGES].map((l) => (
              <Link
                key={l ?? "any"}
                href={historyHref({ ...filters, language: l })}
                aria-current={filters.language === l ? "true" : undefined}
                className={`${chipClass(filters.language === l)} flex items-center`}
              >
                {l ? s.history.languages[l] : s.history.languages.any}
              </Link>
            ))}
          </div>
        </div>
      </div>

      {page.posts.length === 0 ? (
        <div className={`flex flex-col items-center gap-2 border-dashed py-8 text-center ${cardClass}`}>
          <p className="text-card-title text-title">{filtered ? s.history.emptyFilteredTitle : s.history.emptyTitle}</p>
          <p className="mb-2 text-[14px] leading-5 text-desc">{filtered ? s.history.emptyFilteredBody : s.history.emptyBody}</p>
          {filtered ? (
            <Link href="/history" className={secondaryButton}>
              {s.history.clearFilters}
            </Link>
          ) : (
            <Link href="/create" className={primaryButton}>
              {s.history.createFirst}
            </Link>
          )}
        </div>
      ) : (
        <HistoryList
          key={`${brand.id}:${historyHref(filters)}`}
          initialPosts={page.posts}
          initialCursor={page.nextCursor}
          filters={filters}
          brandName={brand.name}
        />
      )}
    </section>
  );
}
