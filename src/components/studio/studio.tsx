"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { adaptDoc, applyDay, normalize, recolor, refont } from "@/lib/studio/ops";
import { FONT_PAIRS } from "@/lib/studio/fonts";
import type { StudioPalette } from "@/lib/studio/palette";
import { aiTagOutside, paintColor } from "@/lib/studio/scene";
import { contrast } from "@/lib/studio/color";
import { buildOptions, fontsInDoc, lookFor, palettesFor, TEMPLATE_IDS, type StudioOption, type TemplateId } from "@/lib/studio/templates";
import { STORY_SAFE, newId, type Layer, type StudioContact, type StudioDoc, type StudioFormat, type StudioInput, type StudioState } from "@/lib/studio/types";
import { StudioCanvas } from "./canvas";
import { I, Ico, IconBtn, Pop, Sep } from "./controls";
import { Panels, RAIL, type PanelId } from "./panels";
import { SceneView } from "./scene-view";
import { ContextBar } from "./toolbar";
import { ensureFonts, studioFontCss, useShaper } from "./use-shaper";
import { cutoutImage, analyzeImage, preloadImage } from "./photo-tools";

export interface LibraryPhoto {
  id: string;
  src: string;
  w: number;
  h: number;
  description: string;
}

export interface PlanDayView {
  date: string;
  /** "Mon 20 Oct". */
  label: string;
  offer: string;
  offerNote: string;
  headline?: string;
}

export interface SmartFitResult {
  ok: boolean;
  focus?: { x: number; y: number };
  treatment?: "cutout" | "frame" | "fade" | "full";
  mask?: string;
  colors?: string[];
  mood?: string;
  note?: string;
  source?: "ai" | "code";
}

export interface StudioProps {
  brandId: string;
  input: StudioInput;
  formats: StudioFormat[];
  initial: StudioState | null;
  photos: LibraryPhoto[];
  contacts: StudioContact[];
  /** Words the fact check asks about (from the details stage). */
  checks?: string[];
  plan?: { days: PlanDayView[] };
  save: (state: StudioState) => Promise<{ ok: boolean; message?: string }>;
  finish: (state: StudioState) => Promise<{ ok: boolean; message?: string; href?: string }>;
  smartFit?: (args: { photoId?: string; colors: string[]; plainBackground: boolean; focus: { x: number; y: number }; busy: number }) => Promise<SmartFitResult>;
  finishLabel: string;
  backHref: string;
  backLabel: string;
  /** Short text above the canvas ("Monday's post" etc.). */
  title?: string;
}

type Docs = Partial<Record<StudioFormat, StudioDoc>>;
interface Snap {
  docs: Docs;
  days: NonNullable<StudioState["days"]>;
}

const FORMAT_LABEL: Record<StudioFormat, string> = { square: "Square 1:1", portrait: "Portrait 4:5", vertical: "Story 9:16" };

