import Link from "next/link";
import { badge } from "@/components/ui";
import { s } from "@/lib/i18n/strings";
import type { HistoryPost } from "@/lib/posts/history";
import { historyView } from "@/lib/posts/history-view";
import { formatIstDateTime } from "@/lib/posts/ist";

/** "Recent posts" on Home: the last few posts with their picture, or a calm empty state. */
export function RecentPosts({ posts }: { posts: HistoryPost[] }) {
  const t = s.home;
  return (
    <div className="mt-8" data-recent-posts>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-section text-title">{t.recentTitle}</h2>
        {posts.length > 0 && (
          <Link href="/history" className="text-ui text-sub underline underline-offset-4 hover:text-title max-md:inline-flex max-md:min-h-11 max-md:items-center">
            {t.seeAll}
          </Link>
        )}
      </div>
      {posts.length === 0 ? (
        <div className="mt-3 rounded-card border border-dashed border-rule px-4 py-8 text-center">
          <p className="text-card-title text-title">{t.emptyTitle}</p>
          <p className="mt-1 text-ui font-normal text-desc">{t.emptyBody}</p>
        </div>
      ) : (
        <ul className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-3">
          {posts.map((p) => {
            const view = historyView(p);
            return (
            <li key={p.id} className="min-w-0">
              <Link href={view.href} aria-label={s.history.openPost} className="flex flex-col gap-2.5 rounded-xl">
                {p.thumbnail ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={`/api/files/${p.thumbnail.path}?v=${p.thumbnail.version}`}
                    alt={s.history.thumbnailAlt}
                    loading="lazy"
                    className="aspect-square w-full rounded-xl bg-well object-cover ring-1 ring-black/5"
                  />
                ) : (
                  <div className="flex aspect-square w-full items-center justify-center rounded-xl bg-well text-note text-helper">{s.history.noImage}</div>
                )}
                <div className="min-w-0">
                  <p className="line-clamp-2 break-words text-ui text-title">{p.title || s.history.untitled}</p>
                  <p className="mt-1 flex flex-wrap items-center gap-1.5 text-note text-desc">
                    <span>{formatIstDateTime(new Date(p.createdAt))}</span>
                    {view.label && <span className={badge(view.tone)}>{view.label}</span>}
                    {view.formatLabel && (
                      <span data-format-badge className={badge("neutral")}>
                        {view.formatLabel}
                      </span>
                    )}
                  </p>
                </div>
              </Link>
            </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
