"use client";

import { useEffect, useState, type ComponentType } from "react";
import type { TweenBundle } from "@/lib/tween/types";

/**
 * The only Tween code in the initial bundle. After the page has loaded and the browser is idle it fetches the written
 * content (/api/tween, same origin) and the code-split Tween chunk together. If either fails, Tween is simply absent.
 */
export function TweenLoader() {
  const [view, setView] = useState<{ Tween: ComponentType<{ bundle: TweenBundle }>; bundle: TweenBundle } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const start = () => {
      Promise.all([import("./Tween"), fetch("/api/tween").then((r) => (r.ok ? (r.json() as Promise<TweenBundle>) : Promise.reject(new Error("no tween"))))])
        .then(([mod, bundle]) => {
          if (!cancelled) setView({ Tween: mod.default, bundle });
        })
        .catch(() => undefined);
    };
    const idle = window.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 1200));
    const run = () => idle(start);
    if (document.readyState === "complete") run();
    else window.addEventListener("load", run, { once: true });
    return () => {
      cancelled = true;
      window.removeEventListener("load", run);
    };
  }, []);

  return view ? <view.Tween bundle={view.bundle} /> : null;
}
