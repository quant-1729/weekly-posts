// Shared types of Ideas (trend research, docs/10-plan-research-and-brand-face.md §1). Orchestrator-owned:
// the database shape is supabase/migrations/0021_ideas_and_faces.sql. Pure; safe in the browser.

import type { PostType } from '@/lib/briefs/types';

/** At most this many competitors per brand (R-1). */
export const MAX_COMPETITORS = 5;
/** Research looks back this many days; the window is set in code, never by the model. */
export const RESEARCH_WINDOW_DAYS = 30;
/** Cards and ideas per run. */
export const MAX_CARDS = 5;
export const IDEAS_PER_CARD = 3;
/** "Research now" runs per brand per week (on top of the weekly run). */
export const MANUAL_RUNS_PER_WEEK = 2;
/** Research spend cap per brand per week, in USD (owner decision 2026-10-15). */
export const RESEARCH_WEEKLY_CAP_USD = 0.5;
/** Grounded searches per run (cost control); the planner may ask for fewer. */
export const MAX_QUERIES = 8;
/** A card is shown for this many days, then expires. */
export const CARD_TTL_DAYS = 14;

export interface Competitor {
  id: string;
  brandId: string;
  name: string;
  website: string | null;
  instagramHandle: string | null;
  youtubeHandle: string | null;
}

export type SourceKind = 'web' | 'competitor_site' | 'competitor_instagram' | 'youtube' | 'reddit' | 'news';

/** One cited source on a card: link, title, site and date only (no copied text, no private usernames). */
export interface TrendSource {
  url: string;
  title: string;
  site: string;
  /** YYYY-MM-DD. A source without a date inside the run's window is dropped. */
  publishedAt: string;
  kind: SourceKind;
  /** Public engagement counts when the source has them (competitor Instagram, YouTube). */
  engagement?: { likes?: number; comments?: number; views?: number };
}

/** What a gatherer returns before cards are made: one finding with its sources. */
export interface Finding {
  topic: string;
  /** Our own one-line summary (never copied wording). */
  note: string;
  sources: TrendSource[];
}

export type TrendKind = 'trend' | 'competitor' | 'seasonal';
export type Confidence = 'low' | 'medium' | 'high';
export type CardStatus = 'new' | 'used' | 'dismissed' | 'expired';

export interface TrendCard {
  id: string;
  brandId: string;
  runId: string;
  title: string;
  summary: string;
  whyItMatters: string;
  kind: TrendKind;
  sources: TrendSource[];
  /** 0-100: recency, velocity, engagement and brand fit, computed in code (src/lib/ideas/score.ts). */
  score: number;
  /** Change vs last week's snapshot; null without history. */
  velocity: number | null;
  confidence: Confidence;
  status: CardStatus;
  expiresAt: string;
  createdAt: string;
}

export type IdeaFormat = 'single' | 'carousel' | 'story' | 'reel';
export type IdeaStatus = 'new' | 'used' | 'dismissed' | 'queued';

/**
 * A post idea. `description` becomes the Create a post description (an owner fact once saved), so it never
 * holds prices, numbers, percentages, dates, ratings or claims: those are removed in code and listed in `flags`.
 */
export interface PostIdea {
  id: string;
  brandId: string;
  cardId: string;
  postType: PostType;
  angle: string;
  description: string;
  format: IdeaFormat | null;
  flags: string[];
  status: IdeaStatus;
  briefId: string | null;
}

export type RunTrigger = 'weekly' | 'manual';
export type RunStatus = 'running' | 'done' | 'failed' | 'capped';

export interface ResearchRun {
  id: string;
  brandId: string;
  trigger: RunTrigger;
  status: RunStatus;
  windowStart: string;
  windowEnd: string;
  focus: string | null;
  queries: PlannedQuery[];
  sourcesCount: number;
  costUsd: number;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}

/** One search the planner asked for. `source` decides which gatherer runs it. */
export interface PlannedQuery {
  q: string;
  source: 'web' | 'youtube';
  why: string;
}

/** Insights of one published post at one age (R-8). */
export interface PostMetrics {
  queueItemId: string;
  ageHours: number;
  reach: number | null;
  impressions: number | null;
  likes: number | null;
  comments: number | null;
  saves: number | null;
  shares: number | null;
  views: number | null;
}
