import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { WebsiteFacts } from "@/lib/ai/schemas-v2";
import type { MockDb } from "@/lib/db/mock";
import { rereadMessage } from "@/lib/memory/messages";
import { s } from "@/lib/i18n/strings";
import { websiteStatusMessage } from "@/lib/setup/website-message";
import type { FetchEnv } from "@/lib/website/fetch";
import { readWebsiteFacts, type ReadWebsiteOptions } from "@/lib/website/extract";
import { loadWebsitePages, metaText } from "@/lib/website/load";
import { applyWebsiteUrl } from "@/lib/setup/save";
import { getWebsiteReadSummary } from "@/lib/setup/website";
import { savedReadNote } from "@/lib/memory/messages";
import { getWebsiteInfo } from "@/lib/memory/website";
import { parseRobots } from "@/lib/website/robots";
import { parseSitemap } from "@/lib/website/sitemap";
import {
  createJinaReader,
  defaultReader,
  parseReaderMarkdown,
  readerProvider,
  readerTarget,
  type ReaderFn,
  type ReaderPage,
} from "@/lib/website/reader";
import { closeTestDb, createBrandFor, createUser, openTestDb } from "../brand/helpers";
import { LOCAL_ENV, pathsOf, serve, serveSite, serveSpa, type TestServer } from "./site-server";

let server: TestServer | null = null;
afterEach(async () => {
  await server?.close();
  server = null;
});

/** A fake reading service: answers by path, records every URL it was asked for. Never touches the network. */
function fakeReader(answers: Record<string, ReaderPage | null | "throw">) {
  const calls: string[] = [];
  const fn: ReaderFn = async (url) => {
    calls.push(url);
    const hit = answers[new URL(url).pathname];
    if (hit === "throw") throw new Error("reader exploded");
    return hit ?? null;
  };
  return { fn, calls };
}

const HOME_TEXT = [
  "Fernhill Pottery makes handmade stoneware mugs, bowls and plates in our Leeds studio.",
  "Every piece is thrown, glazed and fired by hand, so no two are exactly alike.",
  "Free postage on orders over £40.",
].join("\n");
const PRICING_TEXT = "Pricing\nStoneware mug £18\nCereal bowl £22\nDinner plate £26\nAll prices include VAT, and every piece comes in a gift box on request.";
const ABOUT_TEXT = "About us\nFernhill Pottery was started by Jo Marsh in 2016 and works from a converted dairy in Headingley, Leeds, with two other potters.";
const CONTACT_TEXT = "Contact us\nStudio shop open Saturday 10am to 4pm.\nEmail hello@fernhillpottery.example\nPhone 0113 496 0123\nUnit 4, Dairy Yard, Headingley, Leeds LS6 3AB";

function spaAnswers(origin: string, extraLinks: Array<{ href: string; text: string }> = []): Record<string, ReaderPage> {
  return {
    "/": {
      text: HOME_TEXT,
      links: [
        { href: `${origin}/pricing`, text: "Pricing" },
        { href: `${origin}/about`, text: "About us" },
        { href: `${origin}/contact`, text: "Contact" },
        { href: "https://other-site.example/menu", text: "Menu" },
        { href: "http://169.254.169.254/latest/meta-data", text: "Hours" },
        ...extraLinks,
      ],
    },
    "/pricing": { text: PRICING_TEXT, links: [] },
    "/about": { text: ABOUT_TEXT, links: [] },
    "/contact": { text: CONTACT_TEXT, links: [] },
  };
}

