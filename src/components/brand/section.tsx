import { cardClass } from "@/components/ui";

/**
 * One collapsible section of the brand page. Plain <details>, so it works without JavaScript.
 * A white card with a calm 16/500 title and a chevron that turns when open.
 */
export function BrandSection({
  id,
  title,
  defaultOpen = false,
  children,
}: {
  id: string;
  title: string;
  defaultOpen?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <details id={id} data-tween-target={id} open={defaultOpen} className={`group min-w-0 scroll-mt-16 ${cardClass} !p-0`}>
      <summary className="flex min-h-14 cursor-pointer items-center justify-between gap-3 rounded-card px-4 py-3 text-card-title text-title">
        <span className="min-w-0">{title}</span>
        <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0 text-desc transition-transform group-open:rotate-180" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
          <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </summary>
      <div className="space-y-4 px-4 pb-5">{children}</div>
    </details>
  );
}
