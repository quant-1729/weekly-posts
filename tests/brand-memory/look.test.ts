import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { BrandAccessError } from "@/lib/brand/current";
import { setBrandLogo } from "@/lib/brand/profile";
import type { MockDb } from "@/lib/db/mock";
import {
  adoptWebsiteLogo,
  ColorsValidationError,
  forgetWebsiteAssets,
  getLookBase,
  getWebsiteAssets,
  rememberWebsiteAssets,
  saveColors,
  themePalette,
  WebsiteLogoError,
} from "@/lib/memory/look";
import { normalizeThemeColor } from "@/lib/memory/schema";
import { rereadWebsite } from "@/lib/memory/website";
import { createMockStorage } from "@/lib/storage/mock";
import type { Storage } from "@/lib/storage/types";
import { FetchError, safeFetch } from "@/lib/website/fetch";
import { closeTestDb, createBrandFor, createUser, openTestDb } from "../brand/helpers";
import { LOCAL_ENV, pathsOf, serve, type TestServer } from "../website/site-server";

let db: MockDb;
let root: string;
let storage: Storage;
let owner: string;
let outsider: string;
let brand: string;
let server: TestServer | null = null;
let png: Buffer;

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "pm-look-"));
  storage = createMockStorage(root);
  db = await openTestDb();
  owner = (await createUser(db)).id;
  outsider = (await createUser(db)).id;
  png = await sharp({ create: { width: 900, height: 600, channels: 3, background: "#1A6B54" } }).png().toBuffer();
});
afterAll(async () => {
  await closeTestDb(db);
  await rm(root, { recursive: true, force: true });
});
beforeEach(async () => {
  brand = await createBrandFor(db, owner, "Corner Bakery");
});
afterEach(async () => {
  await server?.close();
  server = null;
  forgetWebsiteAssets(brand);
});

const HOME = (extra = "") => `<!doctype html><html><head><title>Corner Bakery</title>
<meta name="theme-color" content="#1a6b54">${extra}</head>
<body><header><img class="logo" src="/logo.svg" alt="Corner Bakery logo"><img class="logo" src="/big.png" alt="logo big"><img class="logo" src="/notimg.png" alt="logo fake"><img class="site-logo" src="/logo.png" alt="logo"></header>
<main><h1>Corner Bakery</h1><p>Fresh sourdough baked on site every morning in Camberwell, London.</p></main></body></html>`;

/** A site whose logo candidates are, in order: an SVG, an image over 2 MB, an HTML page pretending to be an image, and a real PNG. */
function bakerySite(): Promise<TestServer> {
  return serve((req, res) => {
    const p = new URL(req.url ?? "/", "http://x").pathname;
    if (p === "/") return void res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(HOME());
    if (p === "/logo.svg") return void res.writeHead(200, { "content-type": "image/svg+xml" }).end("<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>");
    if (p === "/big.png") return void res.writeHead(200, { "content-type": "image/png" }).end(Buffer.alloc(2 * 1024 * 1024 + 1024, 1));
    if (p === "/notimg.png") return void res.writeHead(200, { "content-type": "text/html" }).end("<html>not an image</html>");
    if (p === "/logo.png") return void res.writeHead(200, { "content-type": "image/png" }).end(png);
    res.writeHead(404, { "content-type": "text/html" }).end("nope");
  });
}

const setWebsite = (url: string, status = "ok") =>
  db.withAdmin((tx) =>
    tx.query("update public.brand_memory set website_url = $2, website_status = $3::public.website_status, website_read_at = now() where brand_id = $1", [brand, url, status]),
  );
const memory = async () =>
  (await db.withAdmin((tx) => tx.query<{ logo_path: string | null; colors: Record<string, string> }>("select logo_path, colors from public.brand_memory where brand_id = $1", [brand])))[0];

