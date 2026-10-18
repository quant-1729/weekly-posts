// Operations on studio documents (pure): recolour with another palette, swap fonts, move a design to another
// size, read the words back, and put a plan day's offer in. Shared by the editor and the server.

import { chipWidth, textHeight } from './scene';
import { contrast, inkOn } from './color';
import type { StudioShaper } from './shaper';
import { buildTemplate, lookFor, offerBadgeText, TEMPLATE_IDS, type Look, type TemplateId } from './templates';
import type { StudioPalette } from './palette';
import { STUDIO_SIZE, newId, type ImageLayer, type Layer, type Paint, type StudioDoc, type StudioFormat, type StudioInput, type TextLayer } from './types';

type Key = keyof StudioPalette;
const ALL_KEYS: Key[] = ['bg', 'bg2', 'surface', 'ink', 'soft', 'primary', 'onPrimary', 'accent', 'onAccent', 'deco', 'surfaceInk'];

/** Which palette roles a property most likely holds, in order (a colour can be several roles at once: white ink and white cards). */
const PREFER: Record<string, Key[]> = {
  textFill: ['ink', 'soft', 'surfaceInk', 'onPrimary', 'onAccent', 'accent', 'primary'],
  textBg: ['surface', 'primary', 'accent', 'bg'],
  shape: ['deco', 'primary', 'surface', 'bg', 'bg2', 'accent', 'ink'],
  badgeFill: ['accent', 'primary', 'surface'],
  badgeInk: ['onAccent', 'onPrimary', 'ink', 'surfaceInk'],
  chipInk: ['surfaceInk', 'ink', 'onPrimary'],
  chipBg: ['surface', 'bg', 'primary', 'ink'],
  chipAccent: ['primary', 'accent', 'ink'],
  icon: ['accent', 'ink', 'surface', 'primary'],
  background: ['bg', 'bg2', 'primary', 'accent'],
  border: ['surface', 'primary', 'accent'],
};

/** Swaps every colour of the old palette for the same role's colour in the new one. */
export function recolor(doc: StudioDoc, from: StudioPalette, to: StudioPalette): StudioDoc {
  const c = (v: string, use: keyof typeof PREFER) => {
    const up = v.toUpperCase();
    for (const k of [...PREFER[use], ...ALL_KEYS]) if (String(from[k]).toUpperCase() === up) return String(to[k]).toUpperCase();
    return v;
  };
  const paint = (p: Paint, use: keyof typeof PREFER): Paint => (p.kind === 'solid' ? { ...p, color: c(p.color, use) } : { ...p, stops: p.stops.map((s) => ({ ...s, color: c(s.color, use) })) });
  const layers = doc.layers.map((l): Layer => {
    switch (l.kind) {
      case 'text':
        return { ...l, fill: paint(l.fill, l.bg ? 'badgeInk' : 'textFill'), bg: l.bg ? { ...l.bg, color: c(l.bg.color, 'textBg') } : undefined, stroke: l.stroke ? { ...l.stroke, color: c(l.stroke.color, 'badgeFill') } : undefined };
      case 'shape':
        return { ...l, fill: paint(l.fill, 'shape'), stroke: l.stroke ? { ...l.stroke, color: c(l.stroke.color, 'shape') } : undefined };
      case 'badge':
        return { ...l, fill: paint(l.fill, 'badgeFill'), color: c(l.color, 'badgeInk'), stroke: l.stroke ? { ...l.stroke, color: c(l.stroke.color, 'badgeInk') } : undefined };
      case 'chip':
        return { ...l, color: c(l.color, 'chipInk'), accent: c(l.accent, 'chipAccent'), bg: l.bg ? c(l.bg, 'chipBg') : undefined };
      case 'icon':
        return { ...l, color: c(l.color, 'icon') };
      case 'image':
        return { ...l, border: l.border ? { ...l.border, color: c(l.border.color, 'border') } : undefined, tint: l.tint ? { ...l.tint, color: c(l.tint.color, 'badgeFill') } : undefined };
      default:
        return l;
    }
  }).map((l): Layer => {
    // Words on their own pill or chip always stay readable.
    if (l.kind === 'text' && l.bg && l.fill.kind === 'solid' && contrast(l.fill.color, l.bg.color) < 3.5) return { ...l, fill: { kind: 'solid', color: inkOn(l.bg.color) } };
    if (l.kind === 'chip' && l.style === 'pill' && l.bg && contrast(l.color, l.bg) < 3.5) return { ...l, color: inkOn(l.bg) };
    if (l.kind === 'badge' && l.fill.kind === 'solid' && contrast(l.color, l.fill.color) < 3) return { ...l, color: inkOn(l.fill.color) };
    return l;
  });
  return { ...doc, background: paint(doc.background, 'background'), layers, meta: { ...doc.meta, palette: to.id } };
}

