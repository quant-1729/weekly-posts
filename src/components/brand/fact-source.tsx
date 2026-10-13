import { fill, s } from "@/lib/i18n/strings";
import { safePageUrl, type FactView } from "@/lib/memory/schema";

const badge = "inline-flex min-h-7 items-center rounded-full bg-stone-100 px-3 py-0.5 text-xs font-medium text-stone-700";

/**
 * Where a fact came from (Req 5, AC 4/5): "From your website" (a link to the page, with the words
 * we read on tap), "From setup", "From an upload", or "Added by you". An owner's edit of another
 * fact says what it was edited from. Plain markup, so it works without JavaScript.
 */
export function FactSource({ fact }: { fact: FactView }) {
  const t = s.brandV2.facts;
  const quote = fact.sourceQuote?.trim();
  const quoteBlock =
    quote && (fact.sourceType === "website" || fact.sourceType === "upload") ? (
      <details className="mt-1 text-sm">
        <summary className="min-h-8 cursor-pointer text-stone-600 underline">{t.showQuote}</summary>
        <blockquote className="mt-1 border-l-2 border-stone-300 pl-3 text-stone-700">{quote}</blockquote>
      </details>
    ) : null;

  if (fact.sourceType === "website") {
    const href = safePageUrl(fact.sourceRef);
    return (
      <div data-source="website">
        {href ? (
          <a href={href} target="_blank" rel="noopener noreferrer" className={`${badge} underline`} aria-label={`${t.source.website}. ${t.openPage}`}>
            {t.source.website}
          </a>
        ) : (
          <span className={badge}>{t.source.website}</span>
        )}
        {quoteBlock}
      </div>
    );
  }
  if (fact.sourceType === "setup") {
    return (
      <div data-source="setup">
        <span className={badge}>{t.source.setup}</span>
      </div>
    );
  }
  if (fact.sourceType === "upload") {
    return (
      <div data-source="upload">
        <span className={badge}>{t.source.upload}</span>
        {quoteBlock}
      </div>
    );
  }
  return (
    <div data-source="owner">
      <span className={badge}>
        {fact.editedFrom ? fill(t.source.editedFrom, { origin: t.source.origins[fact.editedFrom] }) : t.source.owner}
      </span>
    </div>
  );
}
