import { afterEach, describe, expect, it } from "vitest";
import type { PageLink } from "@/lib/website/clean";
import { loadWebsitePages } from "@/lib/website/load";
import { MAX_PAGES, selectPages } from "@/lib/website/pages";
import { ALLOW_ALL, parseRobots } from "@/lib/website/robots";
import { LOCAL_ENV, pathsOf, serve, serveSite, type TestServer } from "./site-server";

const HOME = new URL("https://shop.example/");
const link = (href: string, text = ""): PageLink => ({ href: new URL(href, HOME).href, text });
const pick = (links: PageLink[], robots = ALLOW_ALL()) => selectPages(HOME, links, robots);
const paths = (links: PageLink[], robots = ALLOW_ALL()) => pick(links, robots).pages.map((p) => new URL(p.url).pathname);

describe("selectPages (unit)", () => {
  it("always starts with the home page", () => {
    expect(paths([])[0]).toBe("/");
  });

  it("picks about, menu or services, and contact from path or anchor text", () => {
    expect(paths([link("/p1", "Our Story"), link("/p2", "Treatments"), link("/p3", "Contact us"), link("/p4", "Gift cards")])).toEqual(["/", "/p1", "/p2", "/p3"]);
  });

  it.each([
    ["/a-propos", "About"],
    ["/kontakt", "Kontakt"],
    ["/contacto", "Contacto"],
    ["/servicios", "Servicios"],
    ["/nosotros", "Quienes somos"],
    ["/menu", "Menu"],
    ["/products", "Products"],
    ["/pricing", "Pricing"],
    ["/prices", "Prices"],
    ["/treatments", "Treatments"],
    ["/x", "A propos de nous"],
    ["/x", "Notre carte"],
  ])("recognises %s / %s", (href, text) => {
    expect(paths([link(href, text)])).toContain(new URL(link(href).href).pathname);
  });

  it("ignores other hosts, other pages, non-HTML files and anchors to the same page", () => {
    const links = [
      link("https://other.example/about", "About"),
      link("/blog/about-our-menu", "About our menu"),
      link("/news/contact-changes", "Contact"),
      link("/careers", "Careers"),
      link("/menu.pdf", "Menu"),
      link("/", "Home"),
      link("/gallery", "Gallery"),
    ];
    expect(paths(links)).toEqual(["/", "/about", "/menu", "/services", "/contact"]); // fallback paths: nothing matched
  });

  it("matches the host exactly, so another subdomain is not the same site", () => {
    expect(pick([link("https://blog.shop.example/about", "About")]).usedFallback).toBe(true);
  });

  it("de-duplicates links that point to the same page", () => {
    const sel = paths([link("/menu", "Menu"), link("/menu/", "Our menu"), link("/menu#top", "Menu again")]);
    expect(sel).toEqual(["/", "/menu"]);
  });

  it("never returns more than 5 pages including home", () => {
    const links = [link("/menu", "Menu"), link("/services", "Services"), link("/products", "Products"), link("/pricing", "Pricing"), link("/prices", "Prices"), link("/about", "About"), link("/contact", "Contact")];
    const sel = paths(links);
    expect(sel.length).toBe(MAX_PAGES);
    expect(sel[0]).toBe("/");
    // one of each kind comes first, so a menu-heavy site still gets its contact page
    expect(sel).toContain("/about");
    expect(sel).toContain("/contact");
  });

  it("orders pages: about, then menu or services, then contact", () => {
    expect(paths([link("/contact", "Contact"), link("/menu", "Menu"), link("/about", "About")])).toEqual(["/", "/about", "/menu", "/contact"]);
  });

  it("prefers a shallow path to a deep one", () => {
    expect(paths([link("/en/locations/city/about-the-team", "About"), link("/about", "About")]).slice(0, 2)).toEqual(["/", "/about"]);
  });

  it("skips pages robots.txt disallows and records them", () => {
    const robots = parseRobots("User-agent: *\nDisallow: /menu");
    const sel = pick([link("/about", "About"), link("/menu", "Menu"), link("/services", "Services"), link("/contact", "Contact")], robots);
    expect(sel.pages.map((p) => new URL(p.url).pathname)).toEqual(["/", "/about", "/services", "/contact"]);
    expect(sel.skipped).toEqual([{ url: "https://shop.example/menu", reason: "robots" }]);
  });

  it("uses the common paths only when the home page has no matching links, and only if robots allows", () => {
    const sel = pick([link("/gallery", "Gallery")], parseRobots("User-agent: *\nDisallow: /menu"));
    expect(sel.usedFallback).toBe(true);
    expect(sel.pages.map((p) => new URL(p.url).pathname)).toEqual(["/", "/about", "/services", "/contact"]);
    expect(sel.skipped).toEqual([{ url: "https://shop.example/menu", reason: "robots" }]);
    expect(pick([link("/about", "About")]).usedFallback).toBe(false);
  });

  it("keeps links on the scheme the home page was read with", () => {
    const sel = selectPages(HOME, [{ href: "http://shop.example/about", text: "About" }], ALLOW_ALL());
    expect(sel.pages[1].url).toBe("https://shop.example/about");
  });
});

