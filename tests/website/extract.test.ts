import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { AiError } from "@/lib/ai/client";
import type { WebsiteFacts } from "@/lib/ai/schemas-v2";
import { BrandAccessError } from "@/lib/brand/current";
import type { MockDb } from "@/lib/db/mock";
import { DailyCapError } from "@/lib/usage";
import { normalizeFactValue, normalizeForMatch, readWebsiteFacts, verifyFacts, type ReadWebsiteOptions } from "@/lib/website/extract";
import { closeTestDb, createBrandFor, createUser, openTestDb } from "../brand/helpers";
import { LOCAL_ENV, pathsOf, serve, serveSite, type TestServer } from "./site-server";

let db: MockDb;
let userId: string;
let otherUserId: string;

beforeAll(async () => {
  db = await openTestDb();
  userId = (await createUser(db)).id;
  otherUserId = (await createUser(db)).id;
});
afterAll(async () => {
  await closeTestDb(db);
});

let server: TestServer | null = null;
afterEach(async () => {
  await server?.close();
  server = null;
});

const local: ReadWebsiteOptions = { fetch: LOCAL_ENV };

async function newBrand(name = "Corner Bakery"): Promise<string> {
  return createBrandFor(db, userId, name);
}
async function facts(brandId: string, where = "true") {
  return db.withAdmin((tx) =>
    tx.query<{ kind: string; label: string | null; value: string; source_type: string; source_ref: string | null; source_quote: string | null; active: boolean; outcome_promise: boolean }>(
      `select kind::text, label, value, source_type::text, source_ref, source_quote, active, outcome_promise
         from public.brand_facts where brand_id = $1 and ${where} order by created_at, id`,
      [brandId],
    ),
  );
}
async function memory(brandId: string) {
  const [row] = await db.withAdmin((tx) =>
    tx.query<{ website_url: string | null; website_status: string; website_read_at: string | null }>(
      "select website_url, website_status::text, website_read_at from public.brand_memory where brand_id = $1",
      [brandId],
    ),
  );
  return row;
}
async function usageKinds(brandId: string) {
  const rows = await db.withAdmin((tx) => tx.query<{ kind: string }>("select kind::text from public.usage_events where brand_id = $1 order by id", [brandId]));
  return rows.map((r) => r.kind);
}

