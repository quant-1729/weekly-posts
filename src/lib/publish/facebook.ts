// Publishing to a Facebook Page (graph.facebook.com) with the Page access token:
//   one picture   POST /{page-id}/photos   url + message              -> { id, post_id }
//   several       POST /{page-id}/photos   url + published=false      (one per picture, -> { id })
//                 POST /{page-id}/feed     message + attached_media[n] = {"media_fbid": id}   -> { id }
//   permalink     GET  /{post-id}?fields=permalink_url

import { graphVersion } from "@/lib/connections/config";
import { graphRequest, type FetchLike } from "@/lib/connections/graph";
import type { PublishResult } from "@/lib/queue/types";
import { PublishStop } from "./errors";
import { parseMetaTime, sameCaption, startedRecently, unknownOutcome } from "./recent";

export interface FbCtx {
  token: string;
  fetch?: FetchLike;
  /** When this attempt began (ms). A Page post that appeared after it, with our caption, is ours. */
  startedAt?: number;
}

const base = () => `https://graph.facebook.com/${graphVersion()}`;
const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);

async function permalinkOf(postId: string, ctx: FbCtx): Promise<string | null> {
  try {
    const body = await graphRequest({ url: `${base()}/${postId}`, params: { fields: "permalink_url" }, token: ctx.token, fetch: ctx.fetch });
    const link = str(body.permalink_url);
    if (link) return link.startsWith("http") ? link : `https://www.facebook.com${link}`;
  } catch {
    // Fall through to the plain address.
  }
  return `https://www.facebook.com/${postId}`;
}

/** The Page's latest posts: used only to check whether a post that got no answer went through. */
async function findPosted(pageId: string, message: string, ctx: FbCtx): Promise<Extract<PublishResult, { ok: true }> | null> {
  if (ctx.startedAt === undefined) return null;
  try {
    const body = await graphRequest<{ data?: Array<Record<string, unknown>> }>({
      url: `${base()}/${pageId}/posts`,
      params: { fields: "id,message,created_time,permalink_url", limit: 5 },
      token: ctx.token,
      fetch: ctx.fetch,
    });
    for (const p of body.data ?? []) {
      const id = str(p.id);
      if (id && sameCaption(str(p.message), message) && startedRecently(parseMetaTime(p.created_time), ctx.startedAt)) {
        const link = str(p.permalink_url);
        return { ok: true, platformPostId: id, permalink: link ? (link.startsWith("http") ? link : `https://www.facebook.com${link}`) : `https://www.facebook.com/${id}` };
      }
    }
  } catch {
    // Cannot tell: the caller reports the original problem.
  }
  return null;
}

export async function publishToFacebookPage(pageId: string, job: { urls: string[]; message: string }, ctx: FbCtx): Promise<Extract<PublishResult, { ok: true }>> {
  if (job.urls.length === 0) throw new PublishStop("media_rejected", false, "The post has no picture.");

  if (job.urls.length === 1) {
    let body: Record<string, unknown>;
    try {
      body = await graphRequest({ method: "POST", url: `${base()}/${pageId}/photos`, params: { url: job.urls[0], message: job.message, published: true }, token: ctx.token, fetch: ctx.fetch });
    } catch (e) {
      if (unknownOutcome(e)) {
        const found = await findPosted(pageId, job.message, ctx);
        if (found) return found;
      }
      throw e;
    }
    const postId = str(body.post_id) ?? str(body.id);
    if (!postId) throw new PublishStop("unknown", false, "Facebook did not return the post id.");
    return { ok: true, platformPostId: postId, permalink: await permalinkOf(postId, ctx) };
  }

  const photoIds: string[] = [];
  for (const url of job.urls) {
    const body = await graphRequest({ method: "POST", url: `${base()}/${pageId}/photos`, params: { url, published: false }, token: ctx.token, fetch: ctx.fetch });
    const id = str(body.id);
    if (!id) throw new PublishStop("unknown", false, "Facebook did not return a photo id.");
    photoIds.push(id);
  }
  const params: Record<string, string> = { message: job.message };
  photoIds.forEach((id, i) => {
    params[`attached_media[${i}]`] = JSON.stringify({ media_fbid: id });
  });
  let body: Record<string, unknown>;
  try {
    body = await graphRequest({ method: "POST", url: `${base()}/${pageId}/feed`, params, token: ctx.token, fetch: ctx.fetch });
  } catch (e) {
    if (unknownOutcome(e)) {
      const found = await findPosted(pageId, job.message, ctx);
      if (found) return found;
    }
    throw e;
  }
  const postId = str(body.id);
  if (!postId) throw new PublishStop("unknown", false, "Facebook did not return the post id.");
  return { ok: true, platformPostId: postId, permalink: await permalinkOf(postId, ctx) };
}
