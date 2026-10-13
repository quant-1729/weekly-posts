// Safe fetch for owner-supplied URLs (Req 3). The URL is untrusted input and the
// request runs on our server, so every step guards against SSRF:
//  - only http(s), only ports 80/443, no credentials in the URL
//  - DNS is resolved here, every address is checked, and the connection goes to
//    the checked IP (so DNS rebinding cannot swap it)
//  - redirects are followed by hand (max 3) and every hop is checked again
//  - 8 s per request, 1.5 MB body cap, only text/html (pages) or text/plain (robots)
//  - accept "image" (logo download): only png, jpeg and webp, never SVG; bytes come back in `body`

import http from "node:http";
import https from "node:https";
import dns from "node:dns/promises";
import { isIP } from "node:net";
import zlib from "node:zlib";
import { getEnv } from "@/lib/env";
import { classifyIp, isBlockedHostname } from "./ip";

export const FETCH_TIMEOUT_MS = 8_000;
export const MAX_BODY_BYTES = 1_500_000;
export const MAX_REDIRECTS = 3;

export type FetchErrorCode =
  | "bad_url" // not parseable, empty host, credentials in the URL
  | "bad_scheme" // not http or https
  | "bad_port" // not 80 or 443
  | "blocked_address" // host or resolved IP is private, loopback, metadata ...
  | "dns" // the name did not resolve
  | "network" // connection failed or reset
  | "timeout"
  | "too_many_redirects"
  | "bad_redirect" // redirect to an invalid URL, or https to http
  | "wrong_content_type"
  | "unsupported_encoding"
  | "disallowed"; // the allowUrl hook (robots.txt) said no

export class FetchError extends Error {
  constructor(
    public readonly code: FetchErrorCode,
    message: string,
    public readonly url?: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "FetchError";
  }
}

export interface ResolvedAddress {
  address: string;
  family?: number;
}
export type Resolver = (hostname: string) => Promise<ResolvedAddress[]>;

export interface TransportRequest {
  url: URL;
  /** The checked IP to connect to. Host and TLS server name stay the URL's host name. */
  ip: string;
  port: number;
  headers: Record<string, string>;
  signal: AbortSignal;
}
export interface TransportResponse {
  status: number;
  /** Lower-case header names. */
  headers: Record<string, string | undefined>;
  /** Reads up to maxBytes; `truncated` is true when more was available. Stops reading past the cap. */
  readBody(maxBytes: number): Promise<{ body: Buffer; truncated: boolean }>;
  destroy(): void;
}
export type Transport = (req: TransportRequest) => Promise<TransportResponse>;

/** Shared by every request of a run. The injectable parts exist for tests. */
export interface FetchEnv {
  /**
   * TESTS ONLY. Lifts the private-address and port rules so a local test server can be
   * used. Defaults to false, is never read from the environment, and is refused in production.
   */
  allowPrivate?: boolean;
  resolver?: Resolver;
  transport?: Transport;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
}

export interface SafeFetchOptions extends FetchEnv {
  accept: "text/html" | "text/plain" | "image";
  /** Called with every URL about to be requested (the first one and each redirect). Return false to refuse it. */
  allowUrl?: (url: URL) => Promise<boolean>;
}

export interface FetchResult {
  /** The URL after redirects. */
  url: string;
  status: number;
  contentType: string;
  /** Decoded text; empty for non-2xx responses (the body is not read). */
  text: string;
  truncated: boolean;
  redirects: string[];
  /** Raw bytes, set only for accept "image" (then `text` is empty). */
  body?: Buffer;
}

const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp"]);

function userAgent(): string {
  let app = "";
  try {
    app = getEnv().appUrl;
  } catch {
    app = "";
  }
  return app ? `WeeklyPostsBot/1.0 (+${app}/bot)` : "WeeklyPostsBot/1.0";
}

const defaultResolver: Resolver = async (hostname) => dns.lookup(hostname, { all: true, verbatim: true });

function parseUrl(raw: string | URL, env: FetchEnv): URL {
  let url: URL;
  try {
    url = typeof raw === "string" ? new URL(raw) : new URL(raw.href);
  } catch {
    throw new FetchError("bad_url", "Not a valid URL", String(raw));
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new FetchError("bad_scheme", `Only http and https are allowed, not ${url.protocol}`, url.href);
  }
  if (url.username || url.password) throw new FetchError("bad_url", "Credentials in the URL are not allowed", url.origin);
  if (!url.hostname) throw new FetchError("bad_url", "Missing host", url.href);
  if (!env.allowPrivate && url.port !== "" && url.port !== "80" && url.port !== "443") {
    throw new FetchError("bad_port", `Port ${url.port} is not allowed`, url.href);
  }
  url.hash = "";
  return url;
}