describe("logo from the website", () => {
  it("finds candidates again with load.ts, keeps them for a while, and downloads the best one that works", async () => {
    server = await bakerySite();
    await setWebsite(`${server.origin}/`);

    const assets = await getWebsiteAssets({ userId: owner, brandId: brand, fetch: LOCAL_ENV });
    expect(assets!.logoCandidates.map((c) => new URL(c.url).pathname)).toEqual(["/logo.svg", "/big.png", "/notimg.png", "/logo.png"]);
    expect(assets!.themeColor).toBe("#1a6b54");
    const requestsAfterLoad = server.requests.length;
    await getWebsiteAssets({ userId: owner, brandId: brand, fetch: LOCAL_ENV }); // from memory: no new request
    expect(server.requests.length).toBe(requestsAfterLoad);

    const logo = await adoptWebsiteLogo({ userId: owner, brandId: brand, fetch: LOCAL_ENV, storage });
    expect(logo.logoPath).toBe(`brand-assets/${brand}/logo.png`);
    expect(new URL(logo.source).pathname).toBe("/logo.png");
    expect(logo.palette).not.toBeNull();
    expect((await memory()).logo_path).toBe(logo.logoPath);

    // normalised by the same code as an upload: PNG, at most 512 px
    const file = await storage.get("brand-assets", `${brand}/logo.png`);
    const meta = await sharp(Buffer.from(file!.bytes)).metadata();
    expect(meta.format).toBe("png");
    expect(Math.max(meta.width!, meta.height!)).toBe(512);

    // the bad candidates were refused on type or size, never saved
    const paths = pathsOf(server);
    expect(paths).toContain("/logo.svg");
    expect(paths).toContain("/logo.png");
  });

  it("does not replace a logo the owner already has", async () => {
    server = await bakerySite();
    await setWebsite(`${server.origin}/`);
    await setBrandLogo({ userId: owner, brandId: brand, bytes: png, declaredType: "image/png", storage });
    await expect(adoptWebsiteLogo({ userId: owner, brandId: brand, fetch: LOCAL_ENV, storage })).rejects.toMatchObject({ code: "has_logo" });
  });

  it("refuses a private-IP candidate: safeFetch never connects, and nothing is saved", async () => {
    server = await bakerySite(); // a real local server that would answer, if anything connected
    await setWebsite("https://cornerbakery.example/");
    rememberWebsiteAssets(brand, "https://cornerbakery.example/", {
      logoCandidates: [
        { url: `${server.origin}/logo.png`, source: "img" }, // 127.0.0.1
        { url: "http://localhost/logo.png", source: "img" },
        { url: "http://169.254.169.254/latest/meta-data/logo.png", source: "img" },
        { url: "http://10.0.0.5/logo.png", source: "img" },
      ],
      themeColor: null,
    });
    // default fetch settings, as in production: allowPrivate is off
    const err = await adoptWebsiteLogo({ userId: owner, brandId: brand, storage }).catch((e) => e);
    expect(err).toBeInstanceOf(WebsiteLogoError);
    expect(err.code).toBe("failed");
    expect(server.requests).toEqual([]); // nothing reached the local server
    expect((await memory()).logo_path).toBeNull();
    expect(await storage.get("brand-assets", `${brand}/logo.png`)).toBeNull();

    // the same refusal at the fetch level
    await expect(safeFetch("http://127.0.0.1/logo.png", { accept: "image" })).rejects.toMatchObject({ code: "blocked_address" });
    await expect(safeFetch(`${server.origin}/logo.png`, { accept: "image" })).rejects.toBeInstanceOf(FetchError);
  });

  it("refuses a public-looking name that resolves to a private address (DNS rebinding)", async () => {
    let connected = 0;
    await setWebsite("https://cornerbakery.example/");
    rememberWebsiteAssets(brand, "https://cornerbakery.example/", {
      logoCandidates: [{ url: "https://cdn.cornerbakery.example/logo.png", source: "img" }],
      themeColor: null,
    });
    await expect(
      adoptWebsiteLogo({
        userId: owner,
        brandId: brand,
        storage,
        fetch: {
          resolver: async () => [{ address: "10.1.2.3", family: 4 }],
          transport: async () => {
            connected++;
            throw new Error("must not connect");
          },
        },
      }),
    ).rejects.toMatchObject({ code: "failed" });
    expect(connected).toBe(0);
  });

  it("accepts only image types at the fetch level, and never SVG", async () => {
    server = await bakerySite();
    const ok = await safeFetch(`${server.origin}/logo.png`, { ...LOCAL_ENV, accept: "image" });
    expect(ok.body!.byteLength).toBe(png.byteLength);
    expect(ok.text).toBe("");
    const svg = await safeFetch(`${server.origin}/logo.svg`, { ...LOCAL_ENV, accept: "image" }).catch((e) => e);
    expect(svg).toBeInstanceOf(FetchError);
    expect(svg.code).toBe("wrong_content_type");
    const html = await safeFetch(`${server.origin}/notimg.png`, { ...LOCAL_ENV, accept: "image" }).catch((e) => e);
    expect(html.code).toBe("wrong_content_type");
    // over the 2 MB cap: the caller sees `truncated`
    const big = await safeFetch(`${server.origin}/big.png`, { ...LOCAL_ENV, accept: "image", maxBytes: 2 * 1024 * 1024 });
    expect(big.truncated).toBe(true);
  });

  it("a re-read remembers the candidates, so the offer shows without reading the site again", async () => {
    server = await bakerySite();
    const out = await rereadWebsite({
      userId: owner,
      brandId: brand,
      url: `${server.origin}/`,
      options: { fetch: LOCAL_ENV, fixture: () => ({ business_summary: "A bakery.", facts: [] }) },
    });
    expect(out).toMatchObject({ status: "ok", hasLogoCandidates: true });
    const before = server.requests.length;
    const assets = await getWebsiteAssets({ userId: owner, brandId: brand }); // no fetch env: would be refused if it read again
    expect(assets!.logoCandidates).toHaveLength(4);
    expect(server.requests.length).toBe(before);
  });

  it("offers nothing when the website was not read", async () => {
    await setWebsite("https://cornerbakery.example/", "blocked");
    expect(await getWebsiteAssets({ userId: owner, brandId: brand })).toBeNull();
    await expect(adoptWebsiteLogo({ userId: owner, brandId: brand, storage })).rejects.toMatchObject({ code: "no_candidate" });
  });

  it("is members only", async () => {
    await expect(getWebsiteAssets({ userId: outsider, brandId: brand })).rejects.toBeInstanceOf(BrandAccessError);
    await expect(adoptWebsiteLogo({ userId: outsider, brandId: brand, storage })).rejects.toBeInstanceOf(BrandAccessError);
    await expect(getLookBase(outsider, brand, storage)).rejects.toBeInstanceOf(BrandAccessError);
    await expect(saveColors(outsider, brand, { primary: "#112233", secondary: "#FFFFFF", accent: "#445566" })).rejects.toBeInstanceOf(BrandAccessError);
  });
});

