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
  "flex min-h-11 flex-1 items-center justify-center rounded-lg border border-stone-300 bg-white px-3 text-sm font-medium text-stone-800";

/** One past post: opens its review page; "Download" sits underneath. */
export function HistoryCard({ post, brandName }: { post: HistoryPost; brandName: string }) {
  const createdAt = new Date(post.createdAt);
  const downloads = postDownloads({
    brandName,
    createdAt,
    outputs: post.outputs.map((o) => ({ channel: o.channel, imagePath: o.imagePath })),
  });

  return (
    <li className="rounded-xl border border-stone-200 bg-white">
      <Link href={`/review/${post.id}`} aria-label={s.history.openPost} className="flex gap-3 p-3">
        {post.thumbnail ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/api/files/${post.thumbnail.path}?v=${post.thumbnail.version}`}
            alt={s.history.thumbnailAlt}
            loading="lazy"
            className="h-20 w-20 shrink-0 rounded-lg bg-stone-100 object-cover"
          />
        ) : (
          <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-lg bg-stone-100 text-xs text-stone-500">
            {s.history.noImage}
          </div>
        )}
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-sm text-stone-600">{formatIstDateTime(createdAt)}</p>
          <p className="line-clamp-2 font-medium">{post.title || s.history.untitled}</p>
          <div className="flex flex-wrap items-center gap-1">
            {post.languages.map((l) => (
              <span key={l} className="rounded-full border border-stone-300 px-2 py-0.5 text-xs text-stone-700">
                {s.history.languages[l]}
              </span>
            ))}
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[post.status]}`}>
              {s.history.status[post.status]}
            </span>
          </div>
        </div>
      </Link>

      <div className="flex gap-2 border-t border-stone-200 p-2">
        {downloads.length > 0 ? (
          <details className="relative flex-1">
            <summary className={`${actionClass} cursor-pointer list-none`}>{s.history.download}</summary>
            <ul className="absolute bottom-full right-0 z-10 mb-1 w-56 rounded-lg border border-stone-200 bg-white p-1 shadow-lg">
              {downloads.map((d) => (
                <li key={d.channel}>
                  <a
                    href={d.href}
                    download={d.filename}
                    className="block rounded-md px-3 py-3 text-sm text-stone-800 hover:bg-stone-100"
                  >
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
    </li>
  );
}
