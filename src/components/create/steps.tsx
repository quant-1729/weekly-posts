import { s } from "@/lib/i18n/strings";

const STEPS = ["details", "design", "review", "schedule"] as const;

/** The four steps of "Create a post": Details, Design, Review, Schedule. `current` is the step the owner is on. */
export function StepBar({ current }: { current: (typeof STEPS)[number] }) {
  const t = s.create.steps;
  const at = STEPS.indexOf(current);
  return (
    <nav aria-label={t.label} data-create-steps>
      <ol className="grid grid-cols-4 gap-1 text-center text-xs sm:text-sm">
        {STEPS.map((step, i) => {
          const state = i < at ? "done" : i === at ? "current" : "todo";
          return (
            <li
              key={step}
              data-step={step}
              data-state={state}
              aria-current={state === "current" ? "step" : undefined}
              className={`min-w-0 rounded-lg px-1 py-2 ${
                state === "current" ? "bg-[#E4572E] font-semibold text-white" : state === "done" ? "bg-[#E4572E]/10 text-[#B93A15]" : "bg-stone-100 text-stone-600"
              }`}
            >
              <span className="block">{i + 1}</span>
              <span className="block truncate">{t[step]}</span>
              {state === "current" && <span className="sr-only"> ({t.current})</span>}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
