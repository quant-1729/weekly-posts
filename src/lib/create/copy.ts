// The words of a post (PRD v3 C-1, C-16): one Gemini call writes the headline, subline, call-to-action
// text, a caption per channel, hashtags and the mascot's line. Code does everything else.
//
// Rules this file enforces (the prompt asks for the same, but the model can be wrong):
//  - owner free text and payment IDs are removed from every input before the call (`redactForBrand`);
//    the answer is cleaned the same way;
//  - lengths: headline up to 7 words, subline up to 14 words, CTA up to 25 characters, bubble up to 30
//    characters, caption limits per channel, up to 8 hashtags. Too long is repaired in code (never by
//    cutting a headline in half: a long headline falls back to the main selling point's own words);
//  - the pose must be one of Tween's poses;
//  - the call is counted: usage `post_copy` with its cost, the daily cap and a weekly count cap.

import { generateJson, AiError } from '@/lib/ai/client';
import { POST_COPY_SYSTEM, buildPostCopyUser } from '@/lib/ai/prompts/v3';
import { postCopyJsonSchema, postCopySchema, POST_COPY_CHANNELS, type PostCopy } from '@/lib/ai/schemas-v3';
import { requireBrandMember } from '@/lib/brand/current';
import type { Brief } from '@/lib/briefs/types';
import { neverSayHit } from '@/lib/faces/rules';
import { TWEEN_POST_POSES, postPoseOrDefault } from '@/lib/mascot/poses';
import { TWEEN_NAME } from '@/lib/mascot/spec';
import { getDb } from '@/lib/db';
import { redactPaymentIds } from '@/lib/payments';
import { DailyCapError, assertUnderDailyCap, failedCallModel, failedCallUsd, recordUsage } from '@/lib/usage';
import { WeeklyCapError, assertUnderWeeklyCap } from '@/lib/usage/caps';
import { loadCreateBrand } from './brand';
import { CTA_DEFAULT_TEXT, datesLineFor, offerLineFor, repeatsLines, shownBlocks, stripDatePhrase, uspReadable } from './content';
import type { SlideKind, SlideText } from '@/lib/design/types';
import type { CreateBrand, CreateFace, PostCopyResult } from './types';

export const HEADLINE_MAX_WORDS = 7;
export const SUBLINE_MAX_WORDS = 14;
export const CTA_MAX_CHARS = 25;
export const BUBBLE_MAX_CHARS = 30;
export const HASHTAGS_MAX = 8;

/** Longest slide headline and body per kind of slide, in words (the prompt asks for the same). */
export const SLIDE_HEAD_MAX_WORDS: Record<SlideKind, number> = { cover: 7, point: 6, proof: 10, cta: 5 };
export const SLIDE_BODY_MAX_WORDS: Record<SlideKind, number> = { cover: 10, point: 20, proof: 20, cta: 14 };
/** A carousel needs at least a cover and a closing slide. */
export const MIN_USABLE_SLIDES = 2;

/** Longest caption per channel, in characters. */
export const CAPTION_MAX: Record<string, number> = {
  instagram: 1200,
  facebook: 1200,
  whatsapp: 700,
  youtube: 1500,
  linkedin: 1300,
  gbp: 1000,
};

/** Channels that take hashtags, and how many. */
const HASHTAG_LIMIT: Record<string, number> = { instagram: HASHTAGS_MAX, facebook: 3, linkedin: 3 };

export class PostCopyError extends Error {
  constructor(public readonly code: 'ai_failed' | 'no_channels') {
    super(`Post copy: ${code}`);
    this.name = 'PostCopyError';
  }
}

/** How many slides the brief asks for (0 for a single post). */
export const slidesWanted = (brief: Pick<Brief, 'contentFormat' | 'slideCount'>): number => (brief.contentFormat === 'carousel' ? (brief.slideCount ?? 0) : 0);

/** Channels of the brief that have a caption, in the brief's order (Instagram when it has none). */
export function copyChannels(brief: Pick<Brief, 'channels'>): string[] {
  const list = brief.channels.filter((c) => (POST_COPY_CHANNELS as readonly string[]).includes(c));
  return list.length > 0 ? list : ['instagram'];
}