function portOf(url: URL): number {
  return url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80;
}

/** Resolves the host and returns the checked addresses, IPv4 first. Throws when any address is not public. */
async function checkedAddresses(url: URL, env: FetchEnv): Promise<Array<{ address: string; family: 4 | 6 }>> {
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const literal = isIP(host);
  if (literal) {
    const v = classifyIp(host);
    if (!v.ok && !env.allowPrivate) throw new FetchError("blocked_address", `Address not allowed (${v.reason})`, url.origin);
    return [{ address: host, family: literal as 4 | 6 }];
  }
  if (!env.allowPrivate && isBlockedHostname(host)) {
    throw new FetchError("blocked_address", "Host name not allowed", url.origin);
  }
  let found: ResolvedAddress[];
  try {
    found = await (env.resolver ?? defaultResolver)(host);
  } catch {
    throw new FetchError("dns", "Host did not resolve", url.origin);
  }
  if (found.length === 0) throw new FetchError("dns", "Host did not resolve", url.origin);
  const out: Array<{ address: string; family: 4 | 6 }> = [];
  for (const a of found) {
    const fam = isIP(a.address);
    const v = classifyIp(a.address);
    // Every address must be public: a name that also resolves to a private IP is refused.
    if (!fam || (!v.ok && !env.allowPrivate)) {
      throw new FetchError(
        "blocked_address",
        `Host resolves to an address that is not allowed (${v.ok ? "invalid" : v.reason})`,
        url.origin,
      );
    }
    out.push({ address: a.address, family: fam as 4 | 6 });
  }
  return out.sort((x, y) => x.family - y.family);
}

function lowerHeaders(h: http.IncomingHttpHeaders): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(h)) out[k.toLowerCase()] = Array.isArray(v) ? v.join(", ") : v;
  return out;
}

/** Real transport: connects to the given IP (not the name) and keeps Host and TLS server name as the host name. */
export const nodeTransport: Transport = (req) =>
  new Promise((resolve, reject) => {
    const isHttps = req.url.protocol === "https:";
    const host = req.url.hostname.replace(/^\[|\]$/g, "");
    const options: https.RequestOptions = {
      host: req.ip,
      port: req.port,
      method: "GET",
      path: req.url.pathname + req.url.search,
      headers: { ...req.headers, Host: req.url.host },
      agent: false,
      signal: req.signal,
    };
    if (isHttps && !isIP(host)) options.servername = host;
    const r = (isHttps ? https : http).request(options, (res) => {
      const headers = lowerHeaders(res.headers);
      resolve({
        status: res.statusCode ?? 0,
        headers,
        destroy: () => res.destroy(),
        readBody: (maxBytes) =>
          new Promise((done, fail) => {
            const enc = (headers["content-encoding"] ?? "identity").toLowerCase().trim();
            let stream: NodeJS.ReadableStream = res;
            if (enc === "gzip" || enc === "x-gzip") stream = res.pipe(zlib.createGunzip());
            else if (enc === "deflate") stream = res.pipe(zlib.createInflate());
            else if (enc === "br") stream = res.pipe(zlib.createBrotliDecompress());
            else if (enc !== "identity" && enc !== "") {
              res.destroy();
              fail(new FetchError("unsupported_encoding", `Unsupported content encoding ${enc}`));
              return;
            }
            const chunks: Buffer[] = [];
            let size = 0;
            let finished = false;
            const finish = (truncated: boolean) => {
              if (finished) return;
              finished = true;
              res.destroy();
              done({ body: Buffer.concat(chunks).subarray(0, maxBytes), truncated });
            };
            const onErr = (e: Error) => {
              if (finished) return;
              finished = true;
              fail(e);
            };
            stream.on("data", (c: Buffer) => {
              chunks.push(c);
              size += c.length;
              if (size > maxBytes) finish(true);
            });
            stream.on("end", () => finish(false));
            stream.on("error", onErr);
            res.on("error", onErr);
            res.on("aborted", () => onErr(new Error("aborted")));
            req.signal.addEventListener("abort", () => onErr(new Error("aborted")), { once: true });
          }),
      });
    });
    r.on("error", reject);
    r.end();
  });

