// Code-side clean-up of the model's weekly batch (Req 8, PRD §8 "Caption too long"). The model is
// asked to follow these rules; this makes sure the stored posts follow them whatever it returned.
// Pure functions, no database.

import { V2_CHANNEL_SPECS, V2_IMAGE_TEXT_LIMITS, type V2Channel, type WeeklyOccasion } from '@/lib/ai/prompts/v2-weekly';
import type { WeeklyPost } from '@/lib/ai/schemas-v2';
import { MASCOT_POSES, type MascotPose } from '@/lib/ai/prompts/mascot';
import { IMAGE_TEXT_LIMITS } from '@/lib/ai/prompts/shared';
import { addDaysIso, isValidIsoDate } from '@/lib/occasions/dates';

const segmenter = new Intl.Segmenter('hi', { granularity: 'grapheme' });
const sentenceSegmenter = new Intl.Segmenter('en', { granularity: 'sentence' });

const graphemes = (s: string) => Array.from(segmenter.segment(s), (x) => x.segment);
/** User-visible length, the same count the guardrail uses for channel limits. */
export const visibleChars = (s: string) => graphemes(s).length;

/** Cuts at a word boundary within `max` characters; no ellipsis. Trailing separators are dropped. */
export function trimAtWord(text: string, max: number): string {
  const t = text.trim();
  const g = graphemes(t);
  if (g.length <= max) return t;
  const head = g.slice(0, max).join('');
  // A cut inside a word backs up to the last space, if that keeps at least half of the room.
  const nextIsSpace = /\s/.test(g[max] ?? '');
  const lastSpace = head.search(/\s\S*$/);
  const cut = nextIsSpace || lastSpace < head.length / 2 ? head : head.slice(0, lastSpace);
  return cut.replace(/[\s,;:\-–—·|/]+$/u, '').trim();
}

/**
 * Trims a caption to the channel limit at a sentence boundary, keeping whole sentences. If even
 * the first sentence is too long it is cut at a word with an ellipsis. Short captions are kept as is.
 */
export function trimCaption(caption: string, max: number): string {
  const text = caption.trim();
  if (visibleChars(text) <= max) return text;
  let kept = '';
  for (const { segment } of sentenceSegmenter.segment(text)) {
    if (visibleChars((kept + segment).trimEnd()) > max) break;
    kept += segment;
  }
  kept = kept.trimEnd();
  if (kept) return kept;
  return `${trimAtWord(text, max - 1)}…`;
}

const TAG_CHARS = /[^\p{L}\p{M}\p{N}_]/gu;

/** Tags with a leading #, no spaces or punctuation inside, no duplicates, at most `max`. */
export function normaliseHashtags(tags: string[], max: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    const body = raw.trim().replace(/^#+/, '').replace(TAG_CHARS, '');
    if (!body) continue;
    const tag = `#${body}`;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
    if (out.length >= max) break;
  }
  return out;
}

/** Hashtags built from the business's own name and place, used only to reach the channel minimum. */
function brandTags(brand: { name: string; city?: string; region?: string }): string[] {
  const join = (s: string) => s.replace(TAG_CHARS, '');
  return [join(brand.name), brand.city ? join(brand.city) : '', brand.region ? join(brand.region) : '', 'smallbusiness']
    .map((t) => (t ? `#${t}` : ''))
    .filter(Boolean);
}

export function fitHashtags(tags: string[], channel: V2Channel, brand: { name: string; city?: string; region?: string }): string[] {
  const [min, max] = V2_CHANNEL_SPECS[channel].hashtags;
  let out = normaliseHashtags(tags, max);
  if (out.length < min) out = normaliseHashtags([...out, ...brandTags(brand)], Math.min(max, Math.max(min, out.length)));
  return out;
}

/** The mascot's words: one line, at most 30 characters, cut at a word. */
export function fitBubble(raw: string | undefined): string {
  return trimAtWord((raw ?? '').replace(/\s+/g, ' '), IMAGE_TEXT_LIMITS.bubble);
}

/** The model's pose when it is one of the 8, else '' (the renderer then draws `wave`). */
export function validPose(raw: string | undefined): MascotPose | '' {
  const p = (raw ?? '').trim();
  return (MASCOT_POSES as readonly string[]).includes(p) ? (p as MascotPose) : '';
}