describe("verifyFacts (the quote check)", () => {
  const pages = [
    { url: "https://a.example/", text: "Welcome\n10% off for orders over £30 on Fridays.\nMonday to Friday | 7am to 6pm" },
    { url: "https://a.example/menu", text: "Sourdough loaf £4.50\nRye loaf £4.80" },
  ];
  const f = (over: Partial<WebsiteFacts["facts"][number]>): WebsiteFacts["facts"][number] => ({
    kind: "price",
    label: "Sourdough loaf",
    value: "£4.50",
    quote: "Sourdough loaf £4.50",
    page_url: "https://a.example/menu",
    outcome_promise: false,
    ...over,
  });

  it("keeps a fact whose quote is on the page it names", () => {
    const { kept, dropped } = verifyFacts([f({})], pages);
    expect(dropped).toBe(0);
    expect(kept[0]).toMatchObject({ kind: "price", value: "£4.50", pageUrl: "https://a.example/menu", quote: "Sourdough loaf £4.50" });
  });

  it("ignores case, spacing and table separators in the quote", () => {
    const { kept } = verifyFacts([f({ kind: "hours", label: "Weekdays", value: "7am to 6pm", quote: "MONDAY  to Friday   7am to 6pm", page_url: "https://a.example/" })], pages);
    expect(kept.length).toBe(1);
  });

  it("drops a fact whose quote is not on the page", () => {
    const { kept, dropped } = verifyFacts([f({ quote: "Sourdough loaf £3.50", value: "£3.50" }), f({ quote: "Free coffee with every loaf", kind: "offer", value: "Free coffee" })], pages);
    expect(kept).toEqual([]);
    expect(dropped).toBe(2);
  });

  it("drops a fact whose quote is on a different page than the one it names", () => {
    expect(verifyFacts([f({ page_url: "https://a.example/" })], pages).dropped).toBe(1);
  });

  it("drops a fact whose page was not fetched", () => {
    expect(verifyFacts([f({ page_url: "https://a.example/careers" })], pages).dropped).toBe(1);
    expect(verifyFacts([f({ page_url: "https://evil.example/menu" })], pages).dropped).toBe(1);
    expect(verifyFacts([f({ page_url: "not a url at all %%" })], pages).dropped).toBe(1);
  });

  it("accepts a page URL with a trailing slash, another scheme or a relative path", () => {
    expect(verifyFacts([f({ page_url: "https://a.example/menu/" })], pages).kept.length).toBe(1);
    expect(verifyFacts([f({ page_url: "http://a.example/menu" })], pages).kept.length).toBe(1);
    expect(verifyFacts([f({ page_url: "/menu" })], pages).kept.length).toBe(1);
  });

  it("drops a fact with an empty quote", () => {
    expect(verifyFacts([f({ quote: "" }), f({ quote: "   " })], pages).dropped).toBe(2);
  });

  it("drops a price whose number is not in its own quote", () => {
    // the quote is real, but the value claims a different price
    expect(verifyFacts([f({ value: "£2.50" })], pages).dropped).toBe(1);
  });

  it("drops duplicates and counts them", () => {
    const { kept, dropped } = verifyFacts([f({}), f({}), f({ value: "£4.50 " })], pages);
    expect(kept.length).toBe(1);
    expect(dropped).toBe(2);
  });

  it("normalises quotes, dashes and whitespace", () => {
    expect(normalizeForMatch("  It’s  “fresh” – daily ")).toBe("it's \"fresh\" - daily");
  });

  it("H-9: a pipe in a value becomes a colon before a time or price, a comma elsewhere; the quote keeps its pipe and still verifies", () => {
    const { kept, dropped } = verifyFacts(
      [f({ kind: "hours", label: "Weekdays", value: "Monday to Friday | 7am to 6pm", quote: "Monday to Friday | 7am to 6pm", page_url: "https://a.example/" })],
      pages,
    );
    expect(dropped).toBe(0);
    expect(kept[0].value).toBe("Monday to Friday: 7am to 6pm");
    expect(kept[0].quote).toBe("Monday to Friday | 7am to 6pm");
    expect(normalizeFactValue("Haircut | Rs 300")).toBe("Haircut: Rs 300");
    expect(normalizeFactValue("Mon | 7am to 6pm | Tue | 8am to 5pm")).toBe("Mon: 7am to 6pm, Tue: 8am to 5pm");
    expect(normalizeFactValue("Fresh bread | Baked daily")).toBe("Fresh bread, Baked daily");
    expect(normalizeFactValue("7am to 6pm | 8am to 9pm")).toBe("7am to 6pm, 8am to 9pm");
    expect(normalizeFactValue("No pipes here")).toBe("No pipes here");
    expect(normalizeFactValue(" | Open daily | ")).toBe("Open daily");
  });

  it("H-9: a fact saved from a table row has no pipe in its value, and keeps the quote that was checked", async () => {
    server = await serveSite("corner-bakery");
    const brand = await newBrand();
    const base = server.origin;
    const options: ReadWebsiteOptions = {
      ...local,
      fixture: () => ({
        business_summary: "A bakery.",
        facts: [{ kind: "hours", label: "Weekdays", value: "Monday to Friday | 7am to 6pm", quote: "Monday to Friday | 7am to 6pm", page_url: `${base}/contact.html`, outcome_promise: false }],
      }),
    };
    const res = await readWebsiteFacts({ userId, brandId: brand, url: base + "/", options });
    expect(res.factsSaved).toBe(1);
    expect(res.factsDropped).toBe(0);
    const [saved] = await facts(brand);
    expect(saved.value).toBe("Monday to Friday: 7am to 6pm");
    expect(saved.value).not.toContain("|");
    expect(saved.source_quote).toBe("Monday to Friday | 7am to 6pm");
  });
});

