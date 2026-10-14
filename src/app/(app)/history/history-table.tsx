import Link from "next/link";
import { s } from "@/lib/i18n/strings";
import { postDownloads } from "@/lib/posts/download";
import type { HistoryPost } from "@/lib/posts/history";
import { formatIstDateTime } from "@/lib/posts/ist";

const STATUS_STYLE: Record<HistoryPost["status"], string> = {
  draft: "bg-stone-100 text-stone-700",
  ready: "bg-green-100 text-green-800",
  failed: "bg-red-100 text-red-800",
  generating: "bg-amber-100 text-amber-900",
};

const actionClass =
  "inline-flex min-h-11 items-center justify-center rounded-lg border border-stone-300 bg-white px-3 text-sm font-medium text-stone-800 hover:bg-stone-50";

/** Desktop view of the history: one row per post (phones get the cards in history-card.tsx). Same links and downloads as the cards. */
export function HistoryTable({ posts, brandName }: { posts: HistoryPost[]; brandName: string }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-stone-200 bg-white">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">{s.history.title}</caption>
        <thead className="border-b border-stone-200 bg-stone-50 text-stone-600">
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
        <tbody className="divide-y divide-stone-200">
          {posts.map((post) => {
            const createdAt = new Date(post.createdAt);
            const downloads = postDownloads({
              brandName,
              createdAt,
              outputs: post.outputs.map((o) => ({ channel: o.channel, imagePath: o.imagePath })),
            });
            return (
              <tr key={post.id} className="align-middle">
                <td className="px-4 py-3">
                  <Link href={`/review/${post.id}`} aria-label={s.history.openPost} className="flex items-center gap-3">
                    {post.thumbnail ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={`/api/files/${post.thumbnail.path}?v=${post.thumbnail.version}`}
                        alt={s.history.thumbnailAlt}
                        loading="lazy"
                        className="h-16 w-16 shrink-0 rounded-lg bg-stone-100 object-cover"
                      />
                    ) : (
                      <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg bg-stone-100 text-xs text-stone-500">
                        {s.history.noImage}
                      </span>
                    )}
                    <span className="line-clamp-2 max-w-md font-medium">{post.title || s.history.untitled}</span>
                  </Link>
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-stone-600">{formatIstDateTime(createdAt)}</td>
                <td className="px-4 py-3">
                  <span className="flex flex-wrap gap-1">
                    {post.languages.map((l) => (
                      <span key={l} className="rounded-full border border-stone-300 px-2 py-0.5 text-xs text-stone-700">
                        {s.history.languages[l]}
                      </span>
                    ))}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[post.status]}`}>{s.history.status[post.status]}</span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    {downloads.length > 0 ? (
                      <details className="relative">
                        <summary className={`${actionClass} cursor-pointer list-none`}>{s.history.download}</summary>
                        <ul className="absolute right-0 top-full z-10 mt-1 w-56 rounded-lg border border-stone-200 bg-white p-1 shadow-lg">
                          {downloads.map((d) => (
                            <li key={d.channel}>
                              <a href={d.href} download={d.filename} className="block rounded-md px-3 py-3 text-sm text-stone-800 hover:bg-stone-100">
                                {s.history.downloadChannels[d.channel]}
                              </a>
                            </li>
                          ))}
                        </ul>
                      </details>
                    ) : (
                      <button type="button" disabled title={s.history.noImages} className={`${actionClass} opacity-50`}>
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