/** Swaps the display face and the body face. */
export function refont(doc: StudioDoc, from: Look['fonts'], to: Look['fonts'], shaper: StudioShaper): StudioDoc {
  const layers = doc.layers.map((l): Layer => {
    if (l.kind !== 'text' && l.kind !== 'chip' && l.kind !== 'badge') return l;
    let font = l.font;
    let weight = l.weight;
    if (l.font === from.display && l.weight === from.displayWeight) {
      font = to.display;
      weight = to.displayWeight;
    } else if (l.font === from.body || l.font === from.display) font = to.body;
    const next = { ...l, font, weight } as Layer;
    return normalize(next, shaper);
  });
  return { ...doc, layers, meta: { ...doc.meta, fonts: to.id } };
}

/** Keeps a box in step with its words (text boxes that do not shrink-to-fit grow with the words; chips fit their text). */
export function normalize(l: Layer, shaper: StudioShaper): Layer {
  if (l.kind === 'text' && !l.autoFit) return { ...l, h: textHeight(l, shaper) };
  if (l.kind === 'chip') return { ...l, w: chipWidth(l, shaper) };
  return l;
}

/** The words the poster shows, by role (what the owner changed overrides the details). */
export function wordsOf(doc: StudioDoc): { headline?: string; subline?: string; offer?: string; date?: string; cta?: string } {
  const out: Record<string, string> = {};
  for (const l of doc.layers) {
    if (l.hidden || !l.role) continue;
    if ((l.kind === 'text' || l.kind === 'badge') && ['headline', 'subline', 'offer', 'date', 'cta'].includes(l.role) && out[l.role] === undefined) out[l.role] = l.kind === 'badge' ? l.text.replace(/\n/g, ' ') : l.text;
  }
  return out;
}

const WEEKDAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const WEEKDAY_RE = /\b(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b/g;
const HAS_WEEKDAY = /\b(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b/;

function weekdayOf(date: string | undefined): string | null {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const [y, m, d] = date.split('-').map(Number);
  return WEEKDAY_NAMES[(new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7];
}

/**
 * Puts a day's offer into a design (the plan's "same look, different offer each day"). The offer is replaced; in the
 * headline and the details line only the day's name changes, so the owner's own wording is kept for every day.
 */
export function applyDay(doc: StudioDoc, day: { offer: string; offerNote: string; headline?: string; date?: string }, shaper: StudioShaper): StudioDoc {
  const wd = weekdayOf(day.date);
  // An offer written inside other words ("10% off all cakes") follows the day's offer too, in the same letter case.
  const OFFER_IN_TEXT = /(up to )?(?:[₹$£€]\s?\d[\d,]*|\d+(?:\.\d)?\s?%)\s?off/gi;
  const swapOffer = (t: string) =>
    day.offer.trim() ? t.replace(OFFER_IN_TEXT, (m) => (m === m.toUpperCase() ? day.offer.toUpperCase() : day.offer.toLowerCase())) : t;
  const swapDay = (t: string) => swapOffer(wd ? t.replace(WEEKDAY_RE, wd) : t);
  const layers = doc.layers.map((l): Layer => {
    if (l.role === 'offer') {
      if (l.kind === 'badge') return { ...l, text: offerBadgeText(day.offer), hidden: day.offer.trim() === '' ? true : l.hidden };
      if (l.kind === 'text') return normalize({ ...l, text: l.text.includes('\n') ? offerBadgeText(day.offer) : day.offer }, shaper);
    }
    if (l.role === 'date' && l.kind === 'text') return normalize({ ...l, text: HAS_WEEKDAY.test(l.text) ? swapDay(l.text) : day.offerNote }, shaper);
    if ((l.role === 'headline' || l.role === 'subline' || l.role === 'custom') && l.kind === 'text') {
      const next = swapDay(l.text);
      return next !== l.text ? normalize({ ...l, text: next }, shaper) : l;
    }
    return l;
  });
  return { ...doc, layers };
}

/** Input for a template, with the words the owner already changed in a design. */
export function inputWithWords(input: StudioInput, doc: StudioDoc | null, format: StudioFormat): StudioInput {
  const w = doc ? wordsOf(doc) : {};
  return {
    ...input,
    format,
    content: {
      ...input.content,
      headline: w.headline ?? input.content.headline,
      offer: w.offer ?? input.content.offer,
      offerNote: w.date ?? input.content.offerNote,
      cta: w.cta ?? input.content.cta,
    },
  };
}

/**
 * The same design in another size: the composition is laid out again for the new size with the owner's words, colours
 * and fonts; layers the owner added are carried over in proportion; parts the owner removed stay removed.
 */
export function adaptDoc(doc: StudioDoc, to: StudioFormat, input: StudioInput, shaper: StudioShaper, addRoles: string[] = []): StudioDoc {
  const template = (TEMPLATE_IDS as readonly string[]).includes(doc.meta.template) ? (doc.meta.template as TemplateId) : 'card';
  // The photo the owner has on this design (maybe cut out or tinted) is the one the other size shows.
  const old = doc.layers.find((l): l is ImageLayer => l.kind === 'image' && l.role === 'photo' && !l.hidden);
  const withPhoto: StudioInput = old
    ? {
        ...input,
        photo: {
          ...(input.photo ?? {}),
          id: old.photoId,
          src: old.src,
          w: old.natW,
          h: old.natH,
          focus: { x: old.fx, y: old.fy },
          cutout: old.asset === 'cutout' ? { src: old.src, w: old.natW, h: old.natH } : undefined,
        },
      }
    : input;
  const inp = inputWithWords(withPhoto, doc, to);
  const look = lookFor(inp, template, doc.meta.palette, doc.meta.fonts);
  const fresh = buildTemplate(template, inp, shaper, look);
  const { width: W, height: H } = STUDIO_SIZE[to];
  const kx = W / doc.width;
  const ky = H / doc.height;
  const k = Math.min(kx, ky);
  const roles = new Set(doc.layers.filter((l) => !l.hidden).map((l) => l.role ?? 'custom'));
  const keptTexts = new Set(doc.layers.filter((l) => l.kind === 'chip' && !l.hidden).map((l) => (l as { text: string }).text));
  const kept = fresh.layers.filter((l) => (l.kind === 'chip' ? keptTexts.has(l.text) : !l.role || roles.has(l.role) || l.role === 'decor' || addRoles.includes(l.role)));
  const added = doc.layers
    .filter((l) => {
      if (l.role && addRoles.includes(l.role)) return false;
      if (l.role === 'custom') return true;
      // A contact the owner added (not one the details put on every size).
      if (l.kind === 'chip') return !fresh.layers.some((f) => f.kind === 'chip' && f.text === l.text);
      return !!l.role && !fresh.layers.some((f) => f.role === l.role);
    })
    .map((l) => {
      const cx = (l.x + l.w / 2) * kx;
      const cy = (l.y + l.h / 2) * ky;
      const w = l.w * k;
      const h = l.h * k;
      const n = { ...l, id: newId(), x: cx - w / 2, y: cy - h / 2, w, h } as Layer;
      if (n.kind === 'text') (n as TextLayer).size = (l as TextLayer).size * k;
      if (n.kind === 'chip') n.size = n.size * k;
      return normalize(n, shaper);
    });
  // The pose of the brand's face the owner picked stays the one shown in the other size (the new size only moves and resizes it).
  const oldFace = doc.layers.find((l): l is ImageLayer => l.kind === 'image' && l.asset === 'face' && !l.hidden);
  const carried = kept.map((l): Layer => {
    if (old && l.kind === 'image' && l.role === 'photo') return { ...l, tint: old.tint, adjust: old.adjust, flipX: old.flipX, ...(old.asset === 'cutout' ? { outline: old.outline ?? l.outline } : {}) };
    if (oldFace && l.kind === 'image' && l.asset === 'face' && l.src !== oldFace.src) {
      const w = (l.h * oldFace.natW) / oldFace.natH;
      return { ...l, src: oldFace.src, natW: oldFace.natW, natH: oldFace.natH, w, x: l.x + (l.w - w) / 2, ...(oldFace.ai ? { ai: true } : {}) };
    }
    return l;
  });
  return { ...fresh, background: doc.background, layers: [...carried, ...added] };
}