describe("readWebsiteFacts: corner-bakery (fixture AI)", () => {
  it("reads the site, saves verified facts with sources, and records the status", async () => {
    server = await serveSite("corner-bakery");
    const brand = await newBrand();
    const res = await readWebsiteFacts({ userId, brandId: brand, url: server.origin + "/", options: local });

    expect(res.status).toBe("ok");
    expect(res.pagesRead.map((u) => new URL(u).pathname)).toEqual(["/", "/about.html", "/menu.html", "/contact.html"]);
    expect(res.factsSaved).toBe(22);
    expect(res.factsDropped).toBe(0);
    expect(res.summary).toMatch(/bakery/i);
    expect(res.skipped).toEqual([]);
    expect(res.logoCandidates).toEqual([]);

    const saved = await facts(brand);
    expect(saved.length).toBe(22);
    for (const f of saved) {
      expect(f.source_type).toBe("website");
      expect(f.active).toBe(true);
      expect(res.pagesRead).toContain(f.source_ref);
      expect(f.source_quote).toBeTruthy();
    }
    const price = saved.find((f) => f.kind === "price" && f.label === "Sourdough loaf")!;
    expect(price).toMatchObject({ value: "£4.50", source_ref: server.origin + "/menu.html", source_quote: "£4.50", outcome_promise: false });

    const mem = await memory(brand);
    expect(mem.website_status).toBe("ok");
    expect(mem.website_url).toBe(server.origin + "/");
    expect(mem.website_read_at).not.toBeNull();
    expect(await usageKinds(brand)).toEqual(["website_read"]);

    // robots.txt was fetched, careers.html (disallowed) and blog.html were not
    expect(pathsOf(server)).toContain("/robots.txt");
    expect(pathsOf(server)).not.toContain("/careers.html");
    expect(pathsOf(server)).not.toContain("/blog.html");
  });

  it("drops facts whose quotes are not on the page and counts them", async () => {
    server = await serveSite("corner-bakery");
    const brand = await newBrand();
    const base = server.origin;
    const options: ReadWebsiteOptions = {
      ...local,
      fixture: () => ({
        business_summary: "A bakery.",
        facts: [
          { kind: "price", label: "Sourdough loaf", value: "£4.50", quote: "Sourdough loaf £4.50", page_url: `${base}/menu.html`, outcome_promise: false },
          { kind: "price", label: "Wedding cake", value: "£250", quote: "Wedding cake from £250", page_url: `${base}/menu.html`, outcome_promise: false }, // invented
          { kind: "offer", label: "Free coffee", value: "Free coffee", quote: "Free coffee with any loaf", page_url: `${base}/index.html`, outcome_promise: false }, // invented
          { kind: "price", label: "Careers", value: "£12.50 an hour", quote: "£12.50 an hour", page_url: `${base}/careers.html`, outcome_promise: false }, // page never fetched
          { kind: "differentiator", label: "x", value: "Baked on site every morning since 2009", quote: "Baked on site every morning since 2009", page_url: `${base}/menu.html`, outcome_promise: false }, // wrong page
          { kind: "differentiator", label: "x", value: "Baked on site every morning since 2009", quote: "Baked on site every morning since 2009", page_url: `${base}/`, outcome_promise: true },
        ],
      }),
    };
    const res = await readWebsiteFacts({ userId, brandId: brand, url: base + "/", options });
    expect(res.factsSaved).toBe(2);
    expect(res.factsDropped).toBe(4);
    const saved = await facts(brand);
    expect(saved.map((f) => f.value).sort()).toEqual(["Baked on site every morning since 2009", "£4.50"]);
    const claim = saved.find((f) => f.kind === "differentiator")!;
    expect(claim.outcome_promise).toBe(true);
    expect(claim.source_ref).toBe(base + "/");
  });

  it("deactivates the previous website facts on a re-read, never deletes, and leaves other sources alone", async () => {
    server = await serveSite("corner-bakery");
    const brand = await newBrand();
    await db.withUser(userId, (tx) =>
      tx.query("insert into public.brand_facts (brand_id, kind, value, source_type) values ($1, 'other', 'Owner typed this', 'owner')", [brand]),
    );
    await readWebsiteFacts({ userId, brandId: brand, url: server.origin + "/", options: local });
    const first = await facts(brand, "source_type = 'website'");
    expect(first.length).toBe(22);

    const second = await readWebsiteFacts({ userId, brandId: brand, url: server.origin + "/", options: local });
    expect(second.factsSaved).toBe(22);
    const all = await facts(brand, "source_type = 'website'");
    expect(all.length).toBe(44); // old rows are kept
    expect(all.filter((f) => !f.active).length).toBe(22);
    expect(all.filter((f) => f.active).length).toBe(22);
    const ownerFacts = await facts(brand, "source_type = 'owner'");
    expect(ownerFacts).toMatchObject([{ value: "Owner typed this", active: true }]);
  });

  it("keeps the old website facts when the new read fails", async () => {
    server = await serveSite("corner-bakery");
    const brand = await newBrand();
    await readWebsiteFacts({ userId, brandId: brand, url: server.origin + "/", options: local });
    await server.close();
    server = null;
    const res = await readWebsiteFacts({ userId, brandId: brand, url: "http://127.0.0.1:1/", options: { fetch: { ...LOCAL_ENV, timeoutMs: 500 } } });
    expect(res.status).toBe("failed");
    expect((await facts(brand, "active")).length).toBe(22);
  });
});

