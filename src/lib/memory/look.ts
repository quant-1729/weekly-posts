/**
 * Logo and colours on the brand page (Req 5). The logo upload, replace and remove are the v1
 * code (src/lib/brand/profile.ts, /api/brand/logo). New here: colours saved on their own,
 * and the logo and theme colour of the owner's website.
 *
 * Website logo candidates are not stored. The page asks load.ts for them again, and keeps the
 * answer in memory for a while so a reload does not read the site again. The image itself is
 * downloaded only through safeFetch (the URL is untrusted), image types only, 2 MB at most,
 * and goes through the same normaliser as an upload.
 */
import type { Palette } from "@/lib/brand/colors";
import { requireBrandMember, BrandAccessError } from "@/lib/brand/current";
import { LOGO_MAX_BYTES, LogoError, paletteFromImage } from "@/lib/brand/logo";
import { setBrandLogo } from "@/lib/brand/profile";
import { paletteFromPrimary } from "@/lib/brand/colors";
import { getDb } from "@/lib/db";
import { getStorage, type Storage } from "@/lib/storage";
import type { LogoCandidate } from "@/lib/website/clean";
import { FetchError, safeFetch, type FetchEnv } from "@/lib/website/fetch";
import { loadWebsitePages } from "@/lib/website/load";
import { colorsSchema, normalizeThemeColor, type ColorsInput } from "./schema";

export class ColorsValidationError extends Error {
  constructor() {
    super("Colours are invalid");
    this.name = "ColorsValidationError";
  }
}

export class WebsiteLogoError extends Error {
  constructor(public readonly code: "no_candidate" | "failed" | "has_logo") {
    super(code);
    this.name = "WebsiteLogoError";
  }
}

// ---------------------------------------------------------------------------
// What the website offered (kept in memory for a while; no new column)
// ---------------------------------------------------------------------------

export interface WebsiteAssets {
  /** Best first. Absolute http(s) URLs. */
  logoCandidates: LogoCandidate[];
  themeColor: string | null;
}

interface Cached {
  url: string;
  at: number;
  assets: WebsiteAssets;
  ttl: number;
}

const FRESH_MS = 30 * 60_000;
const EMPTY_MS = 5 * 60_000; // when the site could not be read, do not hammer it
// On globalThis so the page and the server actions (separate module copies in Next dev) share it.
const g = globalThis as unknown as { __weeklyWebsiteAssets?: Map<string, Cached> };
const cache = (g.__weeklyWebsiteAssets ??= new Map<string, Cached>());

/** Called after a re-read, which already has the candidates in hand. */
export function rememberWebsiteAssets(brandId: string, url: string, assets: WebsiteAssets): void {
  cache.set(brandId, { url, at: Date.now(), assets, ttl: FRESH_MS });
}

export function forgetWebsiteAssets(brandId: string): void {
  cache.delete(brandId);
}

interface MemoryState {
  website_url: string | null;
  website_status: string;
  logo_path: string | null;
}

async function readState(userId: string, brandId: string): Promise<MemoryState> {
  await requireBrandMember(userId, brandId);
  const [row] = await getDb().withUser(userId, (tx) =>
    tx.query<MemoryState>("select website_url, website_status::text as website_status, logo_path from public.brand_memory where brand_id = $1", [brandId]),
  );
  if (!row) throw new BrandAccessError();
  return row;
}

/**
 * The logo candidates and theme colour of the owner's website, or null when the website was not
 * read (status none, blocked or failed). Loaded again with load.ts when not in memory.
 */
export async function getWebsiteAssets(args: { userId: string; brandId: string; fetch?: FetchEnv; now?: number }): Promise<WebsiteAssets | null> {
  const state = await readState(args.userId, args.brandId);
  if (!state.website_url || (state.website_status !== "ok" && state.website_status !== "partial")) return null;
  const now = args.now ?? Date.now();
  const hit = cache.get(args.brandId);
  if (hit && hit.url === state.website_url && now - hit.at < hit.ttl) return hit.assets;

  let assets: WebsiteAssets = { logoCandidates: [], themeColor: null };
  let ttl = FRESH_MS;
  try {
    const loaded = await loadWebsitePages(state.website_url, args.fetch, { reader: null }); // logos are in the HTML head: no need to send the page to the reading service
    if (loaded.status === "ok" || loaded.status === "partial") {
      assets = { logoCandidates: loaded.logoCandidates, themeColor: loaded.themeColor };
    } else ttl = EMPTY_MS;
  } catch (e) {
    console.warn("[brand] could not look for the website logo", e instanceof Error ? e.message : e);
    ttl = EMPTY_MS;
  }
  cache.set(args.brandId, { url: state.website_url, at: now, assets, ttl });
  return assets;
}

