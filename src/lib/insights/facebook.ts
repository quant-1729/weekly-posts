// Insights of one Facebook Page post (graph.facebook.com, Page access token):
//   GET /{version}/{post-id}/insights?metric=post_impressions_unique,post_impressions,post_reactions_by_type_total,post_media_view
//       post_impressions_unique -> reach, post_impressions -> impressions, post_reactions_by_type_total -> likes (all reactions added up),
//       post_media_view -> views (Meta's replacement for impressions; asked for, and skipped if the Page does not have it)
//   GET /{version}/{post-id}?fields=shares,comments.summary(true)   -> shares, comments
// Needs read_insights and pages_read_engagement. Same rules as Instagram: a refused metric is skipped, a missing
// permission, a bad token or a busy Meta stops the fetch (InsightsError). post_clicks is not asked: post_metrics has no column for it.

import { graphVersion } from "@/lib/connections/config";
import { GraphError, graphRequest, type FetchLike } from "@/lib/connections/graph";
import { count, stopFor } from "./errors";
import type { FetchedInsights, MetricField, MetricValues } from "./types";

const base = () => `https://graph.facebook.com/${graphVersion()}`;

export const FB_METRICS = ["post_impressions_unique", "post_impressions", "post_reactions_by_type_total", "post_media_view"] as const;

const FIELD_OF: Record<string, MetricField> = {
  post_impressions_unique: "reach",
  post_impressions: "impressions",
  post_reactions_by_type_total: "likes",
  post_media_view: "views",
};

interface InsightRow {
  name?: unknown;
  values?: Array<{ value?: unknown }>;
}

export function readFacebookRows(body: { data?: unknown }): MetricValues {
  const out: MetricValues = {};
  if (!Array.isArray(body.data)) return out;
  for (const row of body.data as InsightRow[]) {
    const field = typeof row?.name === "string" ? FIELD_OF[row.name] : undefined;
    if (!field) continue;
    const v = row.values?.[0]?.value;
    // Reactions come as { like: 3, love: 1, ... }: all of them count as likes.
    const n = v && typeof v === "object" ? Object.values(v as Record<string, unknown>).reduce<number>((sum, x) => sum + (count(x) ?? 0), 0) : count(v);
    if (n !== null) out[field] = n;
  }
  return out;
}

export async function fetchFacebookInsights(args: { postId: string; token: string; fetch?: FetchLike }): Promise<FetchedInsights> {
  const id = encodeURIComponent(args.postId);
  const metrics: MetricValues = {};
  const skipped: string[] = [];
  const ask = (metric: string) => graphRequest<{ data?: unknown }>({ url: `${base()}/${id}/insights`, params: { metric }, token: args.token, fetch: args.fetch });

  let combined = false;
  try {
    Object.assign(metrics, readFacebookRows(await ask(FB_METRICS.join(","))));
    combined = true;
  } catch (e) {
    if (!(e instanceof GraphError)) throw e;
    const stop = stopFor(e, args.token);
    if (stop) throw stop;
  }
  if (!combined) {
    for (const name of FB_METRICS) {
      try {
        Object.assign(metrics, readFacebookRows(await ask(name)));
      } catch (e) {
        if (!(e instanceof GraphError)) throw e;
        const stop = stopFor(e, args.token);
        if (stop) throw stop;
        skipped.push(name);
      }
    }
  }

  // Shares and comments are fields of the post itself.
  try {
    const post = await graphRequest<{ shares?: { count?: unknown }; comments?: { summary?: { total_count?: unknown } } }>({
      url: `${base()}/${id}`,
      params: { fields: "shares,comments.summary(true)" },
      token: args.token,
      fetch: args.fetch,
    });
    // A post nobody shared has no `shares` field at all: that is zero, not unknown.
    metrics.shares = count(post.shares?.count) ?? 0;
    const comments = count(post.comments?.summary?.total_count);
    if (comments !== null) metrics.comments = comments;
  } catch (e) {
    if (!(e instanceof GraphError)) throw e;
    const stop = stopFor(e, args.token);
    if (stop) throw stop;
    skipped.push("shares,comments");
  }
  return { metrics, skipped };
}
