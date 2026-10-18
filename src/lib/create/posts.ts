// The posts of a brief (PRD v3 G-4 to G-7, C-1; change C-16): the draft copy cached on the first visit to the
// design step, the quick edits, "Use this design" (draw every picture the channels need and store it), and
// the review operations (confirm or remove a flag, approve, undo).
//
// How posts and channels are stored (same tables as v2, no schema change):
//  - ONE `posts` row PER CHANNEL of the brief (`brief_id` set, `batch_id` null), like a v2 weekly post: its
//    own caption, hashtags, short-link code (so a link QR counts scans per channel), flags and status. The words
//    on the picture (headline, subline, CTA, mascot line) are the same on every channel's row.
//  - `post_images`: one row per picture size that channel needs (Instagram square + portrait, Facebook square,
//    WhatsApp vertical, YouTube thumbnail, ...), files under `renders/{brand}/{post}/{format}.png`.
//  - A carousel (one USP per slide) is extra `posts` rows of the first channel, sharing `carousel_id`, with
//    `slide_index` 0..n-1 and one picture each. They have no caption or flags of their own: they follow the
//    first channel's post (approved with it, removed when the design changes).
//  - `posts.design` holds the DesignContent, option and colour scheme the picture was drawn with, so a redraw is identical.
//  - Before a design is chosen the rows exist as drafts with the copy only (`theme_id` null): that is the cache of
//    the AI copy, so coming back to the design step never calls the AI again.
//
// Writes run as the service role AFTER `requireBrandMember`; reads run as the user (row-level security).

import { createHash, randomInt, randomUUID } from 'node:crypto';
import type { V2FactCheck } from '@/lib/ai/schemas-v2';
import { requireBrandMember } from '@/lib/brand/current';
import { getBrief } from '@/lib/briefs/service';
import type { Brief } from '@/lib/briefs/types';
import { getDb, type Tx } from '@/lib/db';
import { needsCarousel, renderCarousel, slideContents, splitIntoSlides } from '@/lib/design';
import { carouselFormat, type DesignContent, type DesignFormat, type DesignOption, type SlideKind, type SlideText } from '@/lib/design/types';
import {
  GuardrailActionError,
  confirmFlag as confirmFlagText,
  removeFlagText,
  resolveRemovedSpans,
  type Flag,
} from '@/lib/guardrail';
import { fill, s } from '@/lib/i18n/strings';
import { postPoseOrDefault } from '@/lib/mascot/poses';
import { QrContentError, qrContentFor } from '@/lib/qr';
import { getStorage, type Storage } from '@/lib/storage';
import { logAction } from '@/lib/approvals/data';
import { dropQueuedItems } from '@/lib/queue/service';
import { loadCreateBrand } from './brand';
import { approvalCheck, blockersFromReport, carryDecisions, checkPosts } from './check';
import { channelFormats, contentFromBrief, designFormat, designFormats, isCarouselBrief } from './content';
import {
  BUBBLE_MAX_CHARS,
  hashtagLimitFor,
  CAPTION_MAX,
  CTA_MAX_CHARS,
  HASHTAGS_MAX,
  HEADLINE_MAX_WORDS,
  SUBLINE_MAX_WORDS,
  cleanHashtags,
  copyChannels,
  hashtagsFor,
  visibleLength,
  wordCount,
  writePostCopy,
  type PostCopyDeps,
} from './copy';
import { loadDesignAssets, renderOne, renderSlides, buildInput, saveTypeDefault, validOption, optionsFor, type DesignAssets } from './render';
import type { CreateBrand, CreatePost, DesignBlocker, DesignWords, StoredDesign } from './types';
import { DEFAULT_POST_FILTER, parsePostFilter, type PostFilter } from '@/lib/design/filter-presets';

const e = s.create.design.errors;

export type CreateErrorCode = 'brief_not_found' | 'brief_not_ready' | 'qr_blocked' | 'invalid_option' | 'not_found' | 'forbidden';

export class CreateError extends Error {
  constructor(public readonly code: CreateErrorCode) {
    super(`Create: ${code}`);
    this.name = 'CreateError';
  }
}

export interface CreateDeps {
  /** What the copy model "answers" in fixture mode. */
  copy?: PostCopyDeps;
  /** What the AI fact check "answers" in fixture mode. */
  aiFixture?: V2FactCheck | (() => V2FactCheck);
  storage?: Storage;
  now?: Date;
}

// ---------------------------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------------------------

interface Row {
  id: string;
  brand_id: string;
  brief_id: string;
  channel: string;
  post_code: string;
  status: string;
  caption: string;
  cta: string;
  hashtags: string[] | null;
  image_text: { headline?: string; subline?: string; bubble?: string; pose?: string; slides?: unknown } | null;
  photo_id: string | null;
  mascot_id: string | null;
  fact_flags: Flag[] | null;
  theme_id: string | null;
  layout_id: string | null;
  design: StoredDesign | null;
  carousel_id: string | null;
  slide_index: number | null;
  approved_at: unknown;
  created_at: unknown;
  edited_at: unknown;
  original: { fp?: string } | null;
}

const COLUMNS = `p.id::text as id, p.brand_id::text as brand_id, p.brief_id::text as brief_id, p.channel::text as channel, p.post_code,
  p.status::text as status, coalesce(p.caption, '') as caption, coalesce(p.cta, '') as cta, p.hashtags, p.image_text,
  p.photo_id::text as photo_id, p.mascot_id::text as mascot_id, p.fact_flags, p.theme_id, p.layout_id, p.design,
  p.carousel_id::text as carousel_id, p.slide_index, p.approved_at, p.created_at, p.edited_at, p.original`;

const iso = (v: unknown): string | null => (v == null ? null : v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString());

const SLIDE_KIND_SET = new Set<string>(['cover', 'point', 'proof', 'cta']);

/** The slides stored in a post's `image_text` (a carousel the owner asked for); anything malformed is dropped. */
function slidesOf(raw: unknown): SlideText[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((x): SlideText[] => {
    const o = x && typeof x === 'object' ? (x as Record<string, unknown>) : {};
    return typeof o.kind === 'string' && SLIDE_KIND_SET.has(o.kind) && typeof o.headline === 'string' ? [{ kind: o.kind as SlideKind, headline: o.headline, body: typeof o.body === 'string' ? o.body : '' }] : [];
  });
}

/** True when the post is one channel of a carousel the owner asked for: its slides are the point of it. */
export const hasSlides = (p: Pick<CreatePost, 'imageText'>): boolean => p.imageText.slides.length >= 2;

function toPost(r: Row): CreatePost {
  return {
    id: r.id,
    brandId: r.brand_id,
    briefId: r.brief_id,
    channel: r.channel,
    postCode: r.post_code,
    status: r.status,
    caption: r.caption,
    cta: r.cta,
    hashtags: r.hashtags ?? [],
    imageText: { headline: r.image_text?.headline ?? '', subline: r.image_text?.subline ?? '', bubble: r.image_text?.bubble ?? '', pose: r.image_text?.pose ?? '', slides: slidesOf(r.image_text?.slides) },
    photoId: r.photo_id,
    mascotId: r.mascot_id,
    flags: Array.isArray(r.fact_flags) ? r.fact_flags : [],
    themeId: r.theme_id,
    layoutId: r.layout_id,
    design: r.design && typeof r.design === 'object' ? r.design : null,
    carouselId: r.carousel_id,
    slideIndex: r.slide_index,
    approvedAt: iso(r.approved_at),
    createdAt: iso(r.created_at) ?? '',
    editedAt: iso(r.edited_at),
    fingerprint: typeof r.original?.fp === 'string' ? r.original.fp : null,
  };
}

/** Order the brief's channels come in. */
function byChannelOrder(posts: CreatePost[], channels: readonly string[]): CreatePost[] {
  const rank = (c: string) => {
    const i = channels.indexOf(c);
    return i < 0 ? 99 : i;
  };
  return [...posts].sort((a, b) => rank(a.channel) - rank(b.channel) || a.createdAt.localeCompare(b.createdAt));
}

/**
 * The posts of a brief, one per channel in the brief's channel order (as the signed-in user: another brand's
 * posts are never returned). `slides: true` also returns the carousel slides, after the main posts.
 */
export async function listBriefPosts(userId: string, brandId: string, briefId: string, opts: { slides?: boolean } = {}): Promise<CreatePost[]> {
  await requireBrandMember(userId, brandId);
  const rows = await getDb().withUser(userId, (tx) =>
    tx.query<Row>(
      `select ${COLUMNS} from public.posts p
        where p.brand_id = $1 and p.brief_id = $2 ${opts.slides ? '' : 'and p.carousel_id is null'}
        order by p.carousel_id nulls first, p.slide_index nulls first, p.created_at, p.id`,
      [brandId, briefId],
    ),
  );
  const posts = rows.map(toPost);
  const main = posts.filter((p) => p.carouselId === null);
  const brief = await getBrief(userId, brandId, briefId);
  return [...byChannelOrder(main, brief?.channels ?? []), ...posts.filter((p) => p.carouselId !== null)];
}

