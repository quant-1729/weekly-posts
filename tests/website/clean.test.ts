import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MAX_PAGE_CHARS, cleanHtml } from "@/lib/website/clean";
import { normalizeForMatch } from "@/lib/website/extract";
import { decodeEntities, tokenize } from "@/lib/website/html";
import { SITES_DIR } from "./site-server";

const URL0 = "https://shop.example/about/";
const clean = (html: string) => cleanHtml(html, URL0);

describe("html tokenizer", () => {
  it("handles quoted, unquoted and valueless attributes and a > inside a quoted value", () => {
    const toks = tokenize(`<a href="x?a=1&amp;b=2" title='he said "hi"' data-x=y hidden>t</a>`);
    expect(toks[0]).toMatchObject({ t: "open", name: "a", attrs: { href: "x?a=1&b=2", title: 'he said "hi"', "data-x": "y", hidden: "" } });
    const odd = tokenize(`<div title="a > b">z</div>`);
    expect(odd[0]).toMatchObject({ attrs: { title: "a > b" } });
    expect(odd[1]).toEqual({ t: "text", v: "z" });
  });

  it("skips comments, doctype and processing instructions", () => {
    expect(tokenize("<!DOCTYPE html><!-- <b>x</b> --><?php echo 1 ?>hi")).toEqual([{ t: "text", v: "hi" }]);
  });

  it("treats a lone < as text and survives unterminated input", () => {
    expect(tokenize("a < b").map((t) => (t.t === "text" ? t.v : "")).join("")).toBe("a < b");
    expect(() => tokenize("<div class='x")).not.toThrow();
    expect(() => tokenize("<!-- never closed")).not.toThrow();
    expect(() => tokenize("<script>var a = 1;")).not.toThrow();
  });

  it("keeps script bodies out of the markup, even when they contain tags", () => {
    const toks = tokenize(`<script>document.write("<p>no</p>")</script><p>yes</p>`);
    expect(toks.filter((t) => t.t === "open").map((t) => (t as { name: string }).name)).toEqual(["script", "p"]);
  });
});

describe("entities", () => {
  it("decodes named, decimal and hex entities", () => {
    expect(decodeEntities("Caf&eacute; &amp; Bar &pound;4.50 &euro;5 &#163;3 &#x20B9;9 &nbsp;&mdash;&hellip;")).toBe("Café & Bar £4.50 €5 £3 ₹9  —…");
  });
  it("leaves unknown entities and bare ampersands alone", () => {
    expect(decodeEntities("AT&T &unknown; R&D &")).toBe("AT&T &unknown; R&D &");
  });
  it("decodes legacy entities without a semicolon only", () => {
    expect(decodeEntities("&copy 2026 &eacute")).toBe("© 2026 &eacute");
  });
  it("replaces invalid numeric references", () => {
    expect(decodeEntities("&#0; &#xD800; &#1114112;")).toBe("� � �");
  });
});

describe("cleanHtml: what is dropped", () => {
  it("drops script, style, noscript and svg", () => {
    const { text } = clean(`<body><style>.a{color:red}</style><script>var secret = "x";</script><noscript>Enable JS</noscript><svg><title>icon</title><text>vector</text></svg><p>Visible</p></body>`);
    expect(text).toBe("Visible");
  });

  it("drops hidden elements: hidden attribute, aria-hidden, display:none, visibility:hidden", () => {
    const { text } = clean(`<body>
      <p hidden>a</p><div aria-hidden="true">b</div><div style="color:red; display : none">c</div>
      <span style="visibility:hidden">d</span><div hidden><p>nested e</p></div><p>shown</p></body>`);
    expect(text).toBe("shown");
  });

  it("drops frames, canvas, templates and select lists", () => {
    const { text } = clean(`<body><iframe>frame</iframe><canvas>c</canvas><template><p>t</p></template><select><option>Opt</option></select><p>ok</p></body>`);
    expect(text).toBe("ok");
  });

  it("drops an obvious cookie banner but keeps the rest", () => {
    const { text } = clean(`<body><div id="cookie-banner"><p>We use cookies. <button>Accept</button></p></div>
      <div class="cc-window cookie-consent"><p>Consent</p></div><main><p>Open daily</p></main></body>`);
    expect(text).toBe("Open daily");
  });

  it("does not drop a large block just because its class mentions consent or cookies", () => {
    const long = "Real content. ".repeat(200);
    const { text } = clean(`<body class="cookie-consent-on"><div class="consent-wrapper"><p>${long}</p></div><p>tail</p></body>`);
    expect(text).toContain("Real content.");
    expect(text).toContain("tail");
  });

  it("does not drop text that merely mentions cookies", () => {
    expect(clean(`<body><p>Our chocolate cookies are £2</p><div class="cookies-menu">Cookies £2</div></body>`).text).toContain("Our chocolate cookies are £2");
  });

  it("ignores the title and head text but not body text", () => {
    const { text, title } = clean(`<html><head><title>My Shop</title><meta charset=utf-8></head><body><p>Body</p></body></html>`);
    expect(title).toBe("My Shop");
    expect(text).toBe("Body");
  });

  it("recovers when a hidden element is never closed properly", () => {
    const { text } = clean(`<body><ul><li hidden>one<li>two<li>three</ul><p>after</p></body>`);
    expect(text).toContain("two");
    expect(text).toContain("three");
    expect(text).toContain("after");
    expect(text).not.toContain("one");
  });
});

