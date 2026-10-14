/** One collapsible section of the brand page. Plain <details>, so it works without JavaScript. */
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
    <details id={id} data-tween-target={id} open={defaultOpen} className="group rounded-2xl border border-stone-200 bg-white">
      <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-lg font-bold [&::-webkit-details-marker]:hidden">
        <span>{title}</span>
        <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0 transition-transform group-open:rotate-180" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </summary>
      <div className="space-y-4 px-4 pb-5">{children}</div>
    </details>
  );
}
