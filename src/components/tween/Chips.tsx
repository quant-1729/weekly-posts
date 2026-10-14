"use client";

export type Chip = { label: string; value: string };

/**
 * Two to four reply buttons under the bubble. Native buttons: keyboard, focus ring and touch size come for free.
 * Until Tween has finished speaking the list keeps its space but is hidden (and so not focusable), so nothing shifts when it appears.
 */
export function Chips({ chips, ready, label, onPick }: { chips: Chip[]; ready: boolean; label: string; onPick: (c: Chip) => void }) {
  if (!chips.length) return null;
  return (
    <ul aria-label={label} data-tween="chips" className="tw-chips" style={{ visibility: ready ? "visible" : "hidden" }} aria-hidden={!ready}>
      {chips.map((c) => (
        <li key={c.value}>
          <button type="button" data-tween-chip={c.value} className="tw-chip" onClick={() => onPick(c)}>
            {c.label}
          </button>
        </li>
      ))}
    </ul>
  );
}