/** One post of the brand (as the user), or null. */
export async function getPost(userId: string, brandId: string, postId: string): Promise<CreatePost | null> {
  await requireBrandMember(userId, brandId);
  const [row] = await getDb().withUser(userId, (tx) =>
    tx.query<Row>(`select ${COLUMNS} from public.posts p where p.id = $1 and p.brand_id = $2 and p.brief_id is not null`, [postId, brandId]),
  );
  return row ? toPost(row) : null;
}

/** The colour filter a post's pictures were drawn with ("none" for a post without a design or from before filters). */
export const filterOf = (p: CreatePost | undefined | null): PostFilter => (p?.design?.filter ? parsePostFilter(p.design.filter) : DEFAULT_POST_FILTER);

/** The words on the picture, as stored on a post. */
export const wordsOf = (p: CreatePost): DesignWords => ({ headline: p.imageText.headline, subline: p.imageText.subline, ctaText: p.cta, bubble: p.imageText.bubble });

const storedImageText = (w: { headline: string; subline: string; bubble: string; pose: string; slides?: SlideText[] }): Record<string, unknown> => ({
  headline: w.headline,
  subline: w.subline,
  ...(w.bubble ? { bubble: w.bubble } : {}),
  ...(w.pose ? { pose: w.pose } : {}),
  ...(w.slides && w.slides.length > 0 ? { slides: w.slides } : {}),
});

const CODE_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';
/** 7 random characters from [a-z0-9] (posts.post_code, the post's short link). */
export function newPostCode(): string {
  let code = '';
  for (let i = 0; i < 7; i++) code += CODE_CHARS[randomInt(CODE_CHARS.length)];
  return code;
}

async function readyBrief(userId: string, brandId: string, briefId: string): Promise<Brief> {
  await requireBrandMember(userId, brandId);
  const brief = await getBrief(userId, brandId, briefId);
  if (!brief) throw new CreateError('brief_not_found');
  if (brief.status !== 'ready') throw new CreateError('brief_not_ready');
  return brief;
}

// ---------------------------------------------------------------------------------------------
// The copy: written once, cached as draft posts
// ---------------------------------------------------------------------------------------------

export interface DraftResult {
  brief: Brief;
  brand: CreateBrand;
  /** One per channel, in the brief's order. */
  posts: CreatePost[];
  /** True when this call wrote the copy (and called the AI). */
  created: boolean;
}

/**
 * Which version of the brief a post's words were written for: its type, selling points (with their wording, details
 * and confirmations), CTA, QR, dates, channels, language and notes. The photo and the lines shown are left out: the
 * quick edits change those in place and the words do not depend on them.
 */
export function briefFingerprint(b: Brief): string {
  const usps = b.uspSnapshot.map((u) => [u.uspId, u.kind, u.title, u.details, u.confirmed, u.role]);
  const key = JSON.stringify([b.postType, usps, b.cta, b.qr, b.startsOn, b.endsOn, b.openEnded, b.channels, b.language, b.notes, ...(b.extraPostTypes?.length ? [b.extraPostTypes] : []), ...(b.contentFormat && b.contentFormat !== 'post' ? [b.contentFormat, b.slideCount ?? null] : [])]);
  return createHash('sha256').update(key).digest('hex').slice(0, 16);
}

/** Deletes every post of a brief (carousel slides too) with their pictures. */
async function discardPosts(brandId: string, briefId: string, storage: Storage): Promise<void> {
  const ids = await getDb().withService(async (tx) => {
    const rows = await tx.query<{ id: string }>('select id::text as id from public.posts where brief_id = $1 and brand_id = $2', [briefId, brandId]);
    await tx.query('delete from public.posts where brief_id = $1 and brand_id = $2', [briefId, brandId]);
    return rows.map((r) => r.id);
  });
  await Promise.all(ids.map((id) => storage.removePrefix('renders', `${brandId}/${id}`).catch(() => 0)));
}

const inflight = new Map<string, Promise<DraftResult>>();

/**
 * The brief's posts, writing the copy on the first call only: one AI call for the words, one for the fact check
 * of every channel's post, then one draft `posts` row per channel with its flags. Later calls return the rows.
 * If the brief's details changed since the words were written (`briefFingerprint`), the old posts are replaced by new ones.
 * Throws CreateError('brief_not_ready' | 'qr_blocked'), PostCopyError, DailyCapError, WeeklyCapError.
 * A payment QR whose ID is not active blocks here (`qr_blocked`), before any AI is paid for.
 */
export async function ensureDraftPosts(args: { userId: string; brandId: string; briefId: string }, deps: CreateDeps = {}): Promise<DraftResult> {
  const key = `${args.brandId}:${args.briefId}`;
  const running = inflight.get(key);
  if (running) return running;
  const run = ensureDraftPostsOnce(args, deps).finally(() => inflight.delete(key));
  inflight.set(key, run);
  return run;
}

async function ensureDraftPostsOnce(args: { userId: string; brandId: string; briefId: string }, deps: CreateDeps): Promise<DraftResult> {
  const { userId, brandId, briefId } = args;
  const brief = await readyBrief(userId, brandId, briefId);
  const brand = await loadCreateBrand(userId, brandId);
  const fingerprint = briefFingerprint(brief);
  const existing = await listBriefPosts(userId, brandId, briefId);
  if (existing.length > 0) {
    if (existing[0].fingerprint === null || existing[0].fingerprint === fingerprint) return { brief, brand, posts: existing, created: false };
    // The details changed since the words were written: write them again (the owner's earlier edits were for the old details).
    await discardPosts(brandId, briefId, deps.storage ?? getStorage());
  }

  if (brief.qr) {
    try {
      await qrContentFor(brief.qr, { brandId, postCode: 'preview0' });
    } catch (err) {
      if (err instanceof QrContentError) throw new CreateError('qr_blocked');
      throw err;
    }
  }
  const assets = await loadDesignAssets({ userId, brandId, brief, brand, storage: deps.storage });
  const { copy } = await writePostCopy({ userId, brandId, brief, brand, mascot: assets.faceOn, face: assets.face, now: deps.now }, deps.copy);
  const channels = copyChannels(brief);
  const words: DesignWords = { headline: copy.headline, subline: copy.subline, ctaText: copy.ctaText, bubble: copy.bubble };
  const inputs = channels.map((c) => ({ channel: c, caption: copy.captions[c], hashtags: hashtagsFor(c, copy.hashtags) }));
  const results = await checkPosts({ userId, brandId, brief, brand, words, posts: inputs, now: deps.now, aiFixture: deps.aiFixture, slides: copy.slides });
  const language = brief.language ?? brand.language;
  const pose = assets.faceOn ? copy.pose : '';

  const created = await getDb().withService(async (tx) => {
    await tx.query('select id from public.post_briefs where id = $1 and brand_id = $2 for update', [briefId, brandId]);
    const [have] = await tx.query<{ n: number }>('select count(*)::int as n from public.posts where brief_id = $1 and brand_id = $2 and carousel_id is null', [briefId, brandId]);
    if ((have?.n ?? 0) > 0) return false; // another request wrote it first
    for (let i = 0; i < channels.length; i++) {
      const text = { headline: words.headline, subline: words.subline, bubble: assets.faceOn ? words.bubble : '', pose, slides: copy.slides };
      // `original` is the base version "Undo all" goes back to: the generated words and their flags (the design is added when first chosen).
      const original = { caption: inputs[i].caption, cta: words.ctaText, hashtags: inputs[i].hashtags, image_text: storedImageText(text), fixes: copy.fixes, fp: fingerprint, flags: results[i].flags };
      await insertPost(tx, {
        brandId,
        userId,
        briefId,
        channel: channels[i],
        language,
        caption: inputs[i].caption,
        cta: words.ctaText,
        hashtags: inputs[i].hashtags,
        imageText: storedImageText(text),
        photoId: brief.photoId,
        mascotId: assets.mascotId,
        flags: results[i].flags,
        original,
      });
    }
    return true;
  });
  const posts = await listBriefPosts(userId, brandId, briefId);
  return { brief, brand, posts, created };
}

interface NewPost {
  brandId: string;
  userId: string;
  briefId: string;
  channel: string;
  language: string;
  caption: string;
  cta: string;
  hashtags: string[];
  imageText: Record<string, unknown>;
  photoId: string | null;
  mascotId: string | null;
  flags: Flag[];
  original?: unknown;
  carouselId?: string;
  slideIndex?: number;
  themeId?: string;
  layoutId?: string;
  design?: StoredDesign;
}

