// The post filter (UX-2): the Design step's "filter" control. A filter is a colour treatment (warm, cool, vivid, soft,
// black and white, vintage, with an intensity) that the engine applies by code to the owner's photo and the abstract
// background only; text, logo, QR, brand colours and the face are never touched, so a QR still reads and a brand colour
// stays exact. It costs no AI call: changing it just draws the pictures again.
//
// The filter is stored with the post's design (`posts.design.filter`; "none" when never set) so every later redraw
// (words changed, flag removed, another layout) keeps it.

import { requireBrandMember } from '@/lib/brand/current';
import { getDb } from '@/lib/db';
import { postFilterSchema, type PostFilter } from '@/lib/design/filter-presets';
import type { DesignFormat, DesignOption } from '@/lib/design/types';
import { CreateError, filterOf, listBriefPosts, redrawPosts, type CreateDeps } from './posts';
import { previewForOption, type OptionView } from './view';

export interface FilterImage {
  postId: string;
  channel: string;
  format: DesignFormat;
  /** Same shape as the review step's picture URLs; the "v" part changes with every redraw so the browser reloads it. */
  url: string;
}

export interface SetFilterResult {
  /** The filter now in force. */
  filter: PostFilter;
  /** The posts had a design and their pictures were drawn again with the filter (they are drafts again: approve them again). */
  redrawn: boolean;
  /** The redrawn pictures of every channel's post (empty when nothing was drawn yet). */
  images: FilterImage[];
  /** A fresh preview of `option` with the filter, when an option was given (before "Use this design"). */
  preview: OptionView | null;
}

/**
 * Sets the colour filter of a brief's post.
 *  - If the pictures were already drawn ("Use this design"), they are drawn again with the filter and stored; `images`
 *    returns their new URLs.
 *  - If `option` is given, `preview` is that option's small preview with the filter, for the Design step before a
 *    design is used (the filter is then carried into "Use this design" via chooseDesign's `filter`).
 * Throws CreateError('invalid_option') for a filter that is not a preset with an intensity from 0 to 100.
 */
export async function setPostFilter(args: { userId: string; brandId: string; briefId: string; filter: unknown; option?: DesignOption }, deps: CreateDeps = {}): Promise<SetFilterResult> {
  const { userId, brandId, briefId } = args;
  await requireBrandMember(userId, brandId);
  const parsed = postFilterSchema.safeParse(args.filter);
  if (!parsed.success) throw new CreateError('invalid_option');
  const filter = parsed.data;

  const redrawn = await redrawPosts({ userId, brandId, briefId, filter }, deps);
  const preview = args.option ? await previewForOption({ userId, brandId, briefId, option: args.option, filter }, deps) : null;

  let images: FilterImage[] = [];
  if (redrawn) {
    const posts = await listBriefPosts(userId, brandId, briefId);
    const rows = await getDb().withUser(userId, (tx) =>
      tx.query<{ post_id: string; format: DesignFormat; image_path: string; v: string }>(
        `select post_id::text as post_id, format::text as format, image_path, floor(extract(epoch from updated_at) * 1000)::text as v
           from public.post_images where brand_id = $1 and post_id = any($2::uuid[]) order by format`,
        [brandId, posts.map((p) => p.id)],
      ),
    );
    images = rows.map((r) => ({ postId: r.post_id, channel: posts.find((p) => p.id === r.post_id)?.channel ?? '', format: r.format, url: `/api/files/${r.image_path}?v=${r.v}` }));
  }
  return { filter, redrawn, images, preview };
}

/** The filter a brief's post has now ("none" when never set). */
export async function getPostFilter(userId: string, brandId: string, briefId: string): Promise<PostFilter> {
  const posts = await listBriefPosts(userId, brandId, briefId);
  return filterOf(posts[0]);
}
