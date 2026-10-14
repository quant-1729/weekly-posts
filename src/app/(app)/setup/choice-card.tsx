"use client";

/** A big tappable card: one of several (radio) or one of any number (checkbox). */
export function ChoiceCard(props: {
  selected: boolean;
  label: string;
  hint: string;
  onSelect: () => void;
  kind?: "radio" | "checkbox";
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role={props.kind ?? "radio"}
      aria-checked={props.selected}
      disabled={props.disabled}
      onClick={props.onSelect}
      className={`block w-full rounded-lg border px-4 py-3 text-left disabled:opacity-60 ${
        props.selected ? "border-[#E4572E] bg-[#E4572E]/10" : "border-stone-300 bg-white"
      }`}
    >
      <span className="block text-lg font-semibold text-stone-900">{props.label}</span>
      <span className="block text-sm text-stone-600">{props.hint}</span>
    </button>
  );
}