export function fitImageText(t: { headline: string; subline: string }): { headline: string; subline: string } {
  return {
    headline: trimAtWord(t.headline.replace(/\s+/g, ' '), V2_IMAGE_TEXT_LIMITS.headline),
    subline: trimAtWord(t.subline.replace(/\s+/g, ' '), V2_IMAGE_TEXT_LIMITS.subline),
  };
}

/**
 * Gives every post a day of the week, each day once. A post keeps its day when it is in the
 * week and not taken; the others move to the free day nearest to what they asked for (or the
 * first free one). Returns the days in the same order as the input.
 */
export function assignDays(requested: string[], weekStart: string): string[] {
  const week = Array.from({ length: 7 }, (_, i) => addDaysIso(weekStart, i));
  const result: Array<string | null> = requested.map(() => null);
  const taken = new Set<string>();
  requested.forEach((d, i) => {
    if (week.includes(d) && !taken.has(d)) {
      result[i] = d;
      taken.add(d);
    }
  });
  const offsetOf = (d: string) => (isValidIsoDate(d) ? Math.round((Date.parse(`${d}T00:00:00Z`) - Date.parse(`${weekStart}T00:00:00Z`)) / 86_400_000) : 0);
  requested.forEach((d, i) => {
    if (result[i] !== null) return;
    const want = Math.min(6, Math.max(0, offsetOf(d)));
    const free = week.filter((x) => !taken.has(x));
    const pick = free.reduce((best, x) => (Math.abs(week.indexOf(x) - want) < Math.abs(week.indexOf(best) - want) ? x : best), free[0]);
    result[i] = pick;
    taken.add(pick);
  });
  return result as string[];
}

export interface NormalizedPost {
  suggestedDay: string;
  channel: V2Channel;
  caption: string;
  cta: string;
  hashtags: string[];
  /** From the channel (V2_CHANNEL_SPECS), never from the model. */
  link: boolean;
  imageText: { headline: string; subline: string };
  /** What the mascot says and its pose. Both '' when the brand's mascot is off or the occasion is sensitive. */
  bubble: string;
  pose: MascotPose | '';
  /** The post is for a sensitive occasion: no mascot, whatever the model said. */
  sensitive: boolean;
  /** A real photos.id, or null when the post is text-only. */
  photoId: string | null;
  occasionKey: string;
  /** The occasion's name, or null. */
  occasion: string | null;
  factIds: string[];
  topic: string;
}

export interface NormalizeContext {
  weekStart: string;
  /** Prompt id (p1...) to photos.id. */
  photoIds: Map<string, string>;
  occasions: WeeklyOccasion[];
  brand: { name: string; city?: string; region?: string };
  /** The brand's mascot is on for these posts, so bubble and pose are kept. */
  mascot?: boolean;
}

export function normalizePosts(posts: WeeklyPost[], ctx: NormalizeContext): NormalizedPost[] {
  const days = assignDays(posts.map((p) => p.suggested_day), ctx.weekStart);
  const usedPhotos = new Set<string>();
  const out = posts.map((p, i): NormalizedPost => {
    const spec = V2_CHANNEL_SPECS[p.channel];
    const photoId = ctx.photoIds.get(p.photo_id.trim()) ?? null;
    const photo = photoId && !usedPhotos.has(photoId) ? photoId : null;
    if (photo) usedPhotos.add(photo);
    const occasion = ctx.occasions.find((o) => o.key === p.occasion_key) ?? null;
    const sensitive = occasion?.sensitive === true;
    const withMascot = ctx.mascot === true && !sensitive;
    return {
      suggestedDay: days[i],
      channel: p.channel,
      caption: trimCaption(p.caption, spec.captionMaxChars),
      cta: p.cta.trim(),
      hashtags: fitHashtags(p.hashtags, p.channel, ctx.brand),
      link: spec.clickableLink,
      imageText: fitImageText(p.image_text),
      bubble: withMascot ? fitBubble(p.image_text.bubble) : '',
      pose: withMascot ? validPose(p.image_text.pose) : '',
      sensitive,
      photoId: photo,
      occasionKey: occasion ? occasion.key : '',
      occasion: occasion ? occasion.name : null,
      factIds: p.fact_ids,
      topic: p.topic.trim().slice(0, 120),
    };
  });
  return out.sort((a, b) => a.suggestedDay.localeCompare(b.suggestedDay));
}
