// Loads the pages of a website for fact extraction: robots.txt, the home page, the pages
// chosen from its links, cleaned to text. No database and no AI here; extract.ts adds those.
// Site problems are returned as a status, never thrown (Req 6).
//
// Pages built with JavaScript (almost no text in the HTML) are read through the reading service
// in reader.ts; if that is off or fails, the page's title and descriptions are used (js_only_meta).

import { cleanHtml, type CleanedPage, type LogoCandidate } from "./clean";
import { FetchError, safeFetch, type FetchEnv, type FetchResult } from "./fetch";
import { selectPages, pageKey, MAX_PAGES, type SkippedPage } from "./pages";
import { defaultReader, READER_MIN_TEXT, READER_TIMEOUT_MS, type ReaderFn, type ReaderPage } from "./reader";
import { RobotsCache } from "./robots";
import { discoverSitemapLinks } from "./sitemap";

export type LoadStatus = "ok" | "partial" | "blocked" | "failed";

export interface LoadedPage {
  url: string;
  title: string;
  metaDescription: string;
  /** Cleaned visible text, at most 8000 characters. */
  text: string;
  /** True when the text came from the reading service (the page builds its content with JavaScript). */
  viaReader?: boolean;
}

export interface LoadResult {
  status: LoadStatus;
  /** Why the status is not ok, for logs: a FetchError code, "robots", "http_404", "no_text", "js_only_meta" ... */
  reason: string | null;
  /** The home page as read (after redirects), or the first URL tried when it could not be read. */
  homeUrl: string | null;
  pages: LoadedPage[];
  skipped: SkippedPage[];
  logoCandidates: LogoCandidate[];
  themeColor: string | null;
  /** Origins whose robots.txt was requested. */
  robotsFetched: string[];
  /** URLs of the pages whose text came from the reading service. */
  readerPages: string[];
  /** Raw HTML of the pages read and the reading service's link hrefs, so social profile links
   *  (e.g. the owner's Instagram) can be found. Empty when nothing was read. */
  socialSources: string[];
}

export interface LoadOptions {
  /**
   * The reading service for pages without text. Undefined = the app's default (Jina unless
   * READER_PROVIDER=off; never when the fetch settings allow private addresses, i.e. in tests).
   * Null = never use one.
   */
  reader?: ReaderFn | null;
}

/** All reader calls of one read share this much time. */
const READER_TOTAL_MS = 30_000;

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
  return { status, reason, homeUrl, pages: [], skipped, logoCandidates: [], themeColor: null, robotsFetched: robots.fetched, readerPages: [], socialSources: [] };
}

function bareHost(url: URL): string {
  return url.host.toLowerCase().replace(/^www\./, "");
}

/** Title and descriptions of a page as a small text: used when the page has no text of its own. One per line, no invented punctuation. */
export function metaText(c: Pick<CleanedPage, "title" | "ogTitle" | "metaDescription">): string {
  const parts: string[] = [];
  for (const p of [c.title, c.ogTitle, c.metaDescription]) {
    const t = p.trim();
    if (t && !parts.some((x) => x.toLowerCase() === t.toLowerCase())) parts.push(t);
  }
  return parts.join("\n");
}

