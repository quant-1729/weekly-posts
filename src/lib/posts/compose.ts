import type { ChannelOutput } from "@/lib/ai/schemas";

/**
 * The text the owner copies into Instagram, Facebook or Google:
 *
 *   caption
 *
 *   cta {app url}/r/{post_code}
 *
 *   #tag1 #tag2
 *
 * The prompt forbids the model from writing links or phone numbers (R8), so the
 * short link is added here. `/r/{post_code}` redirects to the brand's WhatsApp (T-21).
 * The hashtag block is left out when there are no hashtags.
 */
export function composeShareText(
  output: Pick<ChannelOutput, "caption" | "cta" | "hashtags">,
  postCode: string,
  baseUrl: string = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
): string {
  const link = `${baseUrl.replace(/\/+$/, "")}/r/${postCode}`;
  const cta = output.cta.trim();
  const ctaLine = cta ? `${cta} ${link}` : link;
  const parts = [output.caption.trim(), ctaLine];
  const tags = output.hashtags.map((t) => t.trim()).filter(Boolean);
  if (tags.length > 0) parts.push(tags.join(" "));
  return parts.join("\n\n");
}
