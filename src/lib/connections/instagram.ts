// "Instagram API with Instagram Login" (Business Login for Instagram), C-25. Scopes: instagram_business_basic and
// instagram_business_content_publish. Reference (Meta developers):
//   authorize   https://www.instagram.com/oauth/authorize
//   code -> short-lived token      POST https://api.instagram.com/oauth/access_token
//   short -> long-lived (60 days)  GET  https://graph.instagram.com/access_token?grant_type=ig_exchange_token
//   refresh                        GET  https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token
//   profile                        GET  https://graph.instagram.com/{version}/me?fields=user_id,username,account_type

import { INSTAGRAM_SCOPES, graphVersion, instagramApp, redirectUri } from "./config";
import { GraphError, graphRequest, type FetchLike } from "./graph";
import { ConnectionError } from "./types";

/** Account types that can publish. A personal account cannot. */
export const PUBLISHING_ACCOUNT_TYPES = ["BUSINESS", "MEDIA_CREATOR", "CREATOR"] as const;

export function instagramAuthorizeUrl(state: string): string {
  const app = instagramApp();
  if (!app) throw new ConnectionError("not_configured");
  const url = new URL("https://www.instagram.com/oauth/authorize");
  url.searchParams.set("client_id", app.appId);
  url.searchParams.set("redirect_uri", redirectUri("instagram"));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", INSTAGRAM_SCOPES.join(","));
  url.searchParams.set("state", state);
  return url.toString();
}

export interface InstagramExchange {
  token: string;
  userId: string;
  /** Permissions the owner granted; empty when Meta did not say. */
  permissions: string[];
}

function str(v: unknown): string | null {
  if (typeof v === "string" && v !== "") return v;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

/** Trades the code from the callback for a short-lived token. Meta answers either a flat object or { data: [ ... ] }. */
export async function exchangeInstagramCode(code: string, fetch?: FetchLike): Promise<InstagramExchange> {
  const app = instagramApp();
  if (!app) throw new ConnectionError("not_configured");
  const body = await graphRequest<Record<string, unknown>>({
    method: "POST",
    url: "https://api.instagram.com/oauth/access_token",
    params: {
      client_id: app.appId,
      client_secret: app.appSecret,
      grant_type: "authorization_code",
      redirect_uri: redirectUri("instagram"),
      code: code.replace(/#_$/, ""),
    },
    secrets: [app.appSecret],
    fetch,
  });
  const first = Array.isArray(body.data) && body.data[0] && typeof body.data[0] === "object" ? (body.data[0] as Record<string, unknown>) : body;
  const token = str(first.access_token);
  const userId = str(first.user_id);
  if (!token || !userId) throw new GraphError({ httpStatus: 200, message: "Instagram did not return an access token." });
  const p = first.permissions;
  const permissions = Array.isArray(p) ? p.map(String) : typeof p === "string" ? p.split(/[,\s]+/).filter(Boolean) : [];
  return { token, userId, permissions };
}

export interface InstagramProfile {
  /** The Instagram professional account id (used in publishing calls). */
  id: string;
  /** Other ids Meta may use for this person in deauthorize and deletion requests. */
  otherIds: string[];
  username: string | null;
  accountType: string | null;
}

export async function fetchInstagramProfile(token: string, fetch?: FetchLike): Promise<InstagramProfile> {
  const body = await graphRequest<Record<string, unknown>>({
    url: `https://graph.instagram.com/${graphVersion()}/me`,
    params: { fields: "user_id,username,account_type" },
    token,
    fetch,
  });
  const id = str(body.user_id) ?? str(body.id);
  if (!id) throw new GraphError({ httpStatus: 200, message: "Instagram did not return the account id." });
  const other = str(body.id);
  return {
    id,
    otherIds: other && other !== id ? [other] : [],
    username: str(body.username),
    accountType: str(body.account_type)?.toUpperCase() ?? null,
  };
}

export const canPublish = (accountType: string | null): boolean =>
  accountType !== null && (PUBLISHING_ACCOUNT_TYPES as readonly string[]).includes(accountType);

export interface LongLivedToken {
  token: string;
  /** Seconds until it stops working (about 60 days). */
  expiresIn: number;
}

function longLived(body: Record<string, unknown>, fallbackToken: string): LongLivedToken {
  const token = str(body.access_token) ?? fallbackToken;
  const expiresIn = typeof body.expires_in === "number" && body.expires_in > 0 ? body.expires_in : 60 * 24 * 3600;
  return { token, expiresIn };
}

/** Short-lived (1 hour) to long-lived (60 days). */
export async function exchangeForLongLived(shortToken: string, fetch?: FetchLike): Promise<LongLivedToken> {
  const app = instagramApp();
  if (!app) throw new ConnectionError("not_configured");
  const body = await graphRequest<Record<string, unknown>>({
    url: "https://graph.instagram.com/access_token",
    params: { grant_type: "ig_exchange_token", client_secret: app.appSecret },
    token: shortToken,
    secrets: [app.appSecret],
    fetch,
  });
  return longLived(body, shortToken);
}

/** A long-lived token at least 24 hours old can be renewed for another 60 days. */
export async function refreshLongLived(token: string, fetch?: FetchLike): Promise<LongLivedToken> {
  const body = await graphRequest<Record<string, unknown>>({
    url: "https://graph.instagram.com/refresh_access_token",
    params: { grant_type: "ig_refresh_token" },
    token,
    fetch,
  });
  return longLived(body, token);
}
