"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { layoutText } from "@/lib/studio/scene";
import type { StudioShaper } from "@/lib/studio/shaper";
import { STORY_SAFE, type Layer, type StudioDoc, type TextLayer } from "@/lib/studio/types";
import { SceneView } from "./scene-view";

type Patch = Partial<Layer>;

export interface CanvasProps {
  doc: StudioDoc;
  shaper: StudioShaper;
  fontsVersion: number;
  selectedId: string | null;
  zoom: number;
  onSelect: (id: string | null) => void;
  /** A gesture starts (the editor keeps an undo point). */
  onBegin: () => void;
  /** Live change during a gesture or typing (no new undo point). */
  onLive: (id: string, patch: Patch) => void;
  editingId: string | null;
  onEdit: (id: string | null) => void;
}

const LOCK_ASPECT = new Set(["image", "badge", "qr", "icon", "character"]);
const SNAP_PX = 7;

interface Gesture {
  kind: "move" | "resize" | "rotate";
  id: string;
  start: { x: number; y: number };
  orig: Layer;
  hx?: number;
  hy?: number;
  began: boolean;
}

function toLocal(l: Layer, x: number, y: number) {
  const cx = l.x + l.w / 2;
  const cy = l.y + l.h / 2;
  const a = (-l.rot * Math.PI) / 180;
  const dx = x - cx;
  const dy = y - cy;
  return { x: dx * Math.cos(a) - dy * Math.sin(a), y: dx * Math.sin(a) + dy * Math.cos(a) };
}

const inside = (l: Layer, x: number, y: number) => {
  const p = toLocal(l, x, y);
  return Math.abs(p.x) <= l.w / 2 && Math.abs(p.y) <= l.h / 2;
};

/** The layer under a point: words, pictures and stickers first, then shapes (so a big backdrop never hides them). */
export function hitTest(doc: StudioDoc, x: number, y: number): Layer | null {
  const order = [...doc.layers].reverse().filter((l) => !l.hidden && !l.locked);
  return order.find((l) => l.kind !== "shape" && inside(l, x, y)) ?? order.find((l) => inside(l, x, y)) ?? null;
}