async function insertPost(tx: Tx, p: NewPost): Promise<string> {
  const id = randomUUID();
  for (let tries = 0; tries < 8; tries++) {
    const ins = await tx.query<{ id: string }>(
      `insert into public.posts (id, brand_id, created_by, brief_id, status, post_code, channel, post_language, caption, cta, hashtags,
                                 image_text, photo_id, fact_flags, original, mascot_id, carousel_id, slide_index, theme_id, layout_id, design)
       values ($1, $2, $3::uuid, $4, 'draft', $5, $6::public.post_channel, $7, $8, $9, $10::text[], $11::jsonb, $12::uuid, $13::jsonb, $14::jsonb, $15::uuid,
               $16::uuid, $17::smallint, $18, $19, $20::jsonb)
       on conflict (post_code) do nothing
       returning id::text as id`,
      [
        id, p.brandId, p.userId, p.briefId, newPostCode(), p.channel, p.language, p.caption, p.cta, p.hashtags, JSON.stringify(p.imageText), p.photoId,
        JSON.stringify(p.flags), p.original === undefined ? null : JSON.stringify(p.original), p.mascotId, p.carouselId ?? null, p.slideIndex ?? null,
        p.themeId ?? null, p.layoutId ?? null, p.design ? JSON.stringify(p.design) : null,
      ],
    );
    if (ins[0]) return id;
  }
  throw new Error('Could not make a unique post code');
}

// ---------------------------------------------------------------------------------------------
// Quick edits of the words (G-6): checked again by the guardrail
// ---------------------------------------------------------------------------------------------

export interface CopyEdit {
  headline?: string;
  subline?: string;
  ctaText?: string;
  bubble?: string;
  /** New caption per channel. */
  captions?: Record<string, string>;
  /** Comma or space separated; the same tags on every channel (each keeps as many as it takes). */
  hashtags?: string;
  /** Comma or space separated, per channel: the review step edits one channel's hashtags at a time. Wins over `hashtags`. */
  hashtagsByChannel?: Record<string, string>;
}

export type SaveCopyResult = { ok: true; posts: CreatePost[]; changed: boolean } | { ok: false; errors: string[] };

const oneLine = (t: string) => t.replace(/\s+/g, ' ').trim();

/** The owner's own text, checked for length. Returns one sentence per problem. */
export function checkCopyEdit(edit: CopyEdit, language: string, channels: readonly string[]): string[] {
  const errors: string[] = [];
  if (edit.headline !== undefined) {
    const h = oneLine(edit.headline);
    if (!h) errors.push(e.headlineEmpty);
    else if (wordCount(h, language) > HEADLINE_MAX_WORDS) errors.push(fill(e.headlineLong, { max: HEADLINE_MAX_WORDS }));
  }
  if (edit.subline !== undefined && wordCount(oneLine(edit.subline), language) > SUBLINE_MAX_WORDS) errors.push(fill(e.sublineLong, { max: SUBLINE_MAX_WORDS }));
  if (edit.ctaText !== undefined && visibleLength(oneLine(edit.ctaText)) > CTA_MAX_CHARS) errors.push(fill(e.ctaLong, { max: CTA_MAX_CHARS }));
  if (edit.bubble !== undefined && visibleLength(oneLine(edit.bubble)) > BUBBLE_MAX_CHARS) errors.push(fill(e.bubbleLong, { max: BUBBLE_MAX_CHARS }));
  for (const [channel, text] of Object.entries(edit.captions ?? {})) {
    if (!channels.includes(channel)) continue;
    const label = s.create.channels.options[channel as keyof typeof s.create.channels.options] ?? channel;
    if (!text.trim()) errors.push(fill(e.captionEmpty, { channel: label }));
    else if (visibleLength(text.trim()) > (CAPTION_MAX[channel] ?? 1200)) errors.push(fill(e.captionLong, { channel: label, max: CAPTION_MAX[channel] ?? 1200 }));
  }
  if (edit.hashtags !== undefined && cleanHashtags(edit.hashtags.split(/[\s,]+/).filter(Boolean), 99).length > HASHTAGS_MAX) errors.push(fill(e.hashtagsMany, { max: HASHTAGS_MAX }));
  for (const [channel, text] of Object.entries(edit.hashtagsByChannel ?? {})) {
    if (!channels.includes(channel)) continue;
    const max = hashtagLimitFor(channel);
    if (max > 0 && cleanHashtags(text.split(/[\s,]+/).filter(Boolean), 99).length > max) errors.push(fill(e.hashtagsMany, { max }));
  }
  return errors;
}

/**
 * Saves the owner's changes to the words and checks every channel's post again (code + AI). A claim the owner
 * already confirmed stays confirmed. If a design had been used, its pictures no longer match the words, so the
 * design is cleared (the owner uses a design again); see `invalidateDesign`.
 */
export async function saveCopy(args: { userId: string; brandId: string; briefId: string; edit: CopyEdit }, deps: CreateDeps = {}): Promise<SaveCopyResult> {
  const { userId, brandId, briefId } = args;
  const { brief, brand, posts } = await ensureDraftPosts({ userId, brandId, briefId }, deps);
  const language = brief.language ?? brand.language;
  const channels = posts.map((p) => p.channel);
  const errors = checkCopyEdit(args.edit, language, channels);
  if (errors.length > 0) return { ok: false, errors };

  const first = posts[0];
  const edit = args.edit;
  const words: DesignWords = {
    headline: edit.headline === undefined ? first.imageText.headline : oneLine(edit.headline),
    subline: edit.subline === undefined ? first.imageText.subline : oneLine(edit.subline),
    ctaText: edit.ctaText === undefined ? first.cta : oneLine(edit.ctaText),
    bubble: edit.bubble === undefined ? first.imageText.bubble : oneLine(edit.bubble),
  };
  const tags = edit.hashtags === undefined ? null : cleanHashtags(edit.hashtags.split(/[\s,]+/).filter(Boolean));
  const next = posts.map((p) => {
    const own = edit.hashtagsByChannel?.[p.channel];
    return {
      post: p,
      caption: edit.captions?.[p.channel] === undefined ? p.caption : edit.captions[p.channel].replace(/\r\n/g, '\n').trim(),
      hashtags: own !== undefined ? hashtagsFor(p.channel, cleanHashtags(own.split(/[\s,]+/).filter(Boolean))) : tags === null ? p.hashtags : hashtagsFor(p.channel, tags),
    };
  });
  // The words on the picture are shared by every channel; a caption or hashtag change is only that channel's.
  const pictureChanged = posts.some((p) => p.imageText.headline !== words.headline || p.imageText.subline !== words.subline || p.cta !== words.ctaText || p.imageText.bubble !== words.bubble);
  const ownChanged = (n: (typeof next)[number]) => n.caption !== n.post.caption || n.hashtags.join(' ') !== n.post.hashtags.join(' ');
  const changed = pictureChanged || next.some(ownChanged);
  if (!changed) return { ok: true, posts, changed: false };

  const results = await checkPosts({
    userId,
    brandId,
    brief,
    brand,
    words,
    posts: next.map((n) => ({ channel: n.post.channel, caption: n.caption, hashtags: n.hashtags })),
    now: deps.now,
    aiFixture: deps.aiFixture,
    slides: first.imageText.slides,
  });
  const now = (deps.now ?? new Date()).toISOString();
  const hadDesign = pictureChanged && posts.some((p) => p.themeId !== null); // a caption edit leaves the pictures alone
  await getDb().withService(async (tx) => {
    for (let i = 0; i < next.length; i++) {
      const n = next[i];
      if (!pictureChanged && !ownChanged(n)) continue; // another channel's caption was edited: this post and its approval stay as they are
      const flags = carryDecisions(results[i].flags, n.post.flags);
      const text = { headline: words.headline, subline: words.subline, bubble: words.bubble, pose: n.post.imageText.pose, slides: n.post.imageText.slides };
      await tx.query(
        `update public.posts set caption = $3, cta = $4, hashtags = $5::text[], image_text = $6::jsonb, fact_flags = $7::jsonb, edited_at = $8::timestamptz,
                status = 'draft', approved_at = null
          where id = $1 and brand_id = $2`,
        [n.post.id, brandId, n.caption, words.ctaText, n.hashtags, JSON.stringify(storedImageText(text)), JSON.stringify(flags), now],
      );
      await dropQueuedItems(tx, brandId, [n.post.id]); // the words changed: the approval and its slot are gone
      await logAction(tx, { via: 'dashboard', userId }, brandId, n.post.id, 'edit', { fields: 'copy' });
    }
  });
  if (hadDesign) await invalidateDesign(userId, brandId, briefId, deps);
  return { ok: true, posts: await listBriefPosts(userId, brandId, briefId), changed: true };
}

