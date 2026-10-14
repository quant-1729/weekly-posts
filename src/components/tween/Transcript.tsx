"use client";

export type Entry = { who: "tween" | "you"; text: string };

/** The conversation so far, as a real list: collapsed by default, one button away for keyboard and screen-reader users. */
export function Transcript({
  entries,
  open,
  onToggle,
  copy,
}: {
  entries: Entry[];
  open: boolean;
  onToggle: () => void;
  copy: { show: string; hide: string; label: string; tween: string; you: string };
}) {
  // always laid out (hidden while empty) so the first line does not change the panel's height
  return (
    <div className="tw-transcript" style={{ visibility: entries.length ? "visible" : "hidden" }}>
      <button type="button" aria-expanded={open} aria-controls="tween-transcript" onClick={onToggle} className="tw-link" data-tween="transcript-toggle">
        {open ? copy.hide : copy.show}
      </button>
      <ol id="tween-transcript" aria-label={copy.label} hidden={!open} data-tween="transcript">
        {entries.map((e, i) => (
          <li key={i}>
            <span className="tw-who">{e.who === "tween" ? copy.tween : copy.you}: </span>
            {e.text}
          </li>
        ))}
      </ol>
    </div>
  );
}