describe("readWebsiteFacts: statuses", () => {
  it("blocked: robots.txt disallows everything, nothing but robots.txt is fetched, no AI call", async () => {
    server = await serveSite("blue-wave-yoga");
    const brand = await newBrand("Blue Wave Yoga");
    const res = await readWebsiteFacts({ userId, brandId: brand, url: server.origin + "/", options: local });
    expect(res.status).toBe("blocked");
    expect(res.pagesRead).toEqual([]);
    expect(res.factsSaved).toBe(0);
    expect(pathsOf(server)).toEqual(["/robots.txt"]);
    expect(await facts(brand)).toEqual([]);
    expect((await memory(brand)).website_status).toBe("blocked");
    expect((await memory(brand)).website_url).toBe(server.origin + "/");
    expect(await usageKinds(brand)).toEqual([]);
  });

  it("partial: some chosen pages failed", async () => {
    server = await serveSite("corner-bakery", { "/menu.html": (_q, res) => void res.writeHead(500, { "content-type": "text/html" }).end("oops") });
    const brand = await newBrand();
    const res = await readWebsiteFacts({ userId, brandId: brand, url: server.origin + "/", options: local });
    expect(res.status).toBe("partial");
    expect(res.pagesRead.map((u) => new URL(u).pathname)).toEqual(["/", "/about.html", "/contact.html"]);
    expect(res.skipped).toContainEqual({ url: server.origin + "/menu.html", reason: "http_500" });
    expect(res.factsSaved).toBeGreaterThan(0); // the menu facts are dropped because their page was not read
    expect(res.factsDropped).toBeGreaterThan(0);
    expect((await memory(brand)).website_status).toBe("partial");
  });

  it("partial: a chosen page that times out", async () => {
    server = await serveSite("corner-bakery", {
      "/about.html": () => {
        /* never answers */
      },
    });
    const brand = await newBrand();
    const res = await readWebsiteFacts({ userId, brandId: brand, url: server.origin + "/", options: { fetch: { ...LOCAL_ENV, timeoutMs: 300 } } });
    expect(res.status).toBe("partial");
    expect(res.skipped).toContainEqual({ url: server.origin + "/about.html", reason: "timeout" });
  });

  it("failed: the home page is a 404", async () => {
    server = await serve((req, res) => {
      if (req.url === "/robots.txt") return void res.writeHead(404).end();
      res.writeHead(404, { "content-type": "text/html" }).end("<h1>nope</h1>");
    });
    const brand = await newBrand();
    const res = await readWebsiteFacts({ userId, brandId: brand, url: server.origin + "/", options: local });
    expect(res).toMatchObject({ status: "failed", reason: "http_404", pagesRead: [], factsSaved: 0 });
    expect((await memory(brand)).website_status).toBe("failed");
    expect(await usageKinds(brand)).toEqual([]);
  });

  it("failed: the home page is not HTML", async () => {
    server = await serve((req, res) => {
      if (req.url === "/robots.txt") return void res.writeHead(404).end();
      res.writeHead(200, { "content-type": "application/json" }).end("{}");
    });
    const brand = await newBrand();
    const res = await readWebsiteFacts({ userId, brandId: brand, url: server.origin + "/", options: local });
    expect(res).toMatchObject({ status: "failed", reason: "wrong_content_type" });
  });

  it("failed: a page with no readable text (script-only site)", async () => {
    server = await serve((req, res) => {
      if (req.url === "/robots.txt") return void res.writeHead(404).end();
      res.writeHead(200, { "content-type": "text/html" }).end('<html><body><div id="root"></div><script>render()</script></body></html>');
    });
    const brand = await newBrand();
    const res = await readWebsiteFacts({ userId, brandId: brand, url: server.origin + "/", options: local });
    expect(res).toMatchObject({ status: "failed", reason: "no_text" });
  });

  it("failed: the SSRF check refuses the URL (default settings, no allowPrivate), and nothing throws", async () => {
    const brand = await newBrand();
    for (const url of ["http://127.0.0.1/", "http://169.254.169.254/latest/meta-data/", "http://[::1]/", "file:///etc/passwd", "ftp://example.com/", "http://user:pw@example.com/", "https://example.com:8443/", "not a url"]) {
      const res = await readWebsiteFacts({ userId, brandId: brand, url });
      expect(res.status, url).toBe("failed");
      expect(res.factsSaved).toBe(0);
    }
    expect((await memory(brand)).website_status).toBe("failed");
    expect(await usageKinds(brand)).toEqual([]);
  });

  it("failed: a hostname that resolves to a private IP", async () => {
    const brand = await newBrand();
    const res = await readWebsiteFacts({
      userId,
      brandId: brand,
      url: "https://intranet.example/",
      options: { fetch: { resolver: async () => [{ address: "10.0.0.5", family: 4 }] } },
    });
    expect(res).toMatchObject({ status: "failed", reason: "blocked_address" });
  });

  it("failed: an unresolvable host", async () => {
    const brand = await newBrand();
    const res = await readWebsiteFacts({
      userId,
      brandId: brand,
      url: "no-such-site.example",
      options: {
        fetch: {
          resolver: async () => {
            throw new Error("ENOTFOUND");
          },
        },
      },
    });
    expect(res).toMatchObject({ status: "failed", reason: "dns" });
  });

  it("failed: the AI call fails (status reported, nothing replaced, still counted)", async () => {
    server = await serveSite("corner-bakery");
    const brand = await newBrand();
    await readWebsiteFacts({ userId, brandId: brand, url: server.origin + "/", options: local });
    const res = await readWebsiteFacts({
      userId,
      brandId: brand,
      url: server.origin + "/",
      options: {
        ...local,
        fixture: () => {
          throw new AiError("invalid_output", "bad json");
        },
      },
    });
    expect(res).toMatchObject({ status: "failed", reason: "ai_failed", factsSaved: 0 });
    expect((await facts(brand, "active")).length).toBe(22);
    expect(await usageKinds(brand)).toEqual(["website_read", "website_read"]);
  });

  it("none: no URL given, setup continues, nothing is fetched or counted", async () => {
    const brand = await newBrand();
    await db.withAdmin((tx) => tx.query("update public.brands set daily_generation_cap = 0 where id = $1", [brand])); // even a spent cap is fine
    for (const url of [undefined, null, "", "   "]) {
      const res = await readWebsiteFacts({ userId, brandId: brand, url });
      expect(res).toMatchObject({ status: "none", pagesRead: [], skipped: [], factsSaved: 0, factsDropped: 0, logoCandidates: [], themeColor: null });
    }
    const mem = await memory(brand);
    expect(mem).toMatchObject({ website_status: "none", website_url: null, website_read_at: null });
  });

  it("adds https:// when the owner types a bare domain", async () => {
    const brand = await newBrand();
    const res = await readWebsiteFacts({
      userId,
      brandId: brand,
      url: "cornerbakery.example",
      options: { fetch: { resolver: async () => [{ address: "10.1.1.1", family: 4 }] } },
    });
    expect(res.reason).toBe("blocked_address"); // reached the check, so the URL was understood
    expect((await memory(brand)).website_url).toBe("cornerbakery.example");
  });

  it("returns logo candidates and the theme colour of the home page", async () => {
    server = await serve((req, res) => {
      if (req.url === "/robots.txt") return void res.writeHead(404).end();
      res.writeHead(200, { "content-type": "text/html" }).end(
        '<html><head><title>Shop</title><meta name="theme-color" content="#112233"><link rel="icon" href="/fav.png"></head><body><img class="logo" src="/logo.png"><p>We sell lovely things all week long.</p></body></html>',
      );
    });
    const brand = await newBrand();
    const res = await readWebsiteFacts({ userId, brandId: brand, url: server.origin + "/", options: { ...local, fixture: () => ({ business_summary: "A shop.", facts: [] }) } });
    expect(res.status).toBe("ok");
    expect(res.themeColor).toBe("#112233");
    expect(res.logoCandidates).toEqual([
      { url: server.origin + "/logo.png", source: "img" },
      { url: server.origin + "/fav.png", source: "icon" },
    ]);
    expect(res.factsSaved).toBe(0);
  });
});

