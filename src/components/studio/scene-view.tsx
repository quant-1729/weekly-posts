"use client";

import { createElement, memo, type ReactNode } from "react";
import { buildScene } from "@/lib/studio/scene";
import type { StudioShaper } from "@/lib/studio/shaper";
import type { StudioDoc } from "@/lib/studio/types";
import type { VNode } from "@/lib/studio/vnode";

export function toReact(n: VNode | string, key?: string | number, positional = false): ReactNode {
  if (typeof n === "string") return n;
  const props: Record<string, unknown> = { ...(n.a ?? {}), key: positional ? key : (n.k ?? key) };
  for (const k of Object.keys(props)) if (props[k] === undefined) delete props[k];
  if (n.s) props.style = n.s;
  if (n.raw) {
    props.dangerouslySetInnerHTML = { __html: n.raw };
    return createElement(n.t, props);
  }
  return createElement(n.t, props, ...(n.c ?? []).map((c, i) => toReact(c, i)));
}

export interface SceneViewProps {
  doc: StudioDoc;
  shaper: StudioShaper;
  fontsVersion: number;
  idPrefix: string;
  skip?: ReadonlySet<string>;
  className?: string;
  /**
   * Match layers by their place in the list instead of their id. Thumbnails of designs that are made again (new
   * layer ids every time) use this, so a rebuilt thumbnail updates in place and its photo is not loaded again.
   */
  positional?: boolean;
}

/** The poster as live SVG (the same drawing the server stores). */
export const SceneView = memo(function SceneView({ doc, shaper, idPrefix, skip, className, positional }: SceneViewProps) {
  const tree = buildScene(doc, shaper, { idPrefix, skip });
  const a = tree.a ?? {};
  return createElement(
    "svg",
    { viewBox: a.viewBox, className, xmlns: "http://www.w3.org/2000/svg", preserveAspectRatio: "xMidYMid meet", style: { display: "block", width: "100%", height: "100%" } },
    ...(tree.c ?? []).map((c, i) => toReact(c, i, positional)),
  );
});
