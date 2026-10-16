// Insights loop (R-8): how each published post performed, fetched from Instagram and Facebook at about 24 h, 72 h
// and 7 days after it went out. Shapes only; the database is supabase/migrations/0021_ideas_and_faces.sql (post_metrics).

import type { PostType } from "@/lib/briefs/types";
import type { PostMetrics } from "@/lib/ideas/types";
import type { Provider } from "@/lib/queue/types";

export type { PostMetrics };

/** The ages (hours after publishing) at which a post is measured. One post_metrics row per post and bucket (age_hours holds the bucket). */
export const INSIGHT_BUCKETS = [24, 72, 168] as const;
export type InsightBucket = (typeof INSIGHT_BUCKETS)[number];

/** Instagram story insights vanish 24 h after posting, so a story is measured once, from this age (stored as bucket 24). */
export const STORY_FETCH_FROM_HOURS = 20;
/** Posts older than this are no longer measured (a bucket missed for this long stays missing). */
export const INSIGHTS_MAX_AGE_DAYS = 30;
/** Posts measured per sweep run. */
export const SWEEP_BATCH = 40;

/** Permission an Instagram connection needs for insights (Instagram Login). */
export const IG_INSIGHTS_SCOPE = "instagram_business_manage_insights";
/** Permissions a Facebook Page connection needs for post insights. */
export const FB_INSIGHTS_SCOPES = ["read_insights", "pages_read_engagement"] as const;

/** The number columns of post_metrics. */
export type MetricField = "reach" | "impressions" | "likes" | "comments" | "saves" | "shares" | "views";
export const METRIC_FIELDS: readonly MetricField[] = ["reach", "impressions", "likes", "comments", "saves", "shares", "views"];
export type MetricValues = Partial<Record<MetricField, number>>;

/** What one fetch brought back: the numbers Meta gave, and the metrics it refused (deprecated or not valid for this post). */
export interface FetchedInsights {
  metrics: MetricValues;
  skipped: string[];
}

export type InstagramMediaKind = "feed" | "carousel" | "reel" | "story";
export type InsightsFailureKind = "permission" | "token" | "transient";

/** A fetch that cannot give an answer now: no permission, a bad token, or Meta having a bad moment. Messages never hold a token. */
export class InsightsError extends Error {
  constructor(
    public readonly kind: InsightsFailureKind,
    message: string,
  ) {
    super(message);
    this.name = "InsightsError";
  }
}

/** A published post with the numbers it earned (latest bucket), plus what it was, for the growth report (R-9). */
export interface BrandPostMetrics extends PostMetrics {
  postId: string;
  channel: string;
  postType: PostType | null;
  themeId: string | null;
  permalink: string | null;
  postedAt: string;
  /** Hour of the day (0-23) the post went out, in the brand's time zone. */
  postedHour: number;
  /** ISO weekday of the post in the brand's time zone, 1 = Monday. */
  postedWeekday: number;
  /** The post was made from a trend idea ("Make this post"). */
  fromIdea: boolean;
}

export type InsightsPermission = "ok" | "missing" | "not_connected";
export type InsightsPermissionByProvider = Record<Provider, InsightsPermission>;
