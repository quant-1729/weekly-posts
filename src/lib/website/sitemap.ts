// Page discovery from sitemap.xml, for sites whose home page has no links in its HTML (Req 3).
// Only the home page's own site is used: "www." and the bare host are one site, and every URL
// is moved to the host the home page was read from, so a host that does not answer (a sitemap
// listed on the other spelling of the name) is never contacted. Every request goes through
// safeFetch and robots.txt. Failures and slow answers are swallowed; discovery has a time budget.

import type { PageLink } from "./clean";
import { FetchError, FETCH_TIMEOUT_MS, safeFetch, type FetchEnv } from "./fetch";
import type { RobotsCache } from "./robots";

export const SITEMAP_TIMEOUT_MS = 5_000;
export const SITEMAP_BUDGET_MS = 8_000;
const MAX_URLS = 500;
const MAX_CHILD_SITEMAPS = 2;
const MAX_SITEMAPS = 3;

function bare(u: URL): string {
  return u.host.toLowerCase().replace(/\.$/, "").replace(/^www\./, "");
}

/** The URL on the home page's host when it is the same site, else null. */
function onHomeHost(raw: string, home: URL): URL | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if ((u.protocol !== "http:" && u.protocol !== "https:") || bare(u) !== bare(home)) return null;
  u.protocol = home.protocol;
  u.host = home.host;
  u.hash = "";
  return u;
}

function decodeXml(s: string): string {
  return s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}

/** The <loc> values of a sitemap or sitemap index. */
export function parseSitemap(xml: string): { isIndex: boolean; locs: string[] } {
  const isIndex = /<sitemapindex[\s>]/i.test(xml);
  const locs: string[] = [];
  for (const m of xml.matchAll(/<loc>\s*(?:<!\[CDATA\[)?\s*([^<\]]+?)\s*(?:\]\]>)?\s*<\/loc>/gi)) {
    locs.push(decodeXml(m[1]));
    if (locs.length >= MAX_URLS) break;
  }
  return { isIndex, locs };
}

async function fetchXml(url: URL, robots: RobotsCache, env: FetchEnv): Promise<string | null> {
  try {
    const res = await safeFetch(url, {
      ...env,
      timeoutMs: Math.min(env.timeoutMs ?? FETCH_TIMEOUT_MS, SITEMAP_TIMEOUT_MS),
      maxBytes: 1_000_000,
      accept: "xml",
      allowUrl: (u) => robots.isAllowed(u),
    });
    return res.status >= 200 && res.status < 300 ? res.text : null;
  } catch (e) {
    if (e instanceof FetchError) return null;
    throw e;
  }
}

async function discover(home: URL, robots: RobotsCache, env: FetchEnv): Promise<PageLink[]> {
  const rules = await robots.rulesFor(home.origin);
  const starts = new Map<string, URL>();
  for (const raw of [...rules.sitemaps, new URL("/sitemap.xml", home).href]) {
    const u = onHomeHost(raw, home);
    if (u && !starts.has(u.href)) starts.set(u.href, u);
    if (starts.size >= MAX_SITEMAPS) break;
  }

  const pages: URL[] = [];
  const children: URL[] = [];
  const bodies = await Promise.all([...starts.values()].map((u) => fetchXml(u, robots, env)));
  for (const xml of bodies) {
    if (!xml) continue;
    const { isIndex, locs } = parseSitemap(xml);
    for (const loc of locs) {
      const u = onHomeHost(loc, home);
      if (!u) continue;
      if (isIndex) {
        if (children.length < MAX_CHILD_SITEMAPS && !starts.has(u.href)) children.push(u);
      } else pages.push(u);
    }
  }
  if (children.length > 0) {
    const childBodies = await Promise.all(children.map((u) => fetchXml(u, robots, env)));
    for (const xml of childBodies) {
      if (!xml) continue;
      for (const loc of parseSitemap(xml).locs) {
        const u = onHomeHost(loc, home);
        if (u) pages.push(u);
      }
    }
  }
  return pages.slice(0, MAX_URLS).map((u) => ({ href: u.href, text: "" }));
}

/** Page URLs from the site's sitemap(s), same site only, [] on any problem or when the budget runs out. */
export async function discoverSitemapLinks(home: URL, robots: RobotsCache, env: FetchEnv, budgetMs = SITEMAP_BUDGET_MS): Promise<PageLink[]> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<PageLink[]>((resolve) => {
    timer = setTimeout(() => resolve([]), budgetMs);
  });
  try {
    return await Promise.race([discover(home, robots, env).catch(() => [] as PageLink[]), limit]);
  } finally {
    clearTimeout(timer);
  }
}
