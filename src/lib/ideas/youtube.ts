// YouTube source (R-4): YouTube Data API v3. Needs YOUTUBE_API_KEY (optional: without it the source is skipped
// cleanly and nothing is called). For one "youtube" query: search videos published inside the window, in the
// brand's country, then read their statistics and keep the top 5 by views.
//
// What is kept: video link, title, date and public counts. Not the channel or the uploader (no profiles of people).
// Quota: a search costs 100 units and a videos.list 1 unit, of 10 000 a day; there is no money cost.

import type { FetchLike } from "@/lib/connections/graph";
import { oneLine, type GatheredFinding } from "./findings";
import type { PlannedQuery, TrendSource } from "./types";
import { inWindow, type ResearchWindow } from "./window";

export const YOUTUBE_TOP = 5;
export const YOUTUBE_SEARCH_RESULTS = 15;
const API = "https://www.googleapis.com/youtube/v3";
const TIMEOUT_MS = 15_000;

export class YoutubeError extends Error {
  constructor(public readonly status: number) {
    super(`YouTube API error ${status}`);
    this.name = "YoutubeError";
  }
}

/** The key, or null when it is not set (the source is then skipped). */
export function youtubeKey(env: Record<string, string | undefined>): string | null {
  const k = (env.YOUTUBE_API_KEY ?? "").trim();
  return k === "" ? null : k;
}

/** YouTube's region code: two capital letters; null for anything else. */
export function regionCode(countryCode: string | null): string | null {
  const c = (countryCode ?? "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(c) ? c : null;
}

async function getJson(url: string, params: Record<string, string>, key: string, fetchFn: FetchLike): Promise<Record<string, unknown>> {
  const qs = new URLSearchParams({ ...params, key });
  let res: Response;
  try {
    res = await fetchFn(`${API}/${url}?${qs.toString()}`, { method: "GET", signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
  } catch {
    throw new YoutubeError(0); // no URL or key in the message
  }
  if (!res.ok) throw new YoutubeError(res.status);
  try {
    const body = (await res.json()) as unknown;
    return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  } catch {
    throw new YoutubeError(res.status);
  }
}

const asNumber = (v: unknown): number | undefined => {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) && n >= 0 ? n : undefined;
};

interface Video {
  id: string;
  title: string;
  date: string;
  views: number;
  likes?: number;
  comments?: number;
}

/** Top videos for one query. Throws YoutubeError on an API problem. */
export async function searchYoutube(
  query: PlannedQuery,
  o: { key: string; region: string | null; window: ResearchWindow; fetch: FetchLike },
): Promise<GatheredFinding | null> {
  const search = await getJson(
    "search",
    {
      part: "snippet",
      type: "video",
      q: query.q,
      publishedAfter: `${o.window.start}T00:00:00Z`,
      maxResults: String(YOUTUBE_SEARCH_RESULTS),
      order: "relevance",
      safeSearch: "moderate",
      ...(o.region ? { regionCode: o.region } : {}),
    },
    o.key,
    o.fetch,
  );
  const ids: string[] = [];
  for (const item of Array.isArray(search.items) ? search.items : []) {
    const id = (item as { id?: { videoId?: unknown } })?.id?.videoId;
    if (typeof id === "string" && /^[A-Za-z0-9_-]{6,20}$/.test(id) && !ids.includes(id)) ids.push(id);
  }
  if (ids.length === 0) return null;

  const stats = await getJson("videos", { part: "snippet,statistics", id: ids.join(",") }, o.key, o.fetch);
  const videos: Video[] = [];
  for (const item of Array.isArray(stats.items) ? stats.items : []) {
    const v = item as { id?: unknown; snippet?: { title?: unknown; publishedAt?: unknown }; statistics?: Record<string, unknown> };
    if (typeof v.id !== "string" || typeof v.snippet?.title !== "string" || typeof v.snippet.publishedAt !== "string") continue;
    const date = v.snippet.publishedAt.slice(0, 10);
    const views = asNumber(v.statistics?.viewCount);
    if (!inWindow(date, o.window) || views === undefined) continue; // undated or hidden counts: not usable
    videos.push({ id: v.id, title: oneLine(v.snippet.title, 200), date, views, likes: asNumber(v.statistics?.likeCount), comments: asNumber(v.statistics?.commentCount) });
  }
  videos.sort((a, b) => b.views - a.views || a.id.localeCompare(b.id));
  const top = videos.slice(0, YOUTUBE_TOP);
  if (top.length === 0) return null;

  const sources: TrendSource[] = top.map((v) => ({
    url: `https://www.youtube.com/watch?v=${v.id}`,
    title: v.title,
    site: "youtube.com",
    publishedAt: v.date,
    kind: "youtube",
    engagement: { views: v.views, ...(v.likes !== undefined ? { likes: v.likes } : {}), ...(v.comments !== undefined ? { comments: v.comments } : {}) },
  }));
  return {
    topic: oneLine(query.q, 80),
    note: `Popular recent videos about ${oneLine(query.q, 80)}.`,
    sources,
    kind: "trend",
    velocity: null,
  };
}
