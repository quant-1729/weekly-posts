import Link from "next/link";

export type Stage = "requirements" | "design" | "automate";

const STAGES: { id: Stage; n: number; label: string; hint: string }[] = [
  { id: "requirements", n: 1, label: "Your week", hint: "Offers and details" },
  { id: "design", n: 2, label: "Design studio", hint: "One look for every day" },
  { id: "automate", n: 3, label: "Automate", hint: "Approve, schedule, relax" },
];

/** The three stages of a weekly plan, always in view, so the owner knows where they are. */
export function StageBar({ current, planId }: { current: Stage; planId?: string }) {
  const at = STAGES.findIndex((s) => s.id === current);
  const href = (s: Stage) => (s === "requirements" ? "/plan" : planId ? (s === "design" ? `/plan/${planId}/design` : `/plan/${planId}`) : null);
  return (
    <ol className="mb-4 grid grid-cols-3 gap-2" aria-label="Plan stages">
      {STAGES.map((s, i) => {
        const done = i < at;
        const on = i === at;
        const link = href(s.id);
        const inner = (
          <span className={`flex items-center gap-3 rounded-2xl px-4 py-2.5 transition ${on ? "bg-ink text-white shadow-sm" : done ? "bg-coral-tint text-coral-dark hover:bg-coral-50" : "bg-well text-sub"}`}>
            <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold ${on ? "bg-white text-ink" : done ? "bg-coral text-white" : "bg-white text-sub"}`}>{done ? "✓" : s.n}</span>
            <span className="min-w-0">
              <span className="block truncate text-[14px] font-medium leading-5">{s.label}</span>
              <span className={`block truncate text-[12px] leading-4 ${on ? "text-white/70" : "text-desc"}`}>{s.hint}</span>
            </span>
          </span>
        );
        return (
          <li key={s.id} aria-current={on ? "step" : undefined}>
            {link && (done || on) ? <Link href={link}>{inner}</Link> : inner}
          </li>
        );
      })}
    </ol>
  );
}
