// The text that goes with a post: the approved caption, then the hashtags on their own paragraph. Only words the owner
// approved are used; nothing is added except the "#" in front of a tag.

export const IG_CAPTION_MAX = 2200;
export const IG_HASHTAG_MAX = 30;

const norm = (tag: string): string | null => {
  const t = tag.trim().replace(/^#+/, "").replace(/\s+/g, "");
  return t ? `#${t}` : null;
};

export function composeCaption(caption: string | null | undefined, hashtags: readonly string[] | null | undefined, max = IG_CAPTION_MAX, maxTags = IG_HASHTAG_MAX): string {
  const text = (caption ?? "").trim();
  const seen = new Set((text.match(/#[\p{L}\p{N}_]+/gu) ?? []).map((h) => h.toLowerCase()));
  const tags: string[] = [];
  for (const raw of hashtags ?? []) {
    const t = norm(raw);
    if (t && !seen.has(t.toLowerCase())) {
      seen.add(t.toLowerCase());
      tags.push(t);
    }
  }
  const room = (list: string[]) => (list.length ? (text ? `${text}\n\n${list.join(" ")}` : list.join(" ")) : text);
  let kept = tags.slice(0, Math.max(0, maxTags - (text.match(/#[\p{L}\p{N}_]+/gu)?.length ?? 0)));
  while (kept.length > 0 && room(kept).length > max) kept = kept.slice(0, -1);
  const out = room(kept);
  return out.length > max ? out.slice(0, max) : out;
}
