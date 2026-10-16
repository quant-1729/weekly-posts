// Competitors (R-1): the businesses the owner names for trend research, and the owner's research settings
// (one-line focus and the weekly on/off switch). Runs as the signed-in user, so row-level security keeps it to the
// brand; the website is checked like a QR link (public https address, no private or local host).
//
// Businesses only, never private people. Up to MAX_COMPETITORS per brand.

import { requireBrandMember } from "@/lib/brand/current";
import { getDb } from "@/lib/db";
import { normalizeInstagramHandle } from "@/lib/instagram/handle";
import { checkQrUrl, type QrResolver } from "@/lib/qr/link";
import { MAX_COMPETITORS, type Competitor } from "./types";

export type CompetitorErrorCode = "name" | "website" | "instagram" | "youtube" | "limit" | "not_found";

export class CompetitorError extends Error {
  constructor(public readonly code: CompetitorErrorCode) {
    super(`Competitor: ${code}`);
    this.name = "CompetitorError";
  }
}

/** What the owner typed. Empty strings and undefined both mean "not given". */
export interface CompetitorInput {
  name: string;
  website?: string | null;
  instagram?: string | null;
  youtube?: string | null;
}

export interface ValidCompetitor {
  name: string;
  website: string | null;
  instagramHandle: string | null;
  youtubeHandle: string | null;
}

export interface CompetitorOptions {
  /** DNS lookup for the website check. Tests pass a fake; the default is the system resolver. */
  resolver?: QrResolver;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const COMPETITOR_NAME_MAX = 80;
export const FOCUS_MAX = 200;

const clean = (v: unknown): string => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim() : "");

/** "@name", "name" or a youtube.com address -> "@name" or a channel id ("UC" + 22 characters). Null when it is neither. */
export function normalizeYoutubeHandle(input: string): string | null {
  const t = input.trim();
  if (!t || t.length > 300) return null;
  const channelId = /^UC[A-Za-z0-9_-]{22}$/;
  const handle = /^[A-Za-z0-9._-]{3,30}$/;
  if (channelId.test(t)) return t;
  if (/youtube\.com|youtu\.be/i.test(t) || /^https?:\/\//i.test(t)) {
    let u: URL;
    try {
      u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(t) ? t : `https://${t}`);
    } catch {
      return null;
    }
    const host = u.hostname.toLowerCase().replace(/^www\.|^m\./, "");
    if (host !== "youtube.com") return null;
    const parts = u.pathname.split("/").filter(Boolean);
    const first = parts[0] ?? "";
    if (first.startsWith("@") && handle.test(first.slice(1))) return `@${first.slice(1).toLowerCase()}`;
    if (first === "channel" && channelId.test(parts[1] ?? "")) return parts[1];
    if ((first === "c" || first === "user") && handle.test(parts[1] ?? "")) return `@${parts[1].toLowerCase()}`;
    return null;
  }
  const name = t.replace(/^@/, "");
  return handle.test(name) ? `@${name.toLowerCase()}` : null;
}

