import Link from "next/link";
import { badge, cardClass, outlineButton } from "@/components/ui";
import { s } from "@/lib/i18n/strings";
import { postDownloads } from "@/lib/posts/download";
import type { HistoryPost } from "@/lib/posts/history";
import { historyView } from "@/lib/posts/history-view";
import { formatIstDateTime } from "@/lib/posts/ist";

const actionClass = `${outlineButton} min-h-8 px-3 text-[13px]`;

/** Desktop view of the history: one row per post (phones get the cards in history-card.tsx). Same links and downloads as the cards. */
export function HistoryTable({ posts, brandName }: { posts: HistoryPost[]; brandName: string }) {
  return (
    <div className={`overflow-x-auto !p-2 ${cardClass}`}>
      <table className="w-full text-left text-[14px] leading-5">
        <caption className="sr-only">{s.history.title}</caption>
        <thead className="border-b border-divider text-desc">
          <tr>
            <th scope="col" className="px-4 py-3 font-medium">
              {s.history.tableColumns.post}
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              {s.history.tableColumns.created}
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              {s.history.tableColumns.languages}
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              {s.history.tableColumns.status}
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              {s.history.tableColumns.actions}
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-divider">
          {posts.map((post) => {
            const createdAt = new Date(post.createdAt);
            const view = historyView(post);
            const downloads = postDownloads({
              brandName,
              createdAt,
              outputs: post.outputs.map((o) => ({ channel: o.channel, imagePath: o.imagePath })),
            });
            return (
              <tr key={post.id} className="align-middle hover:bg-hover">
                <td className="px-4 py-3">
                  <Link href={view.href} aria-label={s.history.openPost} className="flex items-center gap-3">
                    {post.thumbnail ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={`/api/files/${post.thumbnail.path}?v=${post.thumbnail.version}`}
                        alt={s.history.thumbnailAlt}
                        loading="lazy"
                        className="h-10 w-10 shrink-0 rounded-lg bg-well object-cover ring-1 ring-black/5"
                      />
                    ) : (
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-well text-center text-[9px] leading-3 text-helper">
                        {s.history.noImage}
                      </span>
                    )}
                    <span className="line-clamp-2 max-w-md text-title">{post.title || s.history.untitled}</span>
                  </Link>
                </td>
                <td className="px-4 py-3 tabular-nums text-desc">{formatIstDateTime(createdAt)}</td>
                <td className="px-4 py-3">
                  <span className="flex flex-wrap gap-1">
                    {post.languages.map((l) => (
                      <span key={l} className={badge("neutral")}>
                        {s.history.languages[l]}
                      </span>
                    ))}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span className="flex flex-wrap gap-1">
                    <span className={badge(view.tone)}>{view.label}</span>
                    {view.formatLabel ? (
                      <span data-format-badge className={badge("neutral")}>
                        {view.formatLabel}
                      </span>
                    ) : null}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    {view.permalink && (
                      <a href={view.permalink} target="_blank" rel="noopener noreferrer" className={actionClass}>
                        {s.history.v3Status.viewPost}
                      </a>
                    )}
                    {downloads.length > 0 ? (
                      <details className="relative">
                        <summary className={`${actionClass} cursor-pointer`}>{s.history.download}</summary>
                        <ul className="absolute right-0 top-full z-10 mt-1 w-56 rounded-card border border-line bg-white p-1.5 shadow-dialog">
                          {downloads.map((d) => (
                            <li key={d.channel}>
                              <a href={d.href} download={d.filename} className="block rounded-lg px-3 py-2.5 text-ui text-sub hover:bg-fill-active hover:text-title">
                                {s.history.downloadChannels[d.channel]}
                              </a>
                            </li>
                          ))}
                        </ul>
                      </details>
                    ) : (
                      <button type="button" disabled title={s.history.noImages} className={actionClass}>
                        {s.history.download}
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