export function StudioCanvas({ doc, shaper, fontsVersion, selectedId, zoom, onSelect, onBegin, onLive, editingId, onEdit }: CanvasProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 800, h: 600 });
  const [guides, setGuides] = useState<{ v: number[]; h: number[] }>({ v: [], h: [] });
  const [hover, setHover] = useState<string | null>(null);
  const g = useRef<Gesture | null>(null);
  const [dragging, setDragging] = useState(false);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    // Only a real size change redraws the poster (a new object with the same numbers would).
    const measure = () => setBox((b) => (b.w === el.clientWidth && b.h === el.clientHeight ? b : { w: el.clientWidth, h: el.clientHeight }));
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, []);

  const fit = Math.max(0.05, Math.min((box.w - 48) / doc.width, (box.h - 48) / doc.height));
  const scale = fit * zoom;
  const sel = doc.layers.find((l) => l.id === selectedId) ?? null;
  const skip = useMemo(() => (editingId ? new Set([editingId]) : undefined), [editingId]);

  const point = (e: { clientX: number; clientY: number }) => {
    const r = stageRef.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale };
  };

  function snapMove(l: Layer, nx: number, ny: number) {
    const t = SNAP_PX / scale;
    const xs = [0, doc.width / 2, doc.width];
    const ys = [0, doc.height / 2, doc.height];
    for (const o of doc.layers) {
      if (o.id === l.id || o.hidden || o.rot !== 0 || (o.w >= doc.width * 0.95 && o.h >= doc.height * 0.95)) continue;
      xs.push(o.x, o.x + o.w / 2, o.x + o.w);
      ys.push(o.y, o.y + o.h / 2, o.y + o.h);
    }
    const gv: number[] = [];
    const gh: number[] = [];
    let bx = nx;
    let by = ny;
    let best = t;
    for (const cand of xs)
      for (const [off] of [[0], [l.w / 2], [l.w]] as const) {
        const d = Math.abs(nx + off - cand);
        if (d < best) {
          best = d;
          bx = cand - off;
          gv.length = 0;
          gv.push(cand);
        }
      }
    best = t;
    for (const cand of ys)
      for (const [off] of [[0], [l.h / 2], [l.h]] as const) {
        const d = Math.abs(ny + off - cand);
        if (d < best) {
          best = d;
          by = cand - off;
          gh.length = 0;
          gh.push(cand);
        }
      }
    setGuides({ v: gv, h: gh });
    return { x: bx, y: by };
  }

  function onDown(e: RPointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    const p = point(e);
    const target = e.target as Element;
    const handle = target.closest("[data-handle]")?.getAttribute("data-handle");
    if (handle && sel) {
      e.preventDefault();
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      if (handle === "rot") g.current = { kind: "rotate", id: sel.id, start: p, orig: sel, began: false };
      else {
        const [hx, hy] = handle.split(",").map(Number);
        g.current = { kind: "resize", id: sel.id, start: p, orig: sel, hx, hy, began: false };
      }
      return;
    }
    if (editingId) onEdit(null);
    const hit = sel && inside(sel, p.x, p.y) && !sel.locked ? sel : hitTest(doc, p.x, p.y);
    onSelect(hit?.id ?? null);
    if (hit) {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      g.current = { kind: "move", id: hit.id, start: p, orig: hit, began: false };
    }
  }

  function onMove(e: RPointerEvent<HTMLDivElement>) {
    const p = point(e);
    const cur = g.current;
    if (!cur) {
      const h = hitTest(doc, p.x, p.y);
      setHover(h?.id ?? null);
      return;
    }
    const dx = p.x - cur.start.x;
    const dy = p.y - cur.start.y;
    if (!cur.began) {
      if (Math.hypot(dx, dy) * scale < 3) return;
      cur.began = true;
      if (cur.kind === "move") setDragging(true);
      onBegin();
    }
    const o = cur.orig;
    if (cur.kind === "move") {
      let nx = o.x + dx;
      let ny = o.y + dy;
      if (!e.altKey) ({ x: nx, y: ny } = snapMove(o, nx, ny));
      onLive(o.id, { x: nx, y: ny });
    } else if (cur.kind === "rotate") {
      const cx = o.x + o.w / 2;
      const cy = o.y + o.h / 2;
      let ang = (Math.atan2(p.y - cy, p.x - cx) * 180) / Math.PI + 90;
      if (!e.altKey) {
        const snapTo = Math.round(ang / 15) * 15;
        if (Math.abs(ang - snapTo) < 4) ang = snapTo;
      }
      ang = ((ang + 540) % 360) - 180;
      onLive(o.id, { rot: Math.round(ang * 10) / 10 });
    } else {
      const hx = cur.hx!;
      const hy = cur.hy!;
      const a = (o.rot * Math.PI) / 180;
      // Pointer movement in the layer's own (rotated) frame.
      const lx = dx * Math.cos(-a) - dy * Math.sin(-a);
      const ly = dx * Math.sin(-a) + dy * Math.cos(-a);
      let w = Math.max(12, o.w + lx * hx);
      let h = Math.max(12, o.h + ly * hy);
      const corner = hx !== 0 && hy !== 0;
      const patch: Patch = {};
      if (o.kind === "text") {
        if (corner) {
          const k = w / o.w;
          (patch as Partial<TextLayer>).size = Math.max(6, Math.round(o.size * k * 10) / 10);
          h = o.autoFit ? o.h * k : o.h;
        } else if (hy !== 0 && o.autoFit) {
          w = o.w;
        } else {
          h = o.h;
        }
      } else if ((LOCK_ASPECT.has(o.kind) && corner) || (e.shiftKey && corner)) {
        const k = Math.max(w / o.w, h / o.h);
        w = o.w * k;
        h = o.h * k;
      } else if (o.kind === "chip") {
        const k = h / o.h;
        if (hy !== 0) Object.assign(patch, { size: Math.max(6, o.size * k) });
      }
      // Keep the opposite edge where it was.
      const shiftX = ((w - o.w) / 2) * hx;
      const shiftY = ((h - o.h) / 2) * hy;
      const cx = o.x + o.w / 2 + shiftX * Math.cos(a) - shiftY * Math.sin(a);
      const cy = o.y + o.h / 2 + shiftX * Math.sin(a) + shiftY * Math.cos(a);
      onLive(o.id, { ...patch, w, h, x: cx - w / 2, y: cy - h / 2 });
    }
  }

  function onUp() {
    g.current = null;
    setDragging(false);
    setGuides({ v: [], h: [] });
  }

  function onDouble(e: React.MouseEvent) {
    const p = point(e);
    const hit = hitTest(doc, p.x, p.y);
    if (hit && (hit.kind === "text" || hit.kind === "badge" || hit.kind === "chip")) {
      onSelect(hit.id);
      onEdit(hit.id);
    }
  }

  const hs = 9 / scale;
  const hov = hover && hover !== selectedId ? doc.layers.find((l) => l.id === hover) : null;
  const tf = (l: Layer) => `translate(${l.x + l.w / 2} ${l.y + l.h / 2}) rotate(${l.rot}) translate(${-l.w / 2} ${-l.h / 2})`;

  return (
    <div ref={wrapRef} className="relative h-full w-full overflow-auto" data-studio-canvas>
      <div className="flex min-h-full min-w-full items-center justify-center p-6" style={{ width: Math.max(box.w, doc.width * scale + 48), height: Math.max(box.h, doc.height * scale + 48) }}>
        <div
          ref={stageRef}
          className="relative shrink-0 touch-none select-none rounded-[3px] bg-white shadow-[0_12px_48px_-12px_rgb(40_20_10/0.35),0_0_0_1px_rgb(0_0_0/0.06)]"
          style={{ width: doc.width * scale, height: doc.height * scale, cursor: dragging ? "grabbing" : hov ? "pointer" : "default" }}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          onPointerLeave={() => setHover(null)}
          onDoubleClick={onDouble}
        >
          <SceneView doc={doc} shaper={shaper} fontsVersion={fontsVersion} idPrefix="cv" skip={skip} />
          <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" viewBox={`0 0 ${doc.width} ${doc.height}`} aria-hidden="true">
            {doc.format === "vertical" ? (
              <g stroke="#E4572E" strokeOpacity="0.45" strokeDasharray={`${8 / scale} ${6 / scale}`} strokeWidth={1.2 / scale}>
                <line x1={0} x2={doc.width} y1={STORY_SAFE.top} y2={STORY_SAFE.top} />
                <line x1={0} x2={doc.width} y1={STORY_SAFE.bottom} y2={STORY_SAFE.bottom} />
              </g>
            ) : null}
            {hov ? <rect transform={tf(hov)} width={hov.w} height={hov.h} fill="none" stroke="#E4572E" strokeOpacity="0.55" strokeWidth={1.5 / scale} /> : null}
            {guides.v.map((x) => (
              <line key={`v${x}`} x1={x} x2={x} y1={0} y2={doc.height} stroke="#FF2D87" strokeWidth={1.2 / scale} />
            ))}
            {guides.h.map((y) => (
              <line key={`h${y}`} y1={y} y2={y} x1={0} x2={doc.width} stroke="#FF2D87" strokeWidth={1.2 / scale} />
            ))}
            {sel && !editingId ? (
              <g transform={tf(sel)} className={sel.locked ? "" : "pointer-events-auto"}>
                <rect width={sel.w} height={sel.h} fill="none" stroke="#E4572E" strokeWidth={2 / scale} />
                {sel.locked ? null : (
                  <>
                    <line x1={sel.w / 2} x2={sel.w / 2} y1={0} y2={-28 / scale} stroke="#E4572E" strokeWidth={1.5 / scale} />
                    <circle data-handle="rot" cx={sel.w / 2} cy={-34 / scale} r={hs * 0.9} fill="#fff" stroke="#E4572E" strokeWidth={2 / scale} style={{ cursor: "grab" }} />
                    {[-1, 0, 1].flatMap((hx) =>
                      [-1, 0, 1].map((hy) => {
                        if (hx === 0 && hy === 0) return null;
                        if (sel.kind === "text" && !sel.autoFit && hy !== 0 && hx === 0) return null;
                        const corner = hx !== 0 && hy !== 0;
                        const cx = ((hx + 1) / 2) * sel.w;
                        const cy = ((hy + 1) / 2) * sel.h;
                        const cur = corner ? (hx === hy ? "nwse-resize" : "nesw-resize") : hx !== 0 ? "ew-resize" : "ns-resize";
                        return corner ? (
                          <circle key={`${hx},${hy}`} data-handle={`${hx},${hy}`} cx={cx} cy={cy} r={hs * 0.75} fill="#fff" stroke="#E4572E" strokeWidth={2 / scale} style={{ cursor: cur }} />
                        ) : (
                          <rect key={`${hx},${hy}`} data-handle={`${hx},${hy}`} x={cx - (hx ? hs * 0.45 : hs * 1.1)} y={cy - (hy ? hs * 0.45 : hs * 1.1)} width={hx ? hs * 0.9 : hs * 2.2} height={hy ? hs * 0.9 : hs * 2.2} rx={hs * 0.45} fill="#fff" stroke="#E4572E" strokeWidth={2 / scale} style={{ cursor: cur }} />
                        );
                      }),
                    )}
                  </>
                )}
              </g>
            ) : null}
          </svg>
          {editingId ? <InlineEditor doc={doc} id={editingId} scale={scale} shaper={shaper} onLive={onLive} onDone={() => onEdit(null)} /> : null}
        </div>
      </div>
    </div>
  );
}