describe("colours", () => {
  it("offers the website's theme-color as a palette", () => {
    expect(normalizeThemeColor("#1a6b54")).toBe("#1A6B54");
    expect(normalizeThemeColor("#fa0")).toBe("#FFAA00");
    expect(normalizeThemeColor("red")).toBeNull();
    expect(normalizeThemeColor("rgb(1,2,3)")).toBeNull();
    expect(normalizeThemeColor(null)).toBeNull();
    const p = themePalette("#1a6b54")!;
    expect(p.primary).toBe("#1A6B54");
    expect(p.secondary).toMatch(/^#[0-9A-F]{6}$/);
    expect(p.accent).toMatch(/^#[0-9A-F]{6}$/);
    expect(themePalette("transparent")).toBeNull();
  });

  it("saves colours, upper-cased, and rejects anything that is not a hex colour", async () => {
    const saved = await saveColors(owner, brand, { primary: "#1a6b54", secondary: "#e8f4ef", accent: "#f2a900" });
    expect(saved).toEqual({ primary: "#1A6B54", secondary: "#E8F4EF", accent: "#F2A900" });
    expect((await memory()).colors).toEqual(saved);
    await expect(saveColors(owner, brand, { primary: "red", secondary: "#e8f4ef", accent: "#f2a900" })).rejects.toBeInstanceOf(ColorsValidationError);
    await expect(saveColors(owner, brand, { primary: "#1a6b54" })).rejects.toBeInstanceOf(ColorsValidationError);
    expect((await memory()).colors).toEqual(saved);
  });

  it("suggests a palette from the saved logo", async () => {
    expect((await getLookBase(owner, brand, storage)).logoPalette).toBeNull();
    await setBrandLogo({ userId: owner, brandId: brand, bytes: png, declaredType: "image/png", storage });
    const look = await getLookBase(owner, brand, storage);
    expect(look.logoPath).toBe(`brand-assets/${brand}/logo.png`);
    expect(look.logoPalette!.primary).toMatch(/^#[0-9A-F]{6}$/);
  });
});
