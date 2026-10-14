// The publisher (C-26): publishes ONE approved queue item to the connected Instagram account or Facebook Page and
// reports what happened as a PublishResult. The queue (src/lib/queue) calls `publishQueueItem` for due items in mode
// 'publish' and owns every status change, retry and email; this code never writes a queue row.
//
// Order of checks (each one a refusal, nothing is sent to Meta until all pass):
//   1. the item exists and is an auto-publish item for a channel we can publish to
//   2. it was not already published (the item holds a platform post id): answered as success, so a retry never posts twice
//   3. the post is APPROVED (auto-approved posts have the same status)
//   4. the connection is active and its permission has not ended
// Then the picture addresses (public, expiring), the Instagram limit, the post itself, and the permalink.
//
// A token is decrypted here, used for the calls and dropped. It is never logged, put in a result or kept in an error.

import { GraphError, scrub } from "@/lib/connections/graph";
import { getConnection, markConnectionProblem } from "@/lib/connections/service";
import { readToken } from "@/lib/connections/tokens";
import { PUBLISH_PROVIDER, type Provider, type PublishQueueItem, type PublishResult } from "@/lib/queue/types";
import { getStorage, type Storage } from "@/lib/storage";
import { composeCaption } from "./caption";
import { fail, mapGraphError, toFailure, PublishStop } from "./errors";
import { publishToFacebookPage } from "./facebook";
import { publishToInstagram, type InstagramJob } from "./instagram";
import { loadForPublish, type ImageSet } from "./load";
import { instagramKind, pickImagePath, publicUrlFor } from "./media";
import type { FetchLike } from "@/lib/connections/graph";

export interface PublisherDeps {
  fetch?: FetchLike;
  /** Waits between status checks. Tests pass a no-op. */
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
  storage?: Storage;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function createPublisher(deps: PublisherDeps = {}): PublishQueueItem {
  return async ({ itemId, brandId }): Promise<PublishResult> => {
    const sleep = deps.sleep ?? defaultSleep;
    const now = deps.now?.() ?? new Date();
    let token = "";
    let active: Provider | undefined;
    try {
      const loaded = await loadForPublish(itemId, brandId);
      if (!loaded) return fail("unknown", false, "The queue item or its post no longer exists.");
      const { item, post } = loaded;
      if (item.mode !== "publish") return fail("unknown", false, "This item is delivered to the owner, not posted automatically.");
      const provider = PUBLISH_PROVIDER[item.channel];
      if (!provider) return fail("not_connected", false, "This channel is not posted automatically.");
      active = provider;

      // Already posted (a retry after the answer was lost): report it, do not post again.
      if (item.platformPostId) return { ok: true, platformPostId: item.platformPostId, permalink: item.permalink };

      if (post.status !== "approved") {
        return fail("unknown", false, post.status === "posted" ? "This post was already shared." : "The post is not approved, so it was not published.");
      }

      const conn = await getConnection(brandId, provider);
      if (!conn || conn.status === "revoked") return fail("not_connected", false, "No connected account for this channel.");
      if (conn.status !== "active") return fail("token_expired", false, "The connection needs reconnecting.");
      if (conn.expiresAt && new Date(conn.expiresAt).getTime() <= now.getTime()) {
        await markConnectionProblem({ brandId, provider, status: "expired", message: "The permission has ended." }).catch(() => false);
        return fail("token_expired", false, "The permission has ended. Please reconnect.");
      }

      const storage = deps.storage ?? getStorage();
      token = await readToken({ id: conn.id, brandId, provider });
      const caption = composeCaption(post.caption, post.hashtags, provider === "instagram" ? undefined : 8000, provider === "instagram" ? undefined : 30);
      const isCarousel = loaded.slides.length >= 2;

      if (provider === "instagram") {
        let job: InstagramJob;
        if (isCarousel) {
          job = { kind: "carousel", caption, urls: await urlsFor(loaded.slides, "instagram", storage) };
        } else {
          const kind = instagramKind(loaded.images);
          const path = pickImagePath(loaded.images, "instagram", kind);
          if (!path) return fail("media_rejected", false, "The post has no picture for Instagram.");
          const url = await publicUrlFor(path, storage);
          job = kind === "story" ? { kind: "story", url } : { kind: "feed", url, caption };
        }
        return await publishToInstagram(conn.accountId, job, { token, fetch: deps.fetch, sleep, startedAt: now.getTime() });
      }

      const sets: ImageSet[] = isCarousel ? loaded.slides : [loaded.images];
      const urls = await urlsFor(sets, "facebook", storage);
      return await publishToFacebookPage(conn.accountId, { urls, message: caption }, { token, fetch: deps.fetch, startedAt: now.getTime() });
    } catch (e) {
      const result = e instanceof GraphError ? mapGraphError(e) : toFailure(e, token ? [token] : []);
      if (!result.ok) result.message = scrub(result.message, token ? [token] : []);
      if (!result.ok && result.reason === "token_expired" && e instanceof GraphError && active) {
        // Meta says the permission is gone: pause this channel and tell the owner once.
        await markConnectionProblem({ brandId, provider: active, status: "expired", message: result.message }).catch(() => false);
      }
      return result;
    }
  };
}

async function urlsFor(sets: ImageSet[], provider: "instagram" | "facebook", storage: Storage): Promise<string[]> {
  const urls: string[] = [];
  for (const set of sets) {
    const path = pickImagePath(set, provider);
    if (!path) throw new PublishStop("media_rejected", false, "A picture of the post is missing.");
    urls.push(await publicUrlFor(path, storage));
  }
  return urls;
}

/** The publisher the queue sweep calls. */
export const publishQueueItem: PublishQueueItem = createPublisher();