export function Studio(props: StudioProps) {
  const { shaper, fontsVersion } = useShaper();
  const [format, setFormat] = useState<StudioFormat>(props.initial?.main ?? props.formats[0]);
  const [docs, setDocs] = useState<Docs>(props.initial?.docs ?? {});
  const [days, setDays] = useState<NonNullable<StudioState["days"]>>(props.initial?.days ?? {});
  const [target, setTarget] = useState<string>("all"); // "all" or a plan day's date
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [panel, setPanel] = useState<PanelId>(props.initial ? "text" : "designs");
  const [zoom, setZoom] = useState(1);
  const [shuffle, setShuffle] = useState(0);
  const [photos, setPhotos] = useState<LibraryPhoto[]>(props.photos);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "dirty" | "error">("saved");
  const [fontsReady, setFontsReady] = useState(false);
  const past = useRef<Snap[]>([]);
  const future = useRef<Snap[]>([]);
  const [hist, setHist] = useState({ past: 0, future: 0 });
  const bump = useCallback(() => setHist({ past: past.current.length, future: future.current.length }), []);

  // Fonts every starting design uses, then everything else in the background.
  useEffect(() => {
    if (!shaper) return;
    const first = FONT_PAIRS.flatMap((p) => [{ font: p.display, weight: p.displayWeight }, { font: p.body, weight: 500 }, { font: p.body, weight: 600 }, { font: p.body, weight: 700 }, { font: p.body, weight: 800 }]);
    const own = Object.values(props.initial?.docs ?? {}).flatMap((d) => (d ? fontsInDoc(d) : []));
    void ensureFonts([...first, ...own]).then(() => setFontsReady(true));
  }, [shaper, props.initial]);

  const [photo, setPhoto] = useState(props.input.photo);
  const input = useMemo(() => ({ ...props.input, format, photo }), [props.input, format, photo]);
  const options: StudioOption[] = useMemo(() => (shaper && fontsReady ? buildOptions(input, shaper, shuffle) : []), [shaper, fontsReady, input, shuffle, fontsVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  // First visit: start from option 1.
  useEffect(() => {
    if (!docs[format] && options.length && shaper) {
      const base = docs[props.formats[0]] ?? Object.values(docs).find(Boolean);
      const next = base ? adaptDoc(base, format, props.input, shaper) : options[0].doc;
      // The first design is made in the browser once the fonts are in (it needs the shaper), so it is set here.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDocs((d) => ({ ...d, [format]: next }));
    }
  }, [options, docs, format, shaper, props.formats, props.input]);

  const baseDoc = docs[format] ?? null;
  const dayDoc = target !== "all" ? (days[target]?.[format] ?? null) : null;
  const dayInfo = props.plan?.days.find((d) => d.date === target) ?? null;
  const doc = useMemo(() => {
    if (!baseDoc || !shaper) return baseDoc;
    if (target === "all" || !dayInfo) return baseDoc;
    return dayDoc ?? applyDay(baseDoc, dayInfo, shaper);
  }, [baseDoc, dayDoc, dayInfo, target, shaper]);

  // The small picture of each day. Kept as one list so an unrelated change (a toast, the zoom, a selection) hands the same
  // documents to the thumbnails and they are not drawn again.
  const dayDocs = useMemo(() => {
    if (!props.plan || !baseDoc || !shaper) return [];
    return props.plan.days.map((d) => ({ day: d, doc: days[d.date]?.[format] ?? applyDay(baseDoc, d, shaper) }));
  }, [props.plan, baseDoc, days, format, shaper]);

  // Load the fonts of whatever is on the canvas.
  useEffect(() => {
    if (doc) void ensureFonts(fontsInDoc(doc));
  }, [doc]);

  const snap = useCallback((): Snap => ({ docs, days }), [docs, days]);
  const begin = useCallback(() => {
    past.current.push(snap());
    if (past.current.length > 80) past.current.shift();
    future.current = [];
    setSaveState("dirty");
    bump();
  }, [snap, bump]);

  /** Writes a new version of the document being edited (the base, or one day's own copy). */
  const write = useCallback(
    (fn: (d: StudioDoc) => StudioDoc) => {
      if (target === "all" || !dayInfo) {
        setDocs((all) => (all[format] ? { ...all, [format]: fn(all[format]!) } : all));
      } else {
        setDays((all) => {
          const cur = all[target]?.[format] ?? (docs[format] && shaper ? applyDay(docs[format]!, dayInfo, shaper) : null);
          if (!cur) return all;
          return { ...all, [target]: { ...(all[target] ?? {}), [format]: fn(cur) } };
        });
      }
      setSaveState("dirty");
    },
    [target, dayInfo, format, docs, shaper],
  );

  const change = useCallback(
    (fn: (d: StudioDoc) => StudioDoc) => {
      begin();
      write(fn);
    },
    [begin, write],
  );

  const live = useCallback(
    (id: string, patch: Partial<Layer>) => {
      write((d) => ({ ...d, layers: d.layers.map((l) => (l.id === id ? (shaper ? normalize({ ...l, ...patch } as Layer, shaper) : ({ ...l, ...patch } as Layer)) : l)) }));
    },
    [write, shaper],
  );

  const update = useCallback(
    (id: string, patch: Partial<Layer>) => {
      begin();
      live(id, patch);
    },
    [begin, live],
  );

  const undo = useCallback(() => {
    const prev = past.current.pop();
    if (!prev) return;
    future.current.push(snap());
    setDocs(prev.docs);
    setDays(prev.days);
    setSaveState("dirty");
    bump();
  }, [snap, bump]);
  const redo = useCallback(() => {
    const next = future.current.pop();
    if (!next) return;
    past.current.push(snap());
    setDocs(next.docs);
    setDays(next.days);
    setSaveState("dirty");
    bump();
  }, [snap, bump]);

  const selected = doc?.layers.find((l) => l.id === selectedId) ?? null;

  const addLayer = useCallback(
    (l: Layer, opts: { select?: boolean; bottom?: boolean } = {}) => {
      change((d) => ({ ...d, layers: opts.bottom ? [l, ...d.layers] : [...d.layers, shaper ? normalize(l, shaper) : l] }));
      if (opts.select !== false) setSelectedId(l.id);
    },
    [change, shaper],
  );
  const removeLayer = useCallback(
    (id: string) => {
      change((d) => ({ ...d, layers: d.layers.filter((l) => l.id !== id) }));
      setSelectedId(null);
    },
    [change],
  );
  const duplicate = useCallback(
    (id: string) => {
      const l = doc?.layers.find((x) => x.id === id);
      if (!l) return;
      const copy = { ...l, id: newId(), x: l.x + 30, y: l.y + 30, name: `${l.name} copy`, role: l.role === "photo" || l.role === "logo" ? l.role : l.role ? "custom" : undefined } as Layer;
      change((d) => {
        const i = d.layers.findIndex((x) => x.id === id);
        const layers = [...d.layers];
        layers.splice(i + 1, 0, copy);
        return { ...d, layers };
      });
      setSelectedId(copy.id);
    },
    [doc, change],
  );
  const reorder = useCallback(
    (id: string, dir: "up" | "down" | "top" | "bottom") => {
      change((d) => {
        const i = d.layers.findIndex((x) => x.id === id);
        if (i < 0) return d;
        const layers = [...d.layers];
        const [l] = layers.splice(i, 1);
        const j = dir === "top" ? layers.length : dir === "bottom" ? 0 : dir === "up" ? Math.min(layers.length, i + 1) : Math.max(0, i - 1);
        layers.splice(j, 0, l);
        return { ...d, layers };
      });
    },
    [change],
  );

  const useOption = useCallback(
    (o: StudioOption) => {
      begin();
      // Other sizes follow the new design the next time they are opened.
      setDocs({ [format]: o.doc });
      setDays({});
      setTarget("all");
      setSelectedId(null);
    },
    [begin, format],
  );

  const palettes = useMemo(() => palettesFor(input), [input]);
  const currentPalette = useCallback((d: StudioDoc): StudioPalette => {
    const t = (TEMPLATE_IDS as readonly string[]).includes(d.meta.template) ? (d.meta.template as TemplateId) : "card";
    return lookFor(input, t, d.meta.palette, d.meta.fonts).palette;
  }, [input]);

  const applyPalette = useCallback(
    (p: StudioPalette) => {
      if (!doc) return;
      const from = currentPalette(doc);
      change((d) => recolor(d, from, p));
    },
    [doc, change, currentPalette],
  );
  const applyFonts = useCallback(
    (pairId: string) => {
      if (!doc || !shaper) return;
      const t = (TEMPLATE_IDS as readonly string[]).includes(doc.meta.template) ? (doc.meta.template as TemplateId) : "card";
      const from = lookFor(input, t, doc.meta.palette, doc.meta.fonts).fonts;
      const p = FONT_PAIRS.find((x) => x.id === pairId);
      if (!p) return;
      void ensureFonts([{ font: p.display, weight: p.displayWeight }, { font: p.body, weight: 500 }, { font: p.body, weight: 700 }]).then(() =>
        change((d) => refont(d, from, { id: p.id, display: p.display, displayWeight: p.displayWeight, body: p.body }, shaper)),
      );
    },
    [doc, shaper, input, change],
  );

  const swatches = useMemo(() => {
    const out: string[] = [];
    if (doc) {
      out.push(paintColor(doc.background));
      for (const l of doc.layers) {
        if (l.kind === "text") out.push(paintColor(l.fill));
        if (l.kind === "shape" || l.kind === "badge") out.push(paintColor(l.fill));
        if (l.kind === "badge" || l.kind === "chip" || l.kind === "icon") out.push(l.color);
      }
    }
    const b = props.input.brand.colors;
    out.push(b.primary, b.secondary, b.accent, "#FFFFFF", "#111111", ...(props.input.photo?.colors ?? []).slice(0, 4));
    return out;
  }, [doc, props.input]);

  // ---- photos ----
  const uploadPhoto = useCallback(
    async (file: File): Promise<LibraryPhoto | null> => {
      setBusy("Uploading photo…");
      try {
        const fd = new FormData();
        fd.set("brand_id", props.brandId);
        fd.set("file", file);
        const res = await fetch("/api/uploads/photos", { method: "POST", body: fd });
        const json = await res.json();
        if (!json.ok) {
          setToast(json.message ?? "Could not upload that photo.");
          return null;
        }
        const p = json.photo;
        const dims = await new Promise<{ w: number; h: number }>((resolve) => {
          const img = new Image();
          img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
          img.onerror = () => resolve({ w: p.width ?? 1000, h: p.height ?? 1000 });
          img.src = p.url || `/api/files/${p.storagePath}`;
        });
        const lp: LibraryPhoto = { id: p.id, src: p.url || `/api/files/${p.storagePath}`, w: dims.w, h: dims.h, description: p.description ?? "" };
        setPhotos((all) => [lp, ...all]);
        return lp;
      } catch {
        setToast("Could not upload that photo.");
        return null;
      } finally {
        setBusy(null);
      }
    },
    [props.brandId],
  );

  const placePhoto = useCallback(
    async (p: LibraryPhoto) => {
      if (!doc || !shaper) return;
      const a = await analyzeImage(p.src);
      // Have the new picture ready before the poster switches to it, so the old one stays until then.
      await preloadImage(p.src);
      const sp = { id: p.id, src: p.src, w: p.w, h: p.h, colors: a.colors, focus: a.focus, plainBackground: a.plainBackground, description: p.description };
      setPhoto(sp);
      const existing = (selected?.kind === "image" && selected.asset !== "logo" && selected.asset !== "face" ? selected : null) ?? doc.layers.find((l) => l.kind === "image" && l.role === "photo");
      if (existing && existing.kind === "image") {
        const wasCut = existing.asset === "cutout";
        update(existing.id, { src: p.src, natW: p.w, natH: p.h, photoId: p.id, asset: "photo", fit: "cover", fx: a.focus.x, fy: a.focus.y, zoom: 1, outline: undefined, mask: wasCut ? "rounded" : existing.mask, radius: wasCut ? 40 : existing.radius });
        setSelectedId(existing.id);
      } else {
        // The design has no photo yet: lay it out again around the photo (words, colours and fonts stay).
        const next = adaptDoc(doc, format, { ...props.input, photo: sp }, shaper, ["photo"]);
        change(() => next);
        const ph = next.layers.find((l) => l.role === "photo");
        setSelectedId(ph?.id ?? null);
      }
    },
    [doc, shaper, selected, update, change, format, props.input],
  );

  const makeCutout = useCallback(
    async (id: string): Promise<boolean> => {
      const l = doc?.layers.find((x) => x.id === id);
      if (!l || l.kind !== "image") return false;
      setBusy("Removing the background…");
      try {
        const r = await cutoutImage(l.src, props.brandId);
        if (!r.ok) {
          setToast(r.message);
          return false;
        }
        await preloadImage(r.src);
        const k = Math.min(l.w / r.w, l.h / r.h);
        const w = r.w * k;
        const h = r.h * k;
        update(id, { src: r.src, natW: r.w, natH: r.h, asset: "cutout", mask: "none", fit: "contain", zoom: 1, fx: 0.5, fy: 0.5, border: undefined, fade: undefined, x: l.x + (l.w - w) / 2, y: l.y + (l.h - h) / 2, w, h, outline: { color: "#FFFFFF", width: 8 }, shadow: { color: "#000000", alpha: 0.28, blur: 30, dx: 0, dy: 14 } });
        setToast("Background removed. The cut-out now sits on your poster.");
        return true;
      } finally {
        setBusy(null);
      }
    },
    [doc, props.brandId, update],
  );

  const smartBlend = useCallback(
    async (id: string) => {
      const l = doc?.layers.find((x) => x.id === id);
      if (!l || l.kind !== "image" || !doc) return;
      setBusy("Fitting the photo into your poster…");
      try {
        const a = await analyzeImage(l.src);
        const ai = props.smartFit ? await props.smartFit({ photoId: l.photoId, colors: a.colors, plainBackground: a.plainBackground, focus: a.focus, busy: a.busy }).catch(() => null) : null;
        const focus = ai?.focus ?? a.focus;
        const colors = ai?.colors?.length ? ai.colors : a.colors;
        let treatment = ai?.treatment ?? (a.plainBackground ? "cutout" : l.w >= doc.width * 0.9 ? "fade" : "frame");
        // An edge fade only suits a photo that spans the poster.
        if ((treatment === "fade" || treatment === "full") && l.w < doc.width * 0.85) treatment = "frame";
        const steps: string[] = [];
        // 1. Colours: the poster takes the photo's colours.
        const photoInput = { ...input, photo: { ...(input.photo ?? { src: l.src, w: l.natW, h: l.natH }), colors } };
        const pal = palettesFor(photoInput).find((p) => p.id === (doc.meta.template === "arch" || doc.meta.template === "card" ? "photo-soft" : "photo-deep"));
        begin();
        if (pal) {
          const from = currentPalette(doc);
          write((d) => recolor(d, from, pal));
          steps.push("matched the colours to your photo");
        }
        // 2. The photo itself.
        const patch: Partial<Layer> = { fx: focus.x, fy: focus.y, adjust: { brightness: a.brightness < 0.35 ? 0.12 : 0, contrast: 0.08, saturation: 0.12, warmth: 0.1 } } as Partial<Layer>;
        if (treatment === "fade") Object.assign(patch, { fade: { side: l.y + l.h / 2 < doc.height / 2 ? "bottom" : "top", size: 0.4 }, mask: "none" });
        if (treatment === "frame") Object.assign(patch, { mask: (ai?.mask as never) ?? (l.mask === "none" ? "rounded" : l.mask), radius: Math.max(30, (l as { radius: number }).radius), border: { color: "#FFFFFF", width: 12 }, shadow: { color: "#000000", alpha: 0.25, blur: 44, dx: 0, dy: 18 } });
        write((d) => ({ ...d, layers: d.layers.map((x) => (x.id === id ? ({ ...x, ...patch } as Layer) : x)) }));
        steps.push("centred the subject and warmed the light");
        if (treatment === "cutout" && l.asset !== "cutout") {
          setBusy("Removing the background…");
          const r = await cutoutImage(l.src, props.brandId);
          if (r.ok) {
            await preloadImage(r.src);
            const k = Math.min(l.w / r.w, l.h / r.h);
            const w = r.w * k;
            const h = r.h * k;
            write((d) => ({ ...d, layers: d.layers.map((x) => (x.id === id ? ({ ...x, src: r.src, natW: r.w, natH: r.h, asset: "cutout", mask: "none", fit: "contain", zoom: 1, border: undefined, fade: undefined, x: l.x + (l.w - w) / 2, y: l.y + (l.h - h) / 2, w, h, outline: { color: "#FFFFFF", width: 8 }, shadow: { color: "#000000", alpha: 0.3, blur: 30, dx: 0, dy: 14 } } as Layer) : x)) }));
            steps.push("cut the product out so it sits on the design");
          }
        } else if (treatment === "fade") steps.push("faded the edge into the background");
        else if (treatment === "frame") steps.push("framed it with a soft shadow");
        setToast(`${ai?.source === "ai" ? "AI blend" : "Smart blend"}: ${steps.join(", ")}.${ai?.mood ? ` ${ai.mood}` : ""} Undo if you prefer the old look.`);
      } finally {
        setBusy(null);
      }
    },
    [doc, input, props, begin, write, currentPalette],
  );

  // ---- keyboard ----
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
      } else if (mod && e.key.toLowerCase() === "d" && selectedId) {
        e.preventDefault();
        duplicate(selectedId);
      } else if ((e.key === "Delete" || e.key === "Backspace") && selectedId) {
        e.preventDefault();
        removeLayer(selectedId);
      } else if (e.key === "Escape") setSelectedId(null);
      else if (e.key === "Enter" && selected && (selected.kind === "text" || selected.kind === "badge" || selected.kind === "chip")) {
        e.preventDefault();
        setEditingId(selected.id);
      } else if (selected && e.key.startsWith("Arrow")) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
        const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
        update(selected.id, { x: selected.x + dx, y: selected.y + dy });
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo, duplicate, removeLayer, selectedId, selected, update]);

  // ---- saving ----
  const state = useMemo((): StudioState => ({ v: 1, main: props.formats[0], docs, ...(Object.keys(days).length ? { days } : {}) }), [docs, days, props.formats]);
  const saveRef = useRef(props.save);
  useEffect(() => {
    saveRef.current = props.save;
  }, [props.save]);
  useEffect(() => {
    if (saveState !== "dirty") return;
    const t = setTimeout(async () => {
      setSaveState("saving");
      const r = await saveRef.current(state).catch(() => ({ ok: false }));
      setSaveState(r.ok ? "saved" : "error");
    }, 1200);
    return () => clearTimeout(t);
  }, [state, saveState]);

  async function finish() {
    setBusy("Drawing every size…");
    setSelectedId(null);
    // Make sure every size the channels need has a design (built from the main one, with the owner's words).
    let all = docs;
    if (shaper) {
      const main = docs[props.formats[0]] ?? docs[format];
      for (const f of props.formats) if (!all[f] && main) all = { ...all, [f]: adaptDoc(main, f, props.input, shaper) };
      setDocs(all);
    }
    const r = await props.finish({ ...state, docs: all }).catch(() => ({ ok: false, message: "Something went wrong. Please try again." }) as { ok: false; message: string; href?: string });
    setBusy(null);
    if (!r.ok) setToast(r.message ?? "Something went wrong. Please try again.");
    else if (r.href) window.location.assign(r.href);
  }

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6500);
    return () => clearTimeout(t);
  }, [toast]);

  const fontCss = useMemo(() => studioFontCss(), []);
  const hints = useMemo(() => {
    const own = doc ? [...designHints(doc), ...(shaper ? aiTagOutside(doc, shaper).map((l) => ({ id: l.id, text: "The AI person is partly off the poster, so its “AI” tag would be cut off. Move it back onto the poster." })) : [])] : [];
    const words = doc ? doc.layers.filter((l) => !l.hidden && (l.kind === "text" || l.kind === "badge")).map((l) => (l as { text: string }).text).join(" ") : "";
    const facts = (props.checks ?? []).filter((c) => words.includes(c)).map((c) => ({ id: doc?.layers.find((l) => (l.kind === "text" || l.kind === "badge") && l.text.includes(c))?.id ?? "", text: `Please check “${c}”: it is not in your details. Confirm it in Review, or change the words.` }));
    return [...facts, ...own];
  }, [doc, props.checks, shaper]);
  const ready = !!(shaper && doc && fontsReady);
  const api = {
    doc: doc!,
    format,
    formats: props.formats,
    input,
    shaper: shaper!,
    fontsVersion,
    selected,
    select: setSelectedId,
    update,
    live,
    begin,
    change,
    addLayer,
    removeLayer,
    duplicate,
    reorder,
    options,
    shuffle: () => setShuffle((s) => s + 1),
    useOption,
    palettes,
    applyPalette,
    applyFonts,
    swatches,
    photos,
    uploadPhoto,
    placePhoto,
    makeCutout,
    smartBlend,
    contacts: props.contacts,
    briefQr: props.input.content.qr,
    edit: setEditingId,
    setPanel,
    toast: setToast,
    busy,
  };
  return (
    <div className="flex h-[calc(100dvh-140px)] min-h-[620px] flex-col overflow-hidden rounded-2xl border border-line-light bg-white" data-studio>
      <style>{fontCss}</style>
      {/* Top bar */}
      <div className="flex h-12 shrink-0 items-center gap-1 border-b border-divider px-2">
        <IconBtn label="Undo (Ctrl+Z)" onClick={undo} disabled={hist.past === 0}>
          <Ico d={I.undo} />
        </IconBtn>
        <IconBtn label="Redo (Ctrl+Shift+Z)" onClick={redo} disabled={hist.future === 0}>
          <Ico d={I.redo} />
        </IconBtn>
        <Sep />
        <div className="flex items-center gap-1" role="tablist" aria-label="Size">
          {props.formats.map((f) => (
            <button key={f} type="button" role="tab" aria-selected={f === format} onClick={() => { setFormat(f); setSelectedId(null); }} className={`rounded-lg px-2.5 py-1.5 text-[12.5px] font-medium transition ${f === format ? "bg-ink text-white" : "text-sub hover:bg-fill-secondary"}`}>
              {FORMAT_LABEL[f]}
            </button>
          ))}
        </div>
        <Sep />
        <IconBtn label="Zoom out" onClick={() => setZoom((z) => Math.max(0.4, z - 0.15))}>
          <Ico d={I.zoomOut} />
        </IconBtn>
        <button type="button" className="w-12 text-center text-[12px] tabular-nums text-sub hover:text-ink" onClick={() => setZoom(1)} title="Fit to screen">
          {Math.round(zoom * 100)}%
        </button>
        <IconBtn label="Zoom in" onClick={() => setZoom((z) => Math.min(3, z + 0.15))}>
          <Ico d={I.zoomIn} />
        </IconBtn>
        <div className="ml-auto flex items-center gap-3">
          {ready ? (
            <Pop
              width={300}
              align="right"
              button={(_o, t) => (
                <button type="button" onClick={t} data-design-check className={`inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[12.5px] font-medium ${hints.length ? "bg-warn-bg text-warn-tx" : "bg-ok-bg text-ok-tx"}`}>
                  <Ico d={hints.length ? "M12 8v5M12 16.5v.5M10.3 3.9L2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" : I.check} size={15} />
                  {hints.length ? `${hints.length} design tip${hints.length === 1 ? "" : "s"}` : "Looks good"}
                </button>
              )}
            >
              {(close) => (
                <div className="p-1">
                  <p className="px-2 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wider text-desc">Design check</p>
                  {hints.length === 0 ? <p className="px-2 pb-2 text-[13px] text-sub">Everything is readable, inside the picture and big enough to scan.</p> : null}
                  {hints.map((hn, i) => (
                    <button key={i} type="button" className="block w-full rounded-lg px-2 py-1.5 text-left text-[13px] leading-[18px] text-ink hover:bg-hover" onClick={() => { setSelectedId(hn.id); close(); }}>
                      {hn.text}
                    </button>
                  ))}
                </div>
              )}
            </Pop>
          ) : null}
          <span className="text-[12px] text-desc" role="status" data-save-state={saveState}>
            {saveState === "saving" ? "Saving…" : saveState === "dirty" ? "Unsaved changes" : saveState === "error" ? "Not saved, retrying on next change" : "All changes saved"}
          </span>
          <Link href={props.backHref} className="rounded-full px-3 py-1.5 text-[13px] text-sub hover:bg-fill-active">
            {props.backLabel}
          </Link>
          <button type="button" data-studio-finish onClick={() => void finish()} disabled={!ready || !!busy} className="inline-flex h-9 items-center gap-2 rounded-full bg-ink px-4 text-[13px] font-medium text-white transition hover:bg-ink-2 disabled:bg-faint">
            {props.finishLabel}
            <Ico d="M5 12h14M13 6l6 6-6 6" size={16} />
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Rail */}
        <nav className="flex w-[68px] shrink-0 flex-col items-center gap-1 border-r border-divider bg-cream py-2" aria-label="Tools">
          {RAIL.map((r) => (
            <button key={r.id} type="button" data-rail={r.id} onClick={() => setPanel(r.id)} aria-pressed={panel === r.id} className={`flex w-14 flex-col items-center gap-0.5 rounded-xl py-2 text-[10.5px] font-medium transition ${panel === r.id ? "bg-white text-ink shadow-sm" : "text-sub hover:bg-white/70 hover:text-ink"}`}>
              <Ico d={r.icon} size={20} />
              {r.label}
            </button>
          ))}
        </nav>
        {/* Panel */}
        <aside className="w-[300px] shrink-0 overflow-y-auto border-r border-divider bg-white" aria-label="Tool panel">
          {ready ? <Panels panel={panel} api={api} /> : <PanelSkeleton />}
        </aside>
        {/* Stage */}
        <section className="relative flex min-w-0 flex-1 flex-col bg-[#EFEBE8]" aria-label="Canvas">
          <div className="flex h-12 shrink-0 items-center border-b border-divider bg-white px-3">
            {ready && selected ? <ContextBar api={api} layer={selected} /> : <p className="text-[12.5px] text-desc">{props.title ? <span className="mr-2 font-medium text-ink">{props.title}</span> : null}Click anything on the poster to change it. Double-click words to type. Drag to move.</p>}
          </div>
          {props.plan ? (
            <div className="flex shrink-0 items-center gap-2 border-b border-divider bg-white/70 px-3 py-1.5 text-[12px]">
              <span className="text-desc">Editing:</span>
              <button type="button" onClick={() => setTarget("all")} className={`rounded-full px-2.5 py-1 font-medium ${target === "all" ? "bg-ink text-white" : "text-sub hover:bg-fill-secondary"}`}>
                All days
              </button>
              {target !== "all" && dayInfo ? (
                <span className="rounded-full bg-coral-tint px-2.5 py-1 font-medium text-coral-dark">
                  Only {dayInfo.label}
                  {days[target] ? (
                    <button type="button" className="ml-2 underline" onClick={() => { begin(); setDays((d) => { const n = { ...d }; delete n[target]; return n; }); }}>
                      match the others again
                    </button>
                  ) : null}
                </span>
              ) : (
                <span className="text-desc">Changes apply to every day; each day keeps its own offer.</span>
              )}
            </div>
          ) : null}
          <div className="relative min-h-0 flex-1">
            {ready ? (
              <StudioCanvas doc={doc!} shaper={shaper!} fontsVersion={fontsVersion} selectedId={selectedId} zoom={zoom} onSelect={(id) => { setSelectedId(id); if (id && editingId && id !== editingId) setEditingId(null); }} onBegin={begin} onLive={live} editingId={editingId} onEdit={(id) => { if (id) begin(); setEditingId(id); }} />
            ) : (
              <div className="flex h-full items-center justify-center text-[13px] text-desc" role="status">
                <span className="mr-2 inline-block h-4 w-4 animate-spin rounded-full border-2 border-edge border-t-ink" aria-hidden="true" />
                Preparing your designs…
              </div>
            )}
            {ready ? (
              <button type="button" onClick={() => setPanel("add")} title="Add a phone number, WhatsApp, link, QR code, sticker or shape" data-quick-add className="absolute bottom-4 left-4 z-10 flex h-12 items-center gap-2 rounded-full bg-ink pl-3 pr-4 text-[13px] font-medium text-white shadow-lg transition hover:scale-[1.03] hover:bg-ink-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white/15">
                  <Ico d={I.plus} size={18} />
                </span>
                Add
              </button>
            ) : null}
            {busy ? (
              <div className="absolute inset-x-0 top-3 z-20 mx-auto w-fit rounded-full bg-ink px-4 py-2 text-[12.5px] text-white shadow-lg" role="status">
                <span className="mr-2 inline-block h-3 w-3 animate-spin rounded-full border-2 border-white/30 border-t-white align-[-1px]" aria-hidden="true" />
                {busy}
              </div>
            ) : null}
            {toast ? (
              <div className="absolute inset-x-0 bottom-4 z-20 mx-auto flex w-fit max-w-[560px] items-start gap-3 rounded-2xl bg-ink px-4 py-3 text-[13px] leading-5 text-white shadow-xl" role="status">
                <span>{toast}</span>
                <button type="button" aria-label="Dismiss" onClick={() => setToast(null)} className="text-white/60 hover:text-white">
                  <Ico d={I.close} size={14} />
                </button>
              </div>
            ) : null}
          </div>
          {props.plan && ready && baseDoc ? (
            <div className="flex shrink-0 gap-2 overflow-x-auto border-t border-divider bg-white px-3 py-2" aria-label="Days">
              {dayDocs.map(({ day: d, doc: dd }) => {
                const on = target === d.date;
                return (
                  <button key={d.date} type="button" data-day={d.date} onClick={() => { setTarget(on ? "all" : d.date); setSelectedId(null); }} className={`shrink-0 rounded-xl p-1 text-left transition ${on ? "bg-coral-tint ring-2 ring-coral" : "hover:bg-fill-active"}`}>
                    <div className="overflow-hidden rounded-lg bg-well" style={{ width: 74, height: (74 * dd.height) / dd.width }}>
                      <SceneView doc={dd} shaper={shaper!} fontsVersion={fontsVersion} idPrefix={`d${d.date.replace(/-/g, "")}`} positional />
                    </div>
                    <p className="mt-1 w-[74px] truncate text-[11px] font-medium text-ink">{d.label}</p>
                    <p className="w-[74px] truncate text-[10.5px] text-desc">{d.offer || "No offer"}{days[d.date] ? " · edited" : ""}</p>
                  </button>
                );
              })}
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}

export type StudioApi = {
  doc: StudioDoc;
  format: StudioFormat;
  formats: StudioFormat[];
  input: StudioInput;
  shaper: NonNullable<ReturnType<typeof useShaper>["shaper"]>;
  fontsVersion: number;
  selected: Layer | null;
  select: (id: string | null) => void;
  update: (id: string, patch: Partial<Layer>) => void;
  live: (id: string, patch: Partial<Layer>) => void;
  begin: () => void;
  change: (fn: (d: StudioDoc) => StudioDoc) => void;
  addLayer: (l: Layer, opts?: { select?: boolean; bottom?: boolean }) => void;
  removeLayer: (id: string) => void;
  duplicate: (id: string) => void;
  reorder: (id: string, dir: "up" | "down" | "top" | "bottom") => void;
  options: StudioOption[];
  shuffle: () => void;
  useOption: (o: StudioOption) => void;
  palettes: StudioPalette[];
  applyPalette: (p: StudioPalette) => void;
  applyFonts: (pairId: string) => void;
  swatches: string[];
  photos: LibraryPhoto[];
  uploadPhoto: (f: File) => Promise<LibraryPhoto | null>;
  placePhoto: (p: LibraryPhoto) => Promise<void>;
  makeCutout: (id: string) => Promise<boolean>;
  smartBlend: (id: string) => Promise<void>;
  contacts: StudioContact[];
  briefQr: { data: string; label: string } | null;
  edit: (id: string | null) => void;
  setPanel: (p: PanelId) => void;
  toast: (m: string | null) => void;
  busy: string | null;
};

/** Quick checks a designer would make: words cut off, hidden by story bars, too small, hard to read; a QR too small to scan. */
function designHints(doc: StudioDoc): { id: string; text: string }[] {
  const out: { id: string; text: string }[] = [];
  const bg = paintColor(doc.background);
  for (const l of doc.layers) {
    if (l.hidden) continue;
    const words = l.kind === "text" || l.kind === "chip" || l.kind === "badge";
    const name = words ? `“${l.text.replace(/\n/g, " ").slice(0, 24)}${l.text.length > 24 ? "…" : ""}”` : l.name;
    if (words && (l.x < -2 || l.y < -2 || l.x + l.w > doc.width + 2 || l.y + l.h > doc.height + 2)) out.push({ id: l.id, text: `${name} runs off the edge of the picture.` });
    if (words && doc.format === "vertical" && (l.y < STORY_SAFE.top || l.y + l.h > STORY_SAFE.bottom)) out.push({ id: l.id, text: `${name} sits where the story bars cover it. Move it between the dashed lines.` });
    if (l.kind === "text" && l.size < 22 && l.text.trim()) out.push({ id: l.id, text: `${name} is very small for a phone screen.` });
    if (l.kind === "text" && !l.bg && !l.stroke && l.fill.kind === "solid" && contrast(l.fill.color, bg) < 2 && !doc.layers.some((o) => o !== l && (o.kind === "shape" || o.kind === "image") && o.x <= l.x && o.y <= l.y && o.x + o.w >= l.x + l.w && o.y + o.h >= l.y + l.h && doc.layers.indexOf(o) < doc.layers.indexOf(l))) out.push({ id: l.id, text: `${name} is hard to read on this background. Try another colour or a highlight.` });
    if (l.kind === "qr" && Math.min(l.w, l.h) < 150) out.push({ id: l.id, text: "The QR code is small: make it at least about 1/7 of the width so phones can scan it." });
  }
  return out;
}

function PanelSkeleton() {
  return (
    <div className="space-y-3 p-4" aria-hidden="true">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="h-24 animate-pulse rounded-xl bg-well" />
      ))}
    </div>
  );
}
