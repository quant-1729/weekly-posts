// Loads the pages of a website for fact extraction: robots.txt, the home page, the pages
// chosen from its links, cleaned to text. No database and no AI here; extract.ts adds those.
// Site problems are returned as a status, never thrown (Req 6).

import { cleanHtml, type LogoCandidate } from "./clean";
import { FetchError, safeFetch, type FetchEnv, type FetchResult } from "./fetch";
import { selectPages, pageKey, type SkippedPage } from "./pages";
import { RobotsCache } from "./robots";

export type LoadStatus = "ok" | "partial" | "blocked" | "failed";

export interface LoadedPage {
  url: string;
  title: string;
  metaDescription: string;
  /** Cleaned visible text, at most 8000 characters. */
  text: string;
}

export interface LoadResult {
  status: LoadStatus;
  /** Why the status is not ok, for logs: a FetchError code, "robots", "http_404", "no_text" ... */
  reason: string | null;
  /** The home page as read (after redirects), or the first URL tried when it could not be read. */
  homeUrl: string | null;
  pages: LoadedPage[];
  skipped: SkippedPage[];
  logoCandidates: LogoCandidate[];
  themeColor: string | null;
  /** Origins whose robots.txt was requested. */
  robotsFetched: string[];
}

/** Turns what the owner typed into a URL: adds https:// when there is no scheme. Null if it cannot be a URL. */
export function normalizeWebsiteInput(input: string): URL | null {
  const raw = input.trim();
  if (!raw || raw.length > 2000 || /\s/.test(raw)) return null;
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw) && !/^[^/\s:]+:\d+(\/|$)/.test(raw);
  try {
    const url = new URL(hasScheme ? raw : `https://${raw}`);
    url.hash = "";
    return url;
  } catch {
    return null;
  }
}

const SOFT_FAIL = new Set(["disallowed"]);

function emptyResult(status: LoadStatus, reason: string, homeUrl: string | null, robots: RobotsCache, skipped: SkippedPage[] = []): LoadResult {
  return { status, reason, homeUrl, pages: [], skipped, logoCandidates: [], themeColor: null, robotsFetched: robots.fetched };
}

function bareHost(url: URL): string {
  return url.host.toLowerCase().replace(/^www\./, "");
}

export async function loadWebsitePages(input: string, env: FetchEnv = {}): Promise<LoadResult> {
  const robots = new RobotsCache(env);
  const start = normalizeWebsiteInput(input);
  if (!start) return emptyResult("failed", "bad_url", null, robots);

  // Prefer https: if the owner typed http:// (and no port), try the https URL first.
  const attempts: URL[] = [];
  if (start.protocol === "http:" && start.port === "" && !env.allowPrivate) {
    const secure = new URL(start.href);
    secure.protocol = "https:";
    attempts.push(secure);
  }
  attempts.push(start);

  const allowUrl = (u: URL) => robots.isAllowed(u);
  let home: FetchResult | null = null;
  let homeStart = start;
  for (let i = 0; i < attempts.length; i++) {
    const url = attempts[i];
    homeStart = url;
    try {
      const rules = await robots.rulesFor(url.origin);
      if (!rules.isAllowed(url)) {
        // robots.txt could not be reached at all: we do not read the site, but the site is down rather than blocking us.
        const unreachable = rules.source === "disallow_all_unreachable";
        if (unreachable && i < attempts.length - 1) continue; // https did not answer: try the http URL
        return emptyResult(unreachable ? "failed" : "blocked", `robots_${rules.source}`, url.href, robots, [
          { url: url.href, reason: unreachable ? "robots_unreachable" : "robots" },
        ]);
      }
      home = await safeFetch(url, { ...env, accept: "text/html", allowUrl });
      break;
    } catch (e) {
      if (!(e instanceof FetchError)) throw e;
      if (e.code === "disallowed") {
        return emptyResult("blocked", "robots", url.href, robots, [{ url: e.url ?? url.href, reason: "robots" }]);
      }
      const retryable = e.code === "network" || e.code === "timeout" || e.code === "bad_redirect";
      if (retryable && i < attempts.length - 1) continue;
      return emptyResult("failed", e.code, url.href, robots);
    }
  }
  if (!home) return emptyResult("failed", "network", homeStart.href, robots);
  if (home.status < 200 || home.status >= 300) {
    return emptyResult("failed", `http_${home.status}`, home.url, robots);
  }

  const homeUrl = new URL(home.url);
  const cleanedHome = cleanHtml(home.text, home.url);
  const pages: LoadedPage[] = [
    { url: home.url, title: cleanedHome.title, metaDescription: cleanedHome.metaDescription, text: cleanedHome.text },
  ];
  const skipped: SkippedPage[] = [];

  let selection;
  try {
    selection = selectPages(homeUrl, cleanedHome.links, await robots.rulesFor(homeUrl.origin));
  } catch (e) {
    if (!(e instanceof FetchError)) throw e;
    return emptyResult("failed", e.code, home.url, robots);
  }
  skipped.push(...selection.skipped);

  const readKeys = new Set<string>([pageKey(homeUrl)]);
  const others = selection.pages.slice(1);
  const fetched = await Promise.all(
    others.map(async (c) => {
      try {
        const res = await safeFetch(c.url, { ...env, accept: "text/html", allowUrl });
        return { c, res, error: null as FetchError | null };
      } catch (e) {
        if (!(e instanceof FetchError)) throw e;
        return { c, res: null, error: e };
      }
    }),
  );

  let failures = 0;
  for (const { c, res, error } of fetched) {
    if (error || !res) {
      if (error && SOFT_FAIL.has(error.code)) skipped.push({ url: error.url ?? c.url, reason: "robots" });
      else {
        skipped.push({ url: c.url, reason: error?.code ?? "network" });
        failures++;
      }
      continue;
    }
    if (res.status < 200 || res.status >= 300) {
      skipped.push({ url: c.url, reason: `http_${res.status}` });
      // A guessed common path that does not exist is expected, not a failure.
      if (!(c.kind === "fallback" && (res.status === 404 || res.status === 410))) failures++;
      continue;
    }
    const final = new URL(res.url);
    if (bareHost(final) !== bareHost(homeUrl)) {
      skipped.push({ url: c.url, reason: "off_site_redirect" });
      continue;
    }
    const key = pageKey(final);
    if (readKeys.has(key)) {
      skipped.push({ url: c.url, reason: "duplicate" });
      continue;
    }
    const cleaned = cleanHtml(res.text, res.url);
    if (cleaned.text.length < 20) {
      skipped.push({ url: c.url, reason: "no_text" });
      failures++;
      continue;
    }
    readKeys.add(key);
    pages.push({ url: res.url, title: cleaned.title, metaDescription: cleaned.metaDescription, text: cleaned.text });
  }

  if (pages.reduce((n, p) => n + p.text.length, 0) < 40) {
    return { ...emptyResult("failed", "no_text", home.url, robots, skipped), logoCandidates: cleanedHome.logoCandidates, themeColor: cleanedHome.themeColor };
  }
  return {
    status: failures > 0 ? "partial" : "ok",
    reason: failures > 0 ? "some_pages_failed" : null,
    homeUrl: home.url,
    pages,
    skipped,
    logoCandidates: cleanedHome.logoCandidates,
    themeColor: cleanedHome.themeColor,
    robotsFetched: robots.fetched,
  };
}
