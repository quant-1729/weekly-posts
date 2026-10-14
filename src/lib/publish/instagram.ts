// Publishing to Instagram through "Instagram API with Instagram Login" (graph.instagram.com):
//   1. content_publishing_limit  (are we at the 24-hour limit?)
//   2. POST /{ig-user-id}/media            image_url [+ caption]  (STORIES: media_type=STORIES)
//      carousel: one container per slide (is_carousel_item) then POST media_type=CAROUSEL&children=...
//   3. GET  /{container-id}?fields=status_code,status   until FINISHED (backoff, timeout)
//   4. POST /{ig-user-id}/media_publish    creation_id
//   5. GET  /{media-id}?fields=permalink
// Reference: Instagram Platform > Content Publishing.

import { graphVersion } from "@/lib/connections/config";
import { GraphError, graphRequest, type FetchLike } from "@/lib/connections/graph";
import type { PublishResult } from "@/lib/queue/types";
import { PublishStop } from "./errors";
import { parseMetaTime, sameCaption, startedRecently, unknownOutcome } from "./recent";

export interface Ctx {
  token: string;
  fetch?: FetchLike;
  sleep: (ms: number) => Promise<void>;
  /** When this attempt began (ms). A post that appeared after it, with our caption, is ours. */
  startedAt?: number;
}

const base = () => `https://graph.instagram.com/${graphVersion()}`;
const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);

export const POLL_FIRST_DELAY_MS = 1500;
export const POLL_MAX_DELAY_MS = 10_000;
export const POLL_TIMEOUT_MS = 90_000;
export const DEFAULT_DAILY_LIMIT = 100;

/** Throws PublishStop('rate_limited') when the account used its API-posting allowance for the last 24 hours. A failed check is ignored (unless it says the token is bad). */
export async function checkPublishingLimit(igUserId: string, ctx: Ctx): Promise<void> {
  let body: { data?: Array<{ quota_usage?: unknown; config?: { quota_total?: unknown } }> };
  try {
    body = await graphRequest({ url: `${base()}/${igUserId}/content_publishing_limit`, params: { fields: "quota_usage,config" }, token: ctx.token, fetch: ctx.fetch });
  } catch (e) {
    // The check itself is advisory: only a bad token stops us here (the real call would fail the same way).
    if (e instanceof GraphError && (e.code === 190 || e.code === 102)) throw e;
    return;
  }
  const row = body.data?.[0];
  const used = typeof row?.quota_usage === "number" ? row.quota_usage : 0;
  const total = typeof row?.config?.quota_total === "number" ? row.config.quota_total : DEFAULT_DAILY_LIMIT;
  if (used >= total) throw new PublishStop("rate_limited", true, `Instagram's limit of ${total} posts in 24 hours is reached. Trying again later.`);
}

async function createContainer(igUserId: string, params: Record<string, string | boolean>, ctx: Ctx): Promise<string> {
  const body = await graphRequest({ method: "POST", url: `${base()}/${igUserId}/media`, params, token: ctx.token, fetch: ctx.fetch });
  const id = str(body.id);
  if (!id) throw new PublishStop("unknown", false, "Instagram did not return a container id.");
  return id;
}

/** Waits (with backoff) until Instagram has fetched and processed the picture. */
export async function waitForContainer(containerId: string, ctx: Ctx): Promise<void> {
  let delay = POLL_FIRST_DELAY_MS;
  let waited = 0;
  for (;;) {
    const body = await graphRequest({ url: `${base()}/${containerId}`, params: { fields: "status_code,status" }, token: ctx.token, fetch: ctx.fetch });
    const code = str(body.status_code);
    if (code === "FINISHED" || code === "PUBLISHED") return;
    if (code === "ERROR") {
      const detail = str(body.status);
      throw new PublishStop("media_rejected", false, `Instagram could not process the picture${detail ? `: ${detail.slice(0, 200)}` : "."}`);
    }
    if (code === "EXPIRED") throw new PublishStop("unknown", true, "Instagram dropped the upload before it was posted.");
    if (waited >= POLL_TIMEOUT_MS) throw new PublishStop("network", true, "Instagram is still processing the picture. Trying again later.");
    await ctx.sleep(delay);
    waited += delay;
    delay = Math.min(Math.round(delay * 1.6), POLL_MAX_DELAY_MS);
  }
}

