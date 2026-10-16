import { makeIdeaPostAction } from "@/app/(app)/ideas/actions";
import { badge, strongButton, wellClass } from "@/components/ui";
import { fill, s } from "@/lib/i18n/strings";
import type { IdeaSuggestion } from "@/lib/ideas/suggest";
import { SubmitButton } from "./submit-button";

const t = s.ideas.page.suggestions;
const typeLabel = (pt: string): string => (s.create.type.options as Record<string, { label: string }>)[pt]?.label ?? pt;

/**
 * "From your ideas": up to two of the best unused ideas next to the weekly suggestions on the Queue page. Each opens
 * "Make this post" (a draft in Create a post). Nothing is made, approved or scheduled until the owner does it.
 */
export function IdeaSuggestions({ suggestions }: { suggestions: IdeaSuggestion[] }) {
  if (suggestions.length === 0) return null;
  return (
    <div className="space-y-2" data-idea-suggestions>
      <h3 className="text-ui text-title">{t.title}</h3>
      <ul className="grid gap-2 md:grid-cols-2">
        {suggestions.map((x) => (
          <li key={x.ideaId} className={`${wellClass} flex min-w-0 flex-col justify-between gap-2`}>
            <div className="min-w-0 space-y-1">
              <span className={badge("coral")}>{typeLabel(x.postType)}</span>
              <p className="break-words text-ui text-title">{x.angle}</p>
              <p className="break-words text-[13px] leading-[18px] text-desc">{fill(t.why, { title: x.cardTitle })}</p>
            </div>
            <form action={makeIdeaPostAction}>
              <input type="hidden" name="ideaId" value={x.ideaId} />
              <SubmitButton className={strongButton}>{t.make}</SubmitButton>
            </form>
          </li>
        ))}
      </ul>
    </div>
  );
}
