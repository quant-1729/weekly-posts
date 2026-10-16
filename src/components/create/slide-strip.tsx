"use client";

import { useEffect, useId, useRef, useState } from "react";
import { iconButtonOutline } from "@/components/ui";
import { fill, s } from "@/lib/i18n/strings";

const t = s.create.review.slideStrip;

/**
 * A carousel's slides as a row of thumbnails you can scroll sideways. Clicking one opens it large in a viewer with previous and
 * next arrows (and the Left and Right keys); Escape closes it. A slide with items to check carries a small mark. `defaultOpenAt`
 * is for tests.
 */
export function SlideStrip({ urls, flagged = [], defaultOpenAt }: { urls: string[]; flagged?: readonly number[]; defaultOpenAt?: number }) {
  const [at, setAt] = useState<number | null>(defaultOpenAt ?? null);
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const total = urls.length;

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (at !== null && !d.open) d.showModal();
    if (at === null && d.open) d.close();
  }, [at]);

  const go = (n: number) => setAt((cur) => (cur === null ? cur : (cur + n + total) % total));

  return (
    <div className="space-y-1" data-slide-strip>
      <p className="text-ui text-title">{fill(t.title, { n: total })}</p>
      <ul className="flex gap-2 overflow-x-auto pb-1" data-slides>
        {urls.map((url, i) => (
          <li key={url} className="relative shrink-0" data-slide={i + 1}>
            <button type="button" className="block rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-coral" aria-label={fill(t.open, { n: i + 1, total })} onClick={() => setAt(i)}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt={fill(t.slideN, { n: i + 1 })} className="h-36 w-auto rounded-lg bg-well object-contain ring-1 ring-black/5" />
            </button>
            {flagged.includes(i) ? (
              <span data-slide-flag role="img" aria-label={fill(t.flagged, { n: i + 1 })} className="absolute right-1 top-1 inline-flex h-5 w-5 items-center justify-center rounded-full bg-warn-bg text-[12px] font-semibold text-warn-tx ring-1 ring-warn-bd">
                !
              </span>
            ) : null}
          </li>
        ))}
      </ul>

      <dialog
        ref={ref}
        aria-labelledby={titleId}
        data-slide-viewer
        onClose={() => setAt(null)}
        onClick={(e) => {
          if (e.target === ref.current) setAt(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") {
            e.preventDefault();
            go(1);
          } else if (e.key === "ArrowLeft") {
            e.preventDefault();
            go(-1);
          }
        }}
        className="m-auto w-[calc(100vw-2rem)] max-w-xl rounded-card border border-line bg-white p-0 text-ink shadow-card backdrop:bg-black/50"
      >
        {at !== null ? (
          <div className="space-y-3 p-4">
            <div className="flex items-center justify-between gap-2">
              <h2 id={titleId} className="text-card-title text-title">
                {t.dialog} · <span data-slide-counter>{fill(t.counter, { n: at + 1, total })}</span>
              </h2>
              <button type="button" className={iconButtonOutline} aria-label={t.close} onClick={() => setAt(null)} data-slide-close>
                <span aria-hidden="true">×</span>
              </button>
            </div>
            <div className="flex items-center gap-2">
              <button type="button" className={iconButtonOutline} aria-label={t.previous} onClick={() => go(-1)} data-slide-prev>
                <span aria-hidden="true">‹</span>
              </button>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={urls[at]} alt={fill(t.slideN, { n: at + 1 })} className="max-h-[70vh] min-w-0 flex-1 rounded-lg bg-well object-contain" data-slide-large />
              <button type="button" className={iconButtonOutline} aria-label={t.next} onClick={() => go(1)} data-slide-next>
                <span aria-hidden="true">›</span>
              </button>
            </div>
          </div>
        ) : null}
      </dialog>
    </div>
  );
}