/** The account's latest posts, newest first. Used only to check whether a publish that got no answer went through. */
async function findPublished(igUserId: string, caption: string | null, ctx: Ctx): Promise<{ id: string; permalink: string | null } | null> {
  if (caption === null || ctx.startedAt === undefined) return null; // a story has no caption and is not in this list
  try {
    const body = await graphRequest<{ data?: Array<Record<string, unknown>> }>({
      url: `${base()}/${igUserId}/media`,
      params: { fields: "id,caption,timestamp,permalink", limit: 5 },
      token: ctx.token,
      fetch: ctx.fetch,
    });
    for (const m of body.data ?? []) {
      const id = str(m.id);
      if (id && sameCaption(str(m.caption), caption) && startedRecently(parseMetaTime(m.timestamp), ctx.startedAt)) return { id, permalink: str(m.permalink) };
    }
  } catch {
    // Cannot tell: the caller reports the original problem.
  }
  return null;
}

async function publishContainer(igUserId: string, creationId: string, caption: string | null, ctx: Ctx): Promise<{ id: string; permalink: string | null }> {
  let body: Record<string, unknown>;
  try {
    body = await graphRequest({ method: "POST", url: `${base()}/${igUserId}/media_publish`, params: { creation_id: creationId }, token: ctx.token, fetch: ctx.fetch });
  } catch (e) {
    // No answer from the publish call: it may have worked. Look before anyone retries (a retry could post twice).
    if (unknownOutcome(e)) {
      const found = await findPublished(igUserId, caption, ctx);
      if (found) return found;
    }
    throw e;
  }
  const id = str(body.id);
  if (!id) throw new PublishStop("unknown", false, "Instagram did not return the post id.");
  let permalink: string | null = null;
  try {
    const p = await graphRequest({ url: `${base()}/${id}`, params: { fields: "permalink" }, token: ctx.token, fetch: ctx.fetch });
    permalink = str(p.permalink);
  } catch {
    // The post is live; a missing link is not a failure.
  }
  return { id, permalink };
}

export type InstagramJob =
  | { kind: "feed"; url: string; caption: string }
  | { kind: "story"; url: string }
  | { kind: "carousel"; urls: string[]; caption: string };

export async function publishToInstagram(igUserId: string, job: InstagramJob, ctx: Ctx): Promise<Extract<PublishResult, { ok: true }>> {
  await checkPublishingLimit(igUserId, ctx);

  let creationId: string;
  if (job.kind === "carousel") {
    if (job.urls.length < 2 || job.urls.length > 10) throw new PublishStop("media_rejected", false, "An Instagram carousel needs 2 to 10 pictures.");
    const children: string[] = [];
    for (const url of job.urls) {
      const child = await createContainer(igUserId, { image_url: url, is_carousel_item: true }, ctx);
      await waitForContainer(child, ctx);
      children.push(child);
    }
    creationId = await createContainer(igUserId, { media_type: "CAROUSEL", children: children.join(","), caption: job.caption }, ctx);
  } else if (job.kind === "story") {
    creationId = await createContainer(igUserId, { media_type: "STORIES", image_url: job.url }, ctx);
  } else {
    creationId = await createContainer(igUserId, { image_url: job.url, caption: job.caption }, ctx);
  }
  await waitForContainer(creationId, ctx);
  const done = await publishContainer(igUserId, creationId, job.kind === "story" ? null : job.caption, ctx);
  return { ok: true, platformPostId: done.id, permalink: done.permalink };
}