describe("loadWebsitePages with the reading service", () => {
  it("a site with text in its HTML never calls the reader", async () => {
    server = await serveSite("corner-bakery");
    const reader = fakeReader({});
    const res = await loadWebsitePages(server.origin + "/", LOCAL_ENV, { reader: reader.fn });
    expect(res.status).toBe("ok");
    expect(res.pages.length).toBe(4);
    expect(reader.calls).toEqual([]);
    expect(res.readerPages).toEqual([]);
  });

  it("an empty-root page goes to the reader, and the reader's text and links are used", async () => {
    server = await serveSpa("fernhill-pottery");
    const origin = server.origin;
    const reader = fakeReader(spaAnswers(origin));
    const res = await loadWebsitePages(origin + "/", LOCAL_ENV, { reader: reader.fn });

    expect(res.status).toBe("ok");
    expect(res.reason).toBeNull();
    expect(res.pages.map((p) => new URL(p.url).pathname)).toEqual(["/", "/about", "/pricing", "/contact"]);
    expect(res.pages[0].text).toBe(HOME_TEXT);
    expect(res.pages[0].viaReader).toBe(true);
    expect(res.pages.find((p) => p.url.endsWith("/contact"))?.text).toBe(CONTACT_TEXT);
    expect(res.readerPages.length).toBe(4);
    // Only our own site, only pages we fetched ourselves; the off-site and metadata-address links were never sent.
    expect(reader.calls.every((u) => u.startsWith(origin + "/"))).toBe(true);
    expect(reader.calls.length).toBe(4);
    // The raw page is still fetched by us first (so robots.txt and the address check came first).
    expect(pathsOf(server)[0]).toBe("/robots.txt");
  });

  it("sends the page address without its query string or fragment", async () => {
    server = await serveSpa("fernhill-pottery");
    const reader = fakeReader({ "/": { text: HOME_TEXT, links: [] } });
    await loadWebsitePages(`${server.origin}/?utm_source=mail&email=jo%40example.com#top`, LOCAL_ENV, { reader: reader.fn });
    expect(reader.calls[0]).toBe(server.origin + "/");
    expect(reader.calls.join(" ")).not.toMatch(/utm_source|email|%40|#/);
  });

  it("reads at most 5 pages through the reader, home included", async () => {
    server = await serveSpa("fernhill-pottery");
    const origin = server.origin;
    const answers = spaAnswers(origin, [
      { href: `${origin}/services`, text: "Services" },
      { href: `${origin}/products`, text: "Products" },
      { href: `${origin}/menu`, text: "Menu" },
      { href: `${origin}/prices`, text: "Prices" },
      { href: `${origin}/location`, text: "Location" },
    ]);
    for (const p of ["/services", "/products", "/menu", "/prices", "/location"]) answers[p] = { text: `${p} page text that is long enough to keep`, links: [] };
    const reader = fakeReader(answers);
    const res = await loadWebsitePages(origin + "/", LOCAL_ENV, { reader: reader.fn });
    expect(res.pages.length).toBeLessThanOrEqual(5);
    expect(reader.calls.length).toBeLessThanOrEqual(5);
  });

  it("uses sitemap.xml when the reader's links give no pages: same site only, robots.txt respected", async () => {
    server = await serveSpa("fernhill-pottery");
    const origin = server.origin;
    const answers = spaAnswers(origin);
    answers["/"] = { text: HOME_TEXT, links: [{ href: "https://elsewhere.example/menu", text: "Menu" }] }; // nothing usable
    const reader = fakeReader(answers);
    const res = await loadWebsitePages(origin + "/", LOCAL_ENV, { reader: reader.fn });

    const read = res.pages.map((p) => new URL(p.url).pathname);
    expect(read).toEqual(["/", "/about", "/pricing", "/contact"]);
    expect(pathsOf(server)).toContain("/sitemap.xml");
    // The sitemap lists /private/pricing, which robots.txt disallows: not fetched, not sent to the reader.
    expect(pathsOf(server)).not.toContain("/private/pricing");
    expect(reader.calls.some((u) => u.includes("/private"))).toBe(false);
    expect(res.skipped).toContainEqual({ url: origin + "/private/pricing", reason: "robots" });
    // other-site.example from the sitemap is a different site.
    expect(reader.calls.some((u) => u.includes("other-site"))).toBe(false);
  });

  it("does not look at the sitemap when the home page has enough text of its own", async () => {
    server = await serveSite("corner-bakery");
    await loadWebsitePages(server.origin + "/", LOCAL_ENV, { reader: fakeReader({}).fn });
    expect(pathsOf(server)).not.toContain("/sitemap.xml");
  });

  it("robots.txt that blocks the site: nothing is fetched and nothing goes to the reader", async () => {
    server = await serveSite("blue-wave-yoga");
    const reader = fakeReader({});
    const res = await loadWebsitePages(server.origin + "/", LOCAL_ENV, { reader: reader.fn });
    expect(res.status).toBe("blocked");
    expect(reader.calls).toEqual([]);
    expect(pathsOf(server)).toEqual(["/robots.txt"]);
  });

  it("a page robots.txt disallows is not fetched and not sent to the reader", async () => {
    server = await serveSpa("fernhill-pottery", {
      "/robots.txt": (_req, res) => void res.writeHead(200, { "content-type": "text/plain" }).end("User-agent: *\nDisallow: /pricing\n"),
    });
    const origin = server.origin;
    const reader = fakeReader(spaAnswers(origin));
    const res = await loadWebsitePages(origin + "/", LOCAL_ENV, { reader: reader.fn });
    expect(res.pages.map((p) => new URL(p.url).pathname)).not.toContain("/pricing");
    expect(pathsOf(server)).not.toContain("/pricing");
    expect(reader.calls.some((u) => u.endsWith("/pricing"))).toBe(false);
    expect(res.skipped).toContainEqual({ url: origin + "/pricing", reason: "robots" });
  });

  it("an address that fails the public-address check is never sent to the reader", async () => {
    const reader = fakeReader({});
    const privateResolver: FetchEnv = { resolver: async () => [{ address: "10.0.0.5" }] };
    const res = await loadWebsitePages("http://internal-app.example/", privateResolver, { reader: reader.fn });
    expect(res.status).toBe("failed");
    expect(res.reason).toBe("blocked_address");
    expect(reader.calls).toEqual([]);
    const literal = await loadWebsitePages("http://169.254.169.254/", {}, { reader: reader.fn });
    expect(literal.status).toBe("failed");
    expect(reader.calls).toEqual([]);
  });

  it("falls back to the title and descriptions when the reader returns nothing", async () => {
    server = await serveSpa("fernhill-pottery");
    const reader = fakeReader({});
    const res = await loadWebsitePages(server.origin + "/", LOCAL_ENV, { reader: reader.fn });
    expect(res.status).toBe("partial");
    expect(res.reason).toBe("js_only_meta");
    expect(res.pages.length).toBe(1);
    expect(res.pages[0].text).toBe(
      "Fernhill Pottery - handmade mugs and bowls in Leeds\nFernhill Pottery\nHandmade stoneware mugs, bowls and plates, thrown in our Leeds studio.",
    );
    expect(res.readerPages).toEqual([]);
    expect(reader.calls.length).toBe(1); // it gave up after the home page: no point asking for every page
    expect(res.logoCandidates.length).toBeGreaterThan(0);
  });

  it("falls back the same way when the reader throws, and when it is off (null)", async () => {
    server = await serveSpa("fernhill-pottery");
    const boom = await loadWebsitePages(server.origin + "/", LOCAL_ENV, { reader: fakeReader({ "/": "throw" }).fn });
    expect(boom).toMatchObject({ status: "partial", reason: "js_only_meta" });
    const off = await loadWebsitePages(server.origin + "/", LOCAL_ENV, { reader: null });
    expect(off).toMatchObject({ status: "partial", reason: "js_only_meta" });
    expect(off.pages[0].text).toContain("Handmade stoneware mugs");
  });

  it("an empty page with no title or description is still a failed read, with the reason no_text", async () => {
    server = await serve((_req, res) => {
      res.writeHead(200, { "content-type": "text/html" }).end('<!doctype html><html><head><script src="/a.js"></script></head><body><div id="root"></div></body></html>');
    });
    const res = await loadWebsitePages(server.origin + "/", LOCAL_ENV, { reader: null });
    expect(res).toMatchObject({ status: "failed", reason: "no_text" });
  });

  it("www. and the bare host are one site; a dead bare host is never contacted", async () => {
    // Both names point at the local server; the server hangs on any request for the bare host, like the real apex that timed out.
    const resolver = async () => [{ address: "127.0.0.1" }];
    const env: FetchEnv = { ...LOCAL_ENV, resolver, timeoutMs: 500 };
    let port = 0;
    server = await serveSpa("fernhill-pottery", {
      "/robots.txt": (req, res) => {
        if (!String(req.headers.host).startsWith("www.")) return; // dead apex: no answer
        res.writeHead(200, { "content-type": "text/plain" }).end(`User-agent: *\nAllow: /\nSitemap: http://fern.test:${port}/sitemap.xml\n`);
      },
      "/sitemap.xml": (req, res) => {
        if (!String(req.headers.host).startsWith("www.")) return;
        res
          .writeHead(200, { "content-type": "application/xml" })
          .end(`<urlset><url><loc>http://fern.test:${port}/about</loc></url><url><loc>http://www.fern.test:${port}/pricing</loc></url><url><loc>http://fern.test:${port}/contact</loc></url><url><loc>http://blog.fern.test:${port}/menu</loc></url></urlset>`);
      },
    });
    port = Number(new URL(server.origin).port);
    const reader = fakeReader({
      "/": { text: HOME_TEXT, links: [{ href: `http://fern.test:${port}/gallery`, text: "Gallery" }] }, // nothing to rank: the sitemap is used
      "/about": { text: ABOUT_TEXT, links: [] },
      "/pricing": { text: PRICING_TEXT, links: [] },
      "/contact": { text: CONTACT_TEXT, links: [] },
    });
    const t = Date.now();
    const res = await loadWebsitePages(`http://www.fern.test:${port}/`, env, { reader: reader.fn });
    expect(Date.now() - t).toBeLessThan(4000);

    expect(res.status).toBe("ok");
    expect(res.pages.map((p) => new URL(p.url).pathname).sort()).toEqual(["/", "/about", "/contact", "/pricing"]);
    // Every page was read on the www host; nothing was sent to the dead bare host or to blog. (The sitemap named the bare host: it was moved to www.)
    expect(res.pages.every((p) => new URL(p.url).host === `www.fern.test:${port}`)).toBe(true);
    expect(reader.calls.every((u) => new URL(u).host === `www.fern.test:${port}`)).toBe(true);
    expect(server.headers.some((h) => !String(h.host).startsWith("www."))).toBe(false);
  });

  it("a sitemap that never answers does not sink the read", async () => {
    const env: FetchEnv = { ...LOCAL_ENV, timeoutMs: 300 };
    server = await serveSpa("fernhill-pottery", { "/sitemap.xml": () => undefined });
    const origin = server.origin;
    const answers = spaAnswers(origin);
    answers["/"] = { text: HOME_TEXT, links: [] };
    const t = Date.now();
    const res = await loadWebsitePages(origin + "/", env, { reader: fakeReader(answers).fn });
    expect(Date.now() - t).toBeLessThan(4000);
    expect(["ok", "partial"]).toContain(res.status);
    expect(res.pages[0].text).toBe(HOME_TEXT);
  });
});

describe("the Jina reader client", () => {
  const ok = (body: string, status = 200) => new Response(body, { status, headers: { "content-type": "text/plain" } });

  it("asks r.jina.ai for the page address only, with the links summary, and no key unless one is set", async () => {
    const seen: Array<{ url: string; headers: Record<string, string> }> = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      seen.push({ url, headers: init.headers as Record<string, string> });
      return ok("Title: x\n\nURL Source: https://www.shop.example/about\n\nMarkdown Content:\nHello there, this is the page.\n");
    }) as unknown as typeof fetch;

    const page = await createJinaReader({ fetchImpl })("https://www.shop.example/about?utm=1&mail=a@b.c#team");
    expect(page?.text).toBe("Hello there, this is the page.");
    expect(seen[0].url).toBe("https://r.jina.ai/https://www.shop.example/about");
    expect(seen[0].headers.Accept).toBe("text/plain");
    expect(seen[0].headers["X-With-Links-Summary"]).toBe("true");
    expect(seen[0].headers.Authorization).toBeUndefined();

    await createJinaReader({ fetchImpl, apiKey: "jina_secret" })("https://www.shop.example/");
    expect(seen[1].headers.Authorization).toBe("Bearer jina_secret");
  });

  it("refuses addresses that are not public web pages, without calling out", async () => {
    let called = 0;
    const fetchImpl = (async () => {
      called++;
      return ok("x");
    }) as unknown as typeof fetch;
    const read = createJinaReader({ fetchImpl });
    for (const u of ["http://127.0.0.1/", "http://10.0.0.1/a", "http://localhost/", "http://shop.local/", "https://shop.example:8443/", "https://user:pw@shop.example/", "ftp://shop.example/", "https://intranet/", "not a url"]) {
      expect(await read(u)).toBeNull();
    }
    expect(called).toBe(0);
    expect(readerTarget("https://Shop.Example/a?x=1#y")).toBe("https://shop.example/a");
  });

  it("returns null on an error status, a network error, a timeout and a page error notice", async () => {
    const status = createJinaReader({ fetchImpl: (async () => ok("rate limited", 429)) as unknown as typeof fetch });
    expect(await status("https://shop.example/")).toBeNull();
    const net = createJinaReader({ fetchImpl: (async () => Promise.reject(new Error("down"))) as unknown as typeof fetch });
    expect(await net("https://shop.example/")).toBeNull();
    const slow = createJinaReader({ fetchImpl: ((_u: string, init: RequestInit) => new Promise((_r, rej) => init.signal?.addEventListener("abort", () => rej(new Error("aborted"))))) as unknown as typeof fetch });
    expect(await slow("https://shop.example/", { timeoutMs: 50 })).toBeNull();
    const warned = createJinaReader({ fetchImpl: (async () => ok("Title: x\n\nURL Source: https://shop.example/\n\nWarning: Target URL returned error 403: Forbidden\n\nMarkdown Content:\nForbidden")) as unknown as typeof fetch });
    expect(await warned("https://shop.example/")).toBeNull();
  });

  it("READER_PROVIDER=off turns it off; jina is the default", () => {
    expect(readerProvider({})).toBe("jina");
    expect(readerProvider({ READER_PROVIDER: "" })).toBe("jina");
    expect(readerProvider({ READER_PROVIDER: "OFF" })).toBe("off");
    expect(defaultReader({ READER_PROVIDER: "off" })).toBeNull();
    expect(typeof defaultReader({})).toBe("function");
  });

  it("turns Jina's markdown into plain text and a list of links", () => {
    const raw = [
      "Title: Nostavia Health: AI health products",
      "",
      "URL Source: https://www.shop.example/",
      "",
      "Markdown Content:",
      "## Handmade mugs",
      "",
      "We make **stoneware** mugs. [READ FULL STORY](https://lnkd.in/p/abc)",
      "",
      "![Image 1: A mug](https://www.shop.example/mug.jpg)",
      "",
      "Free postage over £40.",
      "Free postage over £40.",
      "",
      "Links/Buttons:",
      "- [PRICING](https://www.shop.example/pricing)",
      "- [Contact](/contact#form)",
      "- [Email us](mailto:hi@shop.example)",
    ].join("\n");
    const page = parseReaderMarkdown(raw, "https://www.shop.example/");
    expect(page.text).toBe("Handmade mugs\nWe make stoneware mugs. READ FULL STORY\nFree postage over £40.");
    expect(page.text).not.toMatch(/Links\/Buttons|\]\(|!\[|URL Source|\*\*/);
    expect(page.links.map((l) => l.href)).toEqual(["https://www.shop.example/pricing", "https://www.shop.example/contact", "https://lnkd.in/p/abc"]);
    expect(page.links[0].text).toBe("PRICING");
  });

  it("parses robots Sitemap lines and sitemap files", () => {
    const rules = parseRobots("User-agent: *\nDisallow: /x\nSitemap: https://a.example/sitemap.xml\nSitemap: not-a-url\n");
    expect(rules.sitemaps).toEqual(["https://a.example/sitemap.xml"]);
    expect(rules.isAllowed(new URL("https://a.example/y"))).toBe(true);
    expect(rules.isAllowed(new URL("https://a.example/x"))).toBe(false);
    const sm = parseSitemap("<urlset><url><loc> https://a.example/a?x=1&amp;y=2 </loc></url><url><loc>https://a.example/b</loc></url></urlset>");
    expect(sm).toEqual({ isIndex: false, locs: ["https://a.example/a?x=1&y=2", "https://a.example/b"] });
    expect(parseSitemap("<sitemapindex><sitemap><loc>https://a.example/s1.xml</loc></sitemap></sitemapindex>").isIndex).toBe(true);
    expect(metaText({ title: "Shop", ogTitle: "shop", metaDescription: "Sells mugs." })).toBe("Shop\nSells mugs.");
  });
});

