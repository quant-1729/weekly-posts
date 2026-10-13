import { afterEach, describe, expect, it, vi } from "vitest";
import type { Transport, TransportResponse } from "@/lib/website/fetch";
import { loadWebsitePages } from "@/lib/website/load";
import { RobotsCache, parseRobots, robotsFromStatus } from "@/lib/website/robots";
import { LOCAL_ENV, pathsOf, serve, serveSite, type TestServer } from "./site-server";

const ok = (p: string, rules: string) => parseRobots(rules).isAllowed(new URL(p, "https://x.example"));

describe("parseRobots (RFC 9309)", () => {
  it("allows everything when there are no rules or no matching group", () => {
    expect(ok("/anything", "")).toBe(true);
    expect(ok("/anything", "User-agent: otherbot\nDisallow: /")).toBe(true);
  });

  it("Disallow: / blocks every path for *", () => {
    const r = "User-agent: *\nDisallow: /";
    expect(ok("/", r)).toBe(false);
    expect(ok("/menu", r)).toBe(false);
  });

  it("an empty Disallow excludes nothing", () => {
    expect(ok("/menu", "User-agent: *\nDisallow:")).toBe(true);
  });

  it("matches prefixes", () => {
    const r = "User-agent: *\nDisallow: /careers";
    expect(ok("/careers.html", r)).toBe(false);
    expect(ok("/careers/jobs", r)).toBe(false);
    expect(ok("/about", r)).toBe(true);
  });

  it("our group beats the * group, even when it is more permissive", () => {
    const r = "User-agent: *\nDisallow: /\n\nUser-agent: WeeklyPostsBot\nAllow: /\nDisallow: /private";
    expect(ok("/menu", r)).toBe(true);
    expect(ok("/private/x", r)).toBe(false);
  });

  it("the token is matched case-insensitively and ignores a version suffix", () => {
    expect(ok("/x", "User-agent: weeklypostsbot/1.0\nDisallow: /x")).toBe(false);
    expect(ok("/x", "USER-AGENT: WEEKLYPOSTSBOT\nDISALLOW: /x")).toBe(false);
  });

  it("falls back to * when no group names us", () => {
    expect(ok("/x", "User-agent: googlebot\nAllow: /\n\nUser-agent: *\nDisallow: /x")).toBe(false);
  });

  it("merges several groups for the same agent", () => {
    const r = "User-agent: WeeklyPostsBot\nDisallow: /a\n\nUser-agent: *\nDisallow: /z\n\nUser-agent: weeklypostsbot\nDisallow: /b";
    expect(ok("/a", r)).toBe(false);
    expect(ok("/b", r)).toBe(false);
    expect(ok("/z", r)).toBe(true); // the * group is ignored because ours exists
  });

  it("shares rules between consecutive User-agent lines", () => {
    const r = "User-agent: googlebot\nUser-agent: WeeklyPostsBot\nDisallow: /shared";
    expect(ok("/shared", r)).toBe(false);
  });

  it("starts a new group after rules", () => {
    const r = "User-agent: googlebot\nDisallow: /g\nUser-agent: *\nDisallow: /s";
    expect(ok("/g", r)).toBe(true); // /g belongs to googlebot only
    expect(ok("/s", r)).toBe(false);
  });

  it("the longest matching rule wins", () => {
    const r = "User-agent: *\nDisallow: /shop\nAllow: /shop/sale";
    expect(ok("/shop/shoes", r)).toBe(false);
    expect(ok("/shop/sale/1", r)).toBe(true);
    const r2 = "User-agent: *\nAllow: /\nDisallow: /private/";
    expect(ok("/private/a", r2)).toBe(false);
    expect(ok("/public", r2)).toBe(true);
  });

  it("on a tie, Allow wins", () => {
    expect(ok("/page", "User-agent: *\nDisallow: /page\nAllow: /page")).toBe(true);
    expect(ok("/page", "User-agent: *\nAllow: /page\nDisallow: /page")).toBe(true);
  });

  it("supports * wildcards", () => {
    const r = "User-agent: *\nDisallow: /*.pdf\nDisallow: /tmp*/cache";
    expect(ok("/files/menu.pdf", r)).toBe(false);
    expect(ok("/files/menu.pdf.html", r)).toBe(false); // no $, so a prefix match
    expect(ok("/tmp123/cache", r)).toBe(false);
    expect(ok("/menu.html", r)).toBe(true);
  });

  it("supports the $ end anchor", () => {
    const r = "User-agent: *\nDisallow: /*.pdf$\nDisallow: /exact$";
    expect(ok("/a.pdf", r)).toBe(false);
    expect(ok("/a.pdf?x=1", r)).toBe(true); // query is part of the matched path
    expect(ok("/exact", r)).toBe(false);
    expect(ok("/exact/more", r)).toBe(true);
  });

  it("matches the query string", () => {
    const r = "User-agent: *\nDisallow: /*?session=";
    expect(ok("/page?session=1", r)).toBe(false);
    expect(ok("/page?other=1", r)).toBe(true);
  });

  it("treats regex characters in paths literally", () => {
    const r = "User-agent: *\nDisallow: /a.b+c(d)";
    expect(ok("/a.b+c(d)", r)).toBe(false);
    expect(ok("/aXb+c(d)", r)).toBe(true);
  });

  it("ignores comments, sitemap, crawl-delay, unknown fields, BOM and CRLF", () => {
    const r = "﻿User-agent: * # everyone\r\nCrawl-delay: 10\r\nSitemap: https://x.example/s.xml\r\nHost: x.example\r\nDisallow: /secret # hidden\r\n";
    expect(ok("/secret", r)).toBe(false);
    expect(ok("/open", r)).toBe(true);
  });

  it("ignores rules that come before any User-agent line", () => {
    expect(ok("/x", "Disallow: /x\nUser-agent: *\nAllow: /")).toBe(true);
  });

  it("always allows /robots.txt itself", () => {
    expect(ok("/robots.txt", "User-agent: *\nDisallow: /")).toBe(true);
  });

  it("matches non-ASCII paths in their encoded form", () => {
    expect(ok("/caf%C3%A9", "User-agent: *\nDisallow: /café")).toBe(false);
  });
});