describe("readWebsiteFacts: access and cap", () => {
  it("refuses a user who is not a member of the brand, and touches nothing", async () => {
    server = await serveSite("corner-bakery");
    const brand = await newBrand();
    await expect(readWebsiteFacts({ userId: otherUserId, brandId: brand, url: server.origin + "/", options: local })).rejects.toBeInstanceOf(BrandAccessError);
    expect(server.requests).toEqual([]);
    expect(await facts(brand)).toEqual([]);
    expect((await memory(brand)).website_status).toBe("none");
    expect(await usageKinds(brand)).toEqual([]);
    // the same goes for "no website" and for an unknown brand
    await expect(readWebsiteFacts({ userId: otherUserId, brandId: brand, url: "" })).rejects.toBeInstanceOf(BrandAccessError);
    await expect(readWebsiteFacts({ userId, brandId: "00000000-0000-4000-8000-000000000000", url: "" })).rejects.toBeInstanceOf(BrandAccessError);
  });

  it("is blocked by the daily cap before anything is fetched", async () => {
    server = await serveSite("corner-bakery");
    const brand = await newBrand();
    await db.withAdmin((tx) => tx.query("update public.brands set daily_generation_cap = 1 where id = $1", [brand]));
    await readWebsiteFacts({ userId, brandId: brand, url: server.origin + "/", options: local }); // uses the one allowed call
    const before = server.requests.length;
    await expect(readWebsiteFacts({ userId, brandId: brand, url: server.origin + "/", options: local })).rejects.toBeInstanceOf(DailyCapError);
    expect(server.requests.length).toBe(before);
    expect((await facts(brand, "active")).length).toBe(22);
  });
});

