"use client";

import { useEffect, useState } from "react";

const CHARS_PER_SECOND = 42;

/**
 * One speech bubble. The visible text types out (skippable; instant under reduced motion); screen readers get the
 * finished line from the live region in the panel, so the typing itself is hidden from them.
 * The whole line is always laid out: the part not typed yet is invisible, not absent, so the bubble never changes size
 * while it types (that would be a layout shift).
 */
export function Bubble({ text, started, instant, skip, onDone }: { text: string; started: boolean; instant: boolean; skip: number; onDone?: () => void }) {
  const total = text.length;
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
      {text.slice(0, count)}
      <span className="tw-ghost">{text.slice(count)}</span>
    </p>
  );
}
