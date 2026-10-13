import { V2_CHANNEL_SPECS, type V2Channel } from "@/lib/ai/prompts/v2-weekly";
import { buildShortLink } from "./link";

/**
 * The text the owner copies or shares for a v2 post:
 *
 *   caption
 *
 *   cta {short link}        (the link only where the channel allows clickable links)
 *
 *   #tag1 #tag2
 *
 * The prompt never writes links (R8), so the short link is added here. Instagram captions have
 * no clickable links (V2_CHANNEL_SPECS), so none is added there even if `includeLink` is true.
 * Empty parts are left out. Pure: safe to use in the browser.
 */
export interface ShareTextPost {
  channel: V2Channel;
  caption: string;
  cta: string;
  hashtags: string[];
  postCode: string;
}

export interface ShareTextOptions {
  /** Add the short link when the channel allows it. Default true. */
  includeLink?: boolean;
  /** Public base URL. Defaults to NEXT_PUBLIC_APP_URL (inlined in the browser too). */
  baseUrl?: string;
}

export function composeShareText(post: ShareTextPost, opts: ShareTextOptions = {}): string {
  const wantLink = (opts.includeLink ?? true) && V2_CHANNEL_SPECS[post.channel].clickableLink;
  const baseUrl = opts.baseUrl ?? (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000");
  const cta = post.cta.trim();
  const ctaLine = [cta, wantLink ? buildShortLink(baseUrl, post.postCode) : ""].filter(Boolean).join(" ");
  const tags = post.hashtags.map((t) => t.trim()).filter(Boolean).join(" ");
  return [post.caption.trim(), ctaLine, tags].filter(Boolean).join("\n\n");
}
