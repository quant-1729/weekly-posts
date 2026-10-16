// What the design and review pages show, as plain data (safe to send to client components).
// Reads run as the signed-in user (row-level security); writes live in ./posts.ts.

import { AI_DISCLOSURE_LINE } from '@/lib/publish/caption';
import { requireBrandMember } from '@/lib/brand/current';
import { blockLines } from '@/lib/briefs/editor-state';
import type { Brief, BlockKey } from '@/lib/briefs/types';
import { getDb } from '@/lib/db';
import { listLayouts, needsCarousel } from '@/lib/design';
import type { DesignFormat, DesignOption } from '@/lib/design/types';
import type { PostFilter } from '@/lib/design/filter-presets';
import type { Flag } from '@/lib/guardrail/types';
import { getEnv } from '@/lib/env';
import { fill, s } from '@/lib/i18n/strings';
import { CAPTION_MAX, PostCopyError, hashtagLimitFor } from './copy';
import { channelFormats, contentFromBrief, designFormat, isCarouselBrief, postFormats, showsLogo } from './content';
import {
  CreateError,
  ensureDraftPosts,
  filterOf,
  listBriefPosts,
  wordsOf,
  type CreateDeps,
} from './posts';
import { loadDesignAssets, optionsFor, previewOption, previewSlides, reportLines, reportLinesForSlides, type DesignAssets } from './render';
import type { CreateBrand, CreatePost, DesignBlocker } from './types';
import { parsePostFilter } from '@/lib/design/filter-presets';
import { DailyCapError } from '@/lib/usage';
import { WeeklyCapError } from '@/lib/usage/caps';
import { QrContentError } from '@/lib/qr';

const channelLabel = (c: string): string => s.create.channels.options[c as keyof typeof s.create.channels.options] ?? c;

// ---------------------------------------------------------------------------------------------
// Design step
// ---------------------------------------------------------------------------------------------

export interface LayoutChoice {
  id: string;
  name: string;
}

export interface OptionView {
  option: DesignOption;
  /** The layout and colours the engine actually used. */
  used: DesignOption;
  /** Small JPEG as a data URL (a carousel: the cover). */
  src: string;
  /** A carousel: one small JPEG per slide, in order (the strip under the option). Absent for a single picture. */
  slides?: string[];
  lines: { noRoom: string[]; notShown: string[]; problems: string[] };
  /** The layouts of this option's theme for the shown size, for the next/previous buttons. */
  layouts: LayoutChoice[];
}

export interface BlockView {
  key: BlockKey;
  label: string;
  /** What the post shows; null when the brand does not have it yet. */
  text: string | null;
  on: boolean;
}

export interface DesignPageData {
  state: 'ready';
  briefId: string;
  brandName: string;
  format: DesignFormat;
  /** Every size the channels need. */
  formats: DesignFormat[];
  hasMascot: boolean;
  /** The post's colour filter ("none" until the owner picks one). Previews and the drawn pictures use it. */
  filter: PostFilter;
  /** A filter has something to change: the post has a photo. Without one the picture is brand-colour shapes (and at most an abstract background), so hide the filter control. */
  filterApplies: boolean;
  words: { headline: string; subline: string; ctaText: string; bubble: string };
  captions: { postId: string; channel: string; label: string; caption: string; hashtags: string[] }[];
  /** Open flags across the channels' posts (read-only here; decided in the review step). */
  flags: { flag: Flag; channels: string[] }[];
  options: OptionView[];
  /** 0..2: the option already used, if any. */
  usedIndex: number | null;
  photos: { id: string; url: string; description: string; usable: boolean }[];
  photoId: string | null;
  blocks: BlockView[];
  carousel: boolean;
  /** A carousel the owner asked for: how many slides each option has; null for a single post. */
  slideCount: number | null;
  /** The pictures were drawn already (a design was used). */
  designed: boolean;
  /** Changes whenever the words change, so client forms reset. */
  version: string;
}

export type DesignPage =
  | DesignPageData
  | { state: 'not_ready' }
  | { state: 'blocked'; message: string }
  | { state: 'error'; message: string };