/** How many hashtags a channel takes (0 = none). */
export const hashtagLimitFor = (channel: string): number => HASHTAG_LIMIT[channel] ?? 0;

/** The hashtags a channel's post keeps. */
export function hashtagsFor(channel: string, hashtags: readonly string[]): string[] {
  return hashtags.slice(0, HASHTAG_LIMIT[channel] ?? 0);
}

// ---------------------------------------------------------------------------------------------
// Counting and trimming
// ---------------------------------------------------------------------------------------------

export function wordCount(text: string, language = 'en'): number {
  const t = text.trim();
  if (!t) return 0;
  try {
    const seg = new Intl.Segmenter(language, { granularity: 'word' });
    let n = 0;
    for (const s of seg.segment(t)) if (s.isWordLike) n++;
    return n;
  } catch {
    return t.split(/\s+/).length;
  }
}

/** Characters as a person counts them (a flag emoji or a Devanagari conjunct is one). */
export function visibleLength(text: string): number {
  try {
    return [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)].length;
  } catch {
    return [...text].length;
  }
}

const clean = (text: string): string => text.replace(/\s+/g, ' ').trim();

/** Cuts a caption to `max` characters at the end of a sentence, line or word, never in the middle of one. */
export function trimCaption(text: string, max: number): string {
  const t = text.trim();
  if (visibleLength(t) <= max) return t;
  const chars = [...t];
  const head = chars.slice(0, max).join('');
  const minKeep = Math.floor(max * 0.5);
  const cutAt = (idx: number) => head.slice(0, idx).trimEnd();
  const sentence = Math.max(head.lastIndexOf('. '), head.lastIndexOf('! '), head.lastIndexOf('? '), head.lastIndexOf('\n'));
  if (sentence >= minKeep) return cutAt(sentence + 1);
  const space = head.lastIndexOf(' ');
  if (space >= minKeep) return cutAt(space).replace(/[,;:\-–—]+$/, '') + '…';
  return head.slice(0, -1).trimEnd() + '…';
}