export async function loadWebsitePages(input: string, env: FetchEnv = {}, options: LoadOptions = {}): Promise<LoadResult> {
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
  const socialSources: string[] = [home.text];

  // Pages with almost no text are built by JavaScript. Only those go to the reading service, and only
  // pages we have already fetched ourselves (public address, robots.txt allowed, same site, HTML).
  const reader = options.reader === undefined ? (env.allowPrivate ? null : defaultReader()) : options.reader;
  const readerPages: string[] = [];
  let readerCalls = 0;
  let readerBroken = false;
  let readerDeadline = 0;
  const callReader = async (pageUrl: string): Promise<ReaderPage | null> => {
    if (!reader || readerBroken || readerCalls >= MAX_PAGES) return null;
    let pu: URL;
    try {
      pu = new URL(pageUrl);
    } catch {
      return null;
    }
    if ((pu.protocol !== "http:" && pu.protocol !== "https:") || bareHost(pu) !== bareHost(homeUrl)) return null;
    // Only the page's own address: no query string (it can carry tracking ids or personal data), no fragment.
    // The Jina reader itself refuses IP addresses, local names and odd ports (readerTarget).
    pu.search = "";
    pu.hash = "";
    const target = pu.href;
    if (readerCalls === 0) readerDeadline = Date.now() + READER_TOTAL_MS;
    const left = readerDeadline - Date.now();
    if (left < 2000) return null;
    readerCalls++;
    try {
      return await reader(target, { timeoutMs: Math.min(READER_TIMEOUT_MS, left) });
    } catch {
      return null;
    }
  };

  let homeText = cleanedHome.text;
  let homeLinks = cleanedHome.links;
  let homeViaReader = false;
  if (cleanedHome.text.length < READER_MIN_TEXT) {
    const r = await callReader(home.url);
    if (r && r.text.length > cleanedHome.text.length) {
      homeText = r.text;
      homeLinks = [...cleanedHome.links, ...r.links];
      socialSources.push(...r.links.map((l) => l.href));
      homeViaReader = true;
      readerPages.push(home.url);
    } else if (!r) {
      readerBroken = true; // the service is off or not answering: do not try it for every page
    }
  }
  const pages: LoadedPage[] = [
    { url: home.url, title: cleanedHome.title, metaDescription: cleanedHome.metaDescription, text: homeText, ...(homeViaReader ? { viaReader: true } : {}) },
  ];
  const skipped: SkippedPage[] = [];

  let selection;
  try {
    const homeRules = await robots.rulesFor(homeUrl.origin);
    selection = selectPages(homeUrl, homeLinks, homeRules);
    if (homeViaReader && selection.usedFallback) {
      // A site that builds its pages in the browser may have no usable links in the reader's summary: try its sitemap.
      const fromSitemap = await discoverSitemapLinks(homeUrl, robots, env);
      if (fromSitemap.length > 0) selection = selectPages(homeUrl, [...homeLinks, ...fromSitemap], homeRules);
    }
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
        let cleaned: CleanedPage | null = null;
        let read: ReaderPage | null = null;
        if (res.status >= 200 && res.status < 300) {
          socialSources.push(res.text);
          cleaned = cleanHtml(res.text, res.url);
          if (cleaned.text.length < READER_MIN_TEXT && pageKey(new URL(res.url)) !== pageKey(homeUrl)) read = await callReader(res.url);
          if (read) socialSources.push(...read.links.map((l) => l.href));
        }
        return { c, res, cleaned, read, error: null as FetchError | null };
      } catch (e) {
        if (!(e instanceof FetchError)) throw e;
        return { c, res: null, cleaned: null, read: null, error: e };
      }
    }),
  );

  let failures = 0;
  for (const { c, res, cleaned, read, error } of fetched) {
    if (error || !res || !cleaned) {
      if (error && SOFT_FAIL.has(error.code)) skipped.push({ url: error.url ?? c.url, reason: "robots" });
      else if (res) {
        skipped.push({ url: c.url, reason: `http_${res.status}` });
        // A guessed common path that does not exist is expected, not a failure.
        if (!(c.kind === "fallback" && (res.status === 404 || res.status === 410))) failures++;
      } else {
        skipped.push({ url: c.url, reason: error?.code ?? "network" });
        failures++;
      }
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
    const viaReader = !!read && read.text.length > cleaned.text.length;
    const text = viaReader ? read!.text : cleaned.text;
    if (text.length < 20) {
      skipped.push({ url: c.url, reason: "no_text" });
      failures++;
      continue;
    }
    readKeys.add(key);
    if (viaReader) readerPages.push(res.url);
    pages.push({ url: res.url, title: cleaned.title, metaDescription: cleaned.metaDescription, text, ...(viaReader ? { viaReader: true } : {}) });
  }

  if (pages.reduce((n, p) => n + p.text.length, 0) < 40) {
    // Nothing to read, but the head of the page may say what the business is: the title and descriptions
    // are small, true statements about it, with real quotes. Partial, so the owner is told.
    const meta = metaText(cleanedHome);
    if (meta.length >= 20) {
      return {
        status: "partial",
        reason: "js_only_meta",
        homeUrl: home.url,
        pages: [{ url: home.url, title: cleanedHome.title, metaDescription: cleanedHome.metaDescription, text: meta }],
        skipped,
        logoCandidates: cleanedHome.logoCandidates,
        themeColor: cleanedHome.themeColor,
        robotsFetched: robots.fetched,
        readerPages: [],
        socialSources,
      };
    }
    return { ...emptyResult("failed", "no_text", home.url, robots, skipped), logoCandidates: cleanedHome.logoCandidates, themeColor: cleanedHome.themeColor, socialSources };
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
    readerPages,
    socialSources,
  };
}