/**
 * Clears the design of a brief's posts (theme, layout, `design`, pictures, carousel slides) and sets them back
 * to draft. Called when the words, the photo or the blocks change after a design was used: the old pictures
 * would no longer match.
 */
export async function invalidateDesign(userId: string, brandId: string, briefId: string, deps: { storage?: Storage } = {}): Promise<void> {
  await requireBrandMember(userId, brandId);
  const storage = deps.storage ?? getStorage();
  const ids = await getDb().withService(async (tx) => {
    const rows = await tx.query<{ id: string }>('select id::text as id from public.posts where brief_id = $1 and brand_id = $2 and (theme_id is not null or carousel_id is not null)', [briefId, brandId]);
    if (rows.length === 0) return [];
    await dropQueuedItems(tx, brandId, rows.map((r) => r.id));
    await tx.query('delete from public.posts where brief_id = $1 and brand_id = $2 and carousel_id is not null', [briefId, brandId]);
    await tx.query(
      `delete from public.post_images where brand_id = $1 and post_id in (select id from public.posts where brief_id = $2 and brand_id = $1)`,
      [brandId, briefId],
    );
    await tx.query(
      `update public.posts set theme_id = null, layout_id = null, design = null, status = 'draft', approved_at = null
        where brief_id = $1 and brand_id = $2 and carousel_id is null`,
      [briefId, brandId],
    );
    return rows.map((r) => r.id);
  });
  await Promise.all(ids.map((id) => storage.removePrefix('renders', `${brandId}/${id}`).catch(() => 0)));
}

// ---------------------------------------------------------------------------------------------
// "Use this design": draw every picture the channels need and store it
// ---------------------------------------------------------------------------------------------

interface Drawn {
  format: DesignFormat;
  png: Buffer;
  layoutId: string;
  scheme: DesignOption['scheme'];
  dropped: string[];
  blockers: DesignBlocker[];
}

/** Draws the sizes of one post (all at once). A size that cannot be drawn is reported as a blocker, not thrown. */
async function drawPost(assets: DesignAssets, post: CreatePost, content: DesignContent, option: DesignOption, filter: PostFilter): Promise<Drawn[]> {
  const pose = postPoseOrDefault(post.imageText.pose);
  return Promise.all(
    channelFormats(post.channel).map(async (format): Promise<Drawn> => {
      try {
        const r = await renderOne(assets, { format, option, content, pose, filter });
        return { format, png: r.png, layoutId: r.layoutId, scheme: r.scheme, dropped: r.report.dropped, blockers: blockersFromReport(format, r.report) };
      } catch (err) {
        return { format, png: Buffer.alloc(0), layoutId: option.layoutId, scheme: option.scheme, dropped: [], blockers: [{ format, code: 'render_failed', detail: err instanceof Error ? err.message : String(err) }] };
      }
    }),
  );
}

interface Slide {
  index: number;
  total: number;
  kind?: SlideKind;
  png: Buffer;
  content: DesignContent;
  layoutId: string;
  scheme: DesignOption['scheme'];
  blockers: DesignBlocker[];
  dropped: string[];
}

/** C-20: one slide per extra selling point, when a post holds more than its size can show. */
async function drawCarousel(assets: DesignAssets, post: CreatePost, content: DesignContent, option: DesignOption, format: DesignFormat, filter: PostFilter): Promise<Slide[]> {
  const base = await buildInput(assets, { format, option, content, pose: postPoseOrDefault(post.imageText.pose), filter });
  const contents = splitIntoSlides(content, format);
  const details = await renderCarousel({ ...base, content });
  return details.map((d, i) => ({
    index: i,
    total: details.length,
    png: d.png,
    content: contents[i],
    layoutId: d.layoutId,
    scheme: d.scheme,
    blockers: blockersFromReport(format, d.report),
    dropped: d.report.dropped,
  }));
}

/** A carousel the owner asked for: the post's own slide words drawn as a set in the option (same theme, colours, type and character side). */
async function drawSlideSet(assets: DesignAssets, post: CreatePost, content: DesignContent, option: DesignOption, filter: PostFilter): Promise<{ format: DesignFormat; slides: Slide[] }> {
  const format = carouselFormat(post.channel);
  const words = post.imageText.slides;
  const set = await renderSlides(assets, { format, option, content, pose: postPoseOrDefault(post.imageText.pose), filter, slides: words });
  const contents = slideContents(content, words);
  return {
    format,
    slides: set.map((d, i) => ({
      index: i,
      total: set.length,
      kind: words[i].kind,
      png: d.png,
      content: contents[i],
      layoutId: d.layoutId,
      scheme: d.scheme,
      blockers: blockersFromReport(format, d.report),
      dropped: d.report.dropped,
    })),
  };
}

/** What `drawAndStore` needs: the drawn posts' contents (QR included) and the option. */
interface DrawJob {
  userId: string;
  brandId: string;
  brief: Brief;
  brand: CreateBrand;
  assets: DesignAssets;
  posts: CreatePost[];
  contents: Map<string, DesignContent>;
  option: DesignOption;
  options: DesignOption[];
  /** The colour filter every picture of the posts is drawn with. */
  filter: PostFilter;
  storage: Storage;
  /** The first time a design is chosen, remember it as the base "Undo all" goes back to. */
  storeBase?: boolean;
}

const imagePath = (brandId: string, postId: string, format: string) => `${brandId}/${postId}/${format}.png`;

/** A post's slide pictures (a set), the size they are drawn in, and the ids the slide rows get. */
interface PostSet {
  format: DesignFormat;
  slides: Slide[];
  carouselId: string;
  slideIds: string[];
}

