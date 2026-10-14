// Facebook Login for Pages (C-25). Scopes: pages_manage_posts, pages_read_engagement, pages_show_list.
//   authorize   https://www.facebook.com/{version}/dialog/oauth
//   code -> user token       GET https://graph.facebook.com/{version}/oauth/access_token
//   short -> long-lived      same endpoint with grant_type=fb_exchange_token
//   the owner's Pages        GET /me/accounts?fields=id,name,access_token   (Page tokens from a long-lived user token do not expire)
//
// When the owner has more than one Page they pick one on /connections/facebook. In between, the long-lived USER
// token waits in a short-lived httpOnly cookie, encrypted (AES-GCM, bound to brand + user). Page tokens never go
// to the browser: the pick re-reads the Pages with that user token and keeps only the chosen Page's token.

import { FACEBOOK_SCOPES, graphVersion, metaApp, redirectUri } from "./config";
import { decryptToken, encryptToken, type EncryptedToken } from "./crypto";
import { GraphError, graphRequest, type FetchLike } from "./graph";
import { ConnectionError } from "./types";

export const FB_PENDING_COOKIE = "pm_fb_pending";
export const FB_PENDING_TTL_SECONDS = 10 * 60;

export function facebookAuthorizeUrl(state: string): string {
  const app = metaApp();
  if (!app) throw new ConnectionError("not_configured");
  const url = new URL(`https://www.facebook.com/${graphVersion()}/dialog/oauth`);
  url.searchParams.set("client_id", app.appId);
  url.searchParams.set("redirect_uri", redirectUri("facebook"));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", FACEBOOK_SCOPES.join(","));
  url.searchParams.set("state", state);
  return url.toString();
}

const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);

/** Code -> long-lived user token (two calls). */
export async function exchangeFacebookCode(code: string, fetch?: FetchLike): Promise<string> {
  const app = metaApp();
  if (!app) throw new ConnectionError("not_configured");
  const url = `https://graph.facebook.com/${graphVersion()}/oauth/access_token`;
  const shortBody = await graphRequest<Record<string, unknown>>({
    url,
    params: { client_id: app.appId, client_secret: app.appSecret, redirect_uri: redirectUri("facebook"), code },
    secrets: [app.appSecret],
    fetch,
  });
  const short = str(shortBody.access_token);
  if (!short) throw new GraphError({ httpStatus: 200, message: "Facebook did not return an access token." });
  const longBody = await graphRequest<Record<string, unknown>>({
    url,
    params: { grant_type: "fb_exchange_token", client_id: app.appId, client_secret: app.appSecret, fb_exchange_token: short },
    secrets: [app.appSecret, short],
    fetch,
  });
  return str(longBody.access_token) ?? short;
}

export async function fetchFacebookUserId(userToken: string, fetch?: FetchLike): Promise<string> {
  const body = await graphRequest<Record<string, unknown>>({
    url: `https://graph.facebook.com/${graphVersion()}/me`,
    params: { fields: "id" },
    token: userToken,
    fetch,
  });
  const id = str(body.id);
  if (!id) throw new GraphError({ httpStatus: 200, message: "Facebook did not return the account id." });
  return id;
}

export interface FacebookPage {
  id: string;
  name: string;
  /** The Page access token. Server only: never sent to a browser. */
  accessToken: string;
}

export async function fetchPages(userToken: string, fetch?: FetchLike): Promise<FacebookPage[]> {
  const body = await graphRequest<{ data?: unknown }>({
    url: `https://graph.facebook.com/${graphVersion()}/me/accounts`,
    params: { fields: "id,name,access_token", limit: 100 },
    token: userToken,
    fetch,
  });
  const out: FacebookPage[] = [];
  if (Array.isArray(body.data)) {
    for (const p of body.data) {
      if (!p || typeof p !== "object") continue;
      const r = p as Record<string, unknown>;
      const id = str(r.id);
      const accessToken = str(r.access_token);
      if (id && accessToken) out.push({ id, name: str(r.name) ?? id, accessToken });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// The wait between "logged in" and "picked a Page"
// ---------------------------------------------------------------------------

interface PendingPayload {
  v: 1;
  brandId: string;
  userId: string;
  fbUserId: string;
  exp: number; // epoch seconds
  enc: EncryptedToken;
}

const pendingAad = (brandId: string, userId: string) => `fb-pending:${brandId}:${userId}`;

/** The cookie value: base64url JSON holding the encrypted long-lived user token. */
export function sealPending(args: { brandId: string; userId: string; fbUserId: string; userToken: string }, nowMs: number = Date.now()): string {
  const payload: PendingPayload = {
    v: 1,
    brandId: args.brandId,
    userId: args.userId,
    fbUserId: args.fbUserId,
    exp: Math.floor(nowMs / 1000) + FB_PENDING_TTL_SECONDS,
    enc: encryptToken(args.userToken, pendingAad(args.brandId, args.userId)),
  };
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

export interface OpenedPending {
  brandId: string;
  userId: string;
  fbUserId: string;
  userToken: string;
}

/** Throws ConnectionError('pending_expired') when the cookie is missing, altered, expired or another user's. */
export function openPending(cookie: string | null | undefined, userId: string, nowMs: number = Date.now()): OpenedPending {
  if (!cookie || cookie.length > 3500) throw new ConnectionError("pending_expired");
  try {
    const p = JSON.parse(Buffer.from(cookie, "base64url").toString("utf8")) as PendingPayload;
    if (p.v !== 1 || p.userId !== userId || typeof p.exp !== "number" || p.exp * 1000 < nowMs) throw new ConnectionError("pending_expired");
    return { brandId: p.brandId, userId: p.userId, fbUserId: p.fbUserId, userToken: decryptToken(p.enc, pendingAad(p.brandId, p.userId)) };
  } catch {
    throw new ConnectionError("pending_expired");
  }
}
