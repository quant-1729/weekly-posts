// Insights of one Instagram post through "Instagram API with Instagram Login" (graph.instagram.com):
//   GET /{version}/{media-id}/insights?metric=...      needs the instagram_business_manage_insights permission
// The metrics asked for each kind of post (Meta changes these; a refused metric is skipped, never an error):
//   feed picture / carousel  reach, likes, comments, saved, shares, views     (impressions is retired, so impressions stays empty)
//   reel                     reach, likes, comments, saved, shares, views
//   story                    reach, replies, views                            (replies are stored as comments)
// One request asks for all of them. If Meta refuses it because of one metric, each metric is asked alone and the
// refused ones are listed in `skipped`. A missing permission, a bad token or a busy Meta stops the fetch (InsightsError).
// total_interactions is not asked: post_metrics has no column for it.

import { graphVersion } from "@/lib/connections/config";
import { GraphError, graphRequest, type FetchLike } from "@/lib/connections/graph";
import { count, stopFor } from "./errors";
import type { FetchedInsights, InstagramMediaKind, MetricField, MetricValues } from "./types";

const base = () => `https://graph.instagram.com/${graphVersion()}`;

export const IG_METRICS: Record<InstagramMediaKind, readonly string[]> = {
  feed: ["reach", "likes", "comments", "saved", "shares", "views"],
  carousel: ["reach", "likes", "comments", "saved", "shares", "views"],
  reel: ["reach", "likes", "comments", "saved", "shares", "views"],
  story: ["reach", "replies", "views"],
};

const FIELD_OF: Record<string, MetricField> = {
  reach: "reach",
  likes: "likes",
  comments: "comments",
  saved: "saves",
  shares: "shares",
  views: "views",
  replies: "comments",
};

interface InsightRow {
  name?: unknown;
  values?: Array<{ value?: unknown }>;
  total_value?: { value?: unknown };
}

/** Reads the `data` rows of an insights answer into our fields. Both answer shapes (values[] and total_value) are understood. */
export function readInstagramRows(body: { data?: unknown }): MetricValues {
  const out: MetricValues = {};
  if (!Array.isArray(body.data)) return out;
  for (const row of body.data as InsightRow[]) {
    const field = typeof row?.name === "string" ? FIELD_OF[row.name] : undefined;
    if (!field) continue;
    const n = count(row.total_value?.value ?? row.values?.[0]?.value);
    if (n !== null) out[field] = n;
  }
  return out;
}

export async function fetchInstagramInsights(args: { mediaId: string; kind: InstagramMediaKind; token: string; fetch?: FetchLike }): Promise<FetchedInsights> {
  const names = IG_METRICS[args.kind];
  const url = `${base()}/${encodeURIComponent(args.mediaId)}/insights`;
  const ask = (metric: string) => graphRequest<{ data?: unknown }>({ url, params: { metric }, token: args.token, fetch: args.fetch });

  try {
    return { metrics: readInstagramRows(await ask(names.join(","))), skipped: [] };
  } catch (e) {
    if (!(e instanceof GraphError)) throw e;
    const stop = stopFor(e, args.token);
    if (stop) throw stop;
  }

  // One metric is refused: ask for them one at a time and keep what works.
  const metrics: MetricValues = {};
  const skipped: string[] = [];
  for (const name of names) {
    try {
      Object.assign(metrics, readInstagramRows(await ask(name)));
    } catch (e) {
      if (!(e instanceof GraphError)) throw e;
      const stop = stopFor(e, args.token);
      if (stop) throw stop;
      skipped.push(name);
    }
  }
  return { metrics, skipped };
}
