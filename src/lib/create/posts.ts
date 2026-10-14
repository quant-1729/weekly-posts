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
import { needsCarousel, renderCarousel, splitIntoSlides } from '@/lib/design';
import type { DesignContent, DesignFormat, DesignOption } from '@/lib/design/types';
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
import { briefFormats, channelFormats, contentFromBrief, primaryFormat } from './content';
import {
  BUBBLE_MAX_CHARS,
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
import { loadDesignAssets, renderOne, buildInput, saveTypeDefault, validOption, optionsFor, type DesignAssets } from './render';
import type { CreateBrand, CreatePost, DesignBlocker, DesignWords, StoredDesign } from './types';

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
  image_text: { headline?: string; subline?: string; bubble?: string; pose?: string } | null;
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
    imageText: { headline: r.image_text?.headline ?? '', subline: r.image_text?.subline ?? '', bubble: r.image_text?.bubble ?? '', pose: r.image_text?.pose ?? '' },
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

/** The words on the picture, as stored on a post. */
export const wordsOf = (p: CreatePost): DesignWords => ({ headline: p.imageText.headline, subline: p.imageText.subline, ctaText: p.cta, bubble: p.imageText.bubble });

const storedImageText = (w: { headline: string; subline: string; bubble: string; pose: string }): Record<string, string> => ({
  headline: w.headline,
  subline: w.subline,
  ...(w.bubble ? { bubble: w.bubble } : {}),
  ...(w.pose ? { pose: w.pose } : {}),
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
  const key = JSON.stringify([b.postType, usps, b.cta, b.qr, b.startsOn, b.endsOn, b.openEnded, b.channels, b.language, b.notes]);
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
  const { copy } = await writePostCopy({ userId, brandId, brief, brand, mascot: assets.mascotId !== null, now: deps.now }, deps.copy);
  const channels = copyChannels(brief);
  const words: DesignWords = { headline: copy.headline, subline: copy.subline, ctaText: copy.ctaText, bubble: copy.bubble };
  const inputs = channels.map((c) => ({ channel: c, caption: copy.captions[c], hashtags: hashtagsFor(c, copy.hashtags) }));
  const results = await checkPosts({ userId, brandId, brief, brand, words, posts: inputs, now: deps.now, aiFixture: deps.aiFixture });
  const language = brief.language ?? brand.language;
  const pose = assets.mascotId ? copy.pose : '';

  const created = await getDb().withService(async (tx) => {
    await tx.query('select id from public.post_briefs where id = $1 and brand_id = $2 for update', [briefId, brandId]);
    const [have] = await tx.query<{ n: number }>('select count(*)::int as n from public.posts where brief_id = $1 and brand_id = $2 and carousel_id is null', [briefId, brandId]);
    if ((have?.n ?? 0) > 0) return false; // another request wrote it first
    for (let i = 0; i < channels.length; i++) {
      const text = { headline: words.headline, subline: words.subline, bubble: assets.mascotId ? words.bubble : '', pose };
      const original = { caption: inputs[i].caption, cta: words.ctaText, hashtags: inputs[i].hashtags, image_text: storedImageText(text), fixes: copy.fixes, fp: fingerprint };
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
  imageText: Record<string, string>;
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
  /** Comma or space separated. */
  hashtags?: string;
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
  const next = posts.map((p) => ({
    post: p,
    caption: edit.captions?.[p.channel] === undefined ? p.caption : edit.captions[p.channel].replace(/\r\n/g, '\n').trim(),
    hashtags: tags === null ? p.hashtags : hashtagsFor(p.channel, tags),
  }));
  const changed = next.some((n) => n.caption !== n.post.caption || n.hashtags.join(' ') !== n.post.hashtags.join(' ')) || posts.some((p) => p.imageText.headline !== words.headline || p.imageText.subline !== words.subline || p.cta !== words.ctaText || p.imageText.bubble !== words.bubble);
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
  });
  const now = (deps.now ?? new Date()).toISOString();
  const hadDesign = posts.some((p) => p.themeId !== null);
  await getDb().withService(async (tx) => {
    for (let i = 0; i < next.length; i++) {
      const n = next[i];
      const flags = carryDecisions(results[i].flags, n.post.flags);
      const text = { headline: words.headline, subline: words.subline, bubble: words.bubble, pose: n.post.imageText.pose };
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
async function drawPost(assets: DesignAssets, post: CreatePost, content: DesignContent, option: DesignOption): Promise<Drawn[]> {
  const pose = postPoseOrDefault(post.imageText.pose);
  return Promise.all(
    channelFormats(post.channel).map(async (format): Promise<Drawn> => {
      try {
        const r = await renderOne(assets, { format, option, content, pose });
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
  png: Buffer;
  content: DesignContent;
  layoutId: string;
  scheme: DesignOption['scheme'];
  blockers: DesignBlocker[];
  dropped: string[];
}

async function drawCarousel(assets: DesignAssets, post: CreatePost, content: DesignContent, option: DesignOption, format: DesignFormat): Promise<Slide[]> {
  const base = await buildInput(assets, { format, option, content, pose: postPoseOrDefault(post.imageText.pose) });
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
  storage: Storage;
}

const imagePath = (brandId: string, postId: string, format: string) => `${brandId}/${postId}/${format}.png`;

async function drawAndStore(job: DrawJob): Promise<void> {
  const { brandId, assets, posts, option, storage } = job;
  const first = posts[0];
  const firstContent = job.contents.get(first.id)!;
  const wantCarousel = needsCarousel(firstContent, channelFormats(first.channel)[0]);

  const [drawn, slides] = await Promise.all([
    Promise.all(posts.map((p) => drawPost(assets, p, job.contents.get(p.id)!, option))),
    wantCarousel ? drawCarousel(assets, first, firstContent, option, channelFormats(first.channel)[0]) : Promise.resolve([] as Slide[]),
  ]);

  // Files first (a failed write leaves rows untouched), then rows.
  const carouselId = slides.length > 1 ? randomUUID() : null;
  const slideIds = carouselId ? slides.map(() => randomUUID()) : [];
  const formatsOf = (i: number) => channelFormats(posts[i].channel);
  for (let i = 0; i < posts.length; i++) {
    for (const d of drawn[i]) if (d.png.length > 0) await storage.put('renders', imagePath(brandId, posts[i].id, d.format), d.png, 'image/png');
  }
  if (carouselId) for (let k = 0; k < slides.length; k++) await storage.put('renders', imagePath(brandId, slideIds[k], channelFormats(first.channel)[0]), slides[k].png, 'image/png');

  const oldSlides = await getDb().withService(async (tx) => {
    const old = await tx.query<{ id: string }>('select id::text as id from public.posts where brief_id = $1 and brand_id = $2 and carousel_id is not null', [job.brief.id, brandId]);
    await tx.query('delete from public.posts where brief_id = $1 and brand_id = $2 and carousel_id is not null', [job.brief.id, brandId]);
    const language = assets.language;

    for (let i = 0; i < posts.length; i++) {
      const p = posts[i];
      const content = job.contents.get(p.id)!;
      const head = drawn[i][0];
      const blockers = drawn[i].flatMap((d) => d.blockers);
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
        blockers: [...blockers, ...(i === 0 ? slides.flatMap((sl) => sl.blockers) : [])],
        ...(i === 0 && carouselId ? { carousel: { id: carouselId, slides: slides.length } } : {}),
        language,
        photoId: job.brief.photoId,
      };
      await tx.query(
        `update public.posts set theme_id = $3, layout_id = $4, design = $5::jsonb, mascot_id = $6::uuid, photo_id = $7::uuid,
                status = 'draft', approved_at = null, skipped_at = null
          where id = $1 and brand_id = $2`,
        [p.id, brandId, option.themeId, head.layoutId, JSON.stringify(design), assets.mascotId, job.brief.photoId],
      );
      await dropQueuedItems(tx, brandId, [p.id]); // drawn again: it has to be approved again
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
    }

    if (carouselId) {
      const fmt = channelFormats(first.channel)[0];
      for (let k = 0; k < slides.length; k++) {
        const sl = slides[k];
        const slideDesign: StoredDesign = {
          v: 1,
          content: sl.content,
          scheme: sl.scheme,
          option,
          options: job.options,
          formats: [fmt],
          dropped: { [fmt]: sl.dropped },
          blockers: sl.blockers,
          slide: { index: sl.index, total: sl.total },
          language,
          photoId: job.brief.photoId,
        };
        const id = slideIds[k];
        await tx.query(
          `insert into public.posts (id, brand_id, created_by, brief_id, status, post_code, channel, post_language, caption, cta, hashtags, image_text,
                                     photo_id, fact_flags, mascot_id, carousel_id, slide_index, theme_id, layout_id, design)
           values ($1, $2, $3::uuid, $4, 'draft', $5, $6::public.post_channel, $7, $8, $9, $10::text[], $11::jsonb, $12::uuid, '[]'::jsonb, $13::uuid,
                   $14::uuid, $15::smallint, $16, $17, $18::jsonb)`,
          [
            id, brandId, job.userId, job.brief.id, await freeCode(tx), first.channel, language, first.caption, first.cta, first.hashtags,
            JSON.stringify(storedImageText({ ...first.imageText, headline: sl.content.headline, subline: sl.content.subline })), job.brief.photoId, assets.mascotId, carouselId,
            k, option.themeId, sl.layoutId, JSON.stringify(slideDesign),
          ],
        );
        await tx.query(
          `insert into public.post_images (post_id, brand_id, format, template_id, image_path) values ($1, $2, $3::public.image_format, $4, $5)`,
          [id, brandId, fmt, sl.layoutId, `renders/${imagePath(brandId, id, fmt)}`],
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
export async function chooseDesign(args: { userId: string; brandId: string; briefId: string; option: DesignOption }, deps: CreateDeps = {}): Promise<UseDesignResult> {
  const { userId, brandId, briefId } = args;
  const { brief, brand, posts } = await ensureDraftPosts({ userId, brandId, briefId }, deps);
  const storage = deps.storage ?? getStorage();
  const assets = await loadDesignAssets({ userId, brandId, brief, brand, storage });
  const formats = briefFormats(brief.channels);
  if (!validOption(args.option, formats, !!assets.photo)) throw new CreateError('invalid_option');

  const contents = new Map<string, DesignContent>();
  for (const p of posts) {
    try {
      contents.set(p.id, await contentFromBrief(brief, brand, wordsOf(p), { postCode: p.postCode, mascot: assets.mascotId !== null }));
    } catch (err) {
      if (err instanceof QrContentError) throw new CreateError('qr_blocked'); // a payment ID that is not confirmed never reaches a picture
      throw err;
    }
  }
  const options = optionsFor(assets, contents.get(posts[0].id)!, primaryFormat(brief.channels));
  await drawAndStore({ userId, brandId, brief, brand, assets, posts, contents, option: args.option, options, storage });
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
export async function redrawPosts(args: { userId: string; brandId: string; briefId: string }, deps: CreateDeps = {}): Promise<void> {
  const { userId, brandId, briefId } = args;
  const { brief, brand, posts } = await ensureDraftPosts({ userId, brandId, briefId }, deps);
  const designed = posts.filter((p) => p.design && p.themeId);
  if (designed.length === 0 || designed.length !== posts.length) return;
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
      bubble: assets.mascotId ? p.imageText.bubble : '',
    });
  }
  await drawAndStore({ userId, brandId, brief, brand, assets, posts: designed, contents, option: stored.option, options: stored.options, storage });
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
    let edited;
    try {
      edited = removeFlagText({ caption: post.caption, cta: post.cta, image_text: post.imageText }, flag);
    } catch (err) {
      if (err instanceof GuardrailActionError) return flagFailure(err);
      throw err;
    }
    if (!edited.caption.trim()) return fail('cannot_remove', eA.removeEmptiesCaption);
    const shared = sharedField(flag);
    const targets = shared
      ? (await tx.query<Row>(`select ${COLUMNS} from public.posts p where p.brief_id = $1 and p.brand_id = $2 and p.carousel_id is null for update of p`, [post.briefId, brandId])).map(toPost)
      : [post];
    for (const t of targets) {
      // The picture's words are the same on every channel, so they get the same cut; a caption is only this channel's.
      const caption = shared ? t.caption : edited.caption;
      const cta = shared ? edited.cta : t.cta;
      const text = shared ? { ...t.imageText, headline: edited.image_text.headline, subline: edited.image_text.subline, bubble: edited.image_text.bubble ?? '' } : t.imageText;
      const marked = t.flags.map((f) => (f.id === flag.id && f.status === 'open' ? { ...f, status: 'removed' as const, decided_at: now.toISOString() } : f));
      const flags = resolveRemovedSpans({ caption, cta, image_text: text }, marked, now);
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

