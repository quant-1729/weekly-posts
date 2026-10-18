"use client";

import { useCallback, useRef, useState, type ReactNode } from "react";
import { isHex } from "@/lib/studio/color";
import { useDismiss } from "@/components/ui/use-dismiss";

export const panelTitle = "text-[11px] font-semibold uppercase tracking-[0.08em] text-desc";
export const chipBtn =
  "inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-line-input bg-white px-2.5 text-[12.5px] font-medium text-ink transition hover:border-line-input-hover hover:bg-hover disabled:opacity-40";
export const tileBtn =
  "flex flex-col items-center justify-center gap-1 rounded-xl border border-line-light bg-white p-2 text-[11.5px] font-medium text-sub transition hover:-translate-y-px hover:border-line-input-hover hover:text-ink hover:shadow-sm";

/** A small square tool button with a tooltip. */
export function IconBtn({ label, onClick, active, disabled, children, className = "" }: { label: string; onClick?: () => void; active?: boolean; disabled?: boolean; children: ReactNode; className?: string }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex h-8 min-w-8 items-center justify-center rounded-lg px-1.5 text-[13px] text-ink transition hover:bg-fill-secondary disabled:opacity-35 ${active ? "bg-ink text-white hover:bg-ink-2" : ""} ${className}`}
    >
      {children}
    </button>
  );
}

export function Sep() {
  return <span className="mx-1 h-6 w-px shrink-0 bg-edge" aria-hidden="true" />;
}

/** Inline SVG icons for the editor chrome (24 x 24, stroked). */
export function Ico({ d, size = 18, fill = false }: { d: string; size?: number; fill?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill={fill ? "currentColor" : "none"} stroke={fill ? "none" : "currentColor"} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

export const I = {
  undo: "M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3",
  redo: "M15 14l5-5-5-5M20 9H10a6 6 0 0 0 0 12h3",
  trash: "M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3",
  copy: "M8 8h11v11H8zM5 16V5h11",
  front: "M7 7h10v10H7zM3 3h4M3 3v4M21 21h-4M21 21v-4",
  up: "M12 19V5M6 11l6-6 6 6",
  down: "M12 5v14M6 13l6 6 6-6",
  lock: "M6 11h12v9H6zM8 11V8a4 4 0 0 1 8 0v3",
  unlock: "M6 11h12v9H6zM8 11V8a4 4 0 0 1 7.5-2",
  eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6z",
  eyeOff: "M3 3l18 18M10.6 6.1A10 10 0 0 1 12 6c6 0 10 6 10 6a17 17 0 0 1-3.2 3.7M6.6 6.6C3.8 8.4 2 12 2 12s4 7 10 7a9.6 9.6 0 0 0 4.4-1",
  designs: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
  text: "M5 6V4h14v2M12 4v16M9 20h6",
  plus: "M12 5v14M5 12h14",
  photo: "M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15 9.5a1.5 1.5 0 1 0 0-3a1.5 1.5 0 1 0 0 3z",
  brand: "M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.4 6.8 19.1l1-5.8L3.5 9.2l5.9-.9z",
  palette: "M12 3a9 9 0 0 0 0 18c1.2 0 2-1 2-2s-.6-1.4-.6-2.3c0-1 .8-1.7 1.8-1.7H17a4 4 0 0 0 4-4c0-4.4-4-8-9-8zM7.5 12a1 1 0 1 0 0-.1M10 7.5a1 1 0 1 0 0-.1M15 7.5a1 1 0 1 0 0-.1",
  layers: "M12 3l9 5-9 5-9-5zM3 13l9 5 9-5M3 17l9 5 9-5",
  magic: "M5 19L17 7M14 4l1 2 2 1-2 1-1 2-1-2-2-1 2-1zM19 12l.7 1.3L21 14l-1.3.7L19 16l-.7-1.3L17 14l1.3-.7z",
  scissors: "M6 9a3 3 0 1 0 0-6a3 3 0 1 0 0 6zM6 21a3 3 0 1 0 0-6a3 3 0 1 0 0 6zM8.1 7.9L20 20M8.1 16.1L20 4",
  bold: "M7 5h6a3.5 3.5 0 0 1 0 7H7zM7 12h7a3.5 3.5 0 0 1 0 7H7z",
  italic: "M10 5h8M6 19h8M14 5l-4 14",
  alignL: "M4 6h16M4 10h10M4 14h16M4 18h10",
  alignC: "M4 6h16M7 10h10M4 14h16M7 18h10",
  alignR: "M4 6h16M10 10h10M4 14h16M10 18h10",
  flip: "M12 3v18M8 7L3 12l5 5zM16 7l5 5-5 5z",
  check: "M5 12.5l4.5 4.5L19 7.5",
  shuffle: "M4 7h3c5 0 5 10 10 10h3M4 17h3c2 0 3-1.5 4-3M17 4l3 3-3 3M17 14l3 3-3 3M13 9.5c1-1.5 2-2.5 4-2.5",
  qr: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 14h2v2h-2zM14 18h2v2h-2zM18 18h2v2h-2zM16 16h2v2h-2z",
  close: "M6 6l12 12M18 6L6 18",
  zoomIn: "M11 4a7 7 0 1 0 0 14a7 7 0 1 0 0-14zM20 20l-4-4M8 11h6M11 8v6",
  zoomOut: "M11 4a7 7 0 1 0 0 14a7 7 0 1 0 0-14zM20 20l-4-4M8 11h6",
  fit: "M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5",
  center: "M12 3v18M3 12h18",
};

/** A slider with its value. */
export function Slider({ label, value, min, max, step = 1, onChange, format }: { label: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void; format?: (v: number) => string }) {
  return (
    <label className="block">
      <span className="flex items-center justify-between text-[12px] text-sub">
        <span>{label}</span>
        <span className="tabular-nums text-desc">{format ? format(value) : Math.round(value)}</span>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="mt-1 w-full accent-ink" />
    </label>
  );
}

/** Segmented choice. */
export function Seg<T extends string>({ value, options, onChange, size = "md" }: { value: T; options: { value: T; label: ReactNode; title?: string }[]; onChange: (v: T) => void; size?: "sm" | "md" }) {
  return (
    <div className="inline-flex rounded-lg bg-well p-0.5" role="radiogroup">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={`rounded-md px-2.5 ${size === "sm" ? "py-1 text-[12px]" : "py-1.5 text-[12.5px]"} font-medium transition ${o.value === value ? "bg-white text-ink shadow-sm" : "text-sub hover:text-ink"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** A colour swatch button that opens a picker with the poster's palette, the brand colours and any colour. */
export function ColorButton({ value, onChange, swatches, label, size = 28 }: { value: string; onChange: (c: string) => void; swatches: string[]; label: string; size?: number }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const closeIt = useCallback(() => setOpen(false), []);
  useDismiss(open, ref, closeIt);
  const [draft, setDraft] = useState<string | null>(null);
  const hexText = draft ?? value;
  const uniq = [...new Set(swatches.map((s) => s.toUpperCase()))].slice(0, 18);
  return (
    <div className="relative" ref={ref}>
      <button type="button" title={label} aria-label={label} onClick={() => setOpen((o) => !o)} className="rounded-lg border border-line-input p-0.5 transition hover:border-line-input-hover" style={{ width: size + 6, height: size + 6 }}>
        <span className="block h-full w-full rounded-md" style={{ background: value, boxShadow: "inset 0 0 0 1px rgb(0 0 0 / 0.08)" }} />
      </button>
      {open ? (
        <div className="absolute left-0 top-full z-50 mt-2 w-[232px] rounded-2xl border border-line-light bg-white p-3 shadow-xl">
          <p className={panelTitle}>{label}</p>
          <div className="mt-2 grid grid-cols-6 gap-1.5">
            {uniq.map((c) => (
              <button key={c} type="button" title={c} onClick={() => onChange(c)} className={`h-7 w-7 rounded-md transition hover:scale-110 ${c === value.toUpperCase() ? "ring-2 ring-coral ring-offset-1" : ""}`} style={{ background: c, boxShadow: "inset 0 0 0 1px rgb(0 0 0 / 0.1)" }} />
            ))}
          </div>
          <div className="mt-3 flex items-center gap-2">
            <input type="color" value={isHex(value) ? value : "#000000"} onChange={(e) => onChange(e.target.value.toUpperCase())} className="h-8 w-10 cursor-pointer rounded border border-line-input" aria-label="Any colour" />
            <input
              value={hexText}
              onChange={(e) => {
                setDraft(e.target.value);
                if (isHex(e.target.value)) onChange(e.target.value.toUpperCase());
              }}
              onBlur={() => setDraft(null)}
              className="h-8 min-w-0 flex-1 rounded-lg border border-line-input px-2 font-mono text-[12px]"
              aria-label="Hex colour"
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** A dropdown anchored to a button. */
export function Pop({ button, children, width = 240, align = "left" }: { button: (open: boolean, toggle: () => void) => ReactNode; children: (close: () => void) => ReactNode; width?: number; align?: "left" | "right" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const closeIt = useCallback(() => setOpen(false), []);
  useDismiss(open, ref, closeIt);
  return (
    <div className="relative" ref={ref}>
      {button(open, () => setOpen((o) => !o))}
      {open ? (
        <div className={`absolute top-full z-50 mt-2 max-h-[60vh] overflow-y-auto rounded-2xl border border-line-light bg-white p-2 shadow-xl ${align === "right" ? "right-0" : "left-0"}`} style={{ width }}>
          {children(() => setOpen(false))}
        </div>
      ) : null}
    </div>
  );
}
