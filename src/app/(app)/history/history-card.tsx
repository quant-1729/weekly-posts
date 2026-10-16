import Link from "next/link";
import { badge, cardClass, outlineButton } from "@/components/ui";
import { s } from "@/lib/i18n/strings";
import { postDownloads } from "@/lib/posts/download";
import type { HistoryPost } from "@/lib/posts/history";
import { historyView } from "@/lib/posts/history-view";
import { formatIstDateTime } from "@/lib/posts/ist";

const actionClass = `${outlineButton} w-full`;

/** One past post: opens its review page; "Download" sits underneath. */
export function HistoryCard({ post, brandName }: { post: HistoryPost; brandName: string }) {
  const createdAt = new Date(post.createdAt);
  const view = historyView(post);
  const downloads = postDownloads({
    brandName,
    createdAt,
    outputs: post.outputs.map((o) => ({ channel: o.channel, imagePath: o.imagePath })),
  });

  return (
    <li className={`${cardClass} !p-0`}>
      <Link href={view.href} aria-label={s.history.openPost} className="flex gap-3 p-3">
        {post.thumbnail ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/api/files/${post.thumbnail.path}?v=${post.thumbnail.version}`}
            alt={s.history.thumbnailAlt}
            loading="lazy"
            className="h-16 w-16 shrink-0 rounded-xl bg-well object-cover ring-1 ring-black/5"
          />
        ) : (
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-well text-center text-note text-helper">
            {s.history.noImage}
          </div>
        )}
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-[13px] leading-[18px] text-desc">{formatIstDateTime(createdAt)}</p>
          <p className="line-clamp-2 text-ui text-title">{post.title || s.history.untitled}</p>
          <div className="flex flex-wrap items-center gap-1">
            {post.languages.map((l) => (
              <span key={l} className={badge("neutral")}>
                {s.history.languages[l]}
              </span>
            ))}
            <span className={badge(view.tone)}>{view.label}</span>
            {view.formatLabel ? (
              <span data-format-badge className={badge("neutral")}>
                {view.formatLabel}
              </span>
            ) : null}
          </div>
        </div>
      </Link>

      <div className="flex gap-2 border-t border-divider p-2">
        {view.permalink && (
          <a href={view.permalink} target="_blank" rel="noopener noreferrer" className={`${actionClass} flex-1`}>
            {s.history.v3Status.viewPost}
          </a>
        )}
        {downloads.length > 0 ? (
          <details className="relative flex-1">
            <summary className={`${actionClass} cursor-pointer`}>{s.history.download}</summary>
            <ul className="absolute bottom-full right-0 z-10 mb-1 w-56 rounded-card border border-line bg-white p-1.5 shadow-dialog">
              {downloads.map((d) => (
                <li key={d.channel}>
                  <a
                    href={d.href}
                    download={d.filename}
                    className="block rounded-lg px-3 py-2.5 text-ui text-sub hover:bg-fill-active hover:text-title"
                  >
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
    </li>
  );
}
