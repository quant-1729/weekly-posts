import Link from "next/link";
import { dismissCardAction, dismissIdeaAction, makeIdeaPostAction } from "@/app/(app)/ideas/actions";
import { badge, cardClass, quietButton, strongButton, wellClass, type BadgeTone } from "@/components/ui";
import { fill, s } from "@/lib/i18n/strings";
import { formatDayMonth } from "@/lib/links/format";
import type { CardView, IdeaView } from "@/lib/ideas/view";
import { SubmitButton } from "./submit-button";

const t = s.ideas.page.card;
const TONE: Record<CardView["confidence"], BadgeTone> = { high: "ok", medium: "info", low: "warn" };
const typeLabel = (pt: string): string => (s.create.type.options as Record<string, { label: string }>)[pt]?.label ?? pt;

function Idea({ idea }: { idea: IdeaView }) {
  const used = idea.status === "used";
  return (
    <li className={`${wellClass} space-y-2`} data-idea={idea.id}>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={badge("coral")}>{typeLabel(idea.postType)}</span>
        {idea.format && <span className={badge("neutral")}>{t.formats[idea.format]}</span>}
      </div>
      <p className="break-words text-ui text-title">{idea.angle}</p>
      <p className="break-words text-[14px] leading-5 text-sub">{idea.description}</p>
      {idea.flags.length > 0 && (
        <ul className="space-y-1" aria-label={t.pleaseCheck}>
          {idea.flags.map((f) => (
            <li key={f} className="break-words rounded-lg border border-warn-bd bg-warn-bg px-2.5 py-1.5 text-[13px] leading-[18px] text-warn-deep">
              {f}
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {used ? (
          <>
            <span className={badge("ok")}>{t.used}</span>
            {idea.briefId && (
              <Link href={`/create/${idea.briefId}`} className={quietButton}>
                {t.openPost}
              </Link>
            )}
          </>
        ) : (
          <>
            <form action={makeIdeaPostAction}>
              <input type="hidden" name="ideaId" value={idea.id} />
              <SubmitButton className={strongButton}>{t.makePost}</SubmitButton>
            </form>
            <form action={dismissIdeaAction}>
              <input type="hidden" name="ideaId" value={idea.id} />
              <SubmitButton className={quietButton}>{t.notForMe}</SubmitButton>
            </form>
          </>
        )}
      </div>
    </li>
  );
}

/** One trend card: what is trending, why it matters, where it came from, and the post ideas under it. */
export function TrendCard({ card }: { card: CardView }) {
  return (
    <article className={`${cardClass} space-y-3`} data-trend-card={card.id}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1.5">
          <h2 className="break-words text-card-title text-title">{card.title}</h2>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={badge(TONE[card.confidence])}>{t.confidence[card.confidence]}</span>
            <span className={badge("neutral")}>{card.sources.length === 1 ? t.sources.one : fill(t.sources.other, { n: card.sources.length })}</span>
            <span className={badge("neutral")}>{t.fresh[card.freshness]}</span>
          </div>
        </div>
        <details className="relative shrink-0">
          <summary
            aria-label={t.menu}
            className="flex h-9 w-9 cursor-pointer list-none items-center justify-center rounded-full text-sub hover:bg-fill-active max-md:h-11 max-md:w-11 [&::-webkit-details-marker]:hidden"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden="true">
              <circle cx="5" cy="12" r="1.6" />
              <circle cx="12" cy="12" r="1.6" />
              <circle cx="19" cy="12" r="1.6" />
            </svg>
          </summary>
          <div className="absolute right-0 z-10 mt-1 w-52 rounded-2xl border border-line bg-white p-1 shadow-dialog">
            <form action={dismissCardAction}>
              <input type="hidden" name="cardId" value={card.id} />
              <SubmitButton className="flex h-9 w-full items-center rounded-lg px-2.5 text-left text-ui text-sub hover:bg-fill-active max-md:h-11">{t.dismissCard}</SubmitButton>
            </form>
          </div>
        </details>
      </div>

      <p className="break-words text-[14px] leading-5 text-sub">{card.summary}</p>
      <div>
        <h3 className="text-ui text-title">{t.why}</h3>
        <p className="break-words text-[14px] leading-5 text-sub">{card.whyItMatters}</p>
      </div>

      {card.sources.length > 0 && (
        <ul className="flex flex-col gap-1" aria-label={t.sourcesLabel}>
          {card.sources.map((src) => (
            <li key={src.url} className="min-w-0 text-[13px] leading-[18px]">
              <a href={src.url} target="_blank" rel="noopener noreferrer nofollow" title={src.title} className="break-all text-desc underline underline-offset-2 hover:text-title">
                {fill(t.sourceLine, { site: src.site || new URL(src.url).hostname, date: formatDayMonth(src.publishedAt) })}
              </a>
            </li>
          ))}
        </ul>
      )}

      {card.ideas.length > 0 && (
        <ul className="space-y-2" aria-label={t.ideasLabel}>
          {card.ideas.map((i) => (
            <Idea key={i.id} idea={i} />
          ))}
        </ul>
      )}
    </article>
  );
}