describe("readWebsiteFacts on a site built with JavaScript", () => {
  let db: MockDb;
  let userId: string;
  beforeAll(async () => {
    db = await openTestDb();
    userId = (await createUser(db)).id;
  });
  afterAll(async () => {
    await closeTestDb(db);
  });

  const fact = (over: Partial<WebsiteFacts["facts"][number]>): WebsiteFacts["facts"][number] => ({
    kind: "price",
    label: "Stoneware mug",
    value: "£18",
    quote: "Stoneware mug £18",
    page_url: "",
    outcome_promise: false,
    ...over,
  });
  async function savedFacts(brandId: string) {
    return db.withAdmin((tx) =>
      tx.query<{ label: string; value: string; source_ref: string; source_quote: string }>(
        "select label, value, source_ref, source_quote from public.brand_facts where brand_id = $1 and active and source_type = 'website' order by created_at, id",
        [brandId],
      ),
    );
  }
  async function websiteStatus(brandId: string) {
    const [row] = await db.withAdmin((tx) => tx.query<{ website_status: string }>("select website_status::text from public.brand_memory where brand_id = $1", [brandId]));
    return row.website_status;
  }
  async function readReason(brandId: string) {
    const [row] = await db.withAdmin((tx) => tx.query<{ r: string | null }>("select website_read_reason as r from public.brand_memory where brand_id = $1", [brandId]));
    return row.r;
  }

  it("saves facts quoted from the reader's text, keeps the page URL as the source, and drops invented facts", async () => {
    server = await serveSpa("fernhill-pottery");
    const origin = server.origin;
    const brand = await createBrandFor(db, userId, "Fernhill Pottery");
    const reader = fakeReader(spaAnswers(origin));
    const options: ReadWebsiteOptions = {
      fetch: LOCAL_ENV,
      reader: reader.fn,
      fixture: () => ({
        business_summary: "Fernhill Pottery makes handmade stoneware in Leeds.",
        facts: [
          fact({ page_url: `${origin}/pricing` }),
          fact({ kind: "hours", label: "Studio shop", value: "Saturday 10am to 4pm", quote: "Studio shop open Saturday 10am to 4pm", page_url: `${origin}/contact` }),
          fact({ kind: "price", label: "Teapot", value: "£45", quote: "Teapot £45", page_url: `${origin}/pricing` }), // invented
          fact({ kind: "offer", label: "Free postage", value: "Free postage on orders over £40", quote: "Free postage on orders over £40", page_url: `${origin}/pricing` }), // real, but on the home page
        ],
      }),
    };
    const res = await readWebsiteFacts({ userId, brandId: brand, url: origin + "/", options });
    expect(res.status).toBe("ok");
    expect(res.readerPages.length).toBe(4);
    expect(res.factsSaved).toBe(2);
    expect(res.factsDropped).toBe(2);
    const rows = await savedFacts(brand);
    const mug = rows.find((r) => r.label === "Stoneware mug")!;
    expect(rows.map((r) => r.label).sort()).toEqual(["Stoneware mug", "Studio shop"]);
    expect(mug.source_ref).toBe(`${origin}/pricing`); // the page's own address, not r.jina.ai
    expect(mug.source_quote).toBe("Stoneware mug £18");
    expect(JSON.stringify(rows)).not.toContain("jina");
    expect(await websiteStatus(brand)).toBe("ok");
    expect(await readReason(brand)).toBeNull();
  });

  it("with the reader off, saves facts quoted from the title and description, as partial/js_only_meta", async () => {
    server = await serveSpa("fernhill-pottery");
    const origin = server.origin;
    const brand = await createBrandFor(db, userId, "Fernhill Pottery 2");
    const options: ReadWebsiteOptions = {
      fetch: LOCAL_ENV,
      reader: null,
      fixture: () => ({
        business_summary: "A pottery in Leeds.",
        facts: [
          { kind: "product", label: "What we make", value: "Handmade stoneware mugs, bowls and plates", quote: "Handmade stoneware mugs, bowls and plates, thrown in our Leeds studio.", page_url: origin + "/", outcome_promise: false },
          { kind: "address", label: "Studio", value: "Leeds", quote: "thrown in our Leeds studio", page_url: origin + "/", outcome_promise: false },
          { kind: "price", label: "Mug", value: "£18", quote: "Stoneware mug £18", page_url: origin + "/", outcome_promise: false }, // not on the page
        ],
      }),
    };
    const res = await readWebsiteFacts({ userId, brandId: brand, url: origin + "/", options });
    expect(res).toMatchObject({ status: "partial", reason: "js_only_meta", factsSaved: 2, factsDropped: 1 });
    expect(res.pagesRead).toEqual([origin + "/"]);
    const rows = await savedFacts(brand);
    expect(rows.map((r) => r.source_quote).sort()).toEqual(["Handmade stoneware mugs, bowls and plates, thrown in our Leeds studio.", "thrown in our Leeds studio"].sort());
    expect(await websiteStatus(brand)).toBe("partial");
    // The reason is in the database, so a fresh load (no in-memory state at all) still explains the read.
    expect(await readReason(brand)).toBe("js_only_meta");
    const summary = await getWebsiteReadSummary(userId, brand);
    expect(summary).toMatchObject({ state: "partial", facts: 2, reason: "js_only_meta" });
    expect(websiteStatusMessage(summary, false)).toEqual({ text: s.setupV2.done.websiteJsOnly, tone: "warn" });
    const info = await getWebsiteInfo(userId, brand);
    expect(info).toMatchObject({ status: "partial", reason: "js_only_meta" });
    expect(savedReadNote(info.status, info.reason)).toBe(s.brandV2.facts.reread.jsOnly);
  });

  it("the reason is cleared by a clean read and by a new address, and a failed read keeps its own", async () => {
    server = await serveSpa("fernhill-pottery");
    const origin = server.origin;
    const brand = await createBrandFor(db, userId, "Fernhill Pottery 4");
    const noFacts = () => ({ business_summary: "", facts: [] });
    await readWebsiteFacts({ userId, brandId: brand, url: origin + "/", options: { fetch: LOCAL_ENV, reader: null, fixture: noFacts } });
    expect(await readReason(brand)).toBe("js_only_meta");
    await readWebsiteFacts({ userId, brandId: brand, url: origin + "/", options: { fetch: LOCAL_ENV, reader: fakeReader(spaAnswers(origin)).fn, fixture: noFacts } });
    expect(await websiteStatus(brand)).toBe("ok");
    expect(await readReason(brand)).toBeNull();

    // A page with no text and no title: failed, no_text.
    await server.close();
    server = await serve((_req, res) => void res.writeHead(200, { "content-type": "text/html" }).end("<html><head></head><body><div id=root></div></body></html>"));
    await readWebsiteFacts({ userId, brandId: brand, url: server.origin + "/", options: { fetch: LOCAL_ENV, reader: null, fixture: noFacts } });
    expect(await websiteStatus(brand)).toBe("failed");
    expect(await readReason(brand)).toBe("no_text");
    const info = await getWebsiteInfo(userId, brand);
    expect(savedReadNote(info.status, info.reason)).toBe(s.brandV2.facts.reread.failedNoText);

    // Setting a new address (applyWebsiteUrl) forgets the old reason.
    await db.withUser(userId, (tx) => applyWebsiteUrl(tx, brand, "https://new.example/"));
    expect(await readReason(brand)).toBeNull();
  });

  it("a reader failure ends the same way", async () => {
    server = await serveSpa("fernhill-pottery");
    const brand = await createBrandFor(db, userId, "Fernhill Pottery 3");
    const res = await readWebsiteFacts({
      userId,
      brandId: brand,
      url: server.origin + "/",
      options: { fetch: LOCAL_ENV, reader: fakeReader({ "/": "throw" }).fn, fixture: () => ({ business_summary: "", facts: [] }) },
    });
    expect(res).toMatchObject({ status: "partial", reason: "js_only_meta", factsSaved: 0 });
    expect(await websiteStatus(brand)).toBe("partial");
  });
});