/** Hashtags as `#word` without spaces or punctuation, at most 40 characters, no repeats. */
export function cleanHashtags(tags: readonly string[], max = HASHTAGS_MAX): string[] {
  const out: string[] = [];
  for (const raw of tags) {
    const word = raw.replace(/^#+/, '').replace(/[^\p{L}\p{M}\p{N}_]+/gu, '');
    if (!word || word.length > 39) continue;
    const tag = `#${word}`;
    if (!out.some((t) => t.toLowerCase() === tag.toLowerCase())) out.push(tag);
    if (out.length >= max) break;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Validation (pure)
// ---------------------------------------------------------------------------------------------

export interface ValidateContext {
  brief: Brief;
  brandName: string;
  language: string;
  channels: string[];
  mascot: boolean;
  /** Phrases the face never says (Brand Face): a bubble line that holds one is dropped. */
  neverSay?: readonly string[];
  /** Contact lines the post shows, for the fallback captions. */
  contactLines: string[];
}

// ---------------------------------------------------------------------------------------------
// Carousel slides
// ---------------------------------------------------------------------------------------------

/** The first `max` words of a text. With `ellipsis` (a body), a cut ends at a sentence end within the limit, else at a word with "…". */
export function trimWords(text: string, max: number, language = 'en', opts: { ellipsis?: boolean } = {}): string {
  const t = text.trim();
  if (wordCount(t, language) <= max) return t;
  let end = 0;
  let n = 0;
  try {
    for (const seg of new Intl.Segmenter(language, { granularity: 'word' }).segment(t)) {
      if (seg.isWordLike) {
        n++;
        if (n > max) break;
      }
      end = seg.index + seg.segment.length;
    }
  } catch {
    end = t.split(/\s+/).slice(0, max).join(' ').length;
  }
  const head = t.slice(0, end).trim();
  const sentence = Math.max(head.lastIndexOf('. '), head.lastIndexOf('! '), head.lastIndexOf('? '));
  if (opts.ellipsis && sentence >= head.length * 0.4) return head.slice(0, sentence + 1);
  const cut = head.replace(/[\s,;:\-–—]+$/, '');
  return opts.ellipsis && !/[.!?]$/.test(cut) ? `${cut}…` : cut;
}

/**
 * A slide set made only from the brief's own words: the cover is the post's headline (and subline), then one point per selling
 * point, the offer line as the proof, and the closing slide with the call to action. Never writes anything new.
 */
export function fallbackSlides(args: { brief: Brief; brandName: string; language: string; headline: string; subline: string; ctaText: string; want: number }): SlideText[] {
  const { brief, language, want } = args;
  const cover: SlideText = { kind: 'cover', headline: args.headline, body: trimWords(args.subline, SLIDE_BODY_MAX_WORDS.cover, language) };
  const cta: SlideText = { kind: 'cta', headline: args.ctaText || (brief.cta ? CTA_DEFAULT_TEXT[brief.cta] : clean(args.brandName)), body: '' };
  const points: SlideText[] = [];
  for (const u of brief.uspSnapshot) {
    const title = clean(u.title);
    if (!title || repeatsLines(title, [args.headline, ...points.map((p) => p.headline)])) continue;
    points.push({ kind: 'point', headline: trimWords(title, 8, language), body: '' });
  }
  const offer = offerLineFor(brief, language);
  const proof: SlideText[] = offer ? [{ kind: 'proof', headline: offer, body: '' }] : [];
  const room = Math.max(0, want - 2 - proof.length);
  return [cover, ...points.slice(0, room), ...proof, cta].slice(0, Math.max(want, MIN_USABLE_SLIDES));
}

/**
 * Checks the model's slides and repairs them in code: no empty slide, at most `want`, the first is the cover and the last the
 * call to action (a missing one is added from the post's own words), a cover or call to action in the middle becomes a point,
 * and every length is inside its limit. Fewer than two usable slides are replaced by `fallbackSlides`. `fixes` gets what was repaired.
 */
export function validateSlides(raw: PostCopy['slides'], ctx: ValidateContext, v: { headline: string; subline: string; ctaText: string }, want: number, fixes: string[]): SlideText[] {
  if (!want) return [];
  const language = ctx.language;
  const fallbackArgs = { brief: ctx.brief, brandName: ctx.brandName, language, headline: v.headline, subline: v.subline, ctaText: v.ctaText, want };
  const asked = raw ?? [];
  let list: SlideText[] = asked.flatMap((x) => {
    const headline = clean(x.headline);
    if (!headline) return [];
    return [{ kind: x.kind, headline, body: clean(x.body) }];
  });
  if (list.length < asked.length) fixes.push('slide_empty');
  if (list.length < MIN_USABLE_SLIDES) {
    fixes.push('slides_fallback');
    return fallbackSlides(fallbackArgs);
  }
  if (list[0].kind !== 'cover') {
    fixes.push('slide_cover_added');
    list = [{ kind: 'cover', headline: v.headline, body: trimWords(v.subline, SLIDE_BODY_MAX_WORDS.cover, language) }, ...list];
  }
  if (list[list.length - 1].kind !== 'cta') {
    fixes.push('slide_cta_added');
    list = [...list, fallbackSlides(fallbackArgs).at(-1)!];
  }
  // A cover or call to action in the middle is a point.
  const last = list.length - 1;
  list = list.map((x, i) => (i > 0 && i < last && (x.kind === 'cover' || x.kind === 'cta') ? { ...x, kind: 'point' as const } : x));
  // Too many: keep the cover and the call to action, drop the last points.
  if (list.length > want) {
    fixes.push('slides_too_many');
    list = [...list.slice(0, want - 1), list[list.length - 1]];
  }
  return list.map((x) => {
    const headline = wordCount(x.headline, language) > SLIDE_HEAD_MAX_WORDS[x.kind] ? trimWords(x.headline, SLIDE_HEAD_MAX_WORDS[x.kind], language) : x.headline;
    const body = wordCount(x.body, language) > SLIDE_BODY_MAX_WORDS[x.kind] ? trimWords(x.body, SLIDE_BODY_MAX_WORDS[x.kind], language, { ellipsis: true }) : x.body;
    if (headline !== x.headline || body !== x.body) fixes.push('slide_trimmed');
    return { kind: x.kind, headline, body };
  });
}

function fallbackCaption(channel: string, v: { headline: string; subline: string; offerLine: string | null; ctaText: string }, contactLines: string[]): string {
  const lines = [v.headline, v.subline, v.offerLine ?? '', v.ctaText];
  if (channel !== 'instagram' && channel !== 'whatsapp') lines.push(...contactLines);
  return lines.filter(Boolean).join('\n');
}

/**
 * Checks the model's answer and repairs it in code. Never invents facts: a too-long headline becomes the
 * main selling point's own title (or the business name), a too-long subline the first secondary point's
 * title (or nothing), a bad call-to-action the standard wording for the brief's CTA kind, a missing
 * caption the headline, subline, dates, CTA and contact lines. `fixes` lists what was repaired.
 */
export function validateCopy(raw: PostCopy, ctx: ValidateContext): PostCopyResult {
  const fixes: string[] = [];
  const primaryTitle = ctx.brief.uspSnapshot.find((u) => u.role === 'primary')?.title ?? '';
  const secondaryTitle = ctx.brief.uspSnapshot.find((u) => u.role === 'secondary')?.title ?? '';

  let headline = clean(raw.headline);
  if (!headline || wordCount(headline, ctx.language) > HEADLINE_MAX_WORDS) {
    fixes.push(headline ? 'headline_too_long' : 'headline_missing');
    headline = primaryTitle && wordCount(primaryTitle, ctx.language) <= HEADLINE_MAX_WORDS ? clean(primaryTitle) : clean(ctx.brandName);
    if (wordCount(headline, ctx.language) > HEADLINE_MAX_WORDS) headline = headline.split(/\s+/).slice(0, HEADLINE_MAX_WORDS).join(' ');
  }

  let subline = clean(raw.subline);
  if (wordCount(subline, ctx.language) > SUBLINE_MAX_WORDS) {
    fixes.push('subline_too_long');
    subline = secondaryTitle && wordCount(secondaryTitle, ctx.language) <= SUBLINE_MAX_WORDS ? clean(secondaryTitle) : '';
  }

  const offerForSubline = offerLineFor(ctx.brief, ctx.language);
  const primaryShown = datesLineFor(ctx.brief) ? stripDatePhrase(primaryTitle) : primaryTitle;
  if (subline && repeatsLines(subline, [headline, primaryShown, offerForSubline ?? ''])) {
    fixes.push('subline_repeats');
    subline = '';
  }

  let ctaText = clean(raw.cta_text);
  if (ctx.brief.cta && (!ctaText || visibleLength(ctaText) > CTA_MAX_CHARS)) {
    fixes.push(ctaText ? 'cta_too_long' : 'cta_missing');
    ctaText = CTA_DEFAULT_TEXT[ctx.brief.cta];
  } else if (!ctx.brief.cta) ctaText = '';

  let bubble = '';
  let pose = '';
  if (ctx.mascot) {
    bubble = clean(raw.bubble);
    if (visibleLength(bubble) > BUBBLE_MAX_CHARS) {
      fixes.push('bubble_too_long');
      bubble = '';
    }
    pose = (TWEEN_POST_POSES as readonly string[]).includes(raw.pose) ? raw.pose : postPoseOrDefault(raw.pose);
    if (pose !== raw.pose) fixes.push('pose_unknown');
    if (bubble && neverSayHit(bubble, ctx.neverSay ?? [])) {
      fixes.push('bubble_never_say');
      bubble = '';
    }
  }

  const offerLine = offerLineFor(ctx.brief, ctx.language);
  const captions: Record<string, string> = {};
  for (const channel of ctx.channels) {
    const asked = raw.captions.find((c) => c.channel === channel)?.text ?? '';
    let text = asked.replace(/\r\n/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    if (!text) {
      fixes.push(`caption_missing:${channel}`);
      text = fallbackCaption(channel, { headline, subline, offerLine, ctaText }, ctx.contactLines);
    }
    const max = CAPTION_MAX[channel] ?? 1200;
    if (visibleLength(text) > max) {
      fixes.push(`caption_too_long:${channel}`);
      text = trimCaption(text, max);
    }
    captions[channel] = text;
  }

  const hashtags = cleanHashtags(raw.hashtags);
  if (hashtags.length < raw.hashtags.filter((h) => h.trim()).length) fixes.push('hashtags_cleaned');
  const slides = validateSlides(raw.slides, ctx, { headline, subline, ctaText }, slidesWanted(ctx.brief), fixes);
  return { headline, subline, ctaText, captions, hashtags, bubble, pose, slides, fixes };
}

// ---------------------------------------------------------------------------------------------
// The call
// ---------------------------------------------------------------------------------------------

/** Test hook: what the model "answers" in fixture mode; a function receives the prompt that would be sent. */
export interface PostCopyDeps {
  fixture?: PostCopy | ((prompt: { system: string; user: string }) => PostCopy);
}

/**
 * Removes payment IDs from several strings with one lookup of the brand's saved IDs (the same filter as
 * `redactForBrand`, applied to each text on its own so one text can never swallow its neighbour).
 */
async function redactMany(brandId: string, texts: string[]): Promise<string[]> {
  if (texts.length === 0) return [];
  const known = (await getDb().withService((tx) => tx.query<{ address: string }>('select address from public.payment_ids where brand_id = $1', [brandId]))).map((r) => r.address);
  return texts.map((t) => redactPaymentIds(t, { known }));
}

/** What the model "answers" in fixture mode when a test gives none: an honest, plain post built from the brief. */
function defaultFixture(ctx: ValidateContext): PostCopy {
  const primary = ctx.brief.uspSnapshot.find((u) => u.role === 'primary')?.title ?? ctx.brandName;
  const headline = primary.split(/\s+/).slice(0, HEADLINE_MAX_WORDS).join(' ');
  const subline = ctx.brief.uspSnapshot.find((u) => u.role === 'secondary')?.title ?? '';
  const ctaText = ctx.brief.cta ? CTA_DEFAULT_TEXT[ctx.brief.cta] : '';
  const offerLine = offerLineFor(ctx.brief, ctx.language);
  return {
    headline,
    subline,
    cta_text: ctaText,
    captions: ctx.channels.map((c) => ({
      channel: c as PostCopy['captions'][number]['channel'],
      text: fallbackCaption(c, { headline, subline, offerLine, ctaText }, ctx.contactLines),
    })),
    hashtags: [],
    bubble: ctx.mascot ? 'Come say hi!' : '',
    pose: ctx.mascot ? 'wave' : '',
    slides: slidesWanted(ctx.brief) ? fallbackSlides({ brief: ctx.brief, brandName: ctx.brandName, language: ctx.language, headline, subline, ctaText, want: slidesWanted(ctx.brief) }) : [],
  };
}

/**
 * Writes the words for a ready brief. Throws PostCopyError('ai_failed'), DailyCapError, WeeklyCapError or
 * BrandAccessError. One `post_copy` usage event is recorded per call that reached the model.
 * `mascot` says whether the post will have the brand's face (it is on AND usable); `face` is that face, for its name and
 * the phrases it never says.
 */
export async function writePostCopy(
  args: { userId: string; brandId: string; brief: Brief; brand?: CreateBrand; mascot?: boolean; face?: CreateFace | null; now?: Date },
  deps: PostCopyDeps = {},
): Promise<{ copy: PostCopyResult; usd: number }> {
  const { userId, brandId, brief } = args;
  const now = args.now ?? new Date();
  await requireBrandMember(userId, brandId);
  const brand = args.brand ?? (await loadCreateBrand(userId, brandId));
  const language = brief.language ?? brand.language;
  const channels = copyChannels(brief);
  const mascot = args.mascot ?? brand.face !== null;
  // The face that will be on the picture: the one given (it may be off for this type of post), else the brand's.
  const face = args.face === undefined ? brand.face : args.face;
  const contactLines = shownBlocks(brief, brand).map((b) => b.text);
  const vctx: ValidateContext = { brief, brandName: brand.name, language, channels, mascot, neverSay: face?.neverSay, contactLines };

  // Everything the owner typed goes through the payment-ID filter before it reaches a prompt.
  const uspTexts = brief.uspSnapshot.flatMap((u) => [u.title, uspReadable({ kind: u.kind, title: '', details: u.details }, language).replace(/^\.\s*/, '')]);
  const offerLine = offerLineFor(brief, language);
  const cleaned = await redactMany(brandId, [
    brand.name,
    brand.sells,
    brand.voice,
    ...brand.wordsToAvoid,
    ...uspTexts,
    ...contactLines,
    offerLine ?? '',
    brief.notes ?? '',
  ]);
  let at = 0;
  const take = (n: number) => cleaned.slice(at, (at += n));
  const [name] = take(1);
  const [sells] = take(1);
  const [voice] = take(1);
  const wordsToAvoid = take(brand.wordsToAvoid.length).filter(Boolean);
  const uspClean = take(uspTexts.length);
  const lines = take(contactLines.length);
  const [offer] = take(1);
  const [notes] = take(1);

  const uspPrompt = (role: 'primary' | 'secondary') =>
    brief.uspSnapshot.flatMap((u, i) =>
      u.role === role ? [{ kind: u.kind, title: uspClean[i * 2], details: uspClean[i * 2 + 1], confirmed: u.confirmed }] : [],
    );
  const prompt = {
    system: POST_COPY_SYSTEM,
    user: buildPostCopyUser({
      brandName: name,
      sells: sells || 'various products and services',
      country: brand.country ?? 'an unknown country',
      voice,
      wordsToAvoid,
      regulated: brand.regulated === 'other' ? 'none' : brand.regulated,
      language,
      postType: brief.postType,
      extraPostTypes: brief.extraPostTypes ?? [],
      primary: uspPrompt('primary')[0] ?? null,
      secondary: uspPrompt('secondary'),
      offerLine: offer || null,
      dates: { startsOn: brief.startsOn, endsOn: brief.openEnded ? null : brief.endsOn },
      ctaKind: brief.cta,
      contactLines: lines,
      channels,
      ownerDescription: notes || null,
      carouselSlides: slidesWanted(brief) || null,
      mascot: mascot ? (face && face.kind !== 'mascot' ? { name: face.name, kind: face.kind } : { name: TWEEN_NAME }) : null,
    }),
  };

  await assertUnderDailyCap(brandId, now);
  await assertUnderWeeklyCap(brandId, 'post_copy', { now });

  let data: PostCopy;
  let usd = 0;
  try {
    const fixture = deps.fixture ?? (() => defaultFixture(vctx));
    const res = await generateJson({
      system: prompt.system,
      user: prompt.user,
      zodSchema: postCopySchema,
      jsonSchema: postCopyJsonSchema,
      temperature: 0.6,
      logContext: { brandId },
      fixture: () => (typeof fixture === 'function' ? fixture(prompt) : fixture),
    });
    data = res.data;
    usd = res.stats?.usd ?? 0;
    await recordUsage(brandId, userId, 'post_copy', usd, { model: res.stats?.model });
  } catch (err) {
    const lost = failedCallUsd(err); // an answer that did not validate still cost money
    if (lost > 0) await recordUsage(brandId, userId, 'post_copy', lost, { ok: false, model: failedCallModel(err) }).catch(() => undefined);
    console.warn(`[create] post copy failed for brand ${brandId}: ${err instanceof AiError ? err.code : err instanceof Error ? err.name : 'error'}`);
    throw new PostCopyError('ai_failed');
  }

  // The answer is cleaned the same way as the input: a payment ID never stays in a post.
  const slides = data.slides ?? [];
  const outTexts = [data.headline, data.subline, data.cta_text, data.bubble, ...data.captions.map((c) => c.text), ...data.hashtags, ...slides.flatMap((x) => [x.headline, x.body])];
  const outClean = await redactMany(brandId, outTexts);
  let k = 0;
  const safe: PostCopy = {
    ...data,
    headline: outClean[k++],
    subline: outClean[k++],
    cta_text: outClean[k++],
    bubble: outClean[k++],
    captions: data.captions.map((c) => ({ ...c, text: outClean[k++] })),
    hashtags: data.hashtags.map(() => outClean[k++]),
    slides: slides.map((x) => ({ ...x, headline: outClean[k++], body: outClean[k++] })),
  };
  return { copy: validateCopy(safe, vctx), usd };
}

export { DailyCapError, WeeklyCapError };
