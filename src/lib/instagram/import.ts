// Bringing in an owner's Instagram posts (owner decision 2026-10-14). The owner gives only an @handle (or we
// find it on their website); we read the account's recent public posts through Meta's Business Discovery.
//
//  - Captions become past posts (photos rows kind='past_post', source='instagram') and feed the voice
//    description, exactly like pasted posts (the same debounced voice refresh runs afterwards).
//  - Pictures are never added by themselves. listInstagramImages() lists the candidates and
//    addInstagramPhotos() stores the ones the owner picks, through the normal photo pipeline.
//
// Rules for what stays and what goes (kept simple on purpose):
//  - At most MAX_IMPORTED_POSTS (12) imported posts per brand: the newest posts whose caption is 10 to 3000
//    characters. When a refresh brings newer ones, the oldest imported posts roll off.
//  - Re-importing never duplicates (one row per brand + Instagram post id), and never overwrites text the
//    owner has edited.
//  - A post the owner deletes comes back only if they tap "Refresh" and it is still among the newest 12.
//    Nothing is re-imported behind their back: the automatic import runs once, when a handle is first saved.
//  - Changing the handle removes the imported posts of the old account (photos the owner picked stay).

import { after } from "next/server";
import { BrandAccessError, requireBrandMember } from "@/lib/brand/current";
import { getDb } from "@/lib/db";
import { getStorage, type Storage } from "@/lib/storage";
import { scheduleVoiceRefresh } from "@/lib/uploads/background";
import { UploadError, type UploadErrorCode } from "@/lib/uploads/errors";
import { PAST_POST_MAX_CHARS, PAST_POST_MIN_CHARS, PHOTO_MAX_BYTES } from "@/lib/uploads/limits";
import { addPhoto, type PhotoView } from "@/lib/uploads/photos";
import { assertUnderDailyCap } from "@/lib/usage";
import { safeFetch } from "@/lib/website/fetch";
import { instagramMode, type InstagramMode } from "./config";
import { discoverInstagram, isInstagramImageHost, type DiscoveryResult, type InstagramMedia } from "./discovery";
import { findInstagramHandles, normalizeInstagramHandle } from "./handle";
import { CACHE_MS, MAX_IMPORTED_POSTS, MAX_PICK_PHOTOS } from "./limits";

export type InstagramStatus = "found" | "imported" | "not_business" | "not_found" | "unavailable" | "failed";
export type HandleSource = "owner" | "website";

export interface InstagramState {
  /** True when the import is switched on (live or fixture mode). */
  available: boolean;
  handle: string | null;
  handleSource: HandleSource | null;
  status: InstagramStatus | null;
  checkedAt: string | null;
  /** Past posts that came from Instagram right now. */
  importedPosts: number;
}

export interface InstagramImageView {
  mediaId: string;
  /** Safe to put in an <img>: an Instagram picture address, or a data address in fixture mode. */
  previewUrl: string;
  /** The post's caption, shortened, for the picture's description. */
  caption: string | null;
  permalink: string | null;
  postedAt: string | null;
  /** Already in the owner's photos. */
  added: boolean;
}

