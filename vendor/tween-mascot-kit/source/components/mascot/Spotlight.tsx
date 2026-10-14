"use client";

import { useEffect, useRef } from "react";

/**
 * A soft ring drawn around the element carrying `data-tween-target="<id>"`. It lives in a fixed layer, follows the
 * target on scroll and resize (one animation frame per event, only while a target is set), and never takes pointer events.
 */
export function Spotlight({ target }: { target: string | null }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ring = ref.current;
    if (!ring || !target) return;
    const el = document.querySelector<HTMLElement>(`[data-tween-target="${CSS.escape(target)}"]`);
    if (!el) {
      ring.style.opacity = "0";
      return;
    }
    let raf = 0;
    const place = () => {
      raf = 0;
      const r = el.getBoundingClientRect();
      const vh = window.innerHeight;
      const top = Math.max(r.top, 6);
      const bottom = Math.min(r.bottom, vh - 6);
      const left = Math.max(r.left, 6);
      const right = Math.min(r.right, window.innerWidth - 6);
      const visible = bottom > top && right > left;
      ring.style.opacity = visible ? "1" : "0";
      ring.style.transform = `translate(${left}px, ${top}px)`;
      ring.style.width = `${Math.max(0, right - left)}px`;
      ring.style.height = `${Math.max(0, bottom - top)}px`;
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(place);
    };
    place();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    const ro = new ResizeObserver(schedule);
    ro.observe(el);
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      ro.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [target]);

  if (!target) return null;
  return <div ref={ref} data-tween="spotlight" data-target={target} aria-hidden="true" className="tw-spotlight" />;
}
