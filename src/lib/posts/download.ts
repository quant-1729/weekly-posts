import { istDateString } from "./ist";

/**
 * Download links for a post's images (R13): Instagram, Story and Facebook PNGs,
 * each served by /api/files after a brand-membership check.
 *
 * This is the one place that builds download links. T-13 adds the fact-flag
 * rule here (no download while a flag is open); callers must not build
 * `/api/files` download links themselves.
 */

export const DOWNLOAD_CHANNELS = ["ig_feed", "status", "facebook"] as const;
export type DownloadChannel = (typeof DOWNLOAD_CHANNELS)[number];

export interface PostDownload {
  channel: DownloadChannel;
  /** Where the PNG is served from (same origin). */
  href: string;
  /** Suggested file name: `{brand}-{date}-{channel}.png`. */
  filename: string;
}

export interface DownloadableOutput {
  channel: string;
  /** Storage path with the bucket first, e.g. renders/{brand}/{post}/ig_feed.png. */
  imagePath: string | null;
}

/** Letters and digits of any script kept, everything else becomes "-". Never empty. */
export function filenamePart(text: string): string {
  const slug = text
    .normalize("NFC")
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "post";
}

export function postDownloads(args: {
  brandName: string;
  createdAt: Date;
  outputs: DownloadableOutput[];
}): PostDownload[] {
  const brand = filenamePart(args.brandName);
  const date = istDateString(args.createdAt);
  return DOWNLOAD_CHANNELS.flatMap((channel) => {
    const out = args.outputs.find((o) => o.channel === channel);
    if (!out?.imagePath) return [];
    return [{ channel, href: `/api/files/${out.imagePath}`, filename: `${brand}-${date}-${channel}.png` }];
  });
}
