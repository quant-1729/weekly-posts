"use client";

import { useEffect, type RefObject } from "react";

/**
 * Closes a popover when Escape is pressed or a pointer goes down outside it. `onClose` gets the reason so the caller can
 * move focus back to the button that opened it after Escape.
 */
export function useDismiss(open: boolean, ref: RefObject<HTMLElement | null>, onClose: (reason: "escape" | "outside") => void): void {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose("escape");
      }
    }
    function onDown(e: PointerEvent) {
      if (ref.current && e.target instanceof Node && !ref.current.contains(e.target)) onClose("outside");
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [open, ref, onClose]);
}
