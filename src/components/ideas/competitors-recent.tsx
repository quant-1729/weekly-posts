import Link from "next/link";
import { cardClass, linkButton } from "@/components/ui";
import { fill, s } from "@/lib/i18n/strings";
import type { IdeasView } from "@/lib/ideas/view";

const t = s.ideas.page;
const count = (n: number | null): string => (n === null ? "-" : String(n));

/**
 * What each named competitor posted recently, from the public counts we saved (format, likes, comments, and a link to
 * the best post). Hidden when Business Discovery is off and there is nothing saved. Counts only, never their words.
 */
export function CompetitorsRecent({ competitors }: { competitors: IdeasView["competitors"] }) {
  if (!competitors.businessDiscovery && competitors.recent.length === 0) return null;
  return (
    <section aria-labelledby="competitors-title" className={`${cardClass} space-y-3`} data-competitors>
      <h2 id="competitors-title" className="text-card-title text-title">
        {t.competitorsTitle}
      </h2>
      {competitors.named === 0 ? (
        <p className="text-[14px] leading-5 text-desc">
          {t.competitorsHint}{" "}
          <Link href="/brand#competitors" className={linkButton}>
            {t.competitorsLink}
          </Link>
        </p>
      ) : competitors.recent.length === 0 ? (
        <p className="text-[14px] leading-5 text-desc">{t.competitorNone}</p>
      ) : (
        <ul className="divide-y divide-divider">
          {competitors.recent.map((c) => (
            <li key={c.competitorId} className="space-y-1 py-2 first:pt-0 last:pb-0">
              <p className="break-words text-ui text-title">{c.name}</p>
              <ul className="space-y-0.5 text-[13px] leading-[18px] text-desc">
                {c.posts.map((p) => (
                  <li key={p.permalink}>{fill(t.competitorPost, { format: t.competitorFormats[p.format], likes: count(p.likes), comments: count(p.comments) })}</li>
                ))}
              </ul>
              {c.bestPermalink && (
                <a href={c.bestPermalink} target="_blank" rel="noopener noreferrer nofollow" className="inline-block text-[13px] leading-[18px] text-sub underline underline-offset-2 hover:text-title">
                  {t.competitorBest}
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
