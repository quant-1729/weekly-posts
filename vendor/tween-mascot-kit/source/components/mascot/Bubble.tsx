"use client";

import { useEffect, useMemo, useState } from "react";
import { splitMarkers } from "@/lib/placeholders";

const CHARS_PER_SECOND = 42;

/**
 * One speech bubble. The visible text types out (skippable; instant under reduced motion); screen readers get the
 * finished line from the live region in the panel, so the typing itself is hidden from them.
 * The whole line is always laid out: the part not typed yet is invisible, not absent, so the bubble never changes size
 * while it types (that would be a layout shift). Placeholder markers appear whole, as the site's amber tags.
 */
export function Bubble({ text, started, instant, skip, onDone }: { text: string; started: boolean; instant: boolean; skip: number; onDone?: () => void }) {
  const segments = useMemo(() => splitMarkers(text), [text]);
  const total = useMemo(() => segments.reduce((n, s) => n + (s.type === "text" ? s.value.length : 0), 0), [segments]);
  const starts = segments.map((_, i) => segments.slice(0, i).reduce((n, seg) => n + (seg.type === "text" ? seg.value.length : 0), 0));
  const [typed, setTyped] = useState(0);
  const count = !started ? 0 : instant || skip > 0 ? total : typed;
  const done = started && count >= total;

  useEffect(() => {
    if (!started || count >= total) return;
    const id = window.setInterval(() => setTyped((c) => Math.min(total, c + 1)), 1000 / CHARS_PER_SECOND);
    return () => window.clearInterval(id);
  }, [started, count, total]);

  useEffect(() => {
    if (done) onDone?.();
    // onDone fires once per finished line; it is deliberately not a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done, text]);

  return (
    <p data-tween="bubble-line" data-started={started ? "true" : "false"} className="tw-bubble" aria-hidden="true">
      {segments.map((s, i) => {
        const at = starts[i] ?? 0;
        if (s.type === "marker") {
          return (
            <span key={i} className={`placeholder-tag${count >= at && started ? "" : " tw-ghost"}`}>
              {s.value}
            </span>
          );
        }
        const n = Math.max(0, Math.min(s.value.length, count - at));
        return (
          <span key={i}>
            {s.value.slice(0, n)}
            <span className="tw-ghost">{s.value.slice(n)}</span>
          </span>
        );
      })}
    </p>
  );
}
