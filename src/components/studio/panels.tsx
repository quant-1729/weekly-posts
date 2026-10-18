"use client";

import { useRef, useState, type ReactNode } from "react";
import { inkOn, mix } from "@/lib/studio/color";
import { FONT_PAIRS } from "@/lib/studio/fonts";
import { ICONS, CONTACT_ICON } from "@/lib/studio/icons";
import { chipWidth } from "@/lib/studio/scene";
import { faceLayer, offerBadgeText } from "@/lib/studio/templates";
import { BADGE_SHAPES, MASKS, newId, solid, type BadgeShape, type ChipLayer, type IconKey, type ImageLayer, type Layer, type MaskKind, type ShapeKind, type TextLayer } from "@/lib/studio/types";
import { ColorButton, I, Ico, Seg, Slider, chipBtn, panelTitle, tileBtn } from "./controls";
import { SceneView } from "./scene-view";
import type { StudioApi } from "./studio";

export type PanelId = "designs" | "text" | "add" | "photo" | "brand" | "colors" | "layers";

export const RAIL: { id: PanelId; label: string; icon: string }[] = [
  { id: "designs", label: "Designs", icon: I.designs },
  { id: "text", label: "Text", icon: I.text },
  { id: "add", label: "Add", icon: I.plus },
  { id: "photo", label: "Photos", icon: I.photo },
  { id: "brand", label: "Brand", icon: I.brand },
  { id: "colors", label: "Colours", icon: I.palette },
  { id: "layers", label: "Layers", icon: I.layers },
];

function Section({ title, children, right, fold }: { title: string; children: ReactNode; right?: ReactNode; fold?: boolean }) {
  if (fold)
    return (
      <details className="group border-b border-divider px-4 py-3 last:border-b-0">
        <summary className={`${panelTitle} flex cursor-pointer list-none items-center justify-between py-1`}>
          {title}
          <span className="text-[14px] transition group-open:rotate-90" aria-hidden="true">›</span>
        </summary>
        <div className="space-y-2.5 pt-2">{children}</div>
      </details>
    );
  return (
    <section className="space-y-2.5 border-b border-divider px-4 py-4 last:border-b-0">
      <div className="flex items-center justify-between">
        <h3 className={panelTitle}>{title}</h3>
        {right}
      </div>
      {children}
    </section>
  );
}

export function Panels({ panel, api }: { panel: PanelId; api: StudioApi }) {
  switch (panel) {
    case "designs":
      return <DesignsPanel api={api} />;
    case "text":
      return <TextPanel api={api} />;
    case "add":
      return <AddPanel api={api} />;
    case "photo":
      return <PhotoPanel api={api} />;
    case "brand":
      return <BrandPanel api={api} />;
    case "colors":
      return <ColorsPanel api={api} />;
    case "layers":
      return <LayersPanel api={api} />;
  }
}

// ---------------------------------------------------------------------------------------------

function DesignsPanel({ api }: { api: StudioApi }) {
  const cur = api.doc.meta;
  return (
    <>
      <Section
        title={`${api.options.length} designs for you`}
        right={
          <button type="button" className={chipBtn} onClick={api.shuffle} title="Same layouts, new colours and fonts">
            <Ico d={I.shuffle} size={14} /> Shuffle
          </button>
        }
      >
        <p className="text-[12.5px] leading-[18px] text-desc">Made from your details. Pick one to start, then change anything on it.</p>
        <div className="grid grid-cols-2 gap-2.5" data-options>
          {api.options.map((o, i) => {
            const on = o.doc.meta.template === cur.template && o.doc.meta.palette === cur.palette && o.doc.meta.fonts === cur.fonts;
            return (
              <button key={o.id} type="button" data-option={i} onClick={() => api.useOption(o)} className={`group rounded-xl p-1 text-left transition ${on ? "bg-coral-tint ring-2 ring-coral" : "hover:bg-fill-active"}`}>
                <div className="overflow-hidden rounded-lg shadow-sm ring-1 ring-black/5 transition group-hover:shadow-md" style={{ aspectRatio: `${o.doc.width} / ${o.doc.height}` }}>
                  <SceneView doc={o.doc} shaper={api.shaper} fontsVersion={api.fontsVersion} idPrefix={`o${i}`} positional />
                </div>
                <p className="mt-1 flex items-center gap-1 px-0.5 text-[12px] font-medium text-ink">
                  {on ? <Ico d={I.check} size={13} /> : null}
                  {o.label}
                </p>
              </button>
            );
          })}
        </div>
        <p className="text-[11.5px] leading-4 text-desc">Picking another design replaces your changes. Undo brings them back.</p>
      </Section>
    </>
  );
}

// ---------------------------------------------------------------------------------------------

const ROLE_LABEL: Record<string, string> = { headline: "Headline", offer: "Offer", date: "Offer details / date", cta: "Button", brand: "Business name", subline: "Second line", qrLabel: "QR label" };

function textLayer(api: StudioApi, p: Partial<TextLayer> & Pick<TextLayer, "text" | "size">): TextLayer {
  const d = api.doc;
  const base = d.layers.find((l): l is TextLayer => l.kind === "text" && l.role === "headline");
  const body = d.layers.find((l): l is TextLayer => l.kind === "text" && l.role === "date");
  const w = d.width * 0.7;
  return {
    id: newId(),
    kind: "text",
    name: "Text",
    role: "custom",
    x: (d.width - w) / 2,
    y: d.height * 0.42,
    w,
    h: 100,
    rot: 0,
    opacity: 1,
    font: (p.size >= 70 ? base?.font : body?.font) ?? "poppins",
    weight: p.size >= 70 ? (base?.weight ?? 800) : 600,
    lineHeight: 1.15,
    tracking: 0,
    align: "center",
    fill: base?.fill ?? solid("#111111"),
    ...p,
  };
}