const MAX_TRIES = 4;

/**
 * Downloads the best working logo candidate of the website and saves it as the brand's logo.
 * Takes no URL from the caller: the candidates come from the website the owner gave. A
 * candidate that is private, not an image, over 2 MB or unreadable is skipped.
 * Throws WebsiteLogoError (no_candidate, failed, has_logo) or BrandAccessError.
 */
export async function adoptWebsiteLogo(args: {
  userId: string;
  brandId: string;
  fetch?: FetchEnv;
  storage?: Storage;
}): Promise<{ logoPath: string; palette: Palette | null; source: string }> {
  const { userId, brandId } = args;
  const state = await readState(userId, brandId);
  if (state.logo_path) throw new WebsiteLogoError("has_logo");
  const assets = await getWebsiteAssets({ userId, brandId, fetch: args.fetch });
  const candidates = (assets?.logoCandidates ?? []).slice(0, MAX_TRIES);
  if (candidates.length === 0) throw new WebsiteLogoError("no_candidate");

  for (const c of candidates) {
    let bytes: Buffer;
    let contentType: string;
    try {
      const res = await safeFetch(c.url, { ...args.fetch, accept: "image", maxBytes: LOGO_MAX_BYTES });
      if (res.status < 200 || res.status >= 300 || !res.body || res.truncated) continue;
      bytes = res.body;
      contentType = res.contentType.split(";")[0].trim();
    } catch (e) {
      if (e instanceof FetchError) continue; // refused address, wrong type, timeout ...
      throw e;
    }
    try {
      const logo = await setBrandLogo({ userId, brandId, bytes, declaredType: contentType, storage: args.storage });
      return { logoPath: logo.logoPath, palette: logo.palette, source: c.url };
    } catch (e) {
      if (e instanceof LogoError) continue; // not a usable image
      throw e;
    }
  }
  throw new WebsiteLogoError("failed");
}

// ---------------------------------------------------------------------------
// Colours
// ---------------------------------------------------------------------------

export interface LookView {
  logoPath: string | null;
  colors: Partial<Palette>;
  /** A palette taken from the saved logo, to offer in the colour picker. */
  logoPalette: Palette | null;
  /** A palette built from the website's theme-color, to offer in the colour picker. */
  themePalette: Palette | null;
  /** True when the website was read, there is no logo yet, and the website had candidates. */
  websiteLogoOffer: boolean;
}

export async function getLookBase(userId: string, brandId: string, storage: Storage = getStorage()): Promise<Pick<LookView, "logoPath" | "colors" | "logoPalette">> {
  await requireBrandMember(userId, brandId);
  const [row] = await getDb().withUser(userId, (tx) =>
    tx.query<{ logo_path: string | null; colors: Partial<Palette> | null }>("select logo_path, colors from public.brand_memory where brand_id = $1", [brandId]),
  );
  if (!row) throw new BrandAccessError();
  let logoPalette: Palette | null = null;
  if (row.logo_path) {
    try {
      const file = await storage.get("brand-assets", `${brandId}/logo.png`);
      if (file) logoPalette = await paletteFromImage(Buffer.from(file.bytes));
    } catch {
      logoPalette = null;
    }
  }
  return { logoPath: row.logo_path, colors: row.colors ?? {}, logoPalette };
}

/** The palette the website's theme-color suggests, or null. */
export function themePalette(themeColor: string | null): Palette | null {
  const hex = normalizeThemeColor(themeColor);
  return hex ? paletteFromPrimary(hex) : null;
}

/** Saves the three brand colours (validated as hex); a background colour chosen in the brand kit is kept. Throws ColorsValidationError or BrandAccessError. */
export async function saveColors(userId: string, brandId: string, raw: ColorsInput | unknown): Promise<Palette> {
  await requireBrandMember(userId, brandId);
  const parsed = colorsSchema.safeParse(raw);
  if (!parsed.success) throw new ColorsValidationError();
  const rows = await getDb().withUser(userId, (tx) =>
    tx.query("update public.brand_memory set colors = coalesce(colors, '{}'::jsonb) || $2::jsonb where brand_id = $1 returning brand_id", [brandId, JSON.stringify(parsed.data)]),
  );
  if (rows.length === 0) throw new BrandAccessError();
  return parsed.data;
}