async function drawAndStore(job: DrawJob): Promise<void> {
  const { brandId, assets, posts, option, storage } = job;
  const first = posts[0];
  const firstContent = job.contents.get(first.id)!;
  const asked = isCarouselBrief(job.brief) && posts.every(hasSlides);
  const autoSplit = !asked && needsCarousel(firstContent, channelFormats(first.channel)[0]);

  const sets = new Map<string, PostSet>();
  let drawn: Drawn[][];
  if (asked) {
    // Every channel gets its own slide set (its own QR short link), in its own size. Channels that draw the same thing share the work.
    const cache = new Map<string, Promise<{ format: DesignFormat; slides: Slide[] }>>();
    const made: { format: DesignFormat; slides: Slide[] }[] = [];
    for (const p of posts) {
      const content = job.contents.get(p.id)!;
      const key = JSON.stringify([carouselFormat(p.channel), content, p.imageText.slides, p.imageText.pose]);
      let run = cache.get(key);
      if (!run) {
        run = drawSlideSet(assets, p, content, option, job.filter);
        cache.set(key, run);
      }
      made.push(await run);
    }
    posts.forEach((p, i) => sets.set(p.id, { ...made[i], carouselId: randomUUID(), slideIds: made[i].slides.map(() => randomUUID()) }));
    // The post's own picture is the cover; the problems of all its slides are listed on the post.
    drawn = posts.map((p) => {
      const set = sets.get(p.id)!;
      const cover = set.slides[0];
      return [{ format: set.format, png: cover.png, layoutId: cover.layoutId, scheme: cover.scheme, dropped: cover.dropped, blockers: [] }];
    });
  } else {
    const [all, slides] = await Promise.all([
      Promise.all(posts.map((p) => drawPost(assets, p, job.contents.get(p.id)!, option, job.filter))),
      autoSplit ? drawCarousel(assets, first, firstContent, option, channelFormats(first.channel)[0], job.filter) : Promise.resolve([] as Slide[]),
    ]);
    drawn = all;
    if (slides.length > 1) sets.set(first.id, { format: channelFormats(first.channel)[0], slides, carouselId: randomUUID(), slideIds: slides.map(() => randomUUID()) });
  }

  // A realistic AI person on the picture: the design remembers it so publishing can add the AI disclosure (F-7).
  const aiFace = assets.faceOn && assets.face?.kind === 'photoreal' ? { aiFace: true as const } : {};

  // Files first (a failed write leaves rows untouched), then rows.
  const formatsOf = (i: number) => (asked ? [sets.get(posts[i].id)!.format] : channelFormats(posts[i].channel));
  for (let i = 0; i < posts.length; i++) {
    for (const d of drawn[i]) if (d.png.length > 0) await storage.put('renders', imagePath(brandId, posts[i].id, d.format), d.png, 'image/png');
  }
  for (const set of sets.values()) {
    for (let k = 0; k < set.slides.length; k++) await storage.put('renders', imagePath(brandId, set.slideIds[k], set.format), set.slides[k].png, 'image/png');
  }

  const oldSlides = await getDb().withService(async (tx) => {
    const old = await tx.query<{ id: string }>('select id::text as id from public.posts where brief_id = $1 and brand_id = $2 and carousel_id is not null', [job.brief.id, brandId]);
    await tx.query('delete from public.posts where brief_id = $1 and brand_id = $2 and carousel_id is not null', [job.brief.id, brandId]);
    const language = assets.language;

    for (let i = 0; i < posts.length; i++) {
      const p = posts[i];
      const content = job.contents.get(p.id)!;
      const head = drawn[i][0];
      const set = sets.get(p.id);
      const blockers = [...drawn[i].flatMap((d) => d.blockers), ...(set ? set.slides.flatMap((sl) => sl.blockers) : [])];
      const dropped: StoredDesign['dropped'] = {};
      for (const d of drawn[i]) dropped[d.format] = d.dropped;
      const design: StoredDesign = {
        v: 1,
        content,
        scheme: head.scheme,
        option,
        options: job.options,
        formats: formatsOf(i),
        dropped,
        blockers,
        ...(set ? { carousel: { id: set.carouselId, slides: set.slides.length } } : {}),
        language,
        photoId: job.brief.photoId,
        ...aiFace,
        filter: job.filter,
      };
      await tx.query(
        `update public.posts set theme_id = $3, layout_id = $4, design = $5::jsonb, mascot_id = $6::uuid, photo_id = $7::uuid,
                status = 'draft', approved_at = null, skipped_at = null
          where id = $1 and brand_id = $2`,
        [p.id, brandId, option.themeId, head.layoutId, JSON.stringify(design), assets.mascotId, job.brief.photoId],
      );
      await dropQueuedItems(tx, brandId, [p.id]); // drawn again: it has to be approved again
      if (job.storeBase) {
        // The first design chosen is the base version (with the generated words kept in `original`): "Undo all" draws it again. Never overwritten.
        await tx.query(
          `update public.posts set original = jsonb_set(coalesce(original, '{}'::jsonb), '{design}', $3::jsonb, true)
            where id = $1 and brand_id = $2 and (original is null or original->'design' is null)`,
          [p.id, brandId, JSON.stringify({ option, options: job.options })],
        );
      }
      const kept = drawn[i].filter((d) => d.png.length > 0).map((d) => d.format);
      await tx.query('delete from public.post_images where post_id = $1 and brand_id = $2 and not (format::text = any($3::text[]))', [p.id, brandId, kept]);
      for (const d of drawn[i]) {
        if (d.png.length === 0) continue;
        await tx.query(
          `insert into public.post_images (post_id, brand_id, format, template_id, image_path)
           values ($1, $2, $3::public.image_format, $4, $5)
           on conflict (post_id, format) do update set template_id = excluded.template_id, image_path = excluded.image_path, updated_at = now()`,
          [p.id, brandId, d.format, d.layoutId, `renders/${imagePath(brandId, p.id, d.format)}`],
        );
      }

      // The carousel's slides: extra rows of this channel's post, each with its one picture.
      if (!set) continue;
      const ownText = { headline: p.imageText.headline, subline: p.imageText.subline, bubble: p.imageText.bubble, pose: p.imageText.pose };
      for (let k = 0; k < set.slides.length; k++) {
        const sl = set.slides[k];
        const slideDesign: StoredDesign = {
          v: 1,
          content: sl.content,
          scheme: sl.scheme,
          option,
          options: job.options,
          formats: [set.format],
          dropped: { [set.format]: sl.dropped },
          blockers: sl.blockers,
          slide: { index: sl.index, total: sl.total, ...(sl.kind ? { kind: sl.kind } : {}) },
          language,
          photoId: job.brief.photoId,
          ...aiFace,
          filter: job.filter,
        };
        const id = set.slideIds[k];
        await tx.query(
          `insert into public.posts (id, brand_id, created_by, brief_id, status, post_code, channel, post_language, caption, cta, hashtags, image_text,
                                     photo_id, fact_flags, mascot_id, carousel_id, slide_index, theme_id, layout_id, design)
           values ($1, $2, $3::uuid, $4, 'draft', $5, $6::public.post_channel, $7, $8, $9, $10::text[], $11::jsonb, $12::uuid, '[]'::jsonb, $13::uuid,
                   $14::uuid, $15::smallint, $16, $17, $18::jsonb)`,
          [
            id, brandId, job.userId, job.brief.id, await freeCode(tx), p.channel, language, p.caption, p.cta, p.hashtags,
            JSON.stringify(storedImageText({ ...ownText, headline: sl.content.headline, subline: sl.content.subline })), job.brief.photoId, assets.mascotId, set.carouselId,
            k, option.themeId, sl.layoutId, JSON.stringify(slideDesign),
          ],
        );
        await tx.query(
          `insert into public.post_images (post_id, brand_id, format, template_id, image_path) values ($1, $2, $3::public.image_format, $4, $5)`,
          [id, brandId, set.format, sl.layoutId, `renders/${imagePath(brandId, id, set.format)}`],
        );
      }
    }
    return old.map((r) => r.id);
  });
  await Promise.all(oldSlides.map((id) => storage.removePrefix('renders', `${brandId}/${id}`).catch(() => 0)));
  // A format the channels no longer need loses its file too.
  for (let i = 0; i < posts.length; i++) {
    const keep = new Set(drawn[i].filter((d) => d.png.length > 0).map((d) => d.format));
    for (const f of ['square', 'portrait', 'vertical', 'landscape', 'thumbnail', 'banner'] as const) {
      if (!keep.has(f)) await storage.remove('renders', imagePath(brandId, posts[i].id, f)).catch(() => undefined);
    }
  }
}

async function freeCode(tx: Tx): Promise<string> {
  for (let i = 0; i < 8; i++) {
    const code = newPostCode();
    const [hit] = await tx.query<{ n: number }>('select count(*)::int as n from public.posts where post_code = $1', [code]);
    if ((hit?.n ?? 0) === 0) return code;
  }
  throw new Error('Could not make a unique post code');
}

export interface UseDesignResult {
  posts: CreatePost[];
  slides: CreatePost[];
  /** Everything that stops approval, across the posts. */
  blockers: DesignBlocker[];
}

/**
 * "Use this design" (G-5, G-6, G-7): draws every size each channel needs (plus the carousel when the brief has
 * more points than a size holds), stores the pictures and the design, and makes the option the default for this
 * type of post. The posts stay drafts. Throws CreateError('invalid_option') for an option that does not exist.
 */
export async function chooseDesign(args: { userId: string; brandId: string; briefId: string; option: DesignOption; filter?: PostFilter }, deps: CreateDeps = {}): Promise<UseDesignResult> {
  const { userId, brandId, briefId } = args;
  const { brief, brand, posts } = await ensureDraftPosts({ userId, brandId, briefId }, deps);
  const storage = deps.storage ?? getStorage();
  const assets = await loadDesignAssets({ userId, brandId, brief, brand, storage });
  const formats = designFormats(brief);
  if (!validOption(args.option, formats, !!assets.photo)) throw new CreateError('invalid_option');

  const contents = new Map<string, DesignContent>();
  for (const p of posts) {
    try {
      contents.set(p.id, await contentFromBrief(brief, brand, wordsOf(p), { postCode: p.postCode, mascot: assets.faceOn }));
    } catch (err) {
      if (err instanceof QrContentError) throw new CreateError('qr_blocked'); // a payment ID that is not confirmed never reaches a picture
      throw err;
    }
  }
  const options = optionsFor(assets, contents.get(posts[0].id)!, designFormat(brief), 3, { postType: brief.postType, extras: brief.extraPostTypes });
  // The filter the owner picked on the design step; else the one the posts already have (choosing another layout keeps it).
  const filter = args.filter ? parsePostFilter(args.filter) : filterOf(posts[0]);
  await drawAndStore({ userId, brandId, brief, brand, assets, posts, contents, option: args.option, options, filter, storage, storeBase: true });
  await saveTypeDefault(userId, brandId, brief.postType, { themeId: args.option.themeId, layoutId: args.option.layoutId, scheme: args.option.scheme });
  return summary(userId, brandId, briefId);
}

async function summary(userId: string, brandId: string, briefId: string): Promise<UseDesignResult> {
  const all = await listBriefPosts(userId, brandId, briefId, { slides: true });
  const posts = all.filter((p) => p.carouselId === null);
  const slides = all.filter((p) => p.carouselId !== null);
  return { posts, slides, blockers: all.flatMap((p) => p.design?.blockers ?? []) };
}

/**
 * Draws the posts again from what is stored (after the words of a design changed, e.g. a flagged phrase was
 * removed): same option and scheme, new text. Posts without a design are left alone.
 */