const EFFECTS: { id: string; label: string; apply: (l: TextLayer, accent: string) => Partial<TextLayer> }[] = [
  { id: "none", label: "Plain", apply: () => ({ shadow: undefined, stroke: undefined, bg: undefined }) },
  { id: "shadow", label: "Shadow", apply: () => ({ shadow: { color: "#000000", alpha: 0.35, blur: 18, dx: 0, dy: 8 }, stroke: undefined }) },
  { id: "lift", label: "Pop", apply: (l, a) => ({ shadow: { color: a, alpha: 1, blur: 0, dx: Math.max(3, l.size * 0.06), dy: Math.max(3, l.size * 0.06) }, stroke: undefined }) },
  { id: "outline", label: "Outline", apply: (l, a) => ({ stroke: { color: a, width: Math.max(3, l.size * 0.08) }, shadow: undefined }) },
  { id: "glow", label: "Glow", apply: (_l, a) => ({ shadow: { color: a, alpha: 0.9, blur: 30, dx: 0, dy: 0 }, stroke: undefined }) },
  { id: "highlight", label: "Highlight", apply: (l, a) => ({ bg: { color: a, padX: l.size * 0.25, padY: l.size * 0.08, radius: l.size * 0.15, mode: "lines" }, fill: solid(inkOn(a)) }) },
];

function TextPanel({ api }: { api: StudioApi }) {
  const words = api.doc.layers.filter((l): l is Extract<Layer, { kind: "text" | "badge" }> => (l.kind === "text" || l.kind === "badge") && !!l.role && l.role in ROLE_LABEL);
  const sel = api.selected?.kind === "text" ? api.selected : null;
  const accent = api.input.brand.colors.accent;
  return (
    <>
      <Section title="Add text">
        <div className="space-y-1.5">
          <button type="button" className="w-full rounded-xl border border-line-light px-3 py-2.5 text-left text-[22px] font-extrabold leading-tight text-ink hover:bg-hover" onClick={() => api.addLayer(textLayer(api, { text: "Add a heading", size: 96, name: "Heading" }))}>
            Add a heading
          </button>
          <button type="button" className="w-full rounded-xl border border-line-light px-3 py-2 text-left text-[16px] font-semibold text-ink hover:bg-hover" onClick={() => api.addLayer(textLayer(api, { text: "Add a subheading", size: 56, name: "Subheading" }))}>
            Add a subheading
          </button>
          <button type="button" className="w-full rounded-xl border border-line-light px-3 py-2 text-left text-[13px] text-sub hover:bg-hover" onClick={() => api.addLayer(textLayer(api, { text: "Add a little bit of body text", size: 34, name: "Body text", weight: 500 }))}>
            Add body text
          </button>
        </div>
      </Section>
      <Section title="Words on the poster">
        <p className="text-[12px] leading-[17px] text-desc">Prices, offers and dates are checked against your details before the post goes out.</p>
        {words.length === 0 ? <p className="text-[12.5px] text-desc">No words yet.</p> : null}
        {words.map((l) => (
          <label key={l.id} className="block">
            <span className="mb-1 block text-[12px] font-medium text-sub">{ROLE_LABEL[l.role!] ?? l.name}</span>
            <textarea
              rows={l.text.length > 34 ? 2 : 1}
              value={l.text}
              onFocus={() => api.select(l.id)}
              onChange={(e) => api.update(l.id, { text: e.target.value } as Partial<Layer>)}
              className="w-full resize-none rounded-xl border border-line-input px-3 py-2 text-[13.5px] leading-5 focus:border-ink"
            />
          </label>
        ))}
      </Section>
      <Section title="Text effects">
        {!sel ? <p className="text-[12.5px] text-desc">Select some words on the poster to style them.</p> : null}
        <div className="grid grid-cols-3 gap-1.5">
          {EFFECTS.map((fx) => (
            <button key={fx.id} type="button" disabled={!sel} className={tileBtn} onClick={() => sel && api.update(sel.id, fx.apply(sel, sel.fill.kind === "solid" && sel.fill.color.toUpperCase() === accent.toUpperCase() ? "#111111" : accent) as Partial<Layer>)}>
              <EffectSample id={fx.id} accent={accent} />
              {fx.label}
            </button>
          ))}
        </div>
      </Section>
    </>
  );
}

function EffectSample({ id, accent }: { id: string; accent: string }) {
  const style: React.CSSProperties = { fontWeight: 900, fontSize: 20, lineHeight: "26px", color: "#1d1d1c" };
  if (id === "shadow") style.textShadow = "0 3px 6px rgb(0 0 0 / .35)";
  if (id === "lift") style.textShadow = `2px 2px 0 ${accent}`;
  if (id === "outline") Object.assign(style, { WebkitTextStroke: `1.5px ${accent}`, color: "#fff" });
  if (id === "glow") style.textShadow = `0 0 10px ${accent}`;
  if (id === "highlight") Object.assign(style, { background: accent, color: inkOn(accent), padding: "0 6px", borderRadius: 4 });
  return <span style={style}>Aa</span>;
}

// ---------------------------------------------------------------------------------------------

