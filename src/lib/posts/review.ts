import type { Channel, ContentLanguage } from "@/lib/ai/schemas";
import { getDb } from "@/lib/db";
import { composeShareText } from "./compose";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ORDER: Channel[] = ["ig_feed", "status", "facebook", "gbp"];

export interface ReviewFlag {
  id: string;
  text: string;
  kind: string;
  regulated: boolean;
  status: "open" | "confirmed" | "removed";
}

export interface ReviewOutput {
  id: string;
  channel: Channel;
  language: ContentLanguage;
  caption: string;
  cta: string;
  hashtags: string[];
  /** Storage path with the bucket first, e.g. renders/{brand}/{post}/ig_feed.png. Null for text-only outputs. */
  imagePath: string | null;
  /** Changes whenever the output is saved. Added to the image URL so a re-rendered PNG is not served from cache. */
  imageVersion: string;
  templateId: string | null;
  flags: ReviewFlag[];
  /** Caption, CTA with the short link, and hashtags, ready to copy. */
  shareText: string;
}

export interface ReviewData {
  postId: string;
  brandId: string;
  status: "generating" | "draft" | "ready" | "failed";
  language: ContentLanguage;
  postCode: string;
  outputs: ReviewOutput[];
}

interface PostRow {
  id: string;
  brand_id: string;
  status: ReviewData["status"];
  language: ContentLanguage;
  post_code: string;
}

/** Columns of an outputs row needed for a ReviewOutput (see toReviewOutput). */
export const REVIEW_OUTPUT_COLUMNS = `id, channel::text as channel, language::text as language, caption, cta, hashtags,
       image_path, template_id, fact_flags, (extract(epoch from updated_at) * 1000)::bigint::text as version`;

export interface OutputRow {
  id: string;
  channel: Channel;
  language: ContentLanguage;
  caption: string;
  cta: string | null;
  hashtags: string[] | null;
  image_path: string | null;
  template_id: string | null;
  fact_flags: ReviewFlag[] | null;
  version: string;
}

export function toReviewOutput(r: OutputRow, postCode: string): ReviewOutput {
  const output = { caption: r.caption, cta: r.cta ?? "", hashtags: r.hashtags ?? [] };
  return {
    id: r.id,
    channel: r.channel,
    language: r.language,
    ...output,
    imagePath: r.image_path,
    imageVersion: r.version,
    templateId: r.template_id,
    flags: r.fact_flags ?? [],
    shareText: composeShareText(output, postCode),
  };
}

/**
 * The post and its outputs for the result screen, read as the signed-in user.
 * Returns null when the id is malformed, the post does not exist or the user
 * is not a member of its brand (row-level security hides it): the page then shows 404.
 */
export async function getReviewData(userId: string, postId: string): Promise<ReviewData | null> {
  if (!UUID_RE.test(postId)) return null;
  return getDb().withUser(userId, async (tx) => {
    const [post] = await tx.query<PostRow>(
      "select id, brand_id, status::text as status, language::text as language, post_code from public.posts where id = $1",
      [postId],
    );
    if (!post) return null;
    const rows = await tx.query<OutputRow>(
      `select ${REVIEW_OUTPUT_COLUMNS} from public.outputs where post_id = $1`,
      [postId],
    );
    const outputs = ORDER.flatMap((channel) => {
      const r = rows.find((x) => x.channel === channel);
      return r ? [toReviewOutput(r, post.post_code)] : [];
    });
    return {
      postId: post.id,
      brandId: post.brand_id,
      status: post.status,
      language: post.language,
      postCode: post.post_code,
      outputs,
    };
  });
}
