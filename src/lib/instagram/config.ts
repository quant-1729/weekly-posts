// Settings for reading public Instagram accounts through Meta's Business Discovery. Nothing here
// is secret except the token, which is never logged or returned to the browser.
//
//   INSTAGRAM_LOOKUP_USER_ID  our own Instagram professional account's id
//   INSTAGRAM_LOOKUP_TOKEN    a Facebook system user (or 60-day user) token with instagram_basic,
//                             instagram_manage_insights and pages_read_engagement
//   META_GRAPH_VERSION        optional, default below
//   INSTAGRAM_MODE            "fixture" = made-up accounts and photos with no network (development and tests)
//
// Without the id and the token the feature is "unavailable": the screens offer screenshots and
// pasted text only, and still save the handle.

export const DEFAULT_GRAPH_VERSION = "v23.0";

export type InstagramMode = "live" | "fixture" | "unavailable";

const clean = (v: string | undefined) => (v && v.trim() !== "" ? v.trim() : undefined);

export function instagramMode(): InstagramMode {
  if (process.env.INSTAGRAM_MODE === "fixture") return "fixture";
  if (clean(process.env.INSTAGRAM_LOOKUP_USER_ID) && clean(process.env.INSTAGRAM_LOOKUP_TOKEN)) return "live";
  return "unavailable";
}

/** True when the owner can bring in posts (live, or fixture for development). */
export function instagramAvailable(): boolean {
  return instagramMode() !== "unavailable";
}

export interface InstagramConfig {
  version: string;
  userId: string;
  token: string;
}

/** Null unless both the id and the token are set. */
export function instagramConfig(): InstagramConfig | null {
  const userId = clean(process.env.INSTAGRAM_LOOKUP_USER_ID);
  const token = clean(process.env.INSTAGRAM_LOOKUP_TOKEN);
  if (!userId || !token || !/^\d{1,30}$/.test(userId)) return null;
  const v = clean(process.env.META_GRAPH_VERSION);
  return { version: v && /^v\d{1,3}\.\d{1,2}$/.test(v) ? v : DEFAULT_GRAPH_VERSION, userId, token };
}