describe("messages", () => {
  const base = { websiteUrl: "https://shop.example/", pagesRead: 0, factsSaved: 0, reason: null as string | null };
  const r = s.brandV2.facts.reread;

  it("Brand page: title and description only", () => {
    expect(rereadMessage({ ...base, status: "partial", reason: "js_only_meta", pagesRead: 1, factsSaved: 2 })).toBe(r.jsOnly);
    expect(r.jsOnly).toBe("Your website builds its pages in the browser, so we could only read its title and description. Add the rest of your facts below.");
  });
  it("Brand page: a site read through the reader needs no special message", () => {
    expect(rereadMessage({ ...base, status: "ok", pagesRead: 4, factsSaved: 12 })).toBe("Done. We read 4 pages and found 12 facts.");
  });
  it("Brand page: real failures keep the check-the-address message; a page that loaded but had no text does not", () => {
    for (const reason of ["network", "timeout", "dns", "bad_url", "http_404", "blocked_address"]) {
      expect(rereadMessage({ ...base, status: "failed", reason })).toBe(r.failed);
    }
    expect(rereadMessage({ ...base, status: "failed", reason: "no_text" })).toBe(r.failedNoText);
    expect(r.failedNoText).not.toMatch(/check the address/i);
    expect(rereadMessage({ ...base, status: "failed", reason: "ai_failed" })).toBe(r.aiFailed);
    expect(rereadMessage({ ...base, status: "blocked" })).toBe(r.blocked);
  });
  it("Setup: done screen", () => {
    const d = s.setupV2.done;
    expect(websiteStatusMessage({ state: "partial", facts: 2, pages: 1, reason: "js_only_meta" }, false).text).toBe(d.websiteJsOnly);
    expect(websiteStatusMessage({ state: "ok", facts: 12, pages: 4, reason: null }, false).text).toBe("We read 4 pages and found 12 facts. Check them on your Brand page.");
    expect(websiteStatusMessage({ state: "failed", facts: 0, pages: 0, reason: null }, false)).toEqual({ text: d.websiteFailed, tone: "warn" });
    expect(d.websiteFailed).not.toMatch(/check the address/i);
    expect(websiteStatusMessage({ state: "reading", facts: 0, pages: 0, reason: null }, true).text).toBe(d.websiteStillReading);
    expect(websiteStatusMessage({ state: "partial", facts: 0, pages: 1, reason: null }, false).text).toBe(d.websiteNoFacts);
  });
});