const e = s.create.design.errors;

/** Words for the owner for what can go wrong before the options can be shown. */
export function describeCreateError(err: unknown): { state: 'not_ready' } | { state: 'blocked' | 'error'; message: string } | null {
  if (err instanceof CreateError) {
    if (err.code === 'brief_not_ready') return { state: 'not_ready' };
    if (err.code === 'qr_blocked') return { state: 'blocked', message: e.qrBlocked };
    if (err.code === 'invalid_option') return { state: 'error', message: e.invalidOption };
    return { state: 'error', message: e.notFound };
  }
  if (err instanceof QrContentError) return { state: 'blocked', message: e.qrBlocked };
  if (err instanceof PostCopyError) return { state: 'error', message: e.aiFailed };
  if (err instanceof WeeklyCapError) return { state: 'error', message: err.message };
  if (err instanceof DailyCapError) return { state: 'error', message: fill(s.errors.dailyCap, { cap: err.cap }) };
  return null;
}

async function optionView(assets: DesignAssets, brief: Brief, brand: CreateBrand, post: CreatePost, option: DesignOption, format: DesignFormat, filter: PostFilter): Promise<OptionView> {
  const content = await contentFromBrief(brief, brand, wordsOf(post), { postCode: post.postCode, mascot: assets.faceOn });
  if (isCarouselBrief(brief) && post.imageText.slides.length >= 2) {
    // A slide set: every slide of the option drawn together, shown as a strip.
    const set = await previewSlides(assets, { format, option, content, pose: post.imageText.pose, filter, slides: post.imageText.slides });
    return {
      option,
      used: set.used,
      src: set.srcs[0],
      slides: set.srcs,
      lines: reportLinesForSlides(set.reports),
      layouts: listLayouts(set.used.themeId, format, !!assets.photo).map((l) => ({ id: l.id, name: l.name })),
    };
  }
  const p = await previewOption(assets, { format, option, content, pose: post.imageText.pose, filter });
  return {
    option,
    used: p.used,
    src: p.src,
    lines: reportLines(p.report),
    layouts: listLayouts(p.used.themeId, format, !!assets.photo).map((l) => ({ id: l.id, name: l.name })),
  };
}

/** One option's preview, for the layout and colour buttons. Never calls the AI. */
export async function previewForOption(args: { userId: string; brandId: string; briefId: string; option: DesignOption; filter?: PostFilter }, deps: CreateDeps = {}): Promise<OptionView> {
  const { brief, brand, posts } = await ensureDraftPosts(args, deps);
  const assets = await loadDesignAssets({ userId: args.userId, brandId: args.brandId, brief, brand, storage: deps.storage });
  return optionView(assets, brief, brand, posts[0], args.option, designFormat(brief), args.filter ? parsePostFilter(args.filter) : filterOf(posts[0]));
}

/**
 * Everything the design step shows. The first visit writes the words (one AI call, cached as draft posts); later
 * visits read them. The three options are drawn now, at the first channel's main size.
 */