export async function redrawPosts(args: { userId: string; brandId: string; briefId: string; base?: { option: DesignOption; options: DesignOption[] }; filter?: PostFilter }, deps: CreateDeps = {}): Promise<boolean> {
  const { userId, brandId, briefId } = args;
  const { brief, brand, posts } = await ensureDraftPosts({ userId, brandId, briefId }, deps);
  const designed = posts.filter((p) => p.design && p.themeId);
  if (designed.length === 0 || designed.length !== posts.length) return false;
  const storage = deps.storage ?? getStorage();
  const assets = await loadDesignAssets({ userId, brandId, brief, brand, storage });
  const stored = designed[0].design!;
  const contents = new Map<string, DesignContent>();
  for (const p of designed) {
    const c = p.design!.content;
    contents.set(p.id, {
      ...c,
      headline: p.imageText.headline,
      subline: p.imageText.subline,
      cta: c.cta ? { ...c.cta, text: p.cta } : null,
      bubble: assets.faceOn ? p.imageText.bubble : '',
    });
  }
  await drawAndStore({ userId, brandId, brief, brand, assets, posts: designed, contents, option: args.base?.option ?? stored.option, options: args.base?.options ?? stored.options, filter: args.filter ? parsePostFilter(args.filter) : filterOf(designed[0]), storage });
  // Sizes the owner designed in the Design Studio are drawn from their own documents again.
  if (designed.some((p) => p.design?.studio)) await (await import('@/lib/studio/service')).restampStudio(userId, brandId, briefId);
  return true;
}

// ---------------------------------------------------------------------------------------------
// Review: flags, approval, undo, share log
// ---------------------------------------------------------------------------------------------

export type OpFailure = { ok: false; code: 'not_found' | 'blocked' | 'design' | 'posted' | 'invalid' | 'ack_required' | 'must_edit' | 'not_open' | 'cannot_remove' | 'not_approved'; message: string; flags?: Flag[]; blockers?: DesignBlocker[] };
export type OpResult<T = object> = ({ ok: true } & T) | OpFailure;

const fail = (code: OpFailure['code'], message: string, extra: Partial<OpFailure> = {}): OpFailure => ({ ok: false, code, message, ...extra });

const eA = s.approvals.errors;
const flagFailure = (err: GuardrailActionError): OpFailure => {
  switch (err.code) {
    case 'not_found':
      return fail('not_found', eA.flagNotFound);
    case 'not_open':
      return fail('not_open', eA.flagNotOpen);
    case 'ack_required':
      return fail('ack_required', eA.ackRequired);
    case 'must_edit':
      return fail('must_edit', eA.mustEdit);
    default:
      return fail('cannot_remove', eA.cannotRemove);
  }
};

async function loadMain(tx: Tx, brandId: string, postId: string, lock = true): Promise<CreatePost | null> {
  const [row] = await tx.query<Row>(
    `select ${COLUMNS} from public.posts p where p.id = $1 and p.brand_id = $2 and p.brief_id is not null and p.carousel_id is null${lock ? ' for update of p' : ''}`,
    [postId, brandId],
  );
  return row ? toPost(row) : null;
}

/**
 * After an edit: open flags whose text is gone from their field become removed. A flag on a carousel slide looks in that slide's
 * headline (field headline) or body (field subline); the others look in the post's own fields.
 */
function resolveFlagSpans(post: { caption: string; cta: string; image_text: CreatePost['imageText'] }, flags: Flag[], now: Date): Flag[] {
  const own = resolveRemovedSpans(post, flags.filter((f) => f.slide === undefined), now);
  const decided = now.toISOString();
  const bySlide = flags
    .filter((f) => f.slide !== undefined)
    .map((f) => {
      const sl = post.image_text.slides[f.slide!];
      if (!sl) return f.status === 'open' ? { ...f, status: 'removed' as const, decided_at: decided } : f;
      return resolveRemovedSpans({ caption: '', cta: '', image_text: { headline: sl.headline, subline: sl.body } }, [f], now)[0];
    });
  const byId = new Map([...own, ...bySlide].map((f) => [f.id, f]));
  return flags.map((f) => byId.get(f.id) ?? f);
}

/** Fields of a flag that are drawn on the picture and so are the same on every channel's post. */
const sharedField = (f: Flag) => f.field !== 'caption';

/** "This is true" (a regulated claim needs the extra tick). A flag on the picture's words is confirmed on every channel's post. */
export async function confirmPostFlag(args: { userId: string; brandId: string; postId: string; flagId: string; regulatedAck?: boolean; now?: Date }): Promise<OpResult> {
  await requireBrandMember(args.userId, args.brandId);
  const now = args.now ?? new Date();
  return getDb().withService(async (tx): Promise<OpResult> => {
    const post = await loadMain(tx, args.brandId, args.postId);
    if (!post) return fail('not_found', eA.notFound);
    if (post.status === 'posted') return fail('posted', eA.posted);
    let flags: Flag[];
    try {
      flags = confirmFlagText(post.flags, args.flagId, { regulatedAck: args.regulatedAck === true, now });
    } catch (err) {
      if (err instanceof GuardrailActionError) return flagFailure(err);
      throw err;
    }
    const flag = post.flags.find((f) => f.id === args.flagId)!;
    await tx.query('update public.posts set fact_flags = $3::jsonb where id = $1 and brand_id = $2', [post.id, args.brandId, JSON.stringify(flags)]);
    if (post.briefId && sharedField(flag)) {
      const sibs = await tx.query<Row>(`select ${COLUMNS} from public.posts p where p.brief_id = $1 and p.brand_id = $2 and p.carousel_id is null and p.id <> $3 for update of p`, [post.briefId, args.brandId, post.id]);
      for (const sib of sibs.map(toPost)) {
        try {
          const f2 = confirmFlagText(sib.flags, args.flagId, { regulatedAck: args.regulatedAck === true, now });
          await tx.query('update public.posts set fact_flags = $3::jsonb where id = $1 and brand_id = $2', [sib.id, args.brandId, JSON.stringify(f2)]);
        } catch {
          // The same claim is not open on that channel: nothing to confirm.
        }
      }
    }
    await logAction(tx, { via: 'dashboard', userId: args.userId }, args.brandId, post.id, 'edit', { flag: flag.id, decision: 'confirm', kind: flag.kind, field: flag.field });
    return { ok: true };
  });
}

/**
 * "These are all fine" (design step): confirms every open flag of the brief's posts, one by one through `confirmPostFlag`
 * (the same path as "It's true" in Review). The owner's confirm counts as the extra tick for regulated claims. A word to avoid
 * cannot be confirmed (the words must be edited), so those stay open; `remaining` lists the ids of the open flags left.
 */
export async function confirmAllPostFlags(args: { userId: string; brandId: string; briefId: string; now?: Date }): Promise<OpResult<{ confirmed: number; remaining: string[] }>> {
  const { userId, brandId, briefId } = args;
  await requireBrandMember(userId, brandId);
  const before = (await listBriefPosts(userId, brandId, briefId)).filter((p) => p.status !== 'posted');
  if (before.length === 0) return fail('not_found', eA.notFound);
  let confirmed = 0;
  for (const post of before) {
    for (const flag of post.flags) {
      if (flag.status !== 'open' || flag.kind === 'avoid' || flag.kind === 'regulated_reminder') continue;
      const r = await confirmPostFlag({ userId, brandId, postId: post.id, flagId: flag.id, regulatedAck: true, now: args.now });
      if (r.ok) confirmed++;
      // not_open: a picture-word flag was already confirmed on this channel through another channel's post.
      else if (r.code !== 'not_open') return r;
    }
  }
  const after = await listBriefPosts(userId, brandId, briefId);
  const remaining = [...new Set(after.filter((p) => p.status !== 'posted').flatMap((p) => p.flags.filter((f) => f.status === 'open' && f.kind !== 'regulated_reminder').map((f) => f.id)))];
  return { ok: true, confirmed, remaining };
}

/**
 * "Remove": the flagged text is cut out of its field. A caption flag changes that channel's caption. A flag on the
 * picture's words (headline, subline, CTA, mascot line) changes them on every channel's post and draws the
 * pictures again.
 */
