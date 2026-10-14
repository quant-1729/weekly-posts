import { s } from "@/lib/i18n/strings";

/** A badge for a field that was filled from the "Describe your post" box, so the owner knows to check it. */
export function FromDescription() {
  return (
    <span data-from-description className="inline-block rounded-full bg-sky-100 px-2.5 py-0.5 text-xs font-medium text-sky-900">
      {s.create.fromDescription}
    </span>
  );
}

/**
 * One section of the brief editor. Fields filled from the description get a blue ring and a badge.
 * `min-w-0` and wrapping keep long words from pushing the page wider than a phone.
 */
export function EditorCard({
  id,
  title,
  hint,
  fromDescription = false,
  children,
}: {
  id: string;
  title: string;
  hint?: string;
  fromDescription?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      data-editor-card={id}
      className={`min-w-0 space-y-3 rounded-2xl border bg-white p-4 ${fromDescription ? "border-sky-300 ring-2 ring-sky-200" : "border-stone-200"}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <h2 id={`${id}-title`} className="text-lg font-bold">
          {title}
        </h2>
        {fromDescription && <FromDescription />}
      </div>
      {hint && <p className="-mt-1 break-words text-sm text-stone-600">{hint}</p>}
      {children}
    </section>
  );
}

/** Class for a pick-one card or chip (radio or checkbox inside a label). */
export function pickClass(selected: boolean, disabled = false): string {
  return `flex min-h-12 min-w-0 cursor-pointer items-start gap-3 rounded-xl border p-3 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[#E4572E] ${
    selected ? "border-[#E4572E] bg-[#E4572E]/10" : "border-stone-300 bg-white"
  } ${disabled ? "cursor-not-allowed opacity-50" : ""}`;
}
