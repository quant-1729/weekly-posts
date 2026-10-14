// Reading service for pages that build their content with JavaScript (Req 3).
//
// Our own fetch gets the raw HTML. When a page that passed our checks (public address, robots.txt
// allows it, same site, HTML) has almost no visible text, the page is built in the browser. Only
// then is its URL sent to Jina Reader (https://r.jina.ai/<url>), which opens it in a real browser
// and returns text plus the links on the page.
//
// What is sent: the page's own URL without query string or fragment, nothing else. No cookies, no
// owner data. What is never sent: a URL that failed the address, robots or same-site checks (the
// caller only passes pages it has already fetched itself).
//
// READER_PROVIDER = jina (default) | off. READER_API_KEY is optional; without it Jina allows a low
// free rate (about 20 requests a minute), which is enough for one read of 5 pages.

import { capText, type PageLink } from "./clean";
import { isBlockedHostname } from "./ip";
import { isIP } from "node:net";

export const READER_TIMEOUT_MS = 20_000;
/** A page with less visible text than this (characters) is treated as built by JavaScript. */
export const READER_MIN_TEXT = 200;
const JINA_BASE = "https://r.jina.ai/";
const MAX_RESPONSE_CHARS = 400_000;
const MAX_LINKS = 300;

export interface ReaderPage {
  /** Clean visible text, at most 8000 characters (same cap as cleaned HTML). */
  text: string;
  /** Links found on the page, absolute http(s) URLs. The caller filters them to the same site. */
  links: PageLink[];
}
export interface ReaderCallOptions {
  timeoutMs?: number;
}
/** Never throws: returns null when the page could not be read. */
export type ReaderFn = (url: string, opts?: ReaderCallOptions) => Promise<ReaderPage | null>;

export type ReaderProvider = "jina" | "off";

export function readerProvider(env: Record<string, string | undefined> = process.env): ReaderProvider {
  const v = (env.READER_PROVIDER ?? "").trim().toLowerCase();
  return v === "off" || v === "none" || v === "0" || v === "false" ? "off" : "jina";
}

/**
 * The URL that may be sent to the reader: http(s), a public-looking host name (no IP literal, no
 * local names), default port, no credentials. Query string and fragment are dropped. Null otherwise.
 */
export function readerTarget(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if (u.username || u.password || u.port !== "") return null;
  const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host || isIP(host) || isBlockedHostname(host) || !host.includes(".")) return null;
  u.search = "";
  u.hash = "";
  return u.href;
}

// ---------------------------------------------------------------------------
// Jina's markdown to plain text + links
// ---------------------------------------------------------------------------

function toLink(href: string, text: string, base: string): PageLink | null {
  try {
    const u = new URL(href.trim(), base);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    u.hash = "";
    return { href: u.href, text: text.replace(/\s+/g, " ").trim() };
  } catch {
    return null;
  }
}

const LINK_RE = /\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g;

/** Turns Jina Reader's markdown answer into plain text and a link list. */
export function parseReaderMarkdown(raw: string, pageUrl: string): ReaderPage {
  let body = raw.replace(/\r\n?/g, "\n").slice(0, MAX_RESPONSE_CHARS);

  // Header lines ("Title:", "URL Source:", "Markdown Content:").
  const marker = body.indexOf("\nMarkdown Content:");
  if (/^Title:/.test(body) && marker >= 0 && marker < 2000) body = body.slice(marker + "\nMarkdown Content:".length);

  // Summary sections added at the end ("Links/Buttons:" and "Images:").
  const links: PageLink[] = [];
  const seen = new Set<string>();
  const add = (l: PageLink | null) => {
    if (!l || seen.has(l.href) || links.length >= MAX_LINKS) return;
    seen.add(l.href);
    links.push(l);
  };
  const section = body.search(/\n(?:Links\/Buttons|Images):[ \t]*\n/);
  if (section >= 0) {
    const tail = body.slice(section);
    body = body.slice(0, section);
    for (const m of tail.matchAll(LINK_RE)) add(toLink(m[2], m[1], pageUrl));
  }
  for (const m of body.replace(/!\[[^\]]*\]\([^)]*\)/g, "").matchAll(LINK_RE)) add(toLink(m[2], m[1], pageUrl));

  const text = body
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "") // images: no text
    .replace(LINK_RE, "$1") // links: keep the words
    .replace(/<\/?[a-z][^>]*>/gi, " ")
    .replace(/^[ \t]*#{1,6}[ \t]+/gm, "")
    .replace(/(\*\*|__)(.+?)\1/g, "$2");

  const lines: string[] = [];
  for (const rawLine of text.split("\n")) {
    const line = rawLine.replace(/[\s​‌‍﻿]+/g, " ").trim();
    if (line && line !== lines[lines.length - 1]) lines.push(line);
  }
  return { text: capText(lines.join("\n")).text, links };
}

// ---------------------------------------------------------------------------
// Jina
// ---------------------------------------------------------------------------

export interface JinaOptions {
  apiKey?: string;
  /** Tests only. */
  fetchImpl?: typeof fetch;
}

export function createJinaReader(opts: JinaOptions = {}): ReaderFn {
  const doFetch = opts.fetchImpl ?? fetch;
  return async (url, call = {}) => {
    const target = readerTarget(url);
    if (!target) return null;
    const headers: Record<string, string> = {
      Accept: "text/plain",
      "X-With-Links-Summary": "true",
    };
    if (opts.apiKey) headers.Authorization = `Bearer ${opts.apiKey}`;
    try {
      const res = await doFetch(JINA_BASE + target, {
        method: "GET",
        headers,
        redirect: "follow",
        signal: AbortSignal.timeout(call.timeoutMs ?? READER_TIMEOUT_MS),
      });
      if (!res.ok) return null;
      const raw = await res.text();
      if (/Warning: Target URL returned error/i.test(raw.slice(0, 800))) return null;
      const page = parseReaderMarkdown(raw, target);
      return page.text.length > 0 ? page : null;
    } catch {
      return null; // timeout, network error: the caller falls back to the title and description
    }
  };
}

/** The reader the app uses: Jina unless READER_PROVIDER=off. Null when off. */
export function defaultReader(env: Record<string, string | undefined> = process.env): ReaderFn | null {
  if (readerProvider(env) === "off") return null;
  const apiKey = (env.READER_API_KEY ?? "").trim() || undefined;
  return createJinaReader({ apiKey });
}
