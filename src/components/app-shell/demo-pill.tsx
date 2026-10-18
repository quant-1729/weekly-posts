import { s } from "@/lib/i18n/strings";

/** Shown in the header during a demo session (docs/15-demo-login.md). */
export function DemoPill() {
  return (
    <span
      data-demo-pill
      title={s.demo.pillLabel}
      aria-label={s.demo.pillLabel}
      className="mr-2 inline-flex h-6 shrink-0 items-center rounded-full bg-coral-tint px-2.5 text-note font-medium text-coral-dark"
    >
      {s.demo.pill}
    </span>
  );
}