describe("AC 3 on the test sites (fixture AI, offline)", () => {
  it("every expected corner-bakery fact is saved with a verified quote on its own page", async () => {
    server = await serveSite("corner-bakery");
    const brand = await newBrand();
    const res = await readWebsiteFacts({ userId, brandId: brand, url: server.origin + "/", options: local });
    const expected: Array<{ kind: string; label: string; value: string; page: string }> = (await import("../../test-data/v2/websites/corner-bakery/expected-facts.json")).default;
    const saved = await facts(brand);
    const found = expected.filter((e) => saved.some((s) => s.kind === e.kind && s.value === e.value && s.source_ref === `${server!.origin}/${e.page === "index.html" ? "" : e.page}`));
    expect(found.length / expected.length).toBeGreaterThanOrEqual(0.8);
    expect(found.length).toBe(expected.length);
    expect(res.status).toBe("ok");
    // the robots trap must not leak
    expect(saved.some((s) => /12\.50/.test(s.value) || /careers/.test(s.source_ref ?? ""))).toBe(false);
  });

  it("harbour-dental is read in full and its fixture facts are dropped, not invented", async () => {
    server = await serveSite("harbour-dental");
    const brand = await newBrand("Harbour Dental");
    const res = await readWebsiteFacts({ userId, brandId: brand, url: server.origin + "/", options: local });
    expect(res.status).toBe("ok");
    expect(res.pagesRead.length).toBe(4);
    // the built-in fixture is the bakery's; none of its facts is on the dental pages (apart from none), so they are dropped
    expect(res.factsSaved + res.factsDropped).toBe(22);
    expect(res.factsDropped).toBeGreaterThan(15);
  });
});