/** Turns what the owner typed into a public https address (adds https://, upgrades http://), or null. */
async function checkWebsite(raw: string, resolver?: QrResolver): Promise<string | null> {
  let text = raw.trim();
  if (!text || /\s/.test(text)) return null;
  if (/^http:\/\//i.test(text)) text = `https://${text.slice(7)}`;
  else if (!/^[a-z][a-z0-9+.-]*:/i.test(text)) text = `https://${text}`;
  const check = await checkQrUrl(text, { resolver });
  if (!check.ok) return null;
  const u = new URL(check.url);
  if (u.protocol !== "https:") return null;
  u.hash = "";
  const href = u.href;
  return href.length <= 300 ? href : null;
}

/** Validates the owner's input (no database). Throws CompetitorError with the first problem. */
export async function validateCompetitor(input: CompetitorInput, opts: CompetitorOptions = {}): Promise<ValidCompetitor> {
  const name = clean(input?.name);
  if (name.length < 1 || [...name].length > COMPETITOR_NAME_MAX) throw new CompetitorError("name");

  const websiteRaw = clean(input?.website);
  const website = websiteRaw ? await checkWebsite(websiteRaw, opts.resolver) : null;
  if (websiteRaw && !website) throw new CompetitorError("website");

  const igRaw = clean(input?.instagram);
  const instagramHandle = igRaw ? normalizeInstagramHandle(igRaw) : null;
  if (igRaw && !instagramHandle) throw new CompetitorError("instagram");

  const ytRaw = clean(input?.youtube);
  const youtubeHandle = ytRaw ? normalizeYoutubeHandle(ytRaw) : null;
  if (ytRaw && !youtubeHandle) throw new CompetitorError("youtube");

  return { name, website, instagramHandle, youtubeHandle };
}

interface Row {
  id: string;
  brand_id: string;
  name: string;
  website: string | null;
  instagram_handle: string | null;
  youtube_handle: string | null;
}
const COLUMNS = "id::text as id, brand_id::text as brand_id, name, website, instagram_handle, youtube_handle";
const toCompetitor = (r: Row): Competitor => ({
  id: r.id,
  brandId: r.brand_id,
  name: r.name,
  website: r.website,
  instagramHandle: r.instagram_handle,
  youtubeHandle: r.youtube_handle,
});

/** The brand's competitors, oldest first. */
export async function listCompetitors(userId: string, brandId: string): Promise<Competitor[]> {
  await requireBrandMember(userId, brandId);
  const rows = await getDb().withUser(userId, (tx) =>
    tx.query<Row>(`select ${COLUMNS} from public.competitors where brand_id = $1 order by created_at, id`, [brandId]),
  );
  return rows.map(toCompetitor);
}

/** Server-only read for the research run (no user): the brand's competitors. */
export async function listCompetitorsForRun(brandId: string): Promise<Competitor[]> {
  const rows = await getDb().withService((tx) =>
    tx.query<Row>(`select ${COLUMNS} from public.competitors where brand_id = $1 order by created_at, id`, [brandId]),
  );
  return rows.map(toCompetitor);
}

export async function createCompetitor(userId: string, brandId: string, input: CompetitorInput, opts: CompetitorOptions = {}): Promise<Competitor> {
  await requireBrandMember(userId, brandId);
  const v = await validateCompetitor(input, opts);
  return getDb().withUser(userId, async (tx) => {
    const [{ n }] = await tx.query<{ n: number }>("select count(*)::int as n from public.competitors where brand_id = $1", [brandId]);
    if (n >= MAX_COMPETITORS) throw new CompetitorError("limit");
    const [row] = await tx.query<Row>(
      `insert into public.competitors (brand_id, name, website, instagram_handle, youtube_handle)
       values ($1, $2, $3, $4, $5) returning ${COLUMNS}`,
      [brandId, v.name, v.website, v.instagramHandle, v.youtubeHandle],
    );
    return toCompetitor(row);
  });
}

export async function updateCompetitor(userId: string, brandId: string, id: string, input: CompetitorInput, opts: CompetitorOptions = {}): Promise<Competitor> {
  await requireBrandMember(userId, brandId);
  if (!UUID_RE.test(id)) throw new CompetitorError("not_found");
  const v = await validateCompetitor(input, opts);
  const rows = await getDb().withUser(userId, (tx) =>
    tx.query<Row>(
      `update public.competitors set name = $3, website = $4, instagram_handle = $5, youtube_handle = $6, updated_at = now()
        where id = $1 and brand_id = $2 returning ${COLUMNS}`,
      [id, brandId, v.name, v.website, v.instagramHandle, v.youtubeHandle],
    ),
  );
  if (rows.length === 0) throw new CompetitorError("not_found");
  return toCompetitor(rows[0]);
}

export async function deleteCompetitor(userId: string, brandId: string, id: string): Promise<void> {
  await requireBrandMember(userId, brandId);
  if (!UUID_RE.test(id)) throw new CompetitorError("not_found");
  const rows = await getDb().withUser(userId, (tx) =>
    tx.query("delete from public.competitors where id = $1 and brand_id = $2 returning id", [id, brandId]),
  );
  if (rows.length === 0) throw new CompetitorError("not_found");
}

// ---------------------------------------------------------------------------------------------
// Research settings: the owner's one-line focus and the weekly switch (brand_memory)
// ---------------------------------------------------------------------------------------------

export interface ResearchSettings {
  focus: string | null;
  on: boolean;
}

export class ResearchSettingsError extends Error {
  constructor() {
    super("Research settings are invalid");
    this.name = "ResearchSettingsError";
  }
}

/** One line, at most 200 characters; empty means none. */
export function cleanFocus(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "string") throw new ResearchSettingsError();
  const t = clean(raw);
  if ([...t].length > FOCUS_MAX) throw new ResearchSettingsError();
  return t === "" ? null : t;
}

export async function getResearchSettings(userId: string, brandId: string): Promise<ResearchSettings> {
  await requireBrandMember(userId, brandId);
  const [row] = await getDb().withUser(userId, (tx) =>
    tx.query<{ research_focus: string | null; research_on: boolean }>("select research_focus, research_on from public.brand_memory where brand_id = $1", [brandId]),
  );
  return { focus: row?.research_focus ?? null, on: row?.research_on ?? true };
}

export async function saveResearchSettings(userId: string, brandId: string, input: { focus: unknown; on: unknown }): Promise<ResearchSettings> {
  await requireBrandMember(userId, brandId);
  const focus = cleanFocus(input?.focus);
  if (typeof input?.on !== "boolean") throw new ResearchSettingsError();
  const rows = await getDb().withUser(userId, (tx) =>
    tx.query("update public.brand_memory set research_focus = $2, research_on = $3 where brand_id = $1 returning brand_id", [brandId, focus, input.on]),
  );
  if (rows.length === 0) throw new ResearchSettingsError();
  return { focus, on: input.on };
}
