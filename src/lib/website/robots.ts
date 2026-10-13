// robots.txt handling, following RFC 9309.
//  - groups by user-agent: our token first, else "*"
//  - Allow / Disallow with longest-match precedence (allow wins a tie); "*" and "$" wildcards
//  - 4xx means "no rules" (allow all); 5xx or unreachable means disallow all
//  - one fetch per origin per run (RobotsCache)

import { FetchError, safeFetch, type FetchEnv } from "./fetch";

export const ROBOTS_TOKEN = "WeeklyPostsBot";
const MAX_ROBOTS_BYTES = 512 * 1024; // RFC 9309: parse at least 500 KiB

interface Rule {
  allow: boolean;
  pattern: string;
  regex: RegExp;
}

export type RobotsSource =
  | "rules" // parsed from a robots.txt
  | "allow_all_4xx" // file missing (4xx)
  | "allow_all_not_text" // 200 but not text/plain, so not a robots file
  | "disallow_all_5xx"
  | "disallow_all_unreachable";

export interface RobotsRules {
  source: RobotsSource;
  /** True when the URL (path plus query) may be fetched. */
  isAllowed(url: URL | string): boolean;
}

function toRegex(pattern: string): RegExp {
  let anchored = false;
  let p = pattern;
  if (p.endsWith("$")) {
    anchored = true;
    p = p.slice(0, -1);
  }
  const body = p
    .split("*")
    .map((s) => s.replace(/[.+?^${}()|[\]\\/]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${body}${anchored ? "$" : ""}`);
}

/** Encodes non-ASCII characters the way URL serialisation does, so patterns and paths compare equal. */
function normalisePattern(p: string): string {
  return p.replace(/[^\x00-\x7f]+/g, (m) => encodeURIComponent(m));
}

function makeRules(rules: Rule[], source: RobotsSource): RobotsRules {
  return {
    source,
    isAllowed(input) {
      const url = typeof input === "string" ? new URL(input) : input;
      const path = (url.pathname || "/") + url.search;
      if (url.pathname === "/robots.txt") return true;
      let best: Rule | null = null;
      for (const r of rules) {
        if (!r.regex.test(path)) continue;
        // Longest pattern wins; on a tie the less restrictive rule (Allow) wins.
        if (!best || r.pattern.length > best.pattern.length || (r.pattern.length === best.pattern.length && r.allow && !best.allow)) {
          best = r;
        }
      }
      return best ? best.allow : true;
    },
  };
}

export const ALLOW_ALL = (source: RobotsSource = "allow_all_4xx"): RobotsRules => makeRules([], source);
export const DISALLOW_ALL = (source: RobotsSource = "disallow_all_unreachable"): RobotsRules =>
  makeRules([{ allow: false, pattern: "/", regex: /^\//u }], source);

interface Group {
  agents: string[];
  rules: Rule[];
}

function productToken(value: string): string {
  return value.trim().toLowerCase().split("/")[0].trim();
}

/** Parses a robots.txt body into the rules that apply to `token` (default: WeeklyPostsBot). */
export function parseRobots(text: string, token: string = ROBOTS_TOKEN): RobotsRules {
  const groups: Group[] = [];
  let current: Group | null = null;
  let lastWasAgent = false;
  const body = text.replace(/^﻿/, "").slice(0, MAX_ROBOTS_BYTES);

  for (const rawLine of body.split(/\r\n|\r|\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const field = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();

    if (field === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(productToken(value));
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if ((field === "allow" || field === "disallow") && current) {
      if (value === "") continue; // "Disallow:" with no value excludes nothing
      const pattern = normalisePattern(value);
      current.rules.push({ allow: field === "allow", pattern, regex: toRegex(pattern) });
    }
    // sitemap, crawl-delay and unknown fields are ignored
  }

  const mine = token.toLowerCase();
  const specific = groups.filter((g) => g.agents.includes(mine));
  const chosen = specific.length > 0 ? specific : groups.filter((g) => g.agents.includes("*"));
  return makeRules(
    chosen.flatMap((g) => g.rules),
    "rules",
  );
}

/** Turns the robots.txt HTTP outcome into rules (RFC 9309 section 2.3.1). */
export function robotsFromStatus(status: number, body: string | null): RobotsRules {
  if (status >= 200 && status < 300) return body === null ? ALLOW_ALL("allow_all_not_text") : parseRobots(body);
  if (status >= 500) return DISALLOW_ALL("disallow_all_5xx");
  return ALLOW_ALL("allow_all_4xx"); // 3xx without a usable redirect, 4xx
}

/** Fetches and caches robots.txt per origin for one run. */
export class RobotsCache {
  private cache = new Map<string, Promise<RobotsRules>>();
  /** Origins whose robots.txt was requested, in order. */
  readonly fetched: string[] = [];

  constructor(private env: FetchEnv = {}) {}

  rulesFor(origin: string): Promise<RobotsRules> {
    let p = this.cache.get(origin);
    if (!p) {
      p = this.load(origin);
      this.cache.set(origin, p);
    }
    return p;
  }

  async isAllowed(url: URL | string): Promise<boolean> {
    const u = typeof url === "string" ? new URL(url) : url;
    return (await this.rulesFor(u.origin)).isAllowed(u);
  }

  private async load(origin: string): Promise<RobotsRules> {
    this.fetched.push(origin);
    try {
      const res = await safeFetch(`${origin}/robots.txt`, { ...this.env, accept: "text/plain", maxBytes: MAX_ROBOTS_BYTES });
      return robotsFromStatus(res.status, res.status >= 200 && res.status < 300 ? res.text : null);
    } catch (e) {
      if (e instanceof FetchError) {
        if (e.code === "wrong_content_type") return robotsFromStatus(200, null);
        // Refused or unresolvable hosts are the caller's problem: the page fetch fails the same way.
        if (["blocked_address", "dns", "bad_url", "bad_scheme", "bad_port"].includes(e.code)) throw e;
        return DISALLOW_ALL("disallow_all_unreachable"); // timeout, network error, redirect loop
      }
      throw e;
    }
  }
}
