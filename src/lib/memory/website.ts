/**
 * "Read my website again" and changing the website address (Req 3, 5). It calls the V-4 reader
 * with the address given, which replaces the facts that came from the website (the old rows stay,
 * inactive). Facts the owner added or edited are kept.
 */
import { requireBrandMember } from "@/lib/brand/current";
import { getDb } from "@/lib/db";
import { applyWebsiteUrl } from "@/lib/setup/save";
import { urlField } from "@/lib/setup/schema";
import { readWebsiteFacts, type ReadWebsiteOptions, type WebsiteStatus } from "@/lib/website/extract";
import { forgetWebsiteAssets, rememberWebsiteAssets } from "./look";

export class WebsiteUrlError extends Error {
  constructor() {
    super("Invalid website address");
    this.name = "WebsiteUrlError";
  }
}

export interface RereadOutcome {
  status: WebsiteStatus;
  /** The address that was saved, or null when the owner removed the website. */
  websiteUrl: string | null;
  pagesRead: number;
  factsSaved: number;
  /** Facts left out because the owner's own version stays. */
  factsSkippedOwnerEdited: number;
  /** The address differs from the one saved before. */
  addressChanged: boolean;
  reason: string | null;
  /** The read found logo candidates (the page can offer "Use the logo from your website?"). */
  hasLogoCandidates: boolean;
}

export type ReadFn = typeof readWebsiteFacts;

/**
 * Saves `rawUrl` as the website (empty removes it) and reads it now. Does not throw for site
 * problems: the status says what happened. Throws WebsiteUrlError, BrandAccessError, DailyCapError.
 */
export async function rereadWebsite(args: {
  userId: string;
  brandId: string;
  url: string;
  read?: ReadFn;
  options?: ReadWebsiteOptions;
}): Promise<RereadOutcome> {
  const { userId, brandId } = args;
  await requireBrandMember(userId, brandId);
  const parsed = urlField.safeParse(typeof args.url === "string" ? args.url : "");
  if (!parsed.success) throw new WebsiteUrlError();
  const url = parsed.data;

  // A new address clears the old read's status; its facts stay until the new read succeeds.
  // Links that pointed at the old website follow the new one, and links the owner pointed
  // somewhere else stay.
  let addressChanged = false;
  await getDb().withUser(userId, async (tx) => {
    const [before] = await tx.query<{ website_url: string | null; link_destination: string | null }>(
      "select website_url, link_destination from public.brand_memory where brand_id = $1",
      [brandId],
    );
    const changed = await applyWebsiteUrl(tx, brandId, url);
    addressChanged = (before?.website_url ?? "") !== url;
    if (changed || url === "") {
      if (before?.link_destination && before.link_destination === before.website_url) {
        await tx.query("update public.brand_memory set link_destination = $2 where brand_id = $1", [brandId, url === "" ? null : url]);
      }
    }
  });
  forgetWebsiteAssets(brandId);

  const result = await (args.read ?? readWebsiteFacts)({ userId, brandId, url, options: args.options });
  if (result.status === "ok" || result.status === "partial") {
    rememberWebsiteAssets(brandId, url, { logoCandidates: result.logoCandidates, themeColor: result.themeColor });
  }
  return {
    status: result.status,
    websiteUrl: url === "" ? null : url,
    pagesRead: result.pagesRead.length,
    factsSaved: result.factsSaved,
    factsSkippedOwnerEdited: result.factsSkippedOwnerEdited,
    addressChanged,
    reason: result.reason,
    hasLogoCandidates: result.logoCandidates.length > 0,
  };
}

export interface WebsiteInfo {
  url: string | null;
  /** brand_memory.website_status */
  status: string;
  /** "YYYY-MM-DD" (UTC) or null */
  readAt: string | null;
  /** brand_memory.website_read_reason: why the last read was partial or failed, null when it was clean. */
  reason: string | null;
}

/** Where the website read stands, for the Facts section. */
export async function getWebsiteInfo(userId: string, brandId: string): Promise<WebsiteInfo> {
  await requireBrandMember(userId, brandId);
  const [row] = await getDb().withUser(userId, (tx) =>
    tx.query<{ url: string | null; status: string; read_at: string | null; reason: string | null }>(
      `select website_url as url, website_status::text as status,
              to_char(website_read_at at time zone 'UTC', 'YYYY-MM-DD') as read_at, website_read_reason as reason
         from public.brand_memory where brand_id = $1`,
      [brandId],
    ),
  );
  return { url: row?.url ?? null, status: row?.status ?? "none", readAt: row?.read_at ?? null, reason: row?.reason ?? null };
}