export async function loadDesignPage(args: { userId: string; brandId: string; briefId: string }, deps: CreateDeps = {}): Promise<DesignPage> {
  const { userId, brandId, briefId } = args;
  let draft;
  try {
    draft = await ensureDraftPosts(args, deps);
  } catch (err) {
    const known = describeCreateError(err);
    if (known) return known;
    throw err;
  }
  const { brief, brand, posts } = draft;
  const assets = await loadDesignAssets({ userId, brandId, brief, brand, storage: deps.storage });
  const format = designFormat(brief);
  const first = posts[0];
  const content = await contentFromBrief(brief, brand, wordsOf(first), { postCode: first.postCode, mascot: assets.faceOn });
  const options = optionsFor(assets, content, format, 3, { postType: brief.postType, extras: brief.extraPostTypes });
  const filter = filterOf(first);
  const views = await Promise.all(options.map((o) => optionView(assets, brief, brand, first, o, format, filter)));

  const stored = first.design?.option;
  const usedIndex = stored ? options.findIndex((o) => o.themeId === stored.themeId && o.layoutId === stored.layoutId && o.scheme === stored.scheme && (o.role ?? null) === (stored.role ?? null)) : -1;

  const flagMap = new Map<string, { flag: Flag; channels: string[] }>();
  for (const p of posts) {
    for (const f of p.flags) {
      if (f.status !== 'open' || f.kind === 'regulated_reminder') continue;
      const hit = flagMap.get(f.id);
      if (hit) hit.channels.push(p.channel);
      else flagMap.set(f.id, { flag: f, channels: [p.channel] });
    }
  }

  const photos = await getDb().withUser(userId, (tx) =>
    tx.query<{ id: string; storage_path: string; description: string | null; usable: boolean | null }>(
      `select id::text as id, storage_path, description, usable from public.photos
        where brand_id = $1 and kind = 'photo' and storage_path is not null order by (usable is false), created_at desc, id limit 30`,
      [brandId],
    ),
  );
  const lines = blockLines({ contacts: brand.contacts, hasLogo: brand.hasLogo, startsOn: brief.startsOn ?? '', endsOn: brief.endsOn ?? '' });
  const blocks: BlockView[] = lines.map((l) => ({ key: l.key, label: l.label, text: l.text, on: l.key === 'logo' ? showsLogo(brief) && l.text !== null : brief.blocks[l.key] === true && l.text !== null }));

  return {
    state: 'ready',
    briefId,
    brandName: brand.name,
    format,
    formats: isCarouselBrief(brief) ? [...new Set(posts.flatMap((p) => postFormats(p.channel, true)))] : [...new Set(posts.flatMap((p) => channelFormats(p.channel)))],
    hasMascot: assets.faceOn,
    filter,
    filterApplies: !!assets.photo,
    words: { headline: first.imageText.headline, subline: first.imageText.subline, ctaText: first.cta, bubble: first.imageText.bubble },
    captions: posts.map((p) => ({ postId: p.id, channel: p.channel, label: channelLabel(p.channel), caption: p.caption, hashtags: p.hashtags })),
    flags: [...flagMap.values()],
    options: views,
    usedIndex: usedIndex >= 0 ? usedIndex : null,
    photos: photos.map((p) => ({ id: p.id, url: `/api/files/${p.storage_path}`, description: p.description ?? '', usable: p.usable !== false })),
    photoId: brief.photoId,
    blocks,
    carousel: !isCarouselBrief(brief) && needsCarousel(content, format),
    slideCount: isCarouselBrief(brief) && first.imageText.slides.length >= 2 ? first.imageText.slides.length : null,
    designed: posts.every((p) => p.themeId !== null) && posts.length > 0,
    version: [first.editedAt ?? first.createdAt, brief.photoId ?? '', JSON.stringify(brief.blocks)].join('|'),
  };
}

// ---------------------------------------------------------------------------------------------
// Review step
// ---------------------------------------------------------------------------------------------

export interface ReviewImage {
  format: DesignFormat;
  url: string;
}

export interface ReviewPost {
  id: string;
  channel: string;
  label: string;
  status: string;
  caption: string;
  hashtags: string[];
  /** How many hashtags this channel takes (0 = none) and the longest caption, for the edit fields. */
  hashtagsMax: number;
  captionMax: number;
  cta: string;
  headline: string;
  flags: Flag[];
  openFlags: Flag[];
  reminder: boolean;
  blockers: DesignBlocker[];
  images: ReviewImage[];
  /** The carousel slides' pictures, when there is one. */
  slides: string[];
  /** The owner asked for a carousel: the post's own picture is its cover, so the slides are the whole post. */
  carouselAsked: boolean;
  /** Caption, call to action with the short link, hashtags: what Copy and Share send. */
  shareText: string;
  designed: boolean;
  canApprove: boolean;
}

export interface ReviewData {
  briefId: string;
  posts: ReviewPost[];
  allApproved: boolean;
}

/** Channels where a link in the caption is clickable. */
const CLICKABLE = new Set(['facebook', 'linkedin', 'gbp', 'whatsapp', 'youtube']);

