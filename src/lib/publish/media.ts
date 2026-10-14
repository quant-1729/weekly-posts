// Which picture goes where, and the public address Meta fetches it from.
//
//   Instagram feed   portrait (1080x1350) first, else square, else landscape
//   Instagram story  vertical (1080x1920): used when the post has no feed picture (a story-only channel post)
//   Facebook Page    square first, else portrait, landscape, vertical
//
// Meta downloads the picture itself, so the address must be public and expire: storage.signedUrl (Cloud Storage or
// Supabase). The mock storage gives an app address Meta cannot fetch; we refuse those instead of sending Meta a link
// that will fail.

import type { DesignFormat } from "@/lib/design/types";
import { getStorage, isBucket, type Storage } from "@/lib/storage";
import type { Provider } from "@/lib/queue/types";
import type { ImageSet } from "./load";
import { PublishStop } from "./errors";

/** Long enough for Meta to fetch it, including a slow container (carousels fetch several). */
export const IMAGE_URL_TTL_SECONDS = 60 * 60;

const FEED_ORDER: Record<Provider, DesignFormat[]> = {
  instagram: ["portrait", "square", "landscape"],
  facebook: ["square", "portrait", "landscape", "vertical"],
};

export type InstagramKind = "feed" | "story";

/** A post is a story when its only picture is the vertical one (no feed size). */
export function instagramKind(images: ImageSet): InstagramKind {
  const hasFeed = FEED_ORDER.instagram.some((f) => images[f]);
  return !hasFeed && images.vertical ? "story" : "feed";
}

export function pickImagePath(images: ImageSet, provider: Provider, kind: InstagramKind = "feed"): string | null {
  if (provider === "instagram" && kind === "story") return images.vertical ?? null;
  for (const f of FEED_ORDER[provider]) if (images[f]) return images[f]!;
  return null;
}

function isPublicUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:") return false;
    const h = u.hostname.toLowerCase();
    return !(h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || /^127\./.test(h) || h === "[::1]" || /^10\./.test(h) || /^192\.168\./.test(h));
  } catch {
    return false;
  }
}

/** A public, expiring address for one stored picture ("renders/{brand}/..."). Throws PublishStop when it cannot be made. */
export async function publicUrlFor(imagePath: string, storage: Storage = getStorage()): Promise<string> {
  const slash = imagePath.indexOf("/");
  const bucket = slash > 0 ? imagePath.slice(0, slash) : "";
  const rest = slash > 0 ? imagePath.slice(slash + 1) : "";
  if (!isBucket(bucket) || !rest) throw new PublishStop("media_rejected", false, "The post's picture could not be found.");
  if (!storage.signedUrl) {
    throw new PublishStop("unknown", false, "This storage cannot make public picture links. Use Cloud Storage or Supabase storage to publish.");
  }
  let url: string;
  try {
    url = await storage.signedUrl(bucket, rest, IMAGE_URL_TTL_SECONDS);
  } catch {
    throw new PublishStop("network", true, "Could not prepare the picture link. Trying again later.");
  }
  if (!isPublicUrl(url)) {
    throw new PublishStop("media_rejected", false, "The picture link is not public, so Meta cannot fetch it. Use Cloud Storage or Supabase storage to publish.");
  }
  return url;
}