describe("cleanHtml: what is kept", () => {
  it("keeps the footer, where hours and addresses live", () => {
    const { text } = clean(`<body><main><p>Hello</p></main><footer><p>Mon-Fri 9-5</p><address>1 High St, Leeds</address></footer></body>`);
    expect(text).toContain("Mon-Fri 9-5");
    expect(text).toContain("1 High St, Leeds");
  });

  it("keeps line breaks at block elements and br, and collapses other whitespace", () => {
    const { text } = clean(`<body><h1>Title</h1><p>One   two\n\n  three</p><ul><li>A</li><li>B</li></ul>line1<br>line2<div>x</div><div>y</div></body>`);
    expect(text).toBe("Title\nOne two three\nA\nB\nline1\nline2\nx\ny");
  });

  it("separates table cells with | and rows with a new line", () => {
    const { text } = clean(`<table><tr><th>Day</th><th>Hours</th></tr><tr><td>Mon</td><td>8am to 5pm</td></tr><tr><td>Sat<td>Closed</table>`);
    expect(text).toBe("Day | Hours\nMon | 8am to 5pm\nSat | Closed");
  });

  it("decodes entities and converts non-breaking spaces", () => {
    expect(clean(`<p>Sourdough&nbsp;loaf &pound;4.50 &amp; more</p>`).text).toBe("Sourdough loaf £4.50 & more");
  });

  it("does not repeat identical consecutive lines", () => {
    expect(clean(`<p>Same</p><p>Same</p><p>Other</p>`).text).toBe("Same\nOther");
  });

  it("caps long pages at 8000 characters and keeps the end (the footer)", () => {
    const body = Array.from({ length: 600 }, (_, i) => `<p>Line number ${i} of the page body</p>`).join("");
    const out = clean(`<body>${body}<footer>FOOTER 27 Lansdowne Parade</footer></body>`);
    expect(out.text.length).toBeLessThanOrEqual(MAX_PAGE_CHARS);
    expect(out.truncated).toBe(true);
    expect(out.text).toContain("FOOTER 27 Lansdowne Parade");
    expect(out.text.startsWith("Line number 0 ")).toBe(true);
    expect(clean("<p>short</p>").truncated).toBe(false);
  });

  it("handles an empty or text-only document", () => {
    expect(clean("").text).toBe("");
    expect(clean("just words").text).toBe("just words");
  });
});