describe("page choice on the test sites", () => {
  let server: TestServer | null = null;
  afterEach(async () => {
    await server?.close();
    server = null;
  });

  it("corner-bakery: home, about, menu and contact; not blog or careers", async () => {
    server = await serveSite("corner-bakery");
    const res = await loadWebsitePages(server.origin + "/", LOCAL_ENV);
    const read = res.pages.map((p) => new URL(p.url).pathname);
    expect(read[0]).toBe("/");
    expect(read.slice(1)).toEqual(["/about.html", "/menu.html", "/contact.html"]);
    expect(read).not.toContain("/blog.html");
    expect(read).not.toContain("/careers.html");
    expect(pathsOf(server)).not.toContain("/blog.html");
    expect(pathsOf(server)).not.toContain("/careers.html");
    expect(res.status).toBe("ok");
    expect(res.pages.length).toBeLessThanOrEqual(5);
  });

  it("harbour-dental: home, services, about and contact", async () => {
    server = await serveSite("harbour-dental");
    const res = await loadWebsitePages(server.origin + "/", LOCAL_ENV);
    const read = res.pages.map((p) => new URL(p.url).pathname);
    expect(read[0]).toBe("/");
    expect([...read.slice(1)].sort()).toEqual(["/about.html", "/contact.html", "/services.html"]);
    expect(res.status).toBe("ok");
  });

  it("reads each page once, home included, when the owner types index.html", async () => {
    server = await serveSite("corner-bakery");
    const res = await loadWebsitePages(server.origin + "/index.html", LOCAL_ENV);
    expect(res.pages.length).toBe(4);
    expect(pathsOf(server).filter((p) => p === "/index.html").length).toBe(1);
  });

  it("falls back to /about, /menu, /services, /contact when the home page has no matching links", async () => {
    server = await serve((req, res) => {
      const p = new URL(req.url ?? "/", "http://x").pathname;
      if (p === "/robots.txt") return void res.writeHead(404).end();
      if (p === "/about" || p === "/contact") {
        return void res.writeHead(200, { "content-type": "text/html" }).end(`<p>The ${p.slice(1)} page has plenty of words in it.</p>`);
      }
      if (p === "/") return void res.writeHead(200, { "content-type": "text/html" }).end('<p>Welcome to our little shop, come on in.</p><a href="/gallery">Photos</a>');
      res.writeHead(404, { "content-type": "text/html" }).end("<h1>Not found</h1>");
    });
    const res = await loadWebsitePages(server.origin + "/", LOCAL_ENV);
    expect(pathsOf(server)).toEqual(expect.arrayContaining(["/about", "/menu", "/services", "/contact"]));
    expect(res.pages.map((p) => new URL(p.url).pathname).sort()).toEqual(["/", "/about", "/contact"]);
    // 404 on a guessed path is not a failure
    expect(res.status).toBe("ok");
    expect(res.skipped.filter((s) => s.reason === "http_404").length).toBe(2);
  });

  it("is partial when a linked page fails, with the reason recorded", async () => {
    server = await serveSite("corner-bakery", { "/menu.html": (_q, res) => void res.writeHead(500, { "content-type": "text/html" }).end("oops") });
    const res = await loadWebsitePages(server.origin + "/", LOCAL_ENV);
    expect(res.status).toBe("partial");
    expect(res.skipped).toContainEqual({ url: server.origin + "/menu.html", reason: "http_500" });
    expect(res.pages.map((p) => new URL(p.url).pathname)).toEqual(["/", "/about.html", "/contact.html"]);
  });
});
