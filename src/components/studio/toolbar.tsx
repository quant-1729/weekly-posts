"use client";

import { STUDIO_FONTS, fontOf } from "@/lib/studio/fonts";
import { paintColor } from "@/lib/studio/scene";
import { BADGE_SHAPES, MASKS, solid, type Layer, type Paint } from "@/lib/studio/types";
import { ColorButton, I, Ico, IconBtn, Pop, Seg, Slider } from "./controls";
import { ensureFonts } from "./use-shaper";
import type { StudioApi } from "./studio";

function FontSelect({ value, onChange }: { value: string; onChange: (key: string) => void }) {
  const groups = [...new Set(STUDIO_FONTS.map((f) => f.group))];
  return (
    <Pop
      width={230}
      button={(open, toggle) => (
        <button type="button" onClick={toggle} aria-expanded={open} className="flex h-8 w-[124px] items-center justify-between gap-1 rounded-lg border border-line-input px-2 text-[13px] hover:border-line-input-hover" style={{ fontFamily: `st-${value}` }} title="Font">
          <span className="truncate">{fontOf(value).label}</span>
          <Ico d="M6 9l6 6 6-6" size={14} />
        </button>
      )}
    >
      {(close) => (
        <div>
          {groups.map((g) => (
            <div key={g} className="mb-1">
              <p className="px-2 pb-0.5 pt-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-desc">{g}</p>
              {STUDIO_FONTS.filter((f) => f.group === g).map((f) => (
                <button key={f.key} type="button" onClick={() => { onChange(f.key); close(); }} className={`block w-full rounded-lg px-2 py-1.5 text-left text-[17px] hover:bg-hover ${f.key === value ? "bg-coral-tint" : ""}`} style={{ fontFamily: `st-${f.key}`, fontWeight: f.weights.includes(700) ? 700 : 400 }}>
                  {f.label}
                  {f.deva ? <span className="ml-1.5 align-middle text-[11px] font-normal text-desc" style={{ fontFamily: "inherit" }}>हिंदी</span> : null}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </Pop>
  );
}

function setPaintColor(p: Paint, c: string): Paint {
  return p.kind === "solid" ? solid(c) : { ...p, stops: p.stops.map((s, i) => (i === 0 ? { ...s, color: c } : s)) };
}

/** The contextual bar over the canvas: everything for the selected thing, in one row. */
export function ContextBar({ api, layer }: { api: StudioApi; layer: Layer }) {
  const u = (patch: Partial<Layer>) => api.update(layer.id, patch);
  const sw = api.swatches;
  return (
    <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto" data-context-bar={layer.kind}>
      {layer.kind === "text" ? (
        <>
          <FontSelect value={layer.font} onChange={(f) => { const font = fontOf(f); const weight = font.weights.includes(layer.weight) ? layer.weight : font.weights[font.weights.length - 1]; void ensureFonts([{ font: f, weight }]).then(() => u({ font: f, weight } as Partial<Layer>)); }} />
          <input type="number" min={6} max={600} value={Math.round(layer.size)} onChange={(e) => u({ size: Math.max(6, Number(e.target.value) || 6) } as Partial<Layer>)} className="h-8 w-[60px] rounded-lg border border-line-input px-2 text-[13px] tabular-nums" aria-label="Size" title="Size" />
          <ColorButton value={paintColor(layer.fill)} swatches={sw} label="Text colour" onChange={(c) => u({ fill: setPaintColor(layer.fill, c) } as Partial<Layer>)} size={22} />
          <IconBtn label="Bold" active={layer.weight >= 700} onClick={() => { const f = fontOf(layer.font); const heavy = f.weights.filter((w) => w >= 700); const next = layer.weight >= 700 ? f.weights[0] : (heavy[heavy.length - 1] ?? f.weights[f.weights.length - 1]); void ensureFonts([{ font: layer.font, weight: next }]).then(() => u({ weight: next } as Partial<Layer>)); }}>
            <Ico d={I.bold} size={16} />
          </IconBtn>
          <IconBtn label="Italic" active={!!layer.italic} onClick={() => u({ italic: !layer.italic } as Partial<Layer>)}>
            <Ico d={I.italic} size={16} />
          </IconBtn>
          <IconBtn label="Capitals" active={!!layer.upper} onClick={() => u({ upper: !layer.upper } as Partial<Layer>)}>
            <span className="text-[12px] font-bold">AA</span>
          </IconBtn>
          <Seg size="sm" value={layer.align} onChange={(v) => u({ align: v } as Partial<Layer>)} options={[{ value: "left", label: <Ico d={I.alignL} size={14} />, title: "Left" }, { value: "center", label: <Ico d={I.alignC} size={14} />, title: "Centre" }, { value: "right", label: <Ico d={I.alignR} size={14} />, title: "Right" }]} />
          <Pop
            width={250}
            button={(_o, t) => (
              <button type="button" onClick={t} className="h-8 rounded-lg px-2 text-[12.5px] font-medium hover:bg-fill-secondary">
                Spacing
              </button>
            )}
          >
            {() => (
              <div className="space-y-3 p-2">
                <Slider label="Line spacing" value={layer.lineHeight * 100} min={70} max={200} onChange={(v) => u({ lineHeight: v / 100 } as Partial<Layer>)} format={(v) => (v / 100).toFixed(2)} />
                <Slider label="Letter spacing" value={layer.tracking} min={-80} max={400} onChange={(v) => u({ tracking: v } as Partial<Layer>)} />
                <label className="flex items-center gap-2 text-[12.5px] text-sub">
                  <input type="checkbox" checked={!!layer.autoFit} onChange={(e) => u({ autoFit: e.target.checked } as Partial<Layer>)} /> Shrink words to fit the box
                </label>
              </div>
            )}
          </Pop>
          <Pop
            width={260}
            button={(_o, t) => (
              <button type="button" onClick={t} className="h-8 rounded-lg px-2 text-[12.5px] font-medium hover:bg-fill-secondary">
                Effects
              </button>
            )}
          >
            {() => (
              <div className="space-y-3 p-2">
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-2 text-[12.5px] text-sub">
                    <input type="checkbox" checked={!!layer.shadow} onChange={(e) => u({ shadow: e.target.checked ? { color: "#000000", alpha: 0.35, blur: 18, dx: 0, dy: 8 } : undefined } as Partial<Layer>)} /> Shadow
                  </label>
                  {layer.shadow ? <ColorButton value={layer.shadow.color} swatches={sw} label="Shadow colour" onChange={(c) => u({ shadow: { ...layer.shadow!, color: c } } as Partial<Layer>)} size={20} /> : null}
                </div>
                {layer.shadow ? <Slider label="Blur" value={layer.shadow.blur} min={0} max={80} onChange={(v) => u({ shadow: { ...layer.shadow!, blur: v } } as Partial<Layer>)} /> : null}
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-2 text-[12.5px] text-sub">
                    <input type="checkbox" checked={!!layer.stroke} onChange={(e) => u({ stroke: e.target.checked ? { color: "#FFFFFF", width: Math.max(3, layer.size * 0.06) } : undefined } as Partial<Layer>)} /> Outline
                  </label>
                  {layer.stroke ? <ColorButton value={layer.stroke.color} swatches={sw} label="Outline colour" onChange={(c) => u({ stroke: { ...layer.stroke!, color: c } } as Partial<Layer>)} size={20} /> : null}
                </div>
                {layer.stroke ? <Slider label="Outline width" value={layer.stroke.width} min={1} max={40} onChange={(v) => u({ stroke: { ...layer.stroke!, width: v } } as Partial<Layer>)} /> : null}
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-2 text-[12.5px] text-sub">
                    <input type="checkbox" checked={!!layer.bg} onChange={(e) => u({ bg: e.target.checked ? { color: "#FFFFFF", padX: layer.size * 0.3, padY: layer.size * 0.12, radius: layer.size * 0.2, mode: "box" } : undefined } as Partial<Layer>)} /> Background
                  </label>
                  {layer.bg ? <ColorButton value={layer.bg.color} swatches={sw} label="Background colour" onChange={(c) => u({ bg: { ...layer.bg!, color: c } } as Partial<Layer>)} size={20} /> : null}
                </div>
                {layer.bg ? (
                  <>
                    <Seg size="sm" value={layer.bg.mode} onChange={(v) => u({ bg: { ...layer.bg!, mode: v } } as Partial<Layer>)} options={[{ value: "box", label: "One box" }, { value: "lines", label: "Each line" }]} />
                    <Slider label="Roundness" value={layer.bg.radius} min={0} max={200} onChange={(v) => u({ bg: { ...layer.bg!, radius: v } } as Partial<Layer>)} />
                  </>
                ) : null}
              </div>
            )}
          </Pop>
        </>
      ) : null}

      {layer.kind === "badge" ? (
        <>
          <select value={layer.shape} onChange={(e) => u({ shape: e.target.value } as Partial<Layer>)} className="h-8 rounded-lg border border-line-input px-2 text-[13px]" aria-label="Sticker shape">
            {BADGE_SHAPES.map((s) => (
              <option key={s} value={s}>
                {s[0].toUpperCase() + s.slice(1)}
              </option>
            ))}
          </select>
          <FontSelect value={layer.font} onChange={(f) => { const font = fontOf(f); const weight = font.weights[font.weights.length - 1]; void ensureFonts([{ font: f, weight }]).then(() => u({ font: f, weight } as Partial<Layer>)); }} />
          <ColorButton value={paintColor(layer.fill)} swatches={sw} label="Sticker colour" onChange={(c) => u({ fill: solid(c) } as Partial<Layer>)} size={22} />
          <ColorButton value={layer.color} swatches={sw} label="Words colour" onChange={(c) => u({ color: c } as Partial<Layer>)} size={22} />
          <button type="button" className="h-8 rounded-lg px-2 text-[12.5px] font-medium hover:bg-fill-secondary" onClick={() => api.edit(layer.id)}>
            Edit words
          </button>
        </>
      ) : null}

      {layer.kind === "chip" ? (
        <>
          <Seg size="sm" value={layer.style} onChange={(v) => u({ style: v } as Partial<Layer>)} options={[{ value: "pill", label: "Pill" }, { value: "outline", label: "Outline" }, { value: "plain", label: "Plain" }]} />
          <ColorButton value={layer.bg ?? "#FFFFFF"} swatches={sw} label="Chip colour" onChange={(c) => u({ bg: c } as Partial<Layer>)} size={22} />
          <ColorButton value={layer.color} swatches={sw} label="Words colour" onChange={(c) => u({ color: c } as Partial<Layer>)} size={22} />
          <ColorButton value={layer.accent} swatches={sw} label="Icon colour" onChange={(c) => u({ accent: c } as Partial<Layer>)} size={22} />
          <input value={layer.text} onChange={(e) => u({ text: e.target.value } as Partial<Layer>)} className="h-8 w-[170px] rounded-lg border border-line-input px-2 text-[13px]" aria-label="What it says" />
        </>
      ) : null}

      {layer.kind === "image" ? (
        <>
          <select value={layer.mask} onChange={(e) => u({ mask: e.target.value } as Partial<Layer>)} className="h-8 rounded-lg border border-line-input px-2 text-[13px]" aria-label="Frame">
            {MASKS.map((m) => (
              <option key={m} value={m}>
                Frame: {m}
              </option>
            ))}
          </select>
          {layer.asset !== "logo" && layer.asset !== "face" ? (
            <>
              <button type="button" disabled={!!api.busy} onClick={() => void api.smartBlend(layer.id)} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-gradient-to-r from-[#E4572E] to-[#C2367A] px-2.5 text-[12.5px] font-semibold text-white disabled:opacity-60">
                <Ico d={I.magic} size={15} /> Blend
              </button>
              <IconBtn label="Remove background" disabled={!!api.busy || layer.asset === "cutout"} onClick={() => void api.makeCutout(layer.id)}>
                <Ico d={I.scissors} size={16} />
              </IconBtn>
              <button type="button" className="h-8 rounded-lg px-2 text-[12.5px] font-medium hover:bg-fill-secondary" onClick={() => api.setPanel("photo")}>
                More photo tools
              </button>
            </>
          ) : null}
          <IconBtn label="Flip" active={!!layer.flipX} onClick={() => u({ flipX: !layer.flipX } as Partial<Layer>)}>
            <Ico d={I.flip} size={16} />
          </IconBtn>
        </>
      ) : null}

      {layer.kind === "shape" ? (
        <>
          <ColorButton value={paintColor(layer.fill)} swatches={sw} label="Fill colour" onChange={(c) => u({ fill: setPaintColor(layer.fill, c), stroke: layer.shape === "line" || layer.shape === "squiggle" ? { color: c, width: layer.stroke?.width ?? 8 } : layer.stroke } as Partial<Layer>)} size={22} />
          <Seg size="sm" value={layer.fill.kind === "solid" ? "solid" : "grad"} onChange={(v) => { const c = paintColor(layer.fill); u({ fill: v === "solid" ? solid(c) : { kind: "linear", angle: 135, stops: [{ at: 0, color: c }, { at: 1, color: api.input.brand.colors.accent }] } } as Partial<Layer>); }} options={[{ value: "solid", label: "Solid" }, { value: "grad", label: "Gradient" }]} />
          {layer.fill.kind !== "solid" ? <ColorButton value={layer.fill.stops[layer.fill.stops.length - 1].color} swatches={sw} label="Second colour" onChange={(c) => layer.fill.kind !== "solid" && u({ fill: { ...layer.fill, stops: layer.fill.stops.map((s, i, a) => (i === a.length - 1 ? { ...s, color: c } : s)) } } as Partial<Layer>)} size={22} /> : null}
          {layer.shape === "rect" ? (
            <Pop width={220} button={(_o, t) => <button type="button" onClick={t} className="h-8 rounded-lg px-2 text-[12.5px] font-medium hover:bg-fill-secondary">Corners</button>}>
              {() => (
                <div className="p-2">
                  <Slider label="Roundness" value={layer.radius ?? 0} min={0} max={Math.min(layer.w, layer.h) / 2} onChange={(v) => u({ radius: v } as Partial<Layer>)} />
                </div>
              )}
            </Pop>
          ) : null}
        </>
      ) : null}

      {layer.kind === "qr" ? (
        <>
          <ColorButton value={layer.fg} swatches={["#111111", "#000000", ...sw]} label="Code colour" onChange={(c) => u({ fg: c } as Partial<Layer>)} size={22} />
          <ColorButton value={layer.bg} swatches={["#FFFFFF", ...sw]} label="Plate colour" onChange={(c) => u({ bg: c } as Partial<Layer>)} size={22} />
          <span className="text-[12px] text-desc">{layer.source === "brief" ? "This post’s QR (checked after drawing)" : layer.data}</span>
        </>
      ) : null}

      {layer.kind === "icon" ? <ColorButton value={layer.color} swatches={sw} label="Icon colour" onChange={(c) => u({ color: c } as Partial<Layer>)} size={22} /> : null}
      {layer.kind === "character" ? (
        <IconBtn label="Flip" active={!!layer.flipX} onClick={() => u({ flipX: !layer.flipX } as Partial<Layer>)}>
          <Ico d={I.flip} size={16} />
        </IconBtn>
      ) : null}

      <div className="ml-auto flex shrink-0 items-center gap-0.5 pl-2">
        <Pop
          width={220}
          align="right"
          button={(_o, t) => (
            <button type="button" onClick={t} className="h-8 rounded-lg px-2 text-[12.5px] font-medium tabular-nums hover:bg-fill-secondary" title="See-through">
              {Math.round(layer.opacity * 100)}%
            </button>
          )}
        >
          {() => (
            <div className="space-y-3 p-2">
              <Slider label="See-through" value={layer.opacity * 100} min={5} max={100} onChange={(v) => u({ opacity: v / 100 })} format={(v) => `${Math.round(v)}%`} />
              <Slider label="Rotate" value={layer.rot} min={-180} max={180} onChange={(v) => u({ rot: v })} format={(v) => `${Math.round(v)}°`} />
            </div>
          )}
        </Pop>
        <Pop
          width={200}
          align="right"
          button={(_o, t) => (
            <IconBtn label="Arrange" onClick={t}>
              <Ico d={I.layers} size={16} />
            </IconBtn>
          )}
        >
          {(close) => (
            <div className="text-[13px]">
              {([["top", "Bring to front"], ["up", "Bring forward"], ["down", "Send backward"], ["bottom", "Send to back"]] as const).map(([dir, label]) => (
                <button key={dir} type="button" className="block w-full rounded-lg px-2.5 py-1.5 text-left hover:bg-hover" onClick={() => { api.reorder(layer.id, dir); close(); }}>
                  {label}
                </button>
              ))}
              <div className="my-1 h-px bg-divider" />
              <button type="button" className="block w-full rounded-lg px-2.5 py-1.5 text-left hover:bg-hover" onClick={() => { u({ x: (api.doc.width - layer.w) / 2 }); close(); }}>
                Centre left to right
              </button>
              <button type="button" className="block w-full rounded-lg px-2.5 py-1.5 text-left hover:bg-hover" onClick={() => { u({ y: (api.doc.height - layer.h) / 2 }); close(); }}>
                Centre top to bottom
              </button>
            </div>
          )}
        </Pop>
        <IconBtn label="Duplicate (Ctrl+D)" onClick={() => api.duplicate(layer.id)}>
          <Ico d={I.copy} size={16} />
        </IconBtn>
        <IconBtn label={layer.locked ? "Unlock" : "Lock"} active={!!layer.locked} onClick={() => u({ locked: !layer.locked })}>
          <Ico d={layer.locked ? I.lock : I.unlock} size={16} />
        </IconBtn>
        <IconBtn label="Delete (Del)" onClick={() => api.removeLayer(layer.id)} className="hover:!bg-err-bg hover:!text-err-tx">
          <Ico d={I.trash} size={16} />
        </IconBtn>
      </div>
    </div>
  );
}