describe("loadWebsitePages: URL handling", () => {
  const resolver = async () => [{ address: "93.184.216.34", family: 4 }];
  const page = (body: string) => ({
    status: 200,
    headers: { "content-type": "text/html" },
    readBody: async () => ({ body: Buffer.from(body), truncated: false }),
    destroy() {},
  });

  it("normalizeWebsiteInput adds https:// to a bare domain and keeps the path", async () => {
    const { normalizeWebsiteInput } = await import("@/lib/website/load");
    expect(normalizeWebsiteInput("cornerbakery.example")?.href).toBe("https://cornerbakery.example/");
    expect(normalizeWebsiteInput("  www.x.example/shop?id=2#top ")?.href).toBe("https://www.x.example/shop?id=2");
    expect(normalizeWebsiteInput("http://x.example")?.protocol).toBe("http:");
    expect(normalizeWebsiteInput("localhost:3000/x")?.href).toBe("https://localhost:3000/x");
    expect(normalizeWebsiteInput("")).toBeNull();
    expect(normalizeWebsiteInput("two words")).toBeNull();
  });

  it("prefers https: an http:// URL is tried as https first, and http only if that fails", async () => {
    const { loadWebsitePages } = await import("@/lib/website/load");
    const seen: string[] = [];
    const transport = async (req: { url: URL }) => {
      seen.push(req.url.href);
      if (req.url.pathname === "/robots.txt") return { status: 404, headers: {}, readBody: async () => ({ body: Buffer.alloc(0), truncated: false }), destroy() {} };
      if (req.url.protocol === "https:") throw new Error("ECONNREFUSED");
      return page("<p>Plain http home page with some words in it.</p>");
    };
    const res = await loadWebsitePages("http://old-site.example/", { resolver, transport });
    expect(res.status).toBe("ok");
    expect(seen[0]).toBe("https://old-site.example/robots.txt");
    expect(seen.some((u) => u === "http://old-site.example/")).toBe(true);
    expect(res.pages[0].url).toBe("http://old-site.example/");

    const seen2: string[] = [];
    const ok = async (req: { url: URL }) => {
      seen2.push(req.url.href);
      if (req.url.pathname === "/robots.txt") return { status: 404, headers: {}, readBody: async () => ({ body: Buffer.alloc(0), truncated: false }), destroy() {} };
      return page("<p>Secure home page with some words in it.</p>");
    };
    const secure = await loadWebsitePages("http://new-site.example/", { resolver, transport: ok });
    expect(secure.pages[0].url).toBe("https://new-site.example/");
    expect(seen2.every((u) => u.startsWith("https://"))).toBe(true);
  });
});
