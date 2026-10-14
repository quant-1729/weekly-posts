"use client";

import { useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { TweenRig } from "./TweenRig";

/**
 * A small Tween that pops up from behind a section's top edge as the section scrolls into view, waves, and ducks back.
 * Decorative only (aria-hidden, no pointer events); Tween.tsx decides when, and removes it when the animation ends.
 */
export type PeekSpot = { section: HTMLElement; side: "l" | "r"; key: number };

export function SectionPeek({ spot, onEnd }: { spot: PeekSpot; onEnd: () => void }) {
  // the peek hangs off the section's top edge, so the section must be its containing block
  useLayoutEffect(() => {
    const section = spot.section;
    if (getComputedStyle(section).position === "static") section.style.setProperty("position", "relative");
  }, [spot.section]);
  // animationend never comes in a background tab; the peek clears itself either way
  useLayoutEffect(() => {
    const t = window.setTimeout(onEnd, 3400);
    return () => window.clearTimeout(t);
  }, [onEnd]);
  return createPortal(
    <div key={spot.key} className="tw-sect-peek" data-side={spot.side} data-tween="section-peek" aria-hidden="true">
      <div className="tw-sect-peek-body" onAnimationEnd={(e) => e.target === e.currentTarget && onEnd()}>
        <TweenRig state="wave" face="happy" facing={spot.side === "r" ? "left" : "right"} pointDir="up" talking={false} still={false} />
      </div>
    </div>,
    spot.section,
  );
}

/** A section can take a peek if its top edge is in the upper part of the viewport and nothing clips above it. */
export function peekable(section: HTMLElement): boolean {
  const r = section.getBoundingClientRect();
  if (r.top < 90 || r.top > window.innerHeight * 0.7 || r.width < 320) return false;
  const cs = getComputedStyle(section);
  return cs.overflow === "visible" && cs.overflowY === "visible";
}