describe("robots.txt status handling", () => {
  it("2xx parses the file", () => {
    expect(robotsFromStatus(200, "User-agent: *\nDisallow: /x").isAllowed(new URL("https://a.example/x"))).toBe(false);
  });
  it("4xx means allow all", () => {
    for (const status of [400, 401, 403, 404, 410, 429]) {
      const r = robotsFromStatus(status, null);
      expect(r.isAllowed(new URL("https://a.example/anything"))).toBe(true);
      expect(r.source).toBe("allow_all_4xx");
    }
  });
  it("5xx means disallow all", () => {
    for (const status of [500, 502, 503]) {
      const r = robotsFromStatus(status, null);
      expect(r.isAllowed(new URL("https://a.example/"))).toBe(false);
      expect(r.source).toBe("disallow_all_5xx");
    }
  });
});

function reply(status: number, type = "text/plain", body = ""): TransportResponse {
  return {
    status,
    headers: { "content-type": type },
    readBody: async () => ({ body: Buffer.from(body), truncated: false }),
    destroy() {},
  };
}
const resolver = async () => [{ address: "93.184.216.34", family: 4 }];
const url = (p: string) => new URL(p, "https://a.example");

describe("RobotsCache", () => {
  it("fetches robots.txt once per origin and caches it for the run", async () => {
    const transport = vi.fn<Transport>(async () => reply(200, "text/plain", "User-agent: *\nDisallow: /no"));
    const cache = new RobotsCache({ resolver, transport });
    expect(await cache.isAllowed(url("/no"))).toBe(false);
    expect(await cache.isAllowed(url("/yes"))).toBe(true);
    expect(await Promise.all([cache.isAllowed(url("/a")), cache.isAllowed(url("/b"))])).toEqual([true, true]);
    expect(transport).toHaveBeenCalledTimes(1);
    expect(cache.fetched).toEqual(["https://a.example"]);
    await cache.isAllowed(new URL("https://b.example/x"));
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it("404 allows all", async () => {
    const cache = new RobotsCache({ resolver, transport: async () => reply(404, "text/html", "nope") });
    expect(await cache.isAllowed(url("/x"))).toBe(true);
  });

  it("500 disallows all", async () => {
    const cache = new RobotsCache({ resolver, transport: async () => reply(503) });
    expect(await cache.isAllowed(url("/x"))).toBe(false);
  });

  it("an unreachable server disallows all", async () => {
    const cache = new RobotsCache({
      resolver,
      transport: async () => {
        throw new Error("ECONNREFUSED");
      },
    });
    expect(await cache.isAllowed(url("/x"))).toBe(false);
  });

  it("a 200 that is not text/plain is not a robots file, so nothing is disallowed", async () => {
    const cache = new RobotsCache({ resolver, transport: async () => reply(200, "text/html", "<h1>Home</h1>") });
    expect(await cache.isAllowed(url("/x"))).toBe(true);
  });

  it("follows a redirect to the robots.txt", async () => {
    let n = 0;
    const transport = vi.fn<Transport>(async () =>
      n++ === 0
        ? { status: 301, headers: { location: "https://www.a.example/robots.txt" }, readBody: async () => ({ body: Buffer.alloc(0), truncated: false }), destroy() {} }
        : reply(200, "text/plain", "User-agent: *\nDisallow: /"),
    );
    const cache = new RobotsCache({ resolver, transport });
    expect(await cache.isAllowed(url("/x"))).toBe(false);
  });

  it("passes SSRF refusals up instead of hiding them as 'unreachable'", async () => {
    const cache = new RobotsCache({ resolver: async () => [{ address: "10.0.0.1", family: 4 }], transport: vi.fn<Transport>() });
    await expect(cache.isAllowed(url("/x"))).rejects.toMatchObject({ code: "blocked_address" });
  });
});

describe("robots.txt on the test sites", () => {
  let server: TestServer | null = null;
  afterEach(async () => {
    await server?.close();
    server = null;
  });

  it("blue-wave-yoga (Disallow: /) is blocked and nothing but robots.txt is fetched", async () => {
    server = await serveSite("blue-wave-yoga");
    const res = await loadWebsitePages(server.origin + "/", LOCAL_ENV);
    expect(res.status).toBe("blocked");
    expect(res.pages).toEqual([]);
    expect(pathsOf(server)).toEqual(["/robots.txt"]);
    expect(res.skipped).toEqual([{ url: server.origin + "/", reason: "robots" }]);
  });

  it("blue-wave-yoga is blocked whichever page the owner typed", async () => {
    server = await serveSite("blue-wave-yoga");
    const res = await loadWebsitePages(server.origin + "/pricing.html", LOCAL_ENV);
    expect(res.status).toBe("blocked");
    expect(pathsOf(server)).toEqual(["/robots.txt"]);
  });

  it("corner-bakery: careers.html (disallowed) is never fetched", async () => {
    server = await serveSite("corner-bakery");
    const res = await loadWebsitePages(server.origin + "/", LOCAL_ENV);
    expect(res.status).toBe("ok");
    expect(pathsOf(server)).not.toContain("/careers.html");
    expect(res.pages.map((p) => p.text).join("\n")).not.toContain("12.50");
  });

  it("a candidate page that robots.txt disallows is skipped and the next best is used", async () => {
    server = await serve((req, res) => {
      const p = new URL(req.url ?? "/", "http://x").pathname;
      if (p === "/robots.txt") return void res.writeHead(200, { "content-type": "text/plain" }).end("User-agent: *\nDisallow: /about");
      const links = '<a href="/about">About</a> <a href="/menu">Menu</a> <a href="/contact">Contact</a>';
      res.writeHead(200, { "content-type": "text/html" }).end(`<html><body><p>Page ${p} with enough words to count as text.</p>${links}</body></html>`);
    });
    const res = await loadWebsitePages(server.origin + "/", LOCAL_ENV);
    expect(res.pages.map((p) => new URL(p.url).pathname).sort()).toEqual(["/", "/contact", "/menu"]);
    expect(res.skipped).toEqual([{ url: server.origin + "/about", reason: "robots" }]);
    expect(pathsOf(server)).not.toContain("/about");
    expect(res.status).toBe("ok");
  });

  it("an unreachable robots.txt (5xx) means the site is not read", async () => {
    server = await serve((req, res) => {
      if (req.url === "/robots.txt") return void res.writeHead(503).end();
      res.writeHead(200, { "content-type": "text/html" }).end("<p>Home page text that is long enough</p>");
    });
    const res = await loadWebsitePages(server.origin + "/", LOCAL_ENV);
    expect(res.status).toBe("blocked");
    expect(pathsOf(server)).toEqual(["/robots.txt"]);
  });

  it("a missing robots.txt (404) means the site is read", async () => {
    server = await serve((req, res) => {
      if (req.url === "/robots.txt") return void res.writeHead(404, { "content-type": "text/html" }).end("nope");
      res.writeHead(200, { "content-type": "text/html" }).end("<p>Home page text that is long enough</p>");
    });
    const res = await loadWebsitePages(server.origin + "/", LOCAL_ENV);
    expect(res.pages.length).toBeGreaterThan(0);
  });

  it("a redirect from the home page into a disallowed path is refused", async () => {
    server = await serve((req, res) => {
      const p = new URL(req.url ?? "/", "http://x").pathname;
      if (p === "/robots.txt") return void res.writeHead(200, { "content-type": "text/plain" }).end("User-agent: *\nDisallow: /private");
      if (p === "/") return void res.writeHead(302, { location: "/private/home" }).end();
      res.writeHead(200, { "content-type": "text/html" }).end("<p>secret page text that is long enough</p>");
    });
    const res = await loadWebsitePages(server.origin + "/", LOCAL_ENV);
    expect(res.status).toBe("blocked");
    expect(pathsOf(server)).not.toContain("/private/home");
  });
});