function InlineEditor({ doc, id, scale, shaper, onLive, onDone }: { doc: StudioDoc; id: string; scale: number; shaper: StudioShaper; onLive: CanvasProps["onLive"]; onDone: () => void }) {
  const l = doc.layers.find((x) => x.id === id);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.select();
  }, []);
  if (!l || (l.kind !== "text" && l.kind !== "badge" && l.kind !== "chip")) return null;
  let size = 32;
  let lineHeight = 1.2;
  let color = "#111111";
  let align: "left" | "center" | "right" = "center";
  let top = 0;
  if (l.kind === "text") {
    const lay = layoutText(l, shaper);
    size = lay.size;
    lineHeight = l.lineHeight;
    color = l.fill.kind === "solid" ? l.fill.color : l.fill.stops[0].color;
    align = l.align;
    top = l.valign === "middle" ? (l.h - lay.blockH) / 2 : l.valign === "bottom" ? l.h - lay.blockH : 0;
  } else if (l.kind === "badge") {
    size = l.h * 0.22;
    color = l.color;
    top = l.h * 0.25;
  } else {
    size = l.size;
    color = l.color;
    align = "left";
  }
  const weight = l.weight;
  return (
    <textarea
      ref={ref}
      value={l.text}
      spellCheck={false}
      onChange={(e) => onLive(l.id, { text: e.target.value } as Patch)}
      onBlur={onDone}
      onKeyDown={(e) => {
        if (e.key === "Escape" || (e.key === "Enter" && (e.metaKey || e.ctrlKey))) {
          e.preventDefault();
          onDone();
        }
        e.stopPropagation();
      }}
      className="absolute resize-none overflow-hidden border-0 bg-transparent p-0 outline-2 outline-offset-4 outline-coral"
      style={{
        left: l.x * scale,
        top: (l.y + top) * scale,
        width: l.w * scale,
        height: Math.max(l.h - top, size * lineHeight) * scale + 4,
        transform: l.rot ? `rotate(${l.rot}deg)` : undefined,
        transformOrigin: `${(l.w * scale) / 2}px ${((l.h - top * 2) * scale) / 2}px`,
        fontFamily: `st-${l.font}, "Noto Sans Devanagari", sans-serif`,
        fontWeight: weight,
        fontSize: size * scale,
        lineHeight,
        color,
        textAlign: align,
        textTransform: l.kind === "text" && l.upper ? "uppercase" : undefined,
        letterSpacing: l.kind === "text" ? `${l.tracking / 1000}em` : undefined,
        caretColor: "#E4572E",
      }}
    />
  );
}