/**
 * What Copy and Share send for a post: caption, the call to action with its short link where links work, hashtags. A post
 * that shows a realistic AI person (Brand Face, F-7) ends with the same disclosure line the publisher adds, so a post
 * the owner shares by hand says it too.
 */
export function shareTextFor(p: Pick<CreatePost, 'channel' | 'caption' | 'cta' | 'hashtags' | 'postCode'> & { aiFace?: boolean }, baseUrl: string): string {
  const link = CLICKABLE.has(p.channel) && baseUrl ? `${baseUrl.replace(/\/$/, '')}/r/${p.postCode}` : '';
  const ctaLine = [p.cta.trim(), link].filter(Boolean).join(' ');
  let caption = p.caption.trim();
  if (caption.endsWith(AI_DISCLOSURE_LINE)) caption = caption.slice(0, -AI_DISCLOSURE_LINE.length).trim();
  const tags = p.hashtags.map((t) => t.trim()).filter(Boolean).join(' ');
  return [caption, ctaLine, tags, p.aiFace ? AI_DISCLOSURE_LINE : ''].filter(Boolean).join('\n\n');
}

export async function loadReviewData(userId: string, brandId: string, briefId: string): Promise<ReviewData | null> {
  await requireBrandMember(userId, brandId);
  const all = await listBriefPosts(userId, brandId, briefId, { slides: true });
  if (all.length === 0) return null;
  const main = all.filter((p) => p.carouselId === null);
  const slides = all.filter((p) => p.carouselId !== null);
  const images = await getDb().withUser(userId, (tx) =>
    tx.query<{ post_id: string; format: DesignFormat; image_path: string; v: string | number }>(
      'select post_id::text as post_id, format::text as format, image_path, floor(extract(epoch from updated_at) * 1000)::text as v from public.post_images where brand_id = $1 and post_id = any($2::uuid[])',
      [brandId, all.map((p) => p.id)],
    ),
  );
  const baseUrl = getEnv().appUrl;
  const posts: ReviewPost[] = main.map((p) => {
    const mine = images.filter((i) => i.post_id === p.id);
    const order = postFormats(p.channel, p.imageText.slides.length >= 2);
    const open = p.flags.filter((f) => f.status === 'open' && f.kind !== 'regulated_reminder');
    const blockers = p.design?.blockers ?? [];
    const mySlides = p.design?.carousel ? slides.filter((sl) => sl.carouselId === p.design!.carousel!.id).sort((a, b) => (a.slideIndex ?? 0) - (b.slideIndex ?? 0)) : [];
    return {
      id: p.id,
      channel: p.channel,
      label: channelLabel(p.channel),
      status: p.status,
      caption: p.caption,
      hashtags: p.hashtags,
      hashtagsMax: hashtagLimitFor(p.channel),
      captionMax: CAPTION_MAX[p.channel] ?? 1200,
      cta: p.cta,
      headline: p.imageText.headline,
      flags: p.flags,
      openFlags: open,
      reminder: p.flags.some((f) => f.kind === 'regulated_reminder'),
      blockers,
      images: order.flatMap((format) => {
        const img = mine.find((i) => i.format === format);
        return img ? [{ format, url: `/api/files/${img.image_path}?v=${img.v}` }] : [];
      }),
      slides: mySlides.flatMap((sl) => {
        const img = images.find((i) => i.post_id === sl.id);
        return img ? [`/api/files/${img.image_path}?v=${img.v}`] : [];
      }),
      carouselAsked: p.imageText.slides.length >= 2 && mySlides.length > 0,
      shareText: shareTextFor({ ...p, aiFace: p.design?.aiFace === true }, baseUrl),
      designed: p.themeId !== null && p.design !== null,
      canApprove: open.length === 0 && blockers.length === 0 && p.themeId !== null && p.design !== null,
    };
  });
  return { briefId, posts, allApproved: posts.length > 0 && posts.every((p) => p.status === 'approved' || p.status === 'posted') };
}

