// The connect flows (C-25): start (build the authorize URL) and finish (the callback). The routes under
// src/app/api/connect are thin wrappers; everything that decides lives here so tests can run it without a browser.
//
// The callback accepts nothing it cannot prove:
//   1. the signed `state` is valid, unexpired and for this provider;
//   2. the signed-in user is the one who started it, and the nonce matches the cookie set at the start;
//   3. that user is an OWNER of the brand (checked again by the database);
//   4. for Instagram, the account is a Business or creator account that granted the publishing permission.
// Only then is a token stored, encrypted. Tokens never reach the browser or a log.

import { connectAvailable, INSTAGRAM_SCOPES, FACEBOOK_SCOPES } from "./config";
import { tokenEncryptionAvailable, TokenKeyError } from "./crypto";
import {
  canPublish,
  exchangeForLongLived,
  exchangeInstagramCode,
  fetchInstagramProfile,
  instagramAuthorizeUrl,
} from "./instagram";
import {
  exchangeFacebookCode,
  facebookAuthorizeUrl,
  fetchFacebookUserId,
  fetchPages,
  openPending,
  sealPending,
  type FacebookPage,
} from "./facebook";
import { GraphError, type FetchLike } from "./graph";
import { requireBrandOwner, saveConnection } from "./service";
import { nonceMatches, signConnectState, verifyConnectState } from "./state";
import { ConnectionError, type ConnectOutcome, type PagePick } from "./types";
import type { Provider } from "@/lib/queue/types";

export interface FlowDeps {
  fetch?: FetchLike;
  now?: Date;
}

/** Checks everything that can be checked before sending the owner to Meta. Returns where to send them and the nonce for the cookie. */
export async function startConnect(args: { userId: string; brandId: string; provider: Provider; now?: Date }): Promise<{ url: string; nonce: string }> {
  if (!connectAvailable(args.provider)) throw new ConnectionError("not_configured");
  if (!tokenEncryptionAvailable()) throw new ConnectionError("key_missing");
  await requireBrandOwner(args.userId, args.brandId);
  const { state, nonce } = await signConnectState(args, args.now?.getTime());
  const url = args.provider === "instagram" ? instagramAuthorizeUrl(state) : facebookAuthorizeUrl(state);
  return { url, nonce };
}

/** Maps what can go wrong inside a flow to one of our codes. */
function failure(e: unknown): ConnectOutcome {
  if (e instanceof ConnectionError) return { ok: false, code: e.code };
  if (e instanceof TokenKeyError) return { ok: false, code: "key_missing" };
  if (e instanceof GraphError) return { ok: false, code: "exchange_failed" };
  console.error("[connections] connect failed:", e instanceof Error ? e.name : "error");
  return { ok: false, code: "exchange_failed" };
}

/** The callback. `userId` is the signed-in user; `nonceCookie` is the cookie set by the start. */
export async function finishConnect(
  args: { provider: Provider; userId: string; code: string | null; state: string | null; nonceCookie: string | null; denied?: boolean },
  deps: FlowDeps = {},
): Promise<ConnectOutcome> {
  const now = deps.now ?? new Date();
  const st = await verifyConnectState(args.state, now.getTime());
  if (!st || st.provider !== args.provider || st.userId !== args.userId || !nonceMatches(st.nonce, args.nonceCookie)) {
    return { ok: false, code: "bad_state" };
  }
  try {
    await requireBrandOwner(args.userId, st.brandId);
    if (args.denied || !args.code) return { ok: false, code: "denied" };
    if (!connectAvailable(args.provider)) return { ok: false, code: "not_configured" };
    if (!tokenEncryptionAvailable()) return { ok: false, code: "key_missing" };
    return args.provider === "instagram"
      ? await finishInstagram({ ...st, userId: args.userId, code: args.code }, deps, now)
      : await finishFacebook({ ...st, userId: args.userId, code: args.code }, deps);
  } catch (e) {
    return failure(e);
  }
}

async function finishInstagram(st: { brandId: string; userId: string; code: string }, deps: FlowDeps, now: Date): Promise<ConnectOutcome> {
  const short = await exchangeInstagramCode(st.code, deps.fetch);
  if (short.permissions.length > 0 && !short.permissions.includes("instagram_business_content_publish")) {
    return { ok: false, code: "missing_permission" };
  }
  const profile = await fetchInstagramProfile(short.token, deps.fetch);
  if (!canPublish(profile.accountType)) return { ok: false, code: "personal_account" };
  const long = await exchangeForLongLived(short.token, deps.fetch);
  await saveConnection({
    brandId: st.brandId,
    userId: st.userId,
    provider: "instagram",
    accountId: profile.id,
    accountName: profile.username ? `@${profile.username}` : null,
    scopes: INSTAGRAM_SCOPES,
    platformUserId: short.userId,
    expiresAt: new Date(now.getTime() + long.expiresIn * 1000),
    token: long.token,
  });
  return { ok: true, next: "done", provider: "instagram" };
}

async function finishFacebook(st: { brandId: string; userId: string; code: string }, deps: FlowDeps): Promise<ConnectOutcome> {
  const userToken = await exchangeFacebookCode(st.code, deps.fetch);
  const fbUserId = await fetchFacebookUserId(userToken, deps.fetch);
  const pages = await fetchPages(userToken, deps.fetch);
  if (pages.length === 0) return { ok: false, code: "no_pages" };
  if (pages.length === 1) {
    await storePage({ brandId: st.brandId, userId: st.userId, fbUserId, page: pages[0] });
    return { ok: true, next: "done", provider: "facebook" };
  }
  return { ok: true, next: "pick_page", pending: sealPending({ brandId: st.brandId, userId: st.userId, fbUserId, userToken }, deps.now?.getTime()) };
}

async function storePage(args: { brandId: string; userId: string; fbUserId: string; page: FacebookPage }): Promise<void> {
  await saveConnection({
    brandId: args.brandId,
    userId: args.userId,
    provider: "facebook",
    accountId: args.page.id,
    accountName: args.page.name,
    scopes: FACEBOOK_SCOPES,
    platformUserId: args.fbUserId,
    // A Page token made from a long-lived user token does not expire (until the owner revokes or changes their password).
    expiresAt: null,
    token: args.page.accessToken,
  });
}

/** The Pages the owner can pick from (ids and names only). */
export async function listPendingPages(args: { userId: string; pending: string | null | undefined }, deps: FlowDeps = {}): Promise<{ brandId: string; pages: PagePick[] }> {
  const p = openPending(args.pending, args.userId, deps.now?.getTime());
  await requireBrandOwner(args.userId, p.brandId);
  const pages = await fetchPages(p.userToken, deps.fetch);
  return { brandId: p.brandId, pages: pages.map(({ id, name }) => ({ id, name })) };
}

/** Saves the picked Page. Re-reads the Pages with the waiting user token, so only a Page the owner really has can be chosen. */
export async function choosePage(args: { userId: string; pending: string | null | undefined; pageId: string }, deps: FlowDeps = {}): Promise<ConnectOutcome> {
  try {
    const p = openPending(args.pending, args.userId, deps.now?.getTime());
    await requireBrandOwner(args.userId, p.brandId);
    const page = (await fetchPages(p.userToken, deps.fetch)).find((x) => x.id === args.pageId);
    if (!page) return { ok: false, code: "page_not_found" };
    await storePage({ brandId: p.brandId, userId: args.userId, fbUserId: p.fbUserId, page });
    return { ok: true, next: "done", provider: "facebook" };
  } catch (e) {
    return failure(e);
  }
}