function decodeBody(body: Buffer, contentType: string): string {
  const fromHeader = contentType.match(/charset\s*=\s*["']?([\w-]+)/i)?.[1];
  const head = body.subarray(0, 2048).toString("latin1");
  const fromMeta = head.match(/<meta[^>]+charset\s*=\s*["']?([\w-]+)/i)?.[1];
  for (const label of [fromHeader, fromMeta, "utf-8"]) {
    if (!label) continue;
    try {
      return new TextDecoder(label).decode(body);
    } catch {
      // unknown label: try the next one
    }
  }
  return body.toString("utf8");
}

function isTimeout(e: unknown, signal: AbortSignal): boolean {
  return signal.aborted || (e instanceof Error && (e.name === "AbortError" || e.name === "TimeoutError"));
}

/** One request, redirects not handled. Tries each checked address in turn until one connects. */
async function requestOnce(url: URL, env: FetchEnv, accept: string, signal: AbortSignal): Promise<TransportResponse> {
  const addrs = await checkedAddresses(url, env);
  const transport = env.transport ?? nodeTransport;
  const headers: Record<string, string> = {
    "User-Agent": userAgent(),
    Accept:
      accept === "text/html"
        ? "text/html,application/xhtml+xml;q=0.9"
        : accept === "image"
          ? "image/png,image/jpeg,image/webp"
          : "text/plain",
    "Accept-Encoding": "gzip, deflate, br",
    Connection: "close",
  };
  let last: unknown;
  for (const a of addrs.slice(0, 3)) {
    try {
      return await transport({ url, ip: a.address, port: portOf(url), headers, signal });
    } catch (e) {
      if (isTimeout(e, signal)) throw new FetchError("timeout", "Request timed out", url.origin);
      last = e;
    }
  }
  throw new FetchError("network", `Connection failed${last instanceof Error ? `: ${last.message}` : ""}`, url.origin);
}

/**
 * Fetches a URL safely. Resolves for any final HTTP status (the caller decides what 404 or 500 means);
 * throws FetchError for refused addresses, timeouts, redirect loops, wrong content type and network errors.
 */
export async function safeFetch(rawUrl: string | URL, opts: SafeFetchOptions): Promise<FetchResult> {
  if (opts.allowPrivate && process.env.NODE_ENV === "production") {
    throw new Error("allowPrivate is for tests only and cannot be used in production");
  }
  const timeoutMs = opts.timeoutMs ?? FETCH_TIMEOUT_MS;
  const maxBytes = opts.maxBytes ?? MAX_BODY_BYTES;
  const maxRedirects = opts.maxRedirects ?? MAX_REDIRECTS;
  const redirects: string[] = [];
  let url = parseUrl(rawUrl, opts);

  for (let hop = 0; ; hop++) {
    if (opts.allowUrl && !(await opts.allowUrl(url))) throw new FetchError("disallowed", "Not allowed by robots.txt", url.href);
    const signal = AbortSignal.timeout(timeoutMs);
    const res = await requestOnce(url, opts, opts.accept, signal);
    try {
      const location = res.headers["location"];
      if ([301, 302, 303, 307, 308].includes(res.status) && location) {
        res.destroy();
        if (hop >= maxRedirects) throw new FetchError("too_many_redirects", `More than ${maxRedirects} redirects`, url.href);
        let next: URL;
        try {
          next = new URL(location, url);
        } catch {
          throw new FetchError("bad_redirect", "Redirect to an invalid URL", url.href);
        }
        if (url.protocol === "https:" && next.protocol === "http:") {
          throw new FetchError("bad_redirect", "Redirect from https to http", url.href);
        }
        redirects.push(next.href);
        url = parseUrl(next, opts); // scheme, port and credentials are checked again; DNS on the next loop
        continue;
      }

      const contentType = (res.headers["content-type"] ?? "").toLowerCase();
      if (res.status < 200 || res.status >= 300) {
        res.destroy();
        return { url: url.href, status: res.status, contentType, text: "", truncated: false, redirects };
      }
      const mime = contentType.split(";")[0].trim();
      const ok =
        opts.accept === "text/html"
          ? mime === "text/html" || mime === "application/xhtml+xml"
          : opts.accept === "image"
            ? IMAGE_TYPES.has(mime)
            : mime === "text/plain";
      if (!ok) {
        res.destroy();
        throw new FetchError("wrong_content_type", `Expected ${opts.accept}, got ${mime || "no content type"}`, url.href, res.status);
      }
      const { body, truncated } = await res.readBody(maxBytes);
      if (opts.accept === "image") {
        return { url: url.href, status: res.status, contentType, text: "", truncated, redirects, body };
      }
      return { url: url.href, status: res.status, contentType, text: decodeBody(body, contentType), truncated, redirects };
    } catch (e) {
      res.destroy();
      if (e instanceof FetchError) throw e;
      if (isTimeout(e, signal)) throw new FetchError("timeout", "Request timed out", url.origin);
      throw new FetchError("network", `Read failed${e instanceof Error ? `: ${e.message}` : ""}`, url.origin);
    }
  }
}
