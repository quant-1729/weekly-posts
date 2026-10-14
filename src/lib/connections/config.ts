// Settings for connecting an owner's own Instagram and Facebook accounts so we can publish for them
// (C-25). Nothing here is returned to a browser except `connectAvailable`.
//
//   META_APP_ID, META_APP_SECRET            the Meta app used for Facebook Login (Pages) and the data-deletion callbacks
//   INSTAGRAM_APP_ID, INSTAGRAM_APP_SECRET  the Instagram app inside the Meta app ("Instagram API with Instagram Login");
//                                           it has its own id and secret in the dashboard. Blank = use the Meta ones
//                                           (right only if you copied the same values).
//   META_GRAPH_VERSION                      optional, default below
//   NEXT_PUBLIC_APP_URL                     redirect URIs are built from it
//
// Without credentials, the Connect buttons explain that setup is pending.

import type { Provider } from "@/lib/queue/types";
import { DEFAULT_GRAPH_VERSION } from "@/lib/instagram/config";

const clean = (v: string | undefined) => (v && v.trim() !== "" ? v.trim() : undefined);

export const INSTAGRAM_SCOPES = ["instagram_business_basic", "instagram_business_content_publish"] as const;
export const FACEBOOK_SCOPES = ["pages_manage_posts", "pages_read_engagement", "pages_show_list"] as const;

export interface AppCredentials {
  appId: string;
  appSecret: string;
}

export function graphVersion(): string {
  const v = clean(process.env.META_GRAPH_VERSION);
  return v && /^v\d{1,3}\.\d{1,2}$/.test(v) ? v : DEFAULT_GRAPH_VERSION;
}

/** The Meta app (Facebook Login), or null until both values are set. */
export function metaApp(): AppCredentials | null {
  const appId = clean(process.env.META_APP_ID);
  const appSecret = clean(process.env.META_APP_SECRET);
  return appId && appSecret ? { appId, appSecret } : null;
}

/** The Instagram app (Instagram Login). Falls back to the Meta app's values. */
export function instagramApp(): AppCredentials | null {
  const appId = clean(process.env.INSTAGRAM_APP_ID);
  const appSecret = clean(process.env.INSTAGRAM_APP_SECRET);
  if (appId && appSecret) return { appId, appSecret };
  return metaApp();
}

export function credentialsFor(provider: Provider): AppCredentials | null {
  return provider === "instagram" ? instagramApp() : metaApp();
}

/** Every app secret we know, for checking signed_request values from Meta. */
export function appSecrets(): { provider: Provider; secret: string }[] {
  const out: { provider: Provider; secret: string }[] = [];
  const ig = instagramApp();
  const fb = metaApp();
  if (ig) out.push({ provider: "instagram", secret: ig.appSecret });
  if (fb && fb.appSecret !== ig?.appSecret) out.push({ provider: "facebook", secret: fb.appSecret });
  return out;
}

export function connectAvailable(provider: Provider): boolean {
  return credentialsFor(provider) !== null;
}

/** Where Meta sends the owner back to, built from NEXT_PUBLIC_APP_URL (no trailing slash). */
export function appUrl(): string {
  const base = clean(process.env.NEXT_PUBLIC_APP_URL);
  if (!base) {
    if (process.env.NODE_ENV === "production") throw new Error("NEXT_PUBLIC_APP_URL is required to connect accounts.");
    return "http://localhost:3000";
  }
  return base.replace(/\/+$/, "");
}

export const redirectUri = (provider: Provider) => `${appUrl()}/api/connect/${provider}/callback`;
export const dataDeletionUrl = () => `${appUrl()}/api/meta/data-deletion`;
export const deauthorizeUrl = () => `${appUrl()}/api/meta/deauthorize`;
