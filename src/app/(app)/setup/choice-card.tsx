"use client";

import { pickCardClass } from "@/components/ui";

/** A big tappable card: one of several (radio) or one of any number (checkbox). The picked one keeps the coral tint. */
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
      className={`${pickCardClass(props.selected)} !block w-full px-4 py-3 text-left disabled:opacity-60`}
    >
      <span className="block text-ui text-title">{props.label}</span>
      <span className="mt-0.5 block text-note text-desc">{props.hint}</span>
    </button>
  );
}