const CONTACT_TILES: { kind: string; label: string; placeholder: string }[] = [
  { kind: "phone", label: "Phone", placeholder: "+91 98200 12345" },
  { kind: "whatsapp", label: "WhatsApp", placeholder: "+91 98200 12345" },
  { kind: "website", label: "Website", placeholder: "yourshop.com" },
  { kind: "instagram", label: "Instagram", placeholder: "@yourshop" },
  { kind: "facebook", label: "Facebook", placeholder: "facebook.com/yourshop" },
  { kind: "youtube", label: "YouTube", placeholder: "@yourchannel" },
  { kind: "reddit", label: "Reddit", placeholder: "r/yourshop" },
  { kind: "link", label: "Any link", placeholder: "yourshop.com/order" },
  { kind: "email", label: "Email", placeholder: "hello@yourshop.com" },
  { kind: "address", label: "Address", placeholder: "Shop 4, LBS Road, Kurla" },
  { kind: "hours", label: "Hours", placeholder: "Open 9am–9pm" },
];

const SHAPES: { shape: ShapeKind; label: string }[] = [
  { shape: "rect", label: "Square" },
  { shape: "ellipse", label: "Circle" },
  { shape: "blob", label: "Blob" },
  { shape: "burst", label: "Burst" },
  { shape: "star", label: "Star" },
  { shape: "arch", label: "Arch" },
  { shape: "triangle", label: "Triangle" },
  { shape: "ring", label: "Ring" },
  { shape: "wave", label: "Wave" },
  { shape: "line", label: "Line" },
  { shape: "squiggle", label: "Squiggle" },
  { shape: "dots", label: "Dots" },
];

const STICKER_ICONS: IconKey[] = ["sparkle", "star", "heart", "fire", "gift", "cake", "cup", "bag", "truck", "check", "percent", "tag", "calendar", "arrow"];

function contactLook(api: StudioApi) {
  const existing = api.doc.layers.find((l): l is ChipLayer => l.kind === "chip");
  return existing ? { font: existing.font, weight: existing.weight, size: existing.size, h: existing.h, color: existing.color, accent: existing.accent, bg: existing.bg, style: existing.style } : { font: "poppins", weight: 600, size: 30, h: 57, color: "#141414", accent: api.input.brand.colors.primary, bg: "#FFFFFF", style: "pill" as const };
}