export async function removePostFlag(args: { userId: string; brandId: string; postId: string; flagId: string; now?: Date }, deps: CreateDeps = {}): Promise<OpResult<{ redrawn: boolean }>> {
  const { userId, brandId } = args;
  await requireBrandMember(userId, brandId);
  const now = args.now ?? deps.now ?? new Date();
  const out = await getDb().withService(async (tx): Promise<OpResult<{ briefId: string; shared: boolean; designed: boolean }>> => {
    const post = await loadMain(tx, brandId, args.postId);
    if (!post) return fail('not_found', eA.notFound);
    if (post.status === 'posted') return fail('posted', eA.posted);
    const flag = post.flags.find((f) => f.id === args.flagId);
    if (!flag) return fail('not_found', eA.flagNotFound);
    if (flag.status !== 'open') return fail('not_open', eA.flagNotOpen);
    // A flag on a carousel slide cuts the text out of that slide's headline or body.
    const slideAt = flag.slide;
    const slide = slideAt === undefined ? null : (post.imageText.slides[slideAt] ?? null);
    if (slideAt !== undefined && !slide) return fail('not_found', eA.flagNotFound);
    let edited;
    try {
      edited = removeFlagText({ caption: post.caption, cta: post.cta, image_text: slide ? { headline: slide.headline, subline: slide.body, bubble: '' } : post.imageText }, flag);
    } catch (err) {
      if (err instanceof GuardrailActionError) return flagFailure(err);
      throw err;
    }
    if (!edited.caption.trim() && !slide) return fail('cannot_remove', eA.removeEmptiesCaption);
    const editedSlide: SlideText | null = slide ? { ...slide, headline: edited.image_text.headline, body: edited.image_text.subline } : null;
    if (editedSlide && !editedSlide.headline.trim()) return fail('cannot_remove', eA.removeEmptiesSlide);
    const shared = sharedField(flag);
    const targets = shared
      ? (await tx.query<Row>(`select ${COLUMNS} from public.posts p where p.brief_id = $1 and p.brand_id = $2 and p.carousel_id is null for update of p`, [post.briefId, brandId])).map(toPost)
      : [post];
    for (const t of targets) {
      // The picture's words are the same on every channel, so they get the same cut; a caption is only this channel's.
      const caption = shared ? t.caption : edited.caption;
      const cta = shared ? edited.cta : t.cta;
      let text: CreatePost['imageText'] = t.imageText;
      if (editedSlide && slideAt !== undefined) text = { ...t.imageText, slides: t.imageText.slides.map((x, k) => (k === slideAt ? editedSlide : x)) };
      else if (shared) text = { ...t.imageText, headline: edited.image_text.headline, subline: edited.image_text.subline, bubble: edited.image_text.bubble ?? '' };
      const marked = t.flags.map((f) => (f.id === flag.id && f.status === 'open' ? { ...f, status: 'removed' as const, decided_at: now.toISOString() } : f));
      const flags = resolveFlagSpans({ caption: editedSlide ? t.caption : caption, cta: editedSlide ? t.cta : cta, image_text: text }, marked, now);
      await tx.query(
        `update public.posts set caption = $3, cta = $4, image_text = $5::jsonb, fact_flags = $6::jsonb, edited_at = $7::timestamptz,
                status = case when status = 'approved' then 'draft'::public.post_status else status end,
                approved_at = case when status = 'approved' then null else approved_at end
          where id = $1 and brand_id = $2`,
        [t.id, brandId, caption, cta, JSON.stringify(storedImageText(text)), JSON.stringify(flags), now.toISOString()],
      );
      await dropQueuedItems(tx, brandId, [t.id]); // an approved post goes back to draft, so it leaves the queue
    }
    await logAction(tx, { via: 'dashboard', userId }, brandId, post.id, 'edit', { flag: flag.id, decision: 'remove', kind: flag.kind, field: flag.field });
    return { ok: true, briefId: post.briefId, shared, designed: targets.some((t) => t.design !== null) };
  });
  if (!out.ok) return out;
  if (out.shared && out.designed) {
    await redrawPosts({ userId, brandId, briefId: out.briefId }, deps);
    return { ok: true, redrawn: true };
  }
  return { ok: true, redrawn: false };
}

/**
 * Approve one post (C-16): only when no flag is open (as in v2), the pictures were drawn and nothing in them is
 * blocking (text that does not fit, a QR that does not read back as intended). The carousel slides follow.
 */
export async function approveCreatePost(args: { userId: string; brandId: string; postId: string; now?: Date }): Promise<OpResult<{ changed: boolean }>> {
  await requireBrandMember(args.userId, args.brandId);
  const now = (args.now ?? new Date()).toISOString();
  return getDb().withService(async (tx): Promise<OpResult<{ changed: boolean }>> => {
    const post = await loadMain(tx, args.brandId, args.postId);
    if (!post) return fail('not_found', eA.notFound);
    if (post.status === 'posted') return fail('posted', eA.posted);
    if (post.status === 'approved') return { ok: true, changed: false };
    const check = approvalCheck(post);
    if (check.noDesign) return fail('design', s.create.review.errors.noDesign);
    if (check.flags.length > 0) return fail('blocked', eA.blocked, { flags: check.flags });
    if (check.blockers.length > 0) return fail('design', s.create.review.errors.designBlocked, { blockers: check.blockers });
    await tx.query(`update public.posts set status = 'approved', approved_at = $3::timestamptz where id = $1 and brand_id = $2`, [post.id, args.brandId, now]);
    if (post.design?.carousel) {
      await tx.query(`update public.posts set status = 'approved', approved_at = $3::timestamptz where carousel_id = $1 and brand_id = $2`, [post.design.carousel.id, args.brandId, now]);
    }
    await logAction(tx, { via: 'dashboard', userId: args.userId }, args.brandId, post.id, 'approve');
    return { ok: true, changed: true };
  });
}

/** Approved goes back to draft (then it can be changed and approved again). */
export async function undoCreateApproval(args: { userId: string; brandId: string; postId: string }): Promise<OpResult<{ changed: boolean }>> {
  await requireBrandMember(args.userId, args.brandId);
  return getDb().withService(async (tx): Promise<OpResult<{ changed: boolean }>> => {
    const post = await loadMain(tx, args.brandId, args.postId);
    if (!post) return fail('not_found', eA.notFound);
    if (post.status === 'posted') return fail('posted', eA.posted);
    if (post.status !== 'approved') return { ok: true, changed: false };
    await tx.query(`update public.posts set status = 'draft', approved_at = null where id = $1 and brand_id = $2`, [post.id, args.brandId]);
    await dropQueuedItems(tx, args.brandId, [post.id]);
    if (post.design?.carousel) await tx.query(`update public.posts set status = 'draft', approved_at = null where carousel_id = $1 and brand_id = $2`, [post.design.carousel.id, args.brandId]);
    await logAction(tx, { via: 'dashboard', userId: args.userId }, args.brandId, post.id, 'undo', { from: 'approved' });
    return { ok: true, changed: true };
  });
}

/** What `posts.original` holds (written when the words were first generated, and the design when it was first chosen). */
interface BaseVersion {
  caption?: string;
  cta?: string;
  hashtags?: string[];
  image_text?: { headline?: string; subline?: string; bubble?: string; pose?: string; slides?: unknown };
  flags?: Flag[];
  design?: { option?: DesignOption; options?: DesignOption[] };
}

/**
 * "Undo all" (review step): puts every post of the brief back to its base version: the words and flags as first generated, the
 * design as first chosen, drawn again; every edit, flag decision and approval is gone and the posts leave the queue. The brief itself
 * and its details are untouched. Refused when a post is already marked as posted. A post whose base was never stored
 * (written before this existed) gets the generated words back and keeps its current design.
 */
