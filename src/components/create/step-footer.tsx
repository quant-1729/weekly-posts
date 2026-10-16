/**
 * The footer of a "Create a post" step: save status on the left, the step's buttons on the right. It sticks to the
 * bottom of the screen (above the phone bottom nav) so Back and Next are always in reach.
 * `data-editor-footer` is kept for the editor tests and Tween.
 */
export function StepFooter({ status, children, problems }: { status?: React.ReactNode; children: React.ReactNode; problems?: React.ReactNode }) {
  return (
    <div
      data-editor-footer
      className="sticky bottom-0 z-5 mt-6 min-w-0 space-y-2 bg-cream py-3 shadow-fade max-md:bottom-15"
    >
      {problems}
      <div className="flex min-w-0 items-center justify-between gap-3">
        <div className="min-w-0 flex-1 text-[13px] leading-[18px] text-desc">{status}</div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">{children}</div>
      </div>
    </div>
  );
}

/** "Draft saved" with a small check, or the saving/error line. */
export function SaveStatus({ state, text }: { state: "idle" | "saving" | "saved" | "error"; text: string }) {
  return (
    <p aria-live="polite" data-save-state={state} className={`flex min-h-5 items-center gap-1.5 break-words ${state === "error" ? "text-err-tx" : ""}`}>
      {state === "saved" && (
        <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-ok-tx" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <path d="M8 12.5l3 3 5-6" />
        </svg>
      )}
      {text}
    </p>
  );
}
