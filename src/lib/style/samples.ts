// What "Keep my look" learns from (C-17): up to 12 of the brand's own pictures and the website's colours.
//
// Pictures:
//   1. photos the owner already added from Instagram (photos.source = 'instagram'), newest first;
//   2. pictures still in the Instagram import's list (listInstagramImages: its 15-minute memory, or one
//      read of the public account) that are not in the photo library yet.
// YouTube thumbnails are added here when the YouTube import exists.
// Website: the page's theme colour (the website loader exposes no CSS colours). The brand's saved colours
// are returned separately and are only a fallback, never labelled "from the website".
// Uploaded photos are not used: they show products and people, not the brand's design.

import { BrandAccessError, requireBrandMember } from '@/lib/brand/current';
import { getDb } from '@/lib/db';
import { downloadInstagramImage, listInstagramImages, type DownloadFn, type InstagramImageView } from '@/lib/instagram/import';
import { getStorage, type Storage } from '@/lib/storage';
import { shrinkForModel } from '@/lib/uploads/image';
import { getWebsiteAssets } from '@/lib/memory/look';
import { normalizeThemeColor } from '@/lib/memory/schema';
import { isHexColor, normalizeHex } from '@/lib/brand/colors';

export const MAX_STYLE_IMAGES = 12;
/** Fewer than this and the read uses colours only. */
export const MIN_STYLE_IMAGES = 3;
/** Longest side sent to the model, in pixels. */
export const STYLE_IMAGE_PX = 768;

export interface StyleSamples {
  /** Shrunk JPEGs ready for the model. */
  images: { mimeType: 'image/jpeg'; data: Buffer }[];
  fromPhotos: number;
  fromInstagram: number;
  /** The website's own colours (theme colour). */
  websiteColors: string[];
  /** The brand's saved colours: a fallback only. */
  brandColors: string[];
  /** True when there are too few pictures and the read will use colours only. */
  colorsOnly: boolean;
}

export interface SampleDeps {
  storage?: Storage;
  /** Test/dev override for the pictures still in the Instagram list. */
  listInstagram?: () => Promise<Pick<InstagramImageView, 'mediaId' | 'previewUrl' | 'added'>[]>;
  download?: DownloadFn;
  /** Test/dev override for the website theme colour. */
  themeColor?: () => Promise<string | null>;
}

export async function collectStyleSamples(args: { userId: string; brandId: string }, deps: SampleDeps = {}): Promise<StyleSamples> {
  const { userId, brandId } = args;
  await requireBrandMember(userId, brandId);
  const storage = deps.storage ?? getStorage();
  const images: StyleSamples['images'] = [];
  let fromPhotos = 0;
  let fromInstagram = 0;

  const shrink = async (bytes: Uint8Array): Promise<Buffer | null> => {
    try {
      return await shrinkForModel(bytes, STYLE_IMAGE_PX);
    } catch {
      return null; // not a readable picture: skip it
    }
  };

  // 1. Instagram pictures already in the photo library.
  const rows = await getDb().withUser(userId, (tx) =>
    tx.query<{ storage_path: string }>(
      `select storage_path from public.photos
        where brand_id = $1 and kind = 'photo' and source = 'instagram' and storage_path is not null
        order by source_posted_at desc nulls last, created_at desc limit $2`,
      [brandId, MAX_STYLE_IMAGES],
    ),
  );
  for (const r of rows) {
    if (images.length >= MAX_STYLE_IMAGES) break;
    const file = await storage.get('photos', r.storage_path.replace(/^photos\//, ''));
    const data = file ? await shrink(file.bytes) : null;
    if (data) {
      images.push({ mimeType: 'image/jpeg', data });
      fromPhotos++;
    }
  }

  // 2. Pictures still in the Instagram import's list.
  if (images.length < MAX_STYLE_IMAGES) {
    try {
      const listed = deps.listInstagram
        ? await deps.listInstagram()
        : await listInstagramImages({ userId, brandId }).then((r) => (r.ok ? r.images : []));
      const download = deps.download ?? downloadInstagramImage;
      for (const img of listed) {
        if (images.length >= MAX_STYLE_IMAGES) break;
        if (img.added) continue; // already counted above
        try {
          const got = await download(img.previewUrl);
          const data = await shrink(got.bytes);
          if (data) {
            images.push({ mimeType: 'image/jpeg', data });
            fromInstagram++;
          }
        } catch {
          // one picture that will not download does not stop the others
        }
      }
    } catch (e) {
      if (e instanceof BrandAccessError) throw e;
      // Instagram not set up, rate limited, no handle: the read carries on with what it has.
    }
  }

  // Website theme colour, and the brand's saved colours as a fallback.
  let theme: string | null = null;
  try {
    theme = normalizeThemeColor(deps.themeColor ? await deps.themeColor() : (await getWebsiteAssets({ userId, brandId }))?.themeColor ?? null);
  } catch {
    theme = null;
  }
  const [mem] = await getDb().withUser(userId, (tx) =>
    tx.query<{ colors: Record<string, unknown> | null }>('select colors from public.brand_memory where brand_id = $1', [brandId]),
  );
  const brandColors = ['primary', 'secondary', 'accent']
    .map((k) => mem?.colors?.[k])
    .filter((v): v is string => isHexColor(v))
    .map(normalizeHex);

  return {
    images,
    fromPhotos,
    fromInstagram,
    websiteColors: theme ? [theme] : [],
    brandColors,
    colorsOnly: images.length < MIN_STYLE_IMAGES,
  };
}