export interface ImportOutcome {
  status: InstagramStatus;
  handle: string;
  /** Posts newly added by this run. */
  added: number;
  /** Instagram past posts the brand has now. */
  total: number;
  /** Pictures to choose from (empty unless the read worked). */
  images: InstagramImageView[];
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

interface MemoryRow {
  instagram_handle: string | null;
  instagram_handle_source: HandleSource | null;
  instagram_status: InstagramStatus | null;
  instagram_checked_at: string | Date | null;
}

const iso = (v: string | Date | null): string | null => (v === null ? null : v instanceof Date ? v.toISOString() : String(v));

/** What the brand page shows. Reads the database only; never calls Instagram. */
export async function getInstagramState(userId: string, brandId: string): Promise<InstagramState> {
  const { row, n } = await getDb().withUser(userId, async (tx) => {
    const [row] = await tx.query<MemoryRow>(
      "select instagram_handle, instagram_handle_source, instagram_status, instagram_checked_at from public.brand_memory where brand_id = $1",
      [brandId],
    );
    const [c] = await tx.query<{ n: number }>(
      "select count(*)::int as n from public.photos where brand_id = $1 and kind = 'past_post' and source = 'instagram'",
      [brandId],
    );
    return { row, n: c?.n ?? 0 };
  });
  return {
    available: instagramMode() !== "unavailable",
    handle: row?.instagram_handle ?? null,
    handleSource: row?.instagram_handle_source ?? null,
    status: row?.instagram_status ?? null,
    checkedAt: iso(row?.instagram_checked_at ?? null),
    importedPosts: n,
  };
}

async function setStatus(userId: string, brandId: string, status: InstagramStatus): Promise<void> {
  await getDb().withUser(userId, (tx) =>
    tx.query(
      "update public.brand_memory set instagram_status = $2, instagram_checked_at = now() where brand_id = $1",
      [brandId, status],
    ),
  );
}

async function deleteImportedPosts(userId: string, brandId: string): Promise<number> {
  const rows = await getDb().withUser(userId, (tx) =>
    tx.query(
      "delete from public.photos where brand_id = $1 and kind = 'past_post' and source = 'instagram' returning id",
      [brandId],
    ),
  );
  return rows.length;
}

/**
 * Saves the handle and where it came from. When it is a different account from before, the old account's
 * imported posts are removed and the status is cleared. Returns whether the handle changed.
 */
export async function saveInstagramHandle(args: {
  userId: string;
  brandId: string;
  handle: string;
  source: HandleSource;
}): Promise<{ changed: boolean; removedPosts: number }> {
  const { userId, brandId, source } = args;
  const handle = normalizeInstagramHandle(args.handle);
  if (!handle) throw new UploadError("empty");
  await requireBrandMember(userId, brandId);
  const [prev] = await getDb().withUser(userId, (tx) =>
    tx.query<{ instagram_handle: string | null }>("select instagram_handle from public.brand_memory where brand_id = $1", [brandId]),
  );
  const changed = (prev?.instagram_handle ?? null) !== handle;
  let removedPosts = 0;
  if (changed && prev?.instagram_handle) removedPosts = await deleteImportedPosts(userId, brandId);
  await getDb().withUser(userId, (tx) =>
    tx.query(
      changed
        ? `update public.brand_memory set instagram_handle = $2, instagram_handle_source = $3,
                  instagram_status = null, instagram_checked_at = null where brand_id = $1`
        : "update public.brand_memory set instagram_handle = $2, instagram_handle_source = $3 where brand_id = $1",
      [brandId, handle, source],
    ),
  );
  if (removedPosts > 0) scheduleVoiceRefresh(userId, brandId);
  return { changed, removedPosts };
}

// ---------------------------------------------------------------------------
// A short memory of the last answer, so choosing pictures never calls Instagram again (Meta allows about
// 200 calls an hour per token). Kept on globalThis like the other per-process state; a miss just means
// one more call, made only when the owner clicks.
// ---------------------------------------------------------------------------

interface CacheEntry {
  handle: string;
  at: number;
  media: InstagramMedia[];
}
const g = globalThis as unknown as { __instagramCache?: Map<string, CacheEntry> };
const cache: Map<string, CacheEntry> = (g.__instagramCache ??= new Map());

/** Test helper. */
export function clearInstagramCache(): void {
  cache.clear();
}

function remember(brandId: string, handle: string, media: InstagramMedia[]): void {
  cache.set(brandId, { handle, at: Date.now(), media });
}

function recall(brandId: string, handle: string): InstagramMedia[] | null {
  const hit = cache.get(brandId);
  if (!hit || hit.handle !== handle || Date.now() - hit.at > CACHE_MS) return null;
  return hit.media;
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

const STATUS_FOR_FAILURE = {
  not_business: "not_business",
  not_found: "not_found",
  unavailable: "unavailable",
  rate_limited: "failed",
  token_problem: "failed",
  network: "failed",
} as const;

/** The caption when it is long enough to learn from (10 to 3000 characters), else null. */
export function usableCaption(caption: string | null): string | null {
  const t = (caption ?? "").trim();
  return t.length >= PAST_POST_MIN_CHARS && t.length <= PAST_POST_MAX_CHARS ? t : null;
}

function previewable(url: string | null, mode: InstagramMode): string | null {
  if (!url) return null;
  if (mode === "fixture" && url.startsWith("data:image/svg+xml")) return url;
  return isInstagramImageHost(url) ? url : null;
}

async function imageViews(userId: string, brandId: string, media: InstagramMedia[]): Promise<InstagramImageView[]> {
  const mode = instagramMode();
  const picks = media
    .map((m) => ({ m, url: previewable(m.imageUrl, mode) }))
    .filter((x): x is { m: InstagramMedia; url: string } => x.url !== null);
  if (picks.length === 0) return [];
  const have = await getDb().withUser(userId, (tx) =>
    tx.query<{ source_id: string }>(
      "select source_id from public.photos where brand_id = $1 and kind = 'photo' and source = 'instagram' and source_id is not null",
      [brandId],
    ),
  );
  const taken = new Set(have.map((r) => r.source_id));
  return picks.map(({ m, url }) => ({
    mediaId: m.id,
    previewUrl: url,
    caption: m.caption ? m.caption.trim().slice(0, 140) : null,
    permalink: m.permalink,
    postedAt: m.postedAt,
    added: taken.has(m.id),
  }));
}

export interface ImportArgs {
  userId: string;
  brandId: string;
  handle: string;
  source: HandleSource;
  /** Test override for the Instagram read. */
  discover?: (handle: string) => Promise<DiscoveryResult>;
  /** Test override for the voice refresh that follows a change (default: the same debounced refresh pasted posts use). */
  onPostsChanged?: (userId: string, brandId: string) => void;
}

/**
 * Reads the account, adds up to 12 recent posts with usable captions as past posts, records the result
 * (instagram_status, instagram_checked_at) and starts the voice refresh when posts changed. Throws
 * BrandAccessError, UploadError("empty") for an unusable handle, and DailyCapError. A failed read does
 * not throw: it is recorded as the status and returned.
 */
export async function importInstagram(args: ImportArgs): Promise<ImportOutcome> {
  const { userId, brandId } = args;
  const handle = normalizeInstagramHandle(args.handle);
  if (!handle) throw new UploadError("empty");
  await requireBrandMember(userId, brandId);
  const changedPosts = args.onPostsChanged ?? scheduleVoiceRefresh;

  const saved = await saveInstagramHandle({ userId, brandId, handle, source: args.source });
  const empty = async (status: InstagramStatus): Promise<ImportOutcome> => {
    await setStatus(userId, brandId, status);
    return { status, handle, added: 0, total: (await getInstagramState(userId, brandId)).importedPosts, images: [] };
  };
  if (saved.removedPosts > 0) cache.delete(brandId);

  if (instagramMode() === "unavailable") return empty("unavailable");
  await assertUnderDailyCap(brandId); // counted like other uploads

  const result = await (args.discover ?? discoverInstagram)(handle);
  if (!result.ok) {
    if (result.reason === "token_problem" || result.reason === "rate_limited") {
      console.warn(`[instagram] could not read @${handle}: ${result.reason}`); // our side, not the owner's; no token or address in the line
    }
    return empty(STATUS_FOR_FAILURE[result.reason]);
  }
  remember(brandId, handle, result.media);

  // The newest posts with a usable caption, oldest first so they are stored in the order they were posted.
  const chosen: Array<{ media: InstagramMedia; text: string }> = [];
  for (const m of result.media) {
    const text = usableCaption(m.caption);
    if (text) chosen.push({ media: m, text });
    if (chosen.length >= MAX_IMPORTED_POSTS) break;
  }
  chosen.reverse();

  let added = 0;
  let rolledOff = 0;
  await getDb().withUser(userId, async (tx) => {
    for (const { media, text } of chosen) {
      const rows = await tx.query(
        `insert into public.photos (brand_id, kind, extracted_text, created_by, source, source_id, source_url, source_posted_at, created_at)
         values ($1, 'past_post', $2, $3, 'instagram', $4, $5, $6, clock_timestamp())
         on conflict (brand_id, source, kind, source_id) where source_id is not null do nothing
         returning id`,
        [brandId, text, userId, media.id, media.permalink, media.postedAt],
      );
      added += rows.length;
    }
    // Keep the newest MAX_IMPORTED_POSTS; older ones roll off.
    const gone = await tx.query(
      `delete from public.photos where id in (
         select id from public.photos
          where brand_id = $1 and kind = 'past_post' and source = 'instagram'
          order by source_posted_at desc nulls last, created_at desc
          offset ${MAX_IMPORTED_POSTS})
       returning id`,
      [brandId],
    );
    rolledOff = gone.length;
  });

  await setStatus(userId, brandId, "imported");
  if (added > 0 || rolledOff > 0 || saved.removedPosts > 0) changedPosts(userId, brandId);

  const state = await getInstagramState(userId, brandId);
  return { status: "imported", handle, added, total: state.importedPosts, images: await imageViews(userId, brandId, result.media) };
}

/** Starts work after the response is sent (Vercel) or right away outside a request. */
function inBackground(work: () => Promise<void>): Promise<void> {
  const running = work();
  try {
    after(running);
  } catch {
    // Not in a request: the promise is already running.
  }
  return running;
}

/**
 * The import for setup and for a handle found on the website: it never throws, and any problem ends as
 * status "failed" so nothing waits on it and nothing breaks.
 */
export function runInstagramImport(args: ImportArgs): Promise<void> {
  return inBackground(async () => {
    try {
      await importInstagram(args);
    } catch (e) {
      console.error("[instagram] background import failed", e instanceof Error ? e.name : "error");
      try {
        await setStatus(args.userId, args.brandId, "failed");
      } catch {
        // nothing more to do
      }
    }
  });
}

/**
 * Called by the website reader with the pages it fetched (HTML, or just their links). When the brand has no
 * Instagram handle yet, the first profile link found is saved as the handle (source "website") and the import
 * starts in the background. Returns the handle it took, or null. Never throws.
 */
export async function rememberInstagramFromWebsite(
  brandId: string,
  pagesHtmlOrLinks: string | string[],
  userId: string,
  opts: Pick<ImportArgs, "discover" | "onPostsChanged"> = {},
): Promise<{ handle: string; done: Promise<void> } | null> {
  try {
    const found = findInstagramHandles(pagesHtmlOrLinks);
    if (found.length === 0) return null;
    const [row] = await getDb().withUser(userId, (tx) =>
      tx.query<{ instagram_handle: string | null }>("select instagram_handle from public.brand_memory where brand_id = $1", [brandId]),
    );
    if (!row || row.instagram_handle) return null; // the owner's own answer (or an earlier find) stays
    const handle = found[0];
    await saveInstagramHandle({ userId, brandId, handle, source: "website" });
    await getDb().withUser(userId, (tx) =>
      tx.query("update public.brand_memory set instagram_status = 'found' where brand_id = $1 and instagram_status is null", [brandId]),
    );
    const done = runInstagramImport({ userId, brandId, handle, source: "website", ...opts });
    return { handle, done };
  } catch (e) {
    console.warn("[instagram] could not remember a handle from the website", e instanceof Error ? e.name : "error");
    return null;
  }
}

/** The "Remove Instagram posts" button: deletes the imported past posts and keeps the handle. */
export async function removeInstagramPosts(args: {
  userId: string;
  brandId: string;
  onPostsChanged?: (userId: string, brandId: string) => void;
}): Promise<number> {
  const { userId, brandId } = args;
  await requireBrandMember(userId, brandId);
  const n = await deleteImportedPosts(userId, brandId);
  await getDb().withUser(userId, (tx) =>
    tx.query(
      "update public.brand_memory set instagram_status = 'found' where brand_id = $1 and instagram_handle is not null and instagram_status = 'imported'",
      [brandId],
    ),
  );
  if (n > 0) (args.onPostsChanged ?? scheduleVoiceRefresh)(userId, brandId);
  return n;
}

// ---------------------------------------------------------------------------
// Pictures
// ---------------------------------------------------------------------------

type MediaLookup = { ok: true; media: InstagramMedia[] } | { ok: false; reason: keyof typeof STATUS_FOR_FAILURE | "no_handle" };

async function loadMedia(
  userId: string,
  brandId: string,
  opts: { force?: boolean; discover?: ImportArgs["discover"] },
): Promise<MediaLookup> {
  const state = await getInstagramState(userId, brandId);
  if (!state.handle) return { ok: false, reason: "no_handle" };
  if (!state.available) return { ok: false, reason: "unavailable" };
  if (!opts.force) {
    const hit = recall(brandId, state.handle);
    if (hit) return { ok: true, media: hit };
  }
  const result = await (opts.discover ?? discoverInstagram)(state.handle);
  if (!result.ok) return { ok: false, reason: result.reason };
  remember(brandId, state.handle, result.media);
  return { ok: true, media: result.media };
}

/** The pictures from the owner's recent posts to choose from. Uses the last answer when it is under 15 minutes old. */
export async function listInstagramImages(args: {
  userId: string;
  brandId: string;
  force?: boolean;
  discover?: ImportArgs["discover"];
}): Promise<{ ok: true; images: InstagramImageView[] } | { ok: false; reason: string }> {
  await requireBrandMember(args.userId, args.brandId);
  const found = await loadMedia(args.userId, args.brandId, args);
  if (!found.ok) return found;
  return { ok: true, images: await imageViews(args.userId, args.brandId, found.media) };
}

export type DownloadFn = (url: string) => Promise<{ bytes: Uint8Array; mimeType: string }>;

/** Fetches one Instagram picture safely: Instagram's own hosts only, through the SSRF-safe fetch, with the photo size limit. */
export const downloadInstagramImage: DownloadFn = async (url) => {
  const mode = instagramMode();
  if (mode === "fixture" && url.startsWith("data:image/svg+xml")) {
    const sharp = (await import("sharp")).default;
    const svg = decodeURIComponent(url.slice(url.indexOf(",") + 1));
    return { bytes: await sharp(Buffer.from(svg)).jpeg().toBuffer(), mimeType: "image/jpeg" };
  }
  if (!isInstagramImageHost(url)) throw new UploadError("bad_type");
  const res = await safeFetch(url, { accept: "image", maxBytes: PHOTO_MAX_BYTES, timeoutMs: 15_000 });
  if (res.status !== 200 || !res.body) throw new UploadError("unreadable");
  if (res.truncated) throw new UploadError("too_large");
  return { bytes: new Uint8Array(res.body), mimeType: res.contentType.split(";")[0].trim() };
};

export interface AddInstagramPhotosResult {
  added: Array<{ mediaId: string; photo: PhotoView; warning: string | null }>;
  /** Picked pictures that were already in the owner's photos. */
  alreadyAdded: string[];
  failed: Array<{ mediaId: string; code: UploadErrorCode | "not_found" | "download" }>;
}

/**
 * Stores the pictures the owner picked (by Instagram media id, never by address: the address always comes from
 * our own read of their account). Each goes through the normal photo pipeline (cleaning, description, usable
 * check) with source "instagram". One bad picture does not stop the others; hitting the 30-photo limit stops
 * the rest.
 */
export async function addInstagramPhotos(args: {
  userId: string;
  brandId: string;
  mediaIds: string[];
  storage?: Storage;
  download?: DownloadFn;
  discover?: ImportArgs["discover"];
  /** Test/dev override for the model's photo description. */
  fixture?: Parameters<typeof addPhoto>[0]["fixture"];
}): Promise<AddInstagramPhotosResult> {
  const { userId, brandId } = args;
  await requireBrandMember(userId, brandId);
  const ids = [...new Set((Array.isArray(args.mediaIds) ? args.mediaIds : []).filter((x): x is string => typeof x === "string"))].slice(
    0,
    MAX_PICK_PHOTOS,
  );
  const out: AddInstagramPhotosResult = { added: [], alreadyAdded: [], failed: [] };
  if (ids.length === 0) return out;

  const found = await loadMedia(userId, brandId, { discover: args.discover });
  if (!found.ok) {
    out.failed = ids.map((mediaId) => ({ mediaId, code: "not_found" as const }));
    return out;
  }
  const byId = new Map(found.media.map((m) => [m.id, m]));
  const have = new Set(
    (
      await getDb().withUser(userId, (tx) =>
        tx.query<{ source_id: string }>(
          "select source_id from public.photos where brand_id = $1 and kind = 'photo' and source = 'instagram' and source_id is not null",
          [brandId],
        ),
      )
    ).map((r) => r.source_id),
  );
  const storage = args.storage ?? getStorage();
  const download = args.download ?? downloadInstagramImage;
  const mode = instagramMode();

  let stopped = false;
  for (const mediaId of ids) {
    const m = byId.get(mediaId);
    const url = m ? previewable(m.imageUrl, mode) : null;
    if (!m || !url) {
      out.failed.push({ mediaId, code: "not_found" });
      continue;
    }
    if (have.has(mediaId)) {
      out.alreadyAdded.push(mediaId);
      continue;
    }
    if (stopped) {
      out.failed.push({ mediaId, code: "photo_limit" });
      continue;
    }
    try {
      const file = await download(url);
      const r = await addPhoto({
        userId,
        brandId,
        bytes: file.bytes,
        mimeType: file.mimeType,
        storage,
        fixture: args.fixture,
        source: { id: m.id, url: m.permalink, postedAt: m.postedAt },
      });
      have.add(mediaId);
      out.added.push({ mediaId, photo: r.photo, warning: r.warning });
    } catch (e) {
      if (e instanceof UploadError) {
        out.failed.push({ mediaId, code: e.code });
        if (e.code === "photo_limit") stopped = true;
      } else if (e instanceof BrandAccessError) {
        throw e;
      } else {
        out.failed.push({ mediaId, code: "download" });
      }
    }
  }
  return out;
}
