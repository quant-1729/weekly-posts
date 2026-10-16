import { badge, cardClass, pickCardClass } from "@/components/ui";
import { s } from "@/lib/i18n/strings";

/** A badge for a field that was filled from the "Describe your post" box, so the owner knows to check it. */
export function FromDescription() {
  return (
    <span data-from-description className={badge("info")}>
      {s.create.fromDescription}
    </span>
  );
}

/**
 * One section of the brief editor. Fields filled from the description get a blue-tinted ring and a badge.
 * `min-w-0` and wrapping keep long words from pushing the page wider than a phone.
 * `hideTitle` keeps the heading for screen readers only (the first card repeats the page title).
 */
export function EditorCard({
  id,
  title,
  hint,
  fromDescription = false,
  hideTitle = false,
  children,
}: {
  id: string;
  title: string;
  hint?: string;
  fromDescription?: boolean;
  hideTitle?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      data-editor-card={id}
      className={`min-w-0 space-y-3 ${cardClass} ${fromDescription ? "border-info-bd ring-[3px] ring-info-bg" : ""}`}
    >
      <div className={hideTitle ? "sr-only" : "flex flex-wrap items-center justify-between gap-2"}>
        <h2 id={`${id}-title`} className="text-card-title text-title">
          {title}
        </h2>
        {fromDescription && <FromDescription />}
      </div>
      {hint && <p className="-mt-2 break-words text-[13px] leading-[18px] text-desc">{hint}</p>}
      {children}
    </section>
  );
}

/** Class for a pick-one card or chip (radio or checkbox inside a label). The picked one keeps the coral tint. */
export function pickClass(selected: boolean, disabled = false): string {
  return `${pickCardClass(selected)} ${disabled ? "cursor-not-allowed opacity-50" : ""}`;
}