export async function resetToBase(args: { userId: string; brandId: string; briefId: string }, deps: CreateDeps = {}): Promise<OpResult<{ redrawn: boolean }>> {
  const { userId, brandId, briefId } = args;
  const { brief, brand, posts } = await ensureDraftPosts({ userId, brandId, briefId }, deps);
  if (posts.some((p) => p.status === 'posted')) return fail('posted', eA.posted);
  const bases = new Map<string, BaseVersion>();
  const raw = await getDb().withService((tx) => tx.query<{ id: string; original: BaseVersion | null }>('select id::text as id, original from public.posts where brief_id = $1 and brand_id = $2 and carousel_id is null', [briefId, brandId]));
  for (const r of raw) bases.set(r.id, r.original && typeof r.original === 'object' ? r.original : {});

  // Flags: the ones stored with the base; an older post has none stored, so its generated words are checked again.
  const missing = posts.filter((p) => !Array.isArray(bases.get(p.id)?.flags));
  const rechecked = new Map<string, Flag[]>();
  if (missing.length > 0) {
    const results = await checkPosts({
      userId,
      brandId,
      brief,
      brand,
      words: wordsFromBase(bases.get(missing[0].id) ?? {}, missing[0]),
      posts: missing.map((p) => ({ channel: p.channel, caption: bases.get(p.id)?.caption ?? p.caption, hashtags: bases.get(p.id)?.hashtags ?? p.hashtags })),
      now: deps.now,
      aiFixture: deps.aiFixture,
      slides: slidesOf(bases.get(missing[0].id)?.image_text?.slides),
    });
    missing.forEach((p, i) => rechecked.set(p.id, results[i].flags));
  }

  await getDb().withService(async (tx) => {
    for (const p of posts) {
      const base = bases.get(p.id) ?? {};
      const words = wordsFromBase(base, p);
      const flags = Array.isArray(base.flags) ? base.flags : (rechecked.get(p.id) ?? []);
      const baseSlides = slidesOf(base.image_text?.slides);
      const text = { headline: words.headline, subline: words.subline, bubble: words.bubble, pose: base.image_text?.pose ?? p.imageText.pose, slides: baseSlides.length > 0 ? baseSlides : p.imageText.slides };
      await tx.query(
        `update public.posts set caption = $3, cta = $4, hashtags = $5::text[], image_text = $6::jsonb, fact_flags = $7::jsonb,
                status = 'draft', approved_at = null, skipped_at = null, edited_at = null
          where id = $1 and brand_id = $2`,
        [p.id, brandId, base.caption ?? p.caption, words.ctaText, base.hashtags ?? p.hashtags, JSON.stringify(storedImageText(text)), JSON.stringify(flags)],
      );
      await dropQueuedItems(tx, brandId, [p.id]);
      if (p.design?.carousel) await tx.query(`update public.posts set status = 'draft', approved_at = null where carousel_id = $1 and brand_id = $2`, [p.design.carousel.id, brandId]);
      await logAction(tx, { via: 'dashboard', userId }, brandId, p.id, 'undo', { from: 'all' });
    }
  });

  const designed = posts.length > 0 && posts.every((p) => p.design && p.themeId);
  if (!designed) return { ok: true, redrawn: false };
  const base = bases.get(posts[0].id)?.design;
  await redrawPosts({ userId, brandId, briefId, base: base?.option && Array.isArray(base.options) ? { option: base.option, options: base.options } : undefined }, deps);
  return { ok: true, redrawn: true };
}

function wordsFromBase(base: BaseVersion, p: CreatePost): DesignWords {
  return { headline: base.image_text?.headline ?? p.imageText.headline, subline: base.image_text?.subline ?? p.imageText.subline, ctaText: base.cta ?? p.cta, bubble: base.image_text?.bubble ?? p.imageText.bubble };
}

/** The owner shared or downloaded an approved post's picture (Copy is not recorded). */
export async function logCreateShare(args: { userId: string; brandId: string; postId: string; kind: 'share' | 'download'; format?: string }): Promise<OpResult> {
  await requireBrandMember(args.userId, args.brandId);
  return getDb().withService(async (tx): Promise<OpResult> => {
    const post = await loadMain(tx, args.brandId, args.postId, false);
    if (!post) return fail('not_found', eA.notFound);
    if (post.status !== 'approved' && post.status !== 'posted') return fail('not_approved', s.share.errors.notApproved);
    await logAction(tx, { via: 'dashboard', userId: args.userId }, args.brandId, post.id, args.kind, args.format ? { format: args.format } : {});
    return { ok: true };
  });
}


// ---------------------------------------------------------------------------------------------
// Design Studio: the owner's own design, drawn by the studio renderer
// ---------------------------------------------------------------------------------------------

export interface StudioDrawFn {
  (args: { post: CreatePost; format: DesignFormat; qrData: string | null }): Promise<{ png: Buffer; problems: string[]; aiFace?: boolean } | null>;
}

/**
 * "Use this design" from the Design Studio. The words on the picture are checked by the guardrail like any edit (the
 * flags go to Review), every size the channels need is drawn (the engine draws sizes the studio has no document for, such
 * as YouTube thumbnails), then the studio's sizes are drawn from the owner's documents and replace the engine's pictures.
 * A QR code that does not scan back exactly becomes a blocker.
 */
export async function applyStudioDesign(
  args: { userId: string; brandId: string; briefId: string; words: { headline: string; subline: string; ctaText: string }; formats: DesignFormat[]; draw: StudioDrawFn },
  deps: CreateDeps = {},
): Promise<UseDesignResult> {
  const { userId, brandId, briefId } = args;
  const { brief, brand, posts } = await ensureDraftPosts({ userId, brandId, briefId }, deps);
  const storage = deps.storage ?? getStorage();
  const first = posts[0];
  const words: DesignWords = {
    headline: oneLine(args.words.headline).slice(0, 300) || first.imageText.headline,
    subline: oneLine(args.words.subline).slice(0, 600),
    ctaText: oneLine(args.words.ctaText).slice(0, 120),
    bubble: first.imageText.bubble,
  };
  const changed = posts.some((p) => p.imageText.headline !== words.headline || p.imageText.subline !== words.subline || p.cta !== words.ctaText);
  if (changed) {
    const results = await checkPosts({ userId, brandId, brief, brand, words, posts: posts.map((p) => ({ channel: p.channel, caption: p.caption, hashtags: p.hashtags })), now: deps.now, aiFixture: deps.aiFixture });
    const now = (deps.now ?? new Date()).toISOString();
    await getDb().withService(async (tx) => {
      for (let i = 0; i < posts.length; i++) {
        const p = posts[i];
        const flags = carryDecisions(results[i].flags, p.flags);
        const text = { headline: words.headline, subline: words.subline, bubble: words.bubble, pose: p.imageText.pose, slides: p.imageText.slides };
        await tx.query(
          `update public.posts set cta = $3, image_text = $4::jsonb, fact_flags = $5::jsonb, edited_at = $6::timestamptz, status = 'draft', approved_at = null
            where id = $1 and brand_id = $2`,
          [p.id, brandId, words.ctaText, JSON.stringify(storedImageText(text)), JSON.stringify(flags), now],
        );
        await logAction(tx, { via: 'dashboard', userId }, brandId, p.id, 'edit', { fields: 'studio' });
      }
    });
  }

  // Every size first (the engine), with the brand's usual option.
  const assets = await loadDesignAssets({ userId, brandId, brief, brand, storage });
  const content0 = await contentFromBrief(brief, brand, words, { postCode: first.postCode, mascot: assets.faceOn }).catch((err) => {
    if (err instanceof QrContentError) throw new CreateError('qr_blocked');
    throw err;
  });
  const formats = designFormats(brief);
  const def = assets.typeDefault && validOption({ themeId: assets.typeDefault.themeId, layoutId: assets.typeDefault.layoutId, scheme: assets.typeDefault.scheme }, formats, !!assets.photo) ? { themeId: assets.typeDefault.themeId, layoutId: assets.typeDefault.layoutId, scheme: assets.typeDefault.scheme } : null;
  const option = def ?? optionsFor(assets, content0, designFormat(brief), 1, { postType: brief.postType, extras: brief.extraPostTypes })[0];
  await chooseDesign({ userId, brandId, briefId, option }, deps);

  // Then the studio's own sizes, per channel post (each has its own QR short link).
  const fresh = await listBriefPosts(userId, brandId, briefId);
  for (const p of fresh) {
    const content = await contentFromBrief(brief, brand, wordsOf(p), { postCode: p.postCode, mascot: assets.faceOn });
    const studioBlockers: DesignBlocker[] = [];
    const drawnFormats: DesignFormat[] = [];
    let studioAi = false;
    for (const f of channelFormats(p.channel)) {
      if (!args.formats.includes(f)) continue;
      const r = await args.draw({ post: p, format: f, qrData: content.qr?.text ?? null });
      if (!r) continue;
      await storage.put('renders', `${brandId}/${p.id}/${f}.png`, r.png, 'image/png');
      drawnFormats.push(f);
      if (r.aiFace) studioAi = true;
      for (const problem of r.problems) studioBlockers.push({ format: f, code: 'qr_mismatch', detail: problem });
    }
    if (drawnFormats.length === 0 || !p.design) continue;
    // A realistic AI person on a studio picture (or on a size the engine drew) makes the caption carry the AI disclosure.
    const { aiFace: engineAi, ...rest } = p.design;
    const keepsEngine = engineAi === true && channelFormats(p.channel).some((f) => !drawnFormats.includes(f));
    const design = {
      ...rest,
      ...(studioAi || keepsEngine ? { aiFace: true as const } : {}),
      studio: { formats: drawnFormats },
      blockers: [...p.design.blockers.filter((b) => !drawnFormats.includes(b.format)), ...studioBlockers],
      dropped: Object.fromEntries(Object.entries(p.design.dropped).map(([k, v]) => [k, drawnFormats.includes(k as DesignFormat) ? [] : v])),
    };
    await getDb().withService((tx) => tx.query('update public.posts set design = $3::jsonb, layout_id = $4 where id = $1 and brand_id = $2', [p.id, brandId, JSON.stringify(design), 'studio']));
  }
  return summary(userId, brandId, briefId);
}