function AddPanel({ api }: { api: StudioApi }) {
  const [asking, setAsking] = useState<string | null>(null);
  const [value, setValue] = useState("");
  const [qrUrl, setQrUrl] = useState("");
  const [qrError, setQrError] = useState<string | null>(null);
  const d = api.doc;
  const offer = api.input.content.offer.trim();

  function addChip(kind: string, text: string) {
    const look = contactLook(api);
    const chips = d.layers.filter((l) => l.kind === "chip");
    const last = chips.reduce<(typeof chips)[number] | undefined>((top, c) => (!top || c.y < top.y ? c : top), undefined);
    const l: ChipLayer = { id: newId(), kind: "chip", name: CONTACT_TILES.find((t) => t.kind === kind)?.label ?? "Contact", role: "contact", contact: kind, icon: (CONTACT_ICON[kind] ?? "link") as IconKey, text, ...look, x: last ? last.x : 70, y: last ? Math.max(70, last.y - look.h - 12) : d.height - 70 - look.h, w: 200, rot: 0, opacity: 1 };
    l.w = chipWidth(l, api.shaper);
    api.addLayer(l);
  }

  function pickContact(kind: string) {
    const known = api.contacts.find((c) => c.kind === kind);
    if (known) {
      addChip(kind, known.text);
      return;
    }
    setAsking(kind);
    setValue("");
  }

  function addQr(data: string, source: "brief" | "custom") {
    const s = Math.round(d.width * 0.2);
    api.addLayer({ id: newId(), kind: "qr", name: "QR code", role: source === "brief" ? "qr" : "custom", source, data, fg: "#111111", bg: "#FFFFFF", plate: true, radius: 18, x: d.width - s - 70, y: d.height - s - 70, w: s, h: s, rot: 0, opacity: 1 });
  }

  function addCustomQr() {
    const v = qrUrl.trim();
    setQrError(null);
    if (!v) return;
    if (/^(upi|bitcoin|ethereum|paytm|phonepe|gpay):/i.test(v)) {
      setQrError("Payment QR codes are set up on your Brand page so they can be confirmed first.");
      return;
    }
    const url = /^[a-z]+:\/\//i.test(v) ? v : `https://${v}`;
    try {
      const u = new URL(url);
      if (!/^https?:$/.test(u.protocol)) throw new Error();
    } catch {
      setQrError("That does not look like a web address.");
      return;
    }
    addQr(url, "custom");
    setQrUrl("");
  }

  function addBadge(shape: BadgeShape) {
    const s = Math.round(d.width * 0.3);
    const fillC = api.input.brand.colors.accent;
    api.addLayer({ id: newId(), kind: "badge", name: "Sticker", role: offer ? "offer" : "custom", shape, fill: solid(fillC), text: offer ? offerBadgeText(offer) : "NEW", font: "anton", weight: 400, color: inkOn(fillC), x: (d.width - s) / 2, y: d.height * 0.35, w: shape === "ribbon" || shape === "flag" || shape === "pill" || shape === "tag" ? s * 1.6 : s, h: shape === "ribbon" || shape === "flag" || shape === "pill" || shape === "tag" ? s * 0.5 : s, rot: -8, opacity: 1, shadow: { color: "#000000", alpha: 0.22, blur: 24, dx: 0, dy: 10 } });
  }

  function addShape(shape: ShapeKind) {
    const s = Math.round(d.width * 0.3);
    const c = api.input.brand.colors.primary;
    const thin = shape === "line" || shape === "squiggle";
    api.addLayer({ id: newId(), kind: "shape", name: SHAPES.find((x) => x.shape === shape)?.label ?? "Shape", role: "custom", shape, fill: solid(c), x: (d.width - s) / 2, y: (d.height - s) / 2, w: thin ? s * 1.2 : s, h: thin ? 40 : shape === "wave" ? s * 0.5 : s, rot: 0, opacity: 1, seed: (d.layers.length * 7 + 3) % 50, radius: shape === "rect" ? 24 : shape === "dots" ? 40 : undefined, stroke: thin ? { color: c, width: 8 } : undefined });
  }

  function addIcon(icon: IconKey) {
    const s = Math.round(d.width * 0.12);
    api.addLayer({ id: newId(), kind: "icon", name: ICONS[icon].label, role: "decor", icon, color: api.input.brand.colors.accent, x: (d.width - s) / 2, y: d.height * 0.2, w: s, h: s, rot: 0, opacity: 1 });
  }

  const ch = api.input.brand.character;
  const face = api.input.brand.face ?? null;

  /** A pose of the brand's face as a picture layer, standing at the bottom right (the owner moves it). */
  function addFace(pose: string) {
    const p = face?.poses[pose];
    if (!face || !p) return;
    const h = Math.round(d.height * 0.3);
    const w = Math.round((h * p.w) / p.h);
    api.addLayer(faceLayer(face, p, { x: d.width - w - 50, y: d.height - h - (d.format === "vertical" ? 400 : 50), w, h }, true));
  }

  return (
    <>
      <Section title="Contacts and links">
        <div className="grid grid-cols-3 gap-1.5" data-add-contacts>
          {CONTACT_TILES.map((t) => {
            const known = api.contacts.some((c) => c.kind === t.kind);
            return (
              <button key={t.kind} type="button" className={`${tileBtn} relative`} onClick={() => pickContact(t.kind)} data-add={t.kind}>
                <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                  {ICONS[(CONTACT_ICON[t.kind] ?? "link") as IconKey].mode === "stroke" ? <path d={ICONS[(CONTACT_ICON[t.kind] ?? "link") as IconKey].d} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /> : <path d={ICONS[(CONTACT_ICON[t.kind] ?? "link") as IconKey].d} fill="currentColor" />}
                </svg>
                {t.label}
                {known ? <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-ok-tx" title="From your details" /> : null}
              </button>
            );
          })}
        </div>
        {asking ? (
          <form
            className="flex gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              if (value.trim()) addChip(asking, value.trim());
              setAsking(null);
            }}
          >
            <input autoFocus value={value} onChange={(e) => setValue(e.target.value)} placeholder={CONTACT_TILES.find((t) => t.kind === asking)?.placeholder} className="h-9 min-w-0 flex-1 rounded-lg border border-line-input px-2.5 text-[13px]" aria-label="Value to show" />
            <button type="submit" className="h-9 rounded-lg bg-ink px-3 text-[12.5px] font-medium text-white">
              Add
            </button>
          </form>
        ) : (
          <p className="text-[11.5px] leading-4 text-desc">A green dot means it comes from your details. Others ask what to show.</p>
        )}
      </Section>
      <Section title="QR code">
        {api.briefQr ? (
          <button type="button" className={`${chipBtn} w-full`} onClick={() => addQr(api.briefQr!.data, "brief")}>
            <Ico d={I.qr} size={15} /> Add this post’s QR ({api.briefQr.label})
          </button>
        ) : null}
        <div className="flex gap-1.5">
          <input value={qrUrl} onChange={(e) => setQrUrl(e.target.value)} placeholder="Link for a QR: yourshop.com/menu" className="h-9 min-w-0 flex-1 rounded-lg border border-line-input px-2.5 text-[13px]" aria-label="Link for a QR code" onKeyDown={(e) => e.key === "Enter" && addCustomQr()} />
          <button type="button" className="h-9 rounded-lg bg-ink px-3 text-[12.5px] font-medium text-white" onClick={addCustomQr}>
            Add
          </button>
        </div>
        {qrError ? <p className="text-[12px] text-err-tx">{qrError}</p> : null}
      </Section>
      <Section title="Offer stickers">
        <div className="grid grid-cols-4 gap-1.5">
          {BADGE_SHAPES.map((s) => (
            <button key={s} type="button" className={tileBtn} onClick={() => addBadge(s)} title={s}>
              <BadgeIcon shape={s} color={api.input.brand.colors.accent} />
            </button>
          ))}
        </div>
      </Section>
      <Section title="Shapes">
        <div className="grid grid-cols-6 gap-1.5">
          {SHAPES.map((s) => (
            <button key={s.shape} type="button" title={s.label} className="flex h-10 items-center justify-center rounded-lg bg-well text-ink hover:bg-fill-secondary" onClick={() => addShape(s.shape)}>
              <ShapeIcon shape={s.shape} />
            </button>
          ))}
        </div>
      </Section>
      <Section title="Icons">
        <div className="grid grid-cols-7 gap-1">
          {STICKER_ICONS.map((ic) => (
            <button key={ic} type="button" title={ICONS[ic].label} className="flex h-9 items-center justify-center rounded-lg text-ink hover:bg-fill-secondary" onClick={() => addIcon(ic)}>
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                {ICONS[ic].mode === "stroke" ? <path d={ICONS[ic].d} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /> : <path d={ICONS[ic].d} fill="currentColor" />}
              </svg>
            </button>
          ))}
        </div>
      </Section>
      {face ? (
        <Section title={face.ai ? "Your AI person" : "Your face"}>
          <div className="grid grid-cols-4 gap-1.5" data-add-face>
            {Object.entries(face.poses).map(([pose, p]) => (
              <button key={pose} type="button" title={`Add ${face.name || "your face"} (${pose})`} className={`${tileBtn} !h-16 overflow-hidden !p-1`} onClick={() => addFace(pose)} data-face-pose={pose}>
                {/* eslint-disable-next-line @next/next/no-img-element -- our own file, shown small */}
                <img src={p.src} alt={`${face.name || "Face"}, ${pose}`} className="h-full w-full object-contain" />
              </button>
            ))}
          </div>
          <p className="text-[11.5px] leading-4 text-desc">{face.ai ? "An AI-made person: it always shows a small “AI” tag on the picture." : "Pick a pose to add it to the poster."}</p>
        </Section>
      ) : null}
      {ch ? (
        <Section title="Your mascot">
          <button type="button" className={`${chipBtn} w-full`} onClick={() => api.addLayer({ id: newId(), kind: "character", name: "Mascot", role: "character", svg: ch.svg, vw: ch.vw, vh: ch.vh, x: d.width - 330, y: d.height - 400, w: 280, h: 330, rot: 0, opacity: 1 })}>
            Add your mascot
          </button>
        </Section>
      ) : null}
    </>
  );
}

