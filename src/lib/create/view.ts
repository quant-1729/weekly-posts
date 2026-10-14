// What the design and review pages show, as plain data (safe to send to client components).
// Reads run as the signed-in user (row-level security); writes live in ./posts.ts.

import { requireBrandMember } from '@/lib/brand/current';
import { blockLines } from '@/lib/briefs/editor-state';
import type { Brief, BlockKey } from '@/lib/briefs/types';
import { getDb } from '@/lib/db';
import { listLayouts, needsCarousel } from '@/lib/design';
import type { DesignFormat, DesignOption } from '@/lib/design/types';
import type { Flag } from '@/lib/guardrail/types';
import { getEnv } from '@/lib/env';
import { fill, s } from '@/lib/i18n/strings';
import { PostCopyError } from './copy';
import { channelFormats, contentFromBrief, primaryFormat, showsLogo } from './content';
import {
  CreateError,
  ensureDraftPosts,
  listBriefPosts,
  wordsOf,
  type CreateDeps,
} from './posts';
import { loadDesignAssets, optionsFor, previewOption, reportLines, type DesignAssets } from './render';
import type { CreateBrand, CreatePost, DesignBlocker } from './types';
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
  /** Small JPEG as a data URL. */
  src: string;
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

async function optionView(assets: DesignAssets, brief: Brief, brand: CreateBrand, post: CreatePost, option: DesignOption, format: DesignFormat): Promise<OptionView> {
  const content = await contentFromBrief(brief, brand, wordsOf(post), { postCode: post.postCode, mascot: assets.mascotId !== null });
  const p = await previewOption(assets, { format, option, content, pose: post.imageText.pose });
  return {
    option,
    used: p.used,
    src: p.src,
    lines: reportLines(p.report),
    layouts: listLayouts(p.used.themeId, format, !!assets.photo).map((l) => ({ id: l.id, name: l.name })),
  };
}

/** One option's preview, for the layout and colour buttons. Never calls the AI. */
export async function previewForOption(args: { userId: string; brandId: string; briefId: string; option: DesignOption }, deps: CreateDeps = {}): Promise<OptionView> {
  const { brief, brand, posts } = await ensureDraftPosts(args, deps);
  const assets = await loadDesignAssets({ userId: args.userId, brandId: args.brandId, brief, brand, storage: deps.storage });
  return optionView(assets, brief, brand, posts[0], args.option, primaryFormat(brief.channels));
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
  const format = primaryFormat(brief.channels);
  const first = posts[0];
  const content = await contentFromBrief(brief, brand, wordsOf(first), { postCode: first.postCode, mascot: assets.mascotId !== null });
  const options = optionsFor(assets, content, format);
  const views = await Promise.all(options.map((o) => optionView(assets, brief, brand, first, o, format)));

  const stored = first.design?.option;
  const usedIndex = stored ? options.findIndex((o) => o.themeId === stored.themeId && o.layoutId === stored.layoutId && o.scheme === stored.scheme) : -1;

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
    formats: [...new Set(posts.flatMap((p) => channelFormats(p.channel)))],
    hasMascot: assets.mascotId !== null,
    words: { headline: first.imageText.headline, subline: first.imageText.subline, ctaText: first.cta, bubble: first.imageText.bubble },
    captions: posts.map((p) => ({ postId: p.id, channel: p.channel, label: channelLabel(p.channel), caption: p.caption, hashtags: p.hashtags })),
    flags: [...flagMap.values()],
    options: views,
    usedIndex: usedIndex >= 0 ? usedIndex : null,
    photos: photos.map((p) => ({ id: p.id, url: `/api/files/${p.storage_path}`, description: p.description ?? '', usable: p.usable !== false })),
    photoId: brief.photoId,
    blocks,
    carousel: needsCarousel(content, format),
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
  cta: string;
  headline: string;
  flags: Flag[];
  openFlags: Flag[];
  reminder: boolean;
  blockers: DesignBlocker[];
  images: ReviewImage[];
  /** The carousel slides' pictures, when there is one. */
  slides: string[];
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

/** What Copy and Share send for a post: caption, the call to action with its short link where links work, hashtags. */
export function shareTextFor(p: Pick<CreatePost, 'channel' | 'caption' | 'cta' | 'hashtags' | 'postCode'>, baseUrl: string): string {
  const link = CLICKABLE.has(p.channel) && baseUrl ? `${baseUrl.replace(/\/$/, '')}/r/${p.postCode}` : '';
  const ctaLine = [p.cta.trim(), link].filter(Boolean).join(' ');
  return [p.caption.trim(), ctaLine, p.hashtags.map((t) => t.trim()).filter(Boolean).join(' ')].filter(Boolean).join('\n\n');
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
    const order = channelFormats(p.channel);
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
      shareText: shareTextFor(p, baseUrl),
      designed: p.themeId !== null && p.design !== null,
      canApprove: open.length === 0 && blockers.length === 0 && p.themeId !== null && p.design !== null,
    };
  });
  return { briefId, posts, allApproved: posts.length > 0 && posts.every((p) => p.status === 'approved' || p.status === 'posted') };
}

