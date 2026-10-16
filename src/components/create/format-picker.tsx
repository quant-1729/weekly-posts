"use client";

import { badge, segButton, segTrack } from "@/components/ui";
import { MAX_SLIDES, MIN_SLIDES, CONTENT_FORMATS, AVAILABLE_CONTENT_FORMATS, type ContentFormat } from "@/lib/briefs/types";
import { fill, s } from "@/lib/i18n/strings";

const t = s.create.format;

const stepButton =
  "inline-flex h-7 w-7 items-center justify-center rounded-full text-ui text-sub transition hover:bg-fill-active focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-coral disabled:cursor-not-allowed disabled:text-faint max-md:h-11 max-md:w-11";

/**
 * "What are you making?" at the very top of Create a post: Post, Carousel or Reel. Reel is not made yet, so it is shown but
 * disabled with a small "Coming soon" badge (`aria-disabled`, and the words are in the label itself, no tooltip needed). Picking Carousel shows a compact
 * slide-count stepper (- 5 +, 3 to 10) next to the choice.
 */
export function FormatPicker({ format, slides, onFormat, onSlides }: { format: ContentFormat; slides: number; onFormat: (f: ContentFormat) => void; onSlides: (n: number) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2" data-format-picker>
      <div className={segTrack} role="radiogroup" aria-label={t.title}>
        {CONTENT_FORMATS.map((f) => {
          const available = AVAILABLE_CONTENT_FORMATS.includes(f);
          const on = format === f;
          return (
            <button
              key={f}
              type="button"
              role="radio"
              aria-checked={on}
              aria-disabled={!available}
              data-format={f}
              data-selected={on}
              className={`${segButton(on)} gap-1.5 ${available ? "" : "cursor-not-allowed opacity-60 hover:text-desc"}`}
              onClick={() => {
                if (available) onFormat(f);
              }}
            >
              {t.options[f]}
              {available ? null : (
                <span data-coming-soon className={badge("neutral")}>
                  {t.comingSoon}
                </span>
              )}
            </button>
          );
        })}
      </div>
      {format === "carousel" ? (
        <div className="inline-flex items-center gap-1 text-ui text-title" role="group" aria-label={t.slidesLabel} data-slide-stepper>
          <button type="button" className={stepButton} aria-label={t.slidesLess} disabled={slides <= MIN_SLIDES} onClick={() => onSlides(slides - 1)}>
            <span aria-hidden="true">−</span>
          </button>
          <span className="min-w-[4.5rem] text-center tabular-nums" role="status" data-slide-count={slides}>
            {fill(t.slidesValue, { n: slides })}
          </span>
          <button type="button" className={stepButton} aria-label={t.slidesMore} disabled={slides >= MAX_SLIDES} onClick={() => onSlides(slides + 1)}>
            <span aria-hidden="true">+</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}