function BadgeIcon({ shape, color }: { shape: string; color: string }) {
  const paths: Record<string, string> = {
    burst: "M20 2l3 5 5-2 0 6 5 1-3 5 3 5-5 1 0 6-5-2-3 5-3-5-5 2 0-6-5-1 3-5-3-5 5-1 0-6 5 2z",
    circle: "M20 4a16 16 0 1 0 0 32a16 16 0 1 0 0-32z",
    ribbon: "M2 12h36l-5 8 5 8H2l5-8z",
    tag: "M8 10h28v20H8l-6-10zM9 19a1.6 1.6 0 1 0 0 2",
    pill: "M10 12h20a8 8 0 0 1 0 16H10a8 8 0 0 1 0-16z",
    stamp: "M20 3l2.5 2 3-1 1.5 2.8 3.2.4.4 3.2L33.4 12l-1 3 2 2.5-2 2.5 1 3-2.8 1.5-.4 3.2-3.2.4L25.5 31l-3-1L20 32l-2.5-2-3 1-1.5-2.8-3.2-.4-.4-3.2L6.6 23l1-3-2-2.5 2-2.5-1-3 2.8-1.5.4-3.2 3.2-.4L14.5 4l3 1z",
    flag: "M2 12h36l-6 8 6 8H2z",
  };
  return (
    <svg viewBox="0 0 40 40" width="30" height="30" aria-hidden="true">
      <path d={paths[shape]} fill={color} />
    </svg>
  );
}

function ShapeIcon({ shape }: { shape: ShapeKind }) {
  const p: Record<string, ReactNode> = {
    rect: <rect x="3" y="3" width="18" height="18" rx="3" />,
    ellipse: <circle cx="12" cy="12" r="9" />,
    blob: <path d="M12 3c5 0 9 3 8.5 8.5S16 21 11 20.5 3 17 3.5 11 7 3 12 3z" />,
    burst: <path d="M12 2l2 4 4-1-1 4 4 2-4 2 1 4-4-1-2 4-2-4-4 1 1-4-4-2 4-2-1-4 4 1z" />,
    star: <path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4l-5.9 3.1 1.2-6.5L2.5 9.4l6.6-.9z" />,
    arch: <path d="M4 21V11a8 8 0 0 1 16 0v10z" />,
    triangle: <path d="M12 3l9 18H3z" />,
    ring: <path d="M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18zm0 4a5 5 0 1 1 0 10a5 5 0 1 1 0-10z" fillRule="evenodd" />,
    wave: <path d="M2 10c3-3 6 3 10 0s7 3 10 0v11H2z" />,
    line: <rect x="2" y="11" width="20" height="2.5" rx="1.2" />,
    squiggle: <path d="M2 12q2.5-5 5 0t5 0t5 0t5 0" fill="none" stroke="currentColor" strokeWidth="2.2" />,
    dots: <path d="M6 6h.1M12 6h.1M18 6h.1M6 12h.1M12 12h.1M18 12h.1M6 18h.1M12 18h.1M18 18h.1" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" />,
  };
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
      {p[shape]}
    </svg>
  );
}

// ---------------------------------------------------------------------------------------------

const MASK_LABEL: Record<MaskKind, string> = { none: "None", rounded: "Rounded", circle: "Circle", arch: "Arch", blob: "Blob", squircle: "Soft", diamond: "Diamond", hexagon: "Hexagon", ticket: "Ticket" };

