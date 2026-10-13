// Which requests are not a person clicking (Req 19: clicks are counted by post, so a link
// previewer or a security scanner must not look like a customer).

/**
 * BEST EFFORT. There is no complete list of bots: new scanners appear all the time, and some
 * (corporate email scanners that use a normal browser UA) cannot be told apart. This list
 * catches the common families so counts are closer to real people; it is not a guarantee, and
 * the summary should call click counts "at least" / approximate.
 */
const BOT_UA = new RegExp(
  [
    // Link previewers
    "facebookexternalhit", "facebot", "twitterbot", "linkedinbot", "slackbot", "slack-imgproxy",
    "whatsapp", "telegrambot", "discordbot", "skypeuripreview", "pinterestbot", "redditbot",
    // Search engines
    "googlebot", "google-inspectiontool", "adsbot-google", "mediapartners-google", "bingbot", "bingpreview", "applebot", "duckduckbot", "yandexbot", "baiduspider",
    // Command line tools and HTTP libraries
    "curl/", "wget", "python-requests", "python-urllib", "aiohttp", "go-http-client", "java/", "libwww-perl", "node-fetch", "axios/", "httpie",
    // Microsoft Office link checks and SafeLinks
    "ms-office", "microsoft office", "msoffice", "microsoft outlook", "office/1\d", "safelinks", "barracuda",
    // Email security scanners
    "proofpoint", "mimecast", "symantec", "trendmicro", "forcepoint",
    // Headless browsers and test drivers
    "headlesschrome", "phantomjs", "puppeteer", "playwright", "selenium", "lighthouse", "chrome-lighthouse",
    // Anything that calls itself one
    "\bbot\b", "\bbots\b", "crawler", "spider", "scanner",
  ].join("|"),
  "i",
);

export function isBotUserAgent(ua: string | null | undefined): boolean {
  const t = (ua ?? "").trim();
  // A real browser always sends a user agent; scripts often do not.
  return t === "" || BOT_UA.test(t);
}

/** Browsers and proxies warming a link before a person opens it. */
export function isPrefetch(headers: Headers): boolean {
  const has = (name: string) => /prefetch/i.test(headers.get(name) ?? "");
  return has("purpose") || has("sec-purpose") || has("x-moz");
}

// ---------------------------------------------------------------------------
// Repeat clicks
// ---------------------------------------------------------------------------

export const REPEAT_WINDOW_MS = 30_000;
const MAX_REMEMBERED = 5_000;
const seen = new Map<string, number>();

/**
 * True the first time a (user agent, post) pair is seen in 30 seconds, and remembers it. Kept
 * in memory, so it is per server instance: a double tap on one phone is caught, a repeat on a
 * different instance may count twice. Good enough for a count that is already approximate.
 */
export function firstClickInWindow(ua: string, postId: string, now: number = Date.now()): boolean {
  const key = `${postId}\n${ua}`;
  const last = seen.get(key);
  if (last !== undefined && now - last < REPEAT_WINDOW_MS) return false;
  seen.set(key, now);
  if (seen.size > MAX_REMEMBERED) {
    for (const [k, t] of seen) if (now - t >= REPEAT_WINDOW_MS) seen.delete(k);
    // Still too many (a burst): drop the oldest entries.
    for (const k of seen.keys()) {
      if (seen.size <= MAX_REMEMBERED) break;
      seen.delete(k);
    }
  }
  return true;
}

/** Tests only. */
export function resetClickDedupe(): void {
  seen.clear();
}
