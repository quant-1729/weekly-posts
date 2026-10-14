// Meta's Business Discovery: reads the recent public posts of an Instagram Business or Creator
// account through OUR Instagram professional account. The owner logs in nowhere.
//   GET https://graph.facebook.com/{version}/{our ig user id}?fields=business_discovery.username({handle}){...}&access_token=...
// Reference: https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/business_discovery
// The token is only ever placed in the request; it is never logged, returned or put in an error.

import { instagramConfig, instagramMode, type InstagramConfig, type InstagramMode } from "./config";
import { fixtureGraphFetch } from "./fixtures";
import { HANDLE_RE } from "./handle";
import { GRAPH_TIMEOUT_MS } from "./limits";

export type MediaType = "IMAGE" | "VIDEO" | "CAROUSEL_ALBUM";

export interface InstagramMedia {
  /** Instagram's media id. */
  id: string;
  /** Null when the post has no caption. */
  caption: string | null;
  mediaType: MediaType;
  /** Link to the original post (https://www.instagram.com/...), or null. */
  permalink: string | null;
  /** ISO time, or null. */
  postedAt: string | null;
  /** A picture to show or save: the image, a video's thumbnail, or a carousel's first image. Null when none came back. */
  imageUrl: string | null;
}

export interface InstagramAccount {
  username: string;
  name: string | null;
  followers: number | null;
  mediaCount: number | null;
}

export type DiscoveryFailure =
  | "not_business" // a personal account (or one Instagram will not share), or an age-gated one
  | "not_found" // no such account
  | "rate_limited" // Meta's hourly limit for our token
  | "token_problem" // our token or settings are wrong or expired: not the owner's fault
  | "network" // timeout, connection, Meta error or an answer we could not read
  | "unavailable"; // the feature is not switched on

export type DiscoveryResult =
  | { ok: true; account: InstagramAccount; media: InstagramMedia[] }
  | { ok: false; reason: DiscoveryFailure };

// ---------------------------------------------------------------------------
// The request
// ---------------------------------------------------------------------------

const MEDIA_FIELDS_FULL = "id,caption,media_type,media_url,permalink,timestamp,thumbnail_url,children{media_type,media_url}";
// If Meta rejects a field for other people's media, the second attempt asks for the sure ones only.
const MEDIA_FIELDS_MINIMAL = "id,caption,media_type,media_url,permalink,timestamp";

export function buildFields(handle: string, mediaFields: string = MEDIA_FIELDS_FULL): string {
  return `business_discovery.username(${handle}){username,name,followers_count,media_count,media.limit(25){${mediaFields}}}`;
}