function PhotoPanel({ api }: { api: StudioApi }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const img = (api.selected?.kind === "image" && api.selected.asset !== "logo" && api.selected.asset !== "face" ? api.selected : null) ?? (api.doc.layers.find((l) => l.kind === "image" && l.role === "photo") as ImageLayer | undefined) ?? null;
  const set = (patch: Partial<ImageLayer>) => img && api.update(img.id, patch as Partial<Layer>);
  return (
    <>
      <Section title="Your photos">
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="sr-only"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (!f) return;
            const p = await api.uploadPhoto(f);
            if (p) {
              api.placePhoto(p);
              api.toast("Photo added. Try “Blend into poster” to make it feel part of the design.");
            }
          }}
        />
        <button type="button" className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-line-input py-3 text-[13px] font-medium text-ink hover:border-ink hover:bg-hover" onClick={() => fileRef.current?.click()} data-upload-photo>
          <Ico d={I.plus} size={16} /> Upload from your computer
        </button>
        {api.photos.length ? (
          <div className="grid grid-cols-3 gap-1.5">
            {api.photos.slice(0, 9).map((p) => (
              <button key={p.id} type="button" title={p.description || "Photo"} onClick={() => api.placePhoto(p)} className={`overflow-hidden rounded-lg ring-offset-1 hover:ring-2 hover:ring-ink ${img?.photoId === p.id ? "ring-2 ring-coral" : ""}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.src} alt={p.description || "Photo"} className="aspect-square w-full object-cover" />
              </button>
            ))}
          </div>
        ) : (
          <p className="text-[12px] text-desc">Your photo library is empty. Upload a photo of your product or shop.</p>
        )}
      </Section>
      {img ? (
        <>
          <Section title="Make it part of the poster">
            <button type="button" disabled={!!api.busy} onClick={() => void api.smartBlend(img.id)} className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#E4572E] to-[#C2367A] py-2.5 text-[13.5px] font-semibold text-white shadow-sm transition hover:brightness-105 disabled:opacity-60" data-smart-blend>
              <Ico d={I.magic} size={17} /> Blend into poster
            </button>
            <p className="text-[11.5px] leading-4 text-desc">Matches the poster’s colours to your photo, finds the subject, and frames, fades or cuts it out. You can change every step below.</p>
            <button type="button" className={`${chipBtn} w-full`} disabled={!!api.busy || img.asset === "cutout"} onClick={() => void api.makeCutout(img.id)}>
              <Ico d={I.scissors} size={15} /> {img.asset === "cutout" ? "Background removed" : "Remove background"}
            </button>
          </Section>
          <Section title="Frame">
            <div className="grid grid-cols-3 gap-1.5">
              {MASKS.map((m) => (
                <button key={m} type="button" onClick={() => set({ mask: m, radius: m === "rounded" ? Math.max(24, img.radius || 36) : img.radius, fit: img.asset === "cutout" && m === "none" ? "contain" : "cover" })} className={`${tileBtn} ${img.mask === m ? "!border-ink !text-ink" : ""}`}>
                  <MaskIcon mask={m} />
                  {MASK_LABEL[m]}
                </button>
              ))}
            </div>
            {img.mask === "rounded" ? <Slider label="Corner" value={img.radius} min={0} max={Math.min(img.w, img.h) / 2} onChange={(v) => set({ radius: v })} /> : null}
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 text-[12.5px] text-sub">
                <input type="checkbox" checked={!!img.border} onChange={(e) => set({ border: e.target.checked ? { color: "#FFFFFF", width: 12 } : undefined })} /> Border
              </label>
              {img.border ? <ColorButton value={img.border.color} swatches={api.swatches} label="Border colour" onChange={(c) => set({ border: { ...img.border!, color: c } })} size={22} /> : null}
              <label className="flex items-center gap-2 text-[12.5px] text-sub">
                <input type="checkbox" checked={!!img.shadow} onChange={(e) => set({ shadow: e.target.checked ? { color: "#000000", alpha: 0.25, blur: 40, dx: 0, dy: 16 } : undefined })} /> Shadow
              </label>
              {img.asset === "cutout" ? (
                <label className="flex items-center gap-2 text-[12.5px] text-sub">
                  <input type="checkbox" checked={!!img.outline} onChange={(e) => set({ outline: e.target.checked ? { color: "#FFFFFF", width: 8 } : undefined })} /> Sticker edge
                </label>
              ) : null}
            </div>
          </Section>
          <Section title="Blend">
            <div className="space-y-2">
              <span className="text-[12px] text-sub">Fade an edge</span>
              <div>
                <Seg size="sm" value={img.fade?.side ?? "off"} onChange={(v) => set({ fade: v === "off" ? undefined : { side: v as "bottom", size: img.fade?.size ?? 0.4 } })} options={[{ value: "off", label: "Off" }, { value: "bottom", label: "↓" }, { value: "top", label: "↑" }, { value: "left", label: "←" }, { value: "right", label: "→" }, { value: "radial", label: "◎" }]} />
              </div>
              {img.fade ? <Slider label="Fade size" value={img.fade.size * 100} min={5} max={100} onChange={(v) => set({ fade: { ...img.fade!, size: v / 100 } })} format={(v) => `${Math.round(v)}%`} /> : null}
              <span className="block pt-1 text-[12px] text-sub">Colour wash</span>
              <div className="flex items-center gap-2">
                <Seg size="sm" value={img.tint?.mode ?? "off"} onChange={(v) => set({ tint: v === "off" ? undefined : { mode: v as "duotone", color: img.tint?.color ?? api.input.brand.colors.primary, amount: img.tint?.amount ?? (v === "duotone" ? 0.6 : 0.3) } })} options={[{ value: "off", label: "Off" }, { value: "duotone", label: "Duotone" }, { value: "wash", label: "Tint" }]} />
                {img.tint ? <ColorButton value={img.tint.color} swatches={api.swatches} label="Wash colour" onChange={(c) => set({ tint: { ...img.tint!, color: c } })} size={22} /> : null}
              </div>
              {img.tint ? <Slider label="Strength" value={img.tint.amount * 100} min={0} max={100} onChange={(v) => set({ tint: { ...img.tint!, amount: v / 100 } })} format={(v) => `${Math.round(v)}%`} /> : null}
            </div>
          </Section>
          <Section title="Adjust light and colour" fold>
            {(["brightness", "contrast", "saturation", "warmth"] as const).map((k) => (
              <Slider key={k} label={k[0].toUpperCase() + k.slice(1)} value={(img.adjust?.[k] ?? 0) * 100} min={-100} max={100} onChange={(v) => set({ adjust: { brightness: 0, contrast: 0, saturation: 0, warmth: 0, ...img.adjust, [k]: v / 100 } })} />
            ))}
            <Slider label="Blur" value={img.adjust?.blur ?? 0} min={0} max={20} onChange={(v) => set({ adjust: { brightness: 0, contrast: 0, saturation: 0, warmth: 0, ...img.adjust, blur: v } })} />
            <button type="button" className="text-[12px] text-sub underline" onClick={() => set({ adjust: undefined })}>
              Reset adjustments
            </button>
          </Section>
          <Section title="Crop and position" fold>
            <Slider label="Zoom" value={img.zoom * 100} min={100} max={300} onChange={(v) => set({ zoom: v / 100 })} format={(v) => `${Math.round(v)}%`} />
            <Slider label="Left / right" value={img.fx * 100} min={0} max={100} onChange={(v) => set({ fx: v / 100 })} format={(v) => `${Math.round(v)}`} />
            <Slider label="Up / down" value={img.fy * 100} min={0} max={100} onChange={(v) => set({ fy: v / 100 })} format={(v) => `${Math.round(v)}`} />
          </Section>
        </>
      ) : null}
    </>
  );
}

function MaskIcon({ mask }: { mask: MaskKind }) {
  const d: Record<MaskKind, string> = {
    none: "M3 5h18v14H3z",
    rounded: "M7 4h10a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3z",
    circle: "M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18z",
    arch: "M5 21V11a7 7 0 0 1 14 0v10z",
    blob: "M12 3c5 0 9 3 8.5 8.5S16 21 11 20.5 3 17 3.5 11 7 3 12 3z",
    squircle: "M12 3c7 0 9 2 9 9s-2 9-9 9-9-2-9-9 2-9 9-9z",
    diamond: "M12 2l10 10-10 10L2 12z",
    hexagon: "M7 3h10l5 9-5 9H7l-5-9z",
    ticket: "M4 5h16v5a2 2 0 0 0 0 4v5H4v-5a2 2 0 0 0 0-4z",
  };
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path d={d[mask]} fill="currentColor" opacity="0.85" />
    </svg>
  );
}

// ---------------------------------------------------------------------------------------------

function BrandPanel({ api }: { api: StudioApi }) {
  const logo = api.input.brand.logo;
  const d = api.doc;
  const hasLogo = d.layers.some((l) => l.role === "logo");
  const hasName = d.layers.some((l) => l.role === "brand");
  const brandPal = api.palettes.find((p) => p.id === "brand");
  return (
    <>
      <Section title="Logo and name">
        {logo ? (
          hasLogo ? (
            <button type="button" className={`${chipBtn} w-full`} onClick={() => { const l = d.layers.find((x) => x.role === "logo"); if (l) api.removeLayer(l.id); }}>
              Remove logo
            </button>
          ) : (
            <button type="button" className={`${chipBtn} w-full`} onClick={() => { const w = 220; const h = (w * logo.h) / logo.w; api.addLayer({ id: newId(), kind: "image", name: "Logo", role: "logo", asset: "logo", src: logo.src, natW: logo.w, natH: logo.h, fit: "contain", fx: 0.5, fy: 0.5, zoom: 1, mask: "none", radius: 0, x: 70, y: 70, w, h, rot: 0, opacity: 1 }); }}>
              Add your logo
            </button>
          )
        ) : (
          <p className="text-[12px] text-desc">No logo yet: your business name is used as a word logo. Add a logo on the Brand page.</p>
        )}
        {!hasName ? (
          <button type="button" className={`${chipBtn} w-full`} onClick={() => api.addLayer({ id: newId(), kind: "text", name: "Brand name", role: "brand", text: api.input.content.brandName, x: 70, y: 70, w: d.width * 0.6, h: 50, rot: 0, opacity: 1, font: "poppins", weight: 800, size: 40, lineHeight: 1.1, tracking: 60, upper: true, align: "left", fill: solid("#111111") })}>
            Add business name
          </button>
        ) : null}
      </Section>
      <Section title="Brand colours">
        <div className="flex items-center gap-2">
          {[api.input.brand.colors.primary, api.input.brand.colors.secondary, api.input.brand.colors.accent].map((c) => (
            <span key={c} className="h-8 w-8 rounded-lg ring-1 ring-black/10" style={{ background: c }} />
          ))}
          {brandPal ? (
            <button type="button" className={`${chipBtn} ml-auto`} onClick={() => api.applyPalette(brandPal)}>
              Use on poster
            </button>
          ) : null}
        </div>
      </Section>
      <Section title="Font pairs">
        <div className="grid grid-cols-2 gap-1.5">
          {FONT_PAIRS.map((p) => (
            <button key={p.id} type="button" onClick={() => api.applyFonts(p.id)} className={`rounded-xl border px-2.5 py-2 text-left transition hover:bg-hover ${d.meta.fonts === p.id ? "border-ink" : "border-line-light"}`}>
              <span className="block truncate text-[19px] leading-6 text-ink" style={{ fontFamily: `st-${p.display}`, fontWeight: p.displayWeight }}>
                {p.label}
              </span>
              <span className="block truncate text-[11px] text-desc" style={{ fontFamily: `st-${p.body}` }}>
                Body text sample
              </span>
            </button>
          ))}
        </div>
      </Section>
    </>
  );
}

// ---------------------------------------------------------------------------------------------

function ColorsPanel({ api }: { api: StudioApi }) {
  const d = api.doc;
  const bg = d.background;
  const bgColor = bg.kind === "solid" ? bg.color : bg.stops[0].color;
  return (
    <>
      <Section title="Colour sets">
        <p className="text-[12px] leading-[17px] text-desc">Changes every colour on the poster at once. “Photo” sets come from your picture.</p>
        <div className="grid grid-cols-2 gap-2" data-palettes>
          {api.palettes.map((p) => (
            <button key={p.id} type="button" onClick={() => api.applyPalette(p)} className={`rounded-xl border p-1.5 text-left transition hover:shadow-sm ${d.meta.palette === p.id ? "border-ink" : "border-line-light"}`}>
              <span className="flex h-9 overflow-hidden rounded-lg">
                {[p.bg, p.primary, p.accent, p.deco, p.ink].map((c, i) => (
                  <span key={i} className="flex-1" style={{ background: c }} />
                ))}
              </span>
              <span className="mt-1 block truncate text-[11.5px] font-medium text-sub">{p.label}</span>
            </button>
          ))}
        </div>
      </Section>
      <Section title="Background">
        <div className="flex items-center gap-3">
          <ColorButton value={bgColor} swatches={api.swatches} label="Background colour" onChange={(c) => api.change((x) => ({ ...x, background: solid(c) }))} />
          <div className="flex flex-wrap gap-1.5">
            {[0.15, 0.35].map((k) => (
              <button key={k} type="button" title="Gradient" className="h-8 w-8 rounded-lg ring-1 ring-black/10" style={{ background: `linear-gradient(160deg, ${bgColor}, ${mix(bgColor, k > 0.2 ? "#000000" : "#FFFFFF", k)})` }} onClick={() => api.change((x) => ({ ...x, background: { kind: "linear", angle: 160, stops: [{ at: 0, color: bgColor }, { at: 1, color: mix(bgColor, k > 0.2 ? "#000000" : "#FFFFFF", k) }] } }))} />
            ))}
            <button type="button" title="Glow" className="h-8 w-8 rounded-lg ring-1 ring-black/10" style={{ background: `radial-gradient(circle at 70% 25%, ${mix(bgColor, "#FFFFFF", 0.3)}, ${bgColor})` }} onClick={() => api.change((x) => ({ ...x, background: { kind: "radial", cx: 0.7, cy: 0.25, r: 1, stops: [{ at: 0, color: mix(bgColor, "#FFFFFF", 0.3) }, { at: 1, color: bgColor }] } }))} />
          </div>
        </div>
      </Section>
    </>
  );
}

// ---------------------------------------------------------------------------------------------

const KIND_ICON: Record<string, string> = { text: I.text, image: I.photo, shape: "M4 4h16v16H4z", qr: I.qr, chip: "M5 8h14a4 4 0 0 1 0 8H5a4 4 0 0 1 0-8z", badge: I.brand, icon: "M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.4 6.8 19.1l1-5.8L3.5 9.2l5.9-.9z", character: "M12 4a4 4 0 1 0 0 8a4 4 0 1 0 0-8zM5 21a7 7 0 0 1 14 0" };

function LayersPanel({ api }: { api: StudioApi }) {
  const list = [...api.doc.layers].reverse();
  return (
    <Section title={`Layers (${list.length})`}>
      <p className="text-[12px] text-desc">Top of the list is in front. Click to select.</p>
      <ul className="space-y-1" data-layers>
        {list.map((l) => {
          const on = api.selected?.id === l.id;
          const label = l.kind === "text" || l.kind === "badge" || l.kind === "chip" ? l.text.replace(/\n/g, " ") || l.name : l.name;
          return (
            <li key={l.id} className={`group flex items-center gap-1 rounded-lg px-1.5 py-1 ${on ? "bg-coral-tint" : "hover:bg-hover"}`}>
              <button type="button" onClick={() => api.select(l.id)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                <span className="text-desc">
                  <Ico d={KIND_ICON[l.kind]} size={14} />
                </span>
                <span className={`truncate text-[12.5px] ${l.hidden ? "text-faint line-through" : "text-ink"}`}>{label}</span>
              </button>
              <button type="button" title={l.hidden ? "Show" : "Hide"} className="rounded p-1 text-desc hover:text-ink" onClick={() => api.update(l.id, { hidden: !l.hidden })}>
                <Ico d={l.hidden ? I.eyeOff : I.eye} size={14} />
              </button>
              <button type="button" title={l.locked ? "Unlock" : "Lock"} className={`rounded p-1 hover:text-ink ${l.locked ? "text-ink" : "text-desc opacity-0 group-hover:opacity-100"}`} onClick={() => api.update(l.id, { locked: !l.locked })}>
                <Ico d={l.locked ? I.lock : I.unlock} size={14} />
              </button>
              <button type="button" title="Delete" className="rounded p-1 text-desc opacity-0 hover:text-err-tx group-hover:opacity-100" onClick={() => api.removeLayer(l.id)}>
                <Ico d={I.trash} size={14} />
              </button>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}