describe("the owner's Instagram linked from their website", () => {
  let db: MockDb;
  let userId: string;
  beforeAll(async () => {
    db = await openTestDb();
    userId = (await createUser(db)).id;
  });
  afterAll(async () => {
    await closeTestDb(db);
  });
  const site = (body: string) =>
    serve((_req, res) => void res.writeHead(200, { "content-type": "text/html" }).end(`<html><head><title>Fernhill Pottery</title></head><body><h1>Fernhill Pottery</h1><p>Handmade stoneware mugs and bowls from our studio in Bristol, open Tuesday to Saturday.</p>${body}</body></html>`));
  async function instagram(brandId: string) {
    const [row] = await db.withAdmin((tx) =>
      tx.query<{ h: string | null; src: string | null }>("select instagram_handle as h, instagram_handle_source as src from public.brand_memory where brand_id = $1", [brandId]),
    );
    return row;
  }
  const noFacts = () => ({ business_summary: "", facts: [] });

  it("remembers a footer link to Instagram as the brand's handle, marked as found on the website", async () => {
    const s = await site('<footer><a href="https://www.instagram.com/fernhill.pottery/?hl=en">Instagram</a> <a href="https://www.instagram.com/p/Cxyz123/">a post</a></footer>');
    try {
      const brand = await createBrandFor(db, userId, "Fernhill IG 1");
      await readWebsiteFacts({ userId, brandId: brand, url: s.origin + "/", options: { fetch: LOCAL_ENV, reader: null, fixture: noFacts } });
      expect(await instagram(brand)).toEqual({ h: "fernhill.pottery", src: "website" });
    } finally {
      await s.close();
    }
  });

  it("never replaces a handle the owner gave, and saves nothing when the site has no Instagram link", async () => {
    const s = await site('<footer><a href="https://www.instagram.com/someone.else/">Instagram</a></footer>');
    const plain = await site("<footer>No social links here.</footer>");
    try {
      const brand = await createBrandFor(db, userId, "Fernhill IG 2");
      await db.withAdmin((tx) => tx.query("update public.brand_memory set instagram_handle = 'fernhill.owner', instagram_handle_source = 'owner' where brand_id = $1", [brand]));
      await readWebsiteFacts({ userId, brandId: brand, url: s.origin + "/", options: { fetch: LOCAL_ENV, reader: null, fixture: noFacts } });
      expect(await instagram(brand)).toEqual({ h: "fernhill.owner", src: "owner" });

      const other = await createBrandFor(db, userId, "Fernhill IG 3");
      await readWebsiteFacts({ userId, brandId: other, url: plain.origin + "/", options: { fetch: LOCAL_ENV, reader: null, fixture: noFacts } });
      expect(await instagram(other)).toEqual({ h: null, src: null });
    } finally {
      await s.close();
      await plain.close();
    }
  });
});