function buildUrl(cfg: InstagramConfig, handle: string, mediaFields: string): URL {
  const url = new URL(`https://graph.facebook.com/${cfg.version}/${cfg.userId}`);
  url.searchParams.set("fields", buildFields(handle, mediaFields));
  url.searchParams.set("access_token", cfg.token);
  return url;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

interface GraphError {
  message?: unknown;
  type?: unknown;
  code?: unknown;
  error_subcode?: unknown;
}

const RATE_CODES = new Set([4, 17, 32, 613, 80001, 80002, 80003, 80004, 80005, 80006, 80008, 80009, 80014]);

/**
 * Turns Meta's error answer into one of our reasons. Meta words these loosely (a personal account and a
 * misspelt name can both come back as "Invalid user id"), so this reads the code first and the text second.
 */
export function mapGraphError(httpStatus: number, body: unknown): DiscoveryFailure {
  const err: GraphError | undefined =
    body && typeof body === "object" && "error" in body ? ((body as { error?: GraphError }).error ?? undefined) : undefined;
  const code = typeof err?.code === "number" ? err.code : Number(err?.code);
  const subcode = typeof err?.error_subcode === "number" ? err.error_subcode : Number(err?.error_subcode);
  const message = typeof err?.message === "string" ? err.message : "";

  if (httpStatus === 429 || RATE_CODES.has(code) || /rate limit|too many calls|request limit/i.test(message)) return "rate_limited";
  if (
    code === 190 ||
    code === 102 ||
    code === 10 ||
    (code >= 200 && code <= 299) ||
    subcode === 458 ||
    subcode === 459 ||
    subcode === 460 ||
    subcode === 463 ||
    subcode === 467 ||
    /access token|session has expired|permission/i.test(message) ||
    httpStatus === 401 ||
    httpStatus === 403
  ) {
    return "token_problem";
  }
  // Our own account id is wrong or our app cannot see it.
  if (/object with id|unsupported get request|nonexisting field \(business_discovery\)/i.test(message)) return "token_problem";
  if (/not a (business|creator)|personal account|business or creator|is private|age[- ]?(gated|restrict)/i.test(message)) return "not_business";
  if (code === 110 || /invalid user id|cannot find|not found|does not exist|no (such )?user|unknown (user|username)/i.test(message)) return "not_found";
  return "network";
}

function isFieldError(httpStatus: number, body: unknown): boolean {
  if (httpStatus !== 400) return false;
  const err = body && typeof body === "object" ? (body as { error?: GraphError }).error : undefined;
  return err?.code === 100 && typeof err.message === "string" && /nonexisting field|tried accessing/i.test(err.message);
}

// ---------------------------------------------------------------------------
// Reading the answer (defensively: what comes back for other accounts is not fully documented)
// ---------------------------------------------------------------------------

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

const INSTAGRAM_LINK = /^https:\/\/(www\.)?instagram\.com\//i;

function mediaTypeOf(v: unknown): MediaType {
  return v === "VIDEO" || v === "CAROUSEL_ALBUM" ? v : "IMAGE";
}

/** Only https picture addresses count. Fixture mode (development) also allows its own small SVG data addresses. */
function pictureOrNull(v: unknown, allowData: boolean): string | null {
  const s = str(v);
  if (!s) return null;
  if (/^https:\/\//i.test(s)) return s;
  return allowData && s.startsWith("data:image/svg+xml;utf8,") ? s : null;
}

/** Image to show for one post: image -> media_url; video -> thumbnail_url; carousel -> first image child. */
function pickImage(m: Record<string, unknown>, type: MediaType, allowData: boolean): string | null {
  const pic = (v: unknown) => pictureOrNull(v, allowData);
  if (type === "VIDEO") return pic(m.thumbnail_url); // a video's media_url is the video file itself
  if (type === "CAROUSEL_ALBUM") {
    const kids = (m.children as { data?: unknown } | undefined)?.data;
    if (Array.isArray(kids)) {
      for (const k of kids) {
        if (!k || typeof k !== "object") continue;
        const kid = k as Record<string, unknown>;
        if (mediaTypeOf(kid.media_type) === "IMAGE" && pic(kid.media_url)) return pic(kid.media_url);
      }
    }
    return pic(m.media_url) ?? pic(m.thumbnail_url);
  }
  return pic(m.media_url) ?? pic(m.thumbnail_url);
}

function parseMedia(raw: unknown, allowData: boolean): InstagramMedia | null {
  if (!raw || typeof raw !== "object") return null;
  const m = raw as Record<string, unknown>;
  const id = str(m.id);
  if (!id || !/^[A-Za-z0-9_]{1,64}$/.test(id)) return null;
  const type = mediaTypeOf(m.media_type);
  const ts = str(m.timestamp);
  const when = ts && !Number.isNaN(Date.parse(ts)) ? new Date(ts).toISOString() : null;
  const link = str(m.permalink);
  return {
    id,
    caption: str(m.caption),
    mediaType: type,
    permalink: link && INSTAGRAM_LINK.test(link) ? link : null,
    postedAt: when,
    imageUrl: pickImage(m, type, allowData),
  };
}

/** Reads a successful Business Discovery answer. Returns null when it holds no account at all. */
export function parseDiscovery(
  body: unknown,
  opts: { allowData?: boolean } = {},
): { account: InstagramAccount; media: InstagramMedia[] } | null {
  const bd = body && typeof body === "object" ? (body as { business_discovery?: unknown }).business_discovery : undefined;
  if (!bd || typeof bd !== "object") return null;
  const b = bd as Record<string, unknown>;
  const username = str(b.username);
  if (!username) return null;
  const list = (b.media as { data?: unknown } | undefined)?.data;
  const media = Array.isArray(list) ? list.map((x) => parseMedia(x, opts.allowData === true)).filter((x): x is InstagramMedia => x !== null) : [];
  return {
    account: { username, name: str(b.name), followers: num(b.followers_count), mediaCount: num(b.media_count) },
    media,
  };
}

// ---------------------------------------------------------------------------
// The call
// ---------------------------------------------------------------------------

export interface DiscoverOptions {
  /** Test override for fetch. */
  fetch?: typeof fetch;
  /** Test override for the mode and settings (otherwise read from the environment). */
  mode?: InstagramMode;
  config?: InstagramConfig | null;
  timeoutMs?: number;
}

async function callOnce(
  doFetch: typeof fetch,
  url: URL,
  timeoutMs: number,
): Promise<{ status: number; body: unknown } | "network"> {
  try {
    const res = await doFetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    return { status: res.status, body };
  } catch {
    return "network"; // timeout, DNS, connection: the error text could carry the request address, so it is not kept
  }
}

/**
 * Reads the public profile and recent posts of `handle`. Never throws; never logs the token.
 * Not called on page load (callers cache it): Meta allows about 200 calls an hour per token.
 */
export async function discoverInstagram(handle: string, opts: DiscoverOptions = {}): Promise<DiscoveryResult> {
  const mode = opts.mode ?? instagramMode();
  if (mode === "unavailable") return { ok: false, reason: "unavailable" };
  if (!HANDLE_RE.test(handle)) return { ok: false, reason: "not_found" };
  const timeoutMs = opts.timeoutMs ?? GRAPH_TIMEOUT_MS;

  let doFetch: typeof fetch;
  let cfg: InstagramConfig;
  if (mode === "fixture") {
    doFetch = opts.fetch ?? fixtureGraphFetch;
    cfg = opts.config ?? { version: "v23.0", userId: "17841400000000000", token: "fixture-token" };
  } else {
    doFetch = opts.fetch ?? fetch;
    const live = opts.config === undefined ? instagramConfig() : opts.config;
    if (!live) return { ok: false, reason: "unavailable" };
    cfg = live;
  }

  for (const fields of [MEDIA_FIELDS_FULL, MEDIA_FIELDS_MINIMAL]) {
    const reply = await callOnce(doFetch, buildUrl(cfg, handle, fields), timeoutMs);
    if (reply === "network") return { ok: false, reason: "network" };
    if (reply.status >= 200 && reply.status < 300) {
      const parsed = parseDiscovery(reply.body, { allowData: mode === "fixture" });
      if (!parsed) {
        // A 200 with no account in it: the same as an account Instagram will not share.
        const err = reply.body && typeof reply.body === "object" && "error" in reply.body;
        return { ok: false, reason: err ? mapGraphError(reply.status, reply.body) : "not_found" };
      }
      return { ok: true, ...parsed };
    }
    if (fields === MEDIA_FIELDS_FULL && isFieldError(reply.status, reply.body)) continue; // try the sure fields
    if (reply.status >= 500) return { ok: false, reason: "network" };
    return { ok: false, reason: mapGraphError(reply.status, reply.body) };
  }
  return { ok: false, reason: "network" };
}

/** Hosts Instagram serves pictures from. Only these are ever downloaded. */
export function isInstagramImageHost(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" || u.username || u.password || (u.port && u.port !== "443")) return false;
    const h = u.hostname.toLowerCase();
    return h.endsWith(".cdninstagram.com") || h.endsWith(".fbcdn.net") || h === "cdninstagram.com" || h === "fbcdn.net";
  } catch {
    return false;
  }
}
