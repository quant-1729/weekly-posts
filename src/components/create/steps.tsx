import { s } from "@/lib/i18n/strings";

const STEPS = ["details", "show", "design", "review", "schedule"] as const;

/**
 * The five steps of "Create a post": Details, On the post, Design, Review, Schedule. `current` is the step the owner is on.
 * Pills: done steps are coral-tint with a check, the current step is the near-black pill, the rest are quiet.
 * On phones only the current step shows its label; the others shrink to a number or check.
 */
export function StepBar({ current }: { current: (typeof STEPS)[number] }) {
  const t = s.create.steps;
  const at = STEPS.indexOf(current);
  return (
    <nav aria-label={t.label} data-create-steps className="mb-6 max-md:mb-4">
      <ol className="flex gap-1.5 max-md:gap-1">
        {STEPS.map((step, i) => {
          const state = i < at ? "done" : i === at ? "current" : "todo";
          return (
            <li
              key={step}
              data-step={step}
              data-state={state}
              aria-current={state === "current" ? "step" : undefined}
              className={`flex h-10 min-w-0 flex-1 items-center gap-2 rounded-full px-3 text-ui max-md:h-9 max-md:px-0 ${
                state === "current"
                  ? "bg-ink text-white max-md:px-3"
                  : state === "done"
                    ? "bg-coral-tint text-coral-dark max-md:flex-none max-md:basis-9 max-md:justify-center"
                    : "bg-well text-sub max-md:flex-none max-md:basis-9 max-md:justify-center"
              }`}
            >
              <span
                className={`grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] font-medium leading-none ${
                  state === "current" ? "bg-white text-ink" : state === "done" ? "bg-coral text-white" : "bg-white/70"
                }`}
              >
                {state === "done" ? (
                  <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M5 12.5l4.5 4.5L19 7.5" />
                  </svg>
                ) : (
                  i + 1
                )}
              </span>
              <span className={`min-w-0 truncate ${state === "current" ? "" : "max-md:sr-only"}`}>{t[step]}</span>
              {state === "current" && <span className="sr-only"> ({t.current})</span>}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