describe("cleanHtml: metadata", () => {
  const head = `<head>
    <title>  Corner &amp; Co  |  Bakery </title>
    <meta name="description" content="Fresh bread &amp; cakes in London">
    <meta name="theme-color" content="#7a4a22">
    <meta property="og:image" content="/img/share.jpg">
    <link rel="icon" href="/favicon.ico">
    <link rel="apple-touch-icon" sizes="180x180" href="/apple.png">
  </head>`;

  it("returns the title, meta description and theme colour", () => {
    const m = clean(`<html>${head}<body>x</body></html>`);
    expect(m.title).toBe("Corner & Co | Bakery");
    expect(m.metaDescription).toBe("Fresh bread & cakes in London");
    expect(m.themeColor).toBe("#7a4a22");
  });

  it("returns logo candidates as absolute URLs, best first", () => {
    const m = clean(`<html>${head}<body><header><a href="/"><img src="images/site-logo.svg" alt="Corner logo"></a></header><img src="/hero.jpg" alt="bread"></body></html>`);
    expect(m.logoCandidates).toEqual([
      { url: "https://shop.example/about/images/site-logo.svg", source: "img" },
      { url: "https://shop.example/apple.png", source: "apple_touch_icon" },
      { url: "https://shop.example/favicon.ico", source: "icon" },
      { url: "https://shop.example/img/share.jpg", source: "og_image" },
    ]);
  });

  it("finds a logo by alt, class or id, but not by the word catalogue", () => {
    expect(clean(`<img src="/a.png" alt="Acme logo">`).logoCandidates[0].url).toBe("https://shop.example/a.png");
    expect(clean(`<img src="/b.png" class="navbar-logo">`).logoCandidates[0].url).toBe("https://shop.example/b.png");
    expect(clean(`<img src="/c.png" id="logo">`).logoCandidates[0].url).toBe("https://shop.example/c.png");
    expect(clean(`<img src="/catalogue.png" alt="catalogue">`).logoCandidates).toEqual([]);
  });

  it("ignores data: and javascript: URLs and de-duplicates", () => {
    const m = clean(`<img src="data:image/png;base64,AAAA" class="logo"><img src="/l.png" class="logo"><img src="/l.png" alt="logo">`);
    expect(m.logoCandidates).toEqual([{ url: "https://shop.example/l.png", source: "img" }]);
  });

  it("resolves URLs against <base href>", () => {
    const m = clean(`<head><base href="https://cdn.example/assets/"></head><img src="logo.png" class="logo">`);
    expect(m.logoCandidates[0].url).toBe("https://cdn.example/assets/logo.png");
  });

  it("falls back to og:description and returns null when there is no theme colour", () => {
    const m = clean(`<meta property="og:description" content="OG text">`);
    expect(m.metaDescription).toBe("OG text");
    expect(m.themeColor).toBeNull();
  });

  it("returns links with absolute URLs and anchor text, including links in hidden menus", () => {
    const m = clean(`<nav style="display:none"><a href="/menu#top">Our <b>Menu</b></a></nav><a href="mailto:x@y.z">mail</a><a href="https://other.example/x" aria-label="Elsewhere"><img src="i.png"></a><a>no href</a>`);
    expect(m.links).toEqual([
      { href: "https://shop.example/menu", text: "Our Menu" },
      { href: "https://other.example/x", text: "Elsewhere" },
    ]);
  });
});

describe("cleaning loses nothing important on the test sites (AC 3)", () => {
  const sites = [
    ["corner-bakery", 22],
    ["harbour-dental", 23],
  ] as const;

  it.each(sites)("%s: at least 95%% of the expected fact values are in the cleaned text of their page", (site, count) => {
    const dir = path.join(SITES_DIR, site);
    const expected: Array<{ kind: string; label: string; value: string; page: string }> = JSON.parse(readFileSync(path.join(dir, "expected-facts.json"), "utf8"));
    expect(expected.length).toBe(count);
    const texts = new Map<string, string>();
    const missing: string[] = [];
    for (const e of expected) {
      if (!texts.has(e.page)) texts.set(e.page, normalizeForMatch(cleanHtml(readFileSync(path.join(dir, e.page), "utf8"), `https://${site}.example/${e.page}`).text));
      if (!texts.get(e.page)!.includes(normalizeForMatch(e.value))) missing.push(`${e.page}: ${e.value}`);
    }
    const coverage = (expected.length - missing.length) / expected.length;
    expect(missing).toEqual([]);
    expect(coverage).toBeGreaterThanOrEqual(0.95);
  });

  it("the robots-disallowed careers page keeps its trap value out of every other page", () => {
    const dir = path.join(SITES_DIR, "corner-bakery");
    for (const f of ["index.html", "about.html", "menu.html", "contact.html"]) {
      expect(cleanHtml(readFileSync(path.join(dir, f), "utf8"), "https://x.example/").text).not.toContain("12.50");
    }
  });

  it("every test page cleans to under the cap with its title and no markup left", () => {
    for (const site of ["corner-bakery", "harbour-dental", "blue-wave-yoga"]) {
      for (const f of ["index.html", "contact.html", "about.html", "menu.html", "services.html", "pricing.html", "timetable.html"]) {
        let html: string;
        try {
          html = readFileSync(path.join(SITES_DIR, site, f), "utf8");
        } catch {
          continue;
        }
        const out = cleanHtml(html, "https://x.example/");
        expect(out.title.length).toBeGreaterThan(0);
        expect(out.text.length).toBeLessThanOrEqual(MAX_PAGE_CHARS);
        expect(out.text).not.toMatch(/<\/?[a-z][^>]*>|&[a-z]+;|font-family|\{\s*margin/i);
      }
    }
  });
});
