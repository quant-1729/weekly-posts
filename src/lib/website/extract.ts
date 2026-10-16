// Website reader entry point (Req 3, 5, 6): read the site, extract facts with their
// sources, verify every quote against the page text, save the facts and the status.
//
// Site problems never throw: they come back as a status so setup can continue (Req 6).
// Only the daily cap, access errors and programming errors propagate. A failed AI call is
// reported as status "failed" with error "ai_failed".

import { rememberInstagramFromWebsite } from "@/lib/instagram/import";
import { AiError, generateJson } from "@/lib/ai/client";
import { buildWebsiteFactsPrompt, type WebsitePage } from "@/lib/ai/prompts/v2-memory";
import { websiteFactsJsonSchema, websiteFactsSchema, type WebsiteFacts } from "@/lib/ai/schemas-v2";
import { BrandAccessError } from "@/lib/brand/current";
import { getDb, type Tx } from "@/lib/db";
import { assertUnderDailyCap, failedCallModel, failedCallUsd, recordUsage, type UsageMeta } from "@/lib/usage";
import { assertUnderWeeklyCap } from "@/lib/usage/caps";
import type { LogoCandidate } from "./clean";
import type { FetchEnv } from "./fetch";
import { websiteFactsFixture } from "./fixtures";
import { loadWebsitePages, type LoadedPage } from "./load";
import { pageKey, type SkippedPage } from "./pages";
import type { ReaderFn } from "./reader";

export type WebsiteStatus = "none" | "ok" | "partial" | "blocked" | "failed";

export interface WebsiteReadResult {
  status: WebsiteStatus;
  /** URLs of the pages that were read (home first). */
  pagesRead: string[];
  /** The pages (a subset of pagesRead) whose text came from the reading service because they build their content with JavaScript. */
  readerPages: string[];
  skipped: SkippedPage[];
  factsSaved: number;
  /** Facts the model returned that failed verification (quote or page not found) or were duplicates. */
  factsDropped: number;
  /** Facts left out because the owner already has their own version (an edit of a website fact, or a fact they added with the same kind and label). */
  factsSkippedOwnerEdited: number;
  /** Best first. Absolute URLs. Whoever downloads one must use safeFetch too. */
  logoCandidates: LogoCandidate[];
  themeColor: string | null;
  /** One plain sentence about the business, from the pages. Empty when nothing was read. */
  summary: string;
  /** Short machine-readable reason when the status is not ok ("js_only_meta": only the title and description could be read). */
  reason: string | null;
}

export interface ReadWebsiteOptions {
  /** Fetch settings. Tests inject a resolver/transport and set allowPrivate; production passes nothing. */
  fetch?: FetchEnv;
  /** The reading service for pages built with JavaScript. Undefined = the app default (Jina unless READER_PROVIDER=off); null = none. Tests inject one. */
  reader?: ReaderFn | null;
  /** Overrides the built-in AI fixture. Only used when AI is in fixture mode. */
  fixture?: (pages: WebsitePage[]) => WebsiteFacts;
}

// ---------------------------------------------------------------------------
// Verification: a fact is kept only when its quote is really on its page
// ---------------------------------------------------------------------------

/** Lower-case, unify quotes and dashes, drop table separators, collapse whitespace. */
export function normalizeForMatch(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/[|·•]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const digits = (s: string) => s.replace(/\D+/g, "");

const STARTS_WITH_TIME_OR_PRICE = /^(?:[\d₹$€£]|rs\b|inr\b)/i;

/**
 * Cleaned website text joins table cells with " | " (H-9). A fact value must not carry the pipe into
 * a post: between a label (no digits) and a time or price it becomes ": " ("Monday to Friday | 7am
 * to 6pm" -> "Monday to Friday: 7am to 6pm"), anywhere else ", ". The quote is not touched: it is
 * checked against the page text, which still has the pipes.
 */
export function normalizeFactValue(value: string): string {
  const parts = value
    .split(/\s*\|\s*/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return value.trim();
  let out = parts[0];
  for (let i = 1; i < parts.length; i++) {
    const label = !/\d/.test(parts[i - 1]) && STARTS_WITH_TIME_OR_PRICE.test(parts[i]);
    out += (label ? ": " : ", ") + parts[i];
  }
  return out;
}

export interface VerifiedFact {
  kind: WebsiteFacts["facts"][number]["kind"];
  label: string;
  value: string;
  quote: string;
  pageUrl: string;
  outcomePromise: boolean;
}

export function verifyFacts(facts: WebsiteFacts["facts"], pages: Array<{ url: string; text: string }>): { kept: VerifiedFact[]; dropped: number } {
  const byKey = new Map(pages.map((p) => [pageKey(p.url), { url: p.url, text: normalizeForMatch(p.text) }]));
  const home = pages[0] ? new URL(pages[0].url) : null;
  const kept: VerifiedFact[] = [];
  const seen = new Set<string>();
  let dropped = 0;

  for (const f of facts) {
    let page: { url: string; text: string } | undefined;
    try {
      page = byKey.get(pageKey(new URL(f.page_url, home ?? undefined)));
    } catch {
      page = undefined;
    }
    const quote = normalizeForMatch(f.quote);
    const value = normalizeFactValue(f.value);
    let ok = !!page && quote.length > 0 && page.text.includes(quote);
    // A price or phone number must also be in its own quote, so a real quote cannot carry a made-up number.
    if (ok && (f.kind === "price" || f.kind === "phone") && digits(value) && !digits(f.quote).includes(digits(value))) ok = false;
    const dedupe = `${f.kind}|${normalizeForMatch(f.label)}|${normalizeForMatch(value)}`;
    if (!ok || !value || seen.has(dedupe)) {
      dropped++;
      continue;
    }
    seen.add(dedupe);
    kept.push({
      kind: f.kind,
      label: f.label.trim(),
      value,
      quote: f.quote.trim(),
      pageUrl: page!.url,
      outcomePromise: f.outcome_promise,
    });
  }
  return { kept, dropped };
}

// ---------------------------------------------------------------------------
// Reader
// ---------------------------------------------------------------------------

/** kind + normalised label, or null when there is no label (a fact without a name is never matched). */
function factKey(kind: string, label: string | null): string | null {
  const l = normalizeForMatch(label ?? "");
  return l ? `${kind}|${l}` : null;
}

/**
 * The kind + label of every active fact the owner has made their own: facts they added, and edits
 * of website facts (matched under the edited label and under the original's label).
 */
async function ownerFactKeys(tx: Tx, brandId: string): Promise<Set<string>> {
  const rows = await tx.query<{ kind: string; label: string | null; origin_kind: string | null; origin_label: string | null }>(
    `select o.kind::text as kind, o.label, w.kind::text as origin_kind, w.label as origin_label
       from public.brand_facts o
       left join public.brand_facts w
         on w.brand_id = o.brand_id and w.source_type = 'website' and w.id::text = o.source_ref
      where o.brand_id = $1 and o.source_type = 'owner' and o.active`,
    [brandId],
  );
  const keys = new Set<string>();
  for (const r of rows) {
    const own = factKey(r.kind, r.label);
    if (own) keys.add(own);
    if (r.origin_kind) {
      const origin = factKey(r.origin_kind, r.origin_label);
      if (origin) keys.add(origin);
    }
  }
  return keys;
}

function toPrompt(pages: LoadedPage[]): WebsitePage[] {
  return pages.map((p) => ({ url: p.url, title: p.title, text: p.text }));
}

export async function readWebsiteFacts(args: {
  userId: string;
  brandId: string;
  /** What the owner typed. Empty or missing means "no website". */
  url: string | null | undefined;
  options?: ReadWebsiteOptions;
}): Promise<WebsiteReadResult> {
  const { userId, brandId } = args;
  const typed = (args.url ?? "").trim();

  // Membership first: RLS only shows the brand to its members.
  const brand = await getDb().withUser(userId, (tx) =>
    tx.query<{ name: string; business_name: string | null }>(
      `select b.name, m.business_name
         from public.brands b
         left join public.brand_memory m on m.brand_id = b.id
        where b.id = $1 and public.is_brand_member(b.id)`,
      [brandId],
    ),
  );
  if (brand.length === 0) throw new BrandAccessError();
  const businessName = brand[0].business_name?.trim() || brand[0].name;

  // The reason is kept with the status (brand_memory.website_read_reason, at most 40 characters; null for a clean read)
  // so the setup and Brand screens can explain a partial or failed read after a reload.
  const setStatus = (status: WebsiteStatus, websiteUrl: string | null, reason: string | null = null) =>
    getDb().withUser(userId, (tx) =>
      tx.query(
        `update public.brand_memory
            set website_url = $2, website_status = $3::public.website_status, website_read_at = $4, website_read_reason = $5
          where brand_id = $1`,
        [brandId, websiteUrl, status, status === "none" ? null : new Date().toISOString(), status === "none" ? null : reason?.slice(0, 40) ?? null],
      ),
    );

  const base: WebsiteReadResult = {
    status: "none",
    pagesRead: [],
    readerPages: [],
    skipped: [],
    factsSaved: 0,
    factsDropped: 0,
    factsSkippedOwnerEdited: 0,
    logoCandidates: [],
    themeColor: null,
    summary: "",
    reason: null,
  };

  if (!typed) {
    await setStatus("none", null);
    return base;
  }

  await assertUnderDailyCap(brandId);
  await assertUnderWeeklyCap(brandId, "website_read"); // 3 reads a week (Req 23)

  const loaded = await loadWebsitePages(typed, args.options?.fetch, { reader: args.options?.reader });
  // The owner's Instagram is often linked from their website: remember it and start the import
  // (no-op when the brand already has a handle; never throws, never waits for Instagram).
  if (loaded.socialSources.length) await rememberInstagramFromWebsite(brandId, loaded.socialSources, userId);
  const common = {
    ...base,
    skipped: loaded.skipped,
    logoCandidates: loaded.logoCandidates,
    themeColor: loaded.themeColor,
    reason: loaded.reason,
  };
  if (loaded.status === "blocked" || loaded.status === "failed") {
    await setStatus(loaded.status, typed.slice(0, 2000), loaded.reason);
    return { ...common, status: loaded.status };
  }

  // Ask the model, then keep only facts whose quote is on the page they name.
  const prompt = buildWebsiteFactsPrompt({ businessName, pages: toPrompt(loaded.pages) });
  let data: WebsiteFacts;
  let usd = 0;
  let meta: UsageMeta = {};
  try {
    const fixture = args.options?.fixture ?? ((pages: WebsitePage[]) => websiteFactsFixture(pages.map((p) => p.url)));
    const res = await generateJson({
      system: prompt.system,
      user: prompt.user,
      zodSchema: websiteFactsSchema,
      jsonSchema: websiteFactsJsonSchema,
      temperature: 0,
      timeoutMs: 40_000,
      budgetMs: 60_000,
      logContext: { brandId },
      fixture: () => fixture(toPrompt(loaded.pages)),
    });
    data = res.data;
    usd = res.stats?.usd ?? 0;
    meta = { model: res.stats?.model };
  } catch (e) {
    if (!(e instanceof AiError)) throw e;
    // The call was made, so it counts against the cap, but nothing is replaced.
    await recordUsage(brandId, userId, "website_read", failedCallUsd(e), { ok: false, model: failedCallModel(e) });
    await setStatus("failed", typed.slice(0, 2000), "ai_failed");
    return { ...common, status: "failed", pagesRead: loaded.pages.map((p) => p.url), readerPages: loaded.readerPages, reason: "ai_failed" };
  }
  await recordUsage(brandId, userId, "website_read", usd, meta);

  const { kept, dropped } = verifyFacts(data.facts, loaded.pages);
  const status: WebsiteStatus = loaded.status; // "ok" | "partial"

  // Replace the previous website facts (deactivate, never delete) and record the status, together.
  // The old facts go only when this read found at least one fact: a read that found nothing leaves
  // them alone. A fact the owner has their own version of is not added again: the owner's wins.
  let skippedOwnerEdited = 0;
  let saved = 0;
  await getDb().withUser(userId, async (tx) => {
    let toSave = kept;
    if (kept.length > 0) {
      await tx.query(
        `update public.brand_facts set active = false
          where brand_id = $1 and source_type = 'website' and active`,
        [brandId],
      );
      const owned = await ownerFactKeys(tx, brandId);
      toSave = kept.filter((f) => {
        const key = factKey(f.kind, f.label);
        return key === null || !owned.has(key);
      });
      skippedOwnerEdited = kept.length - toSave.length;
    }
    saved = toSave.length;
    for (const f of toSave) {
      await tx.query(
        `insert into public.brand_facts
           (brand_id, kind, label, value, source_type, source_ref, source_quote, outcome_promise, created_by)
         values ($1, $2::public.fact_kind, $3, $4, 'website', $5, $6, $7, $8)`,
        [brandId, f.kind, f.label.slice(0, 200) || null, f.value.slice(0, 1000), f.pageUrl, f.quote.slice(0, 500), f.outcomePromise, userId],
      );
    }
    await tx.query(
      `update public.brand_memory
          set website_url = $2, website_status = $3::public.website_status, website_read_at = now(), website_read_reason = $4
        where brand_id = $1`,
      [brandId, typed.slice(0, 2000), status, loaded.reason?.slice(0, 40) ?? null],
    );
  });

  return {
    ...common,
    status,
    pagesRead: loaded.pages.map((p) => p.url),
    readerPages: loaded.readerPages,
    factsSaved: saved,
    factsDropped: dropped,
    factsSkippedOwnerEdited: skippedOwnerEdited,
    summary: data.business_summary.trim().slice(0, 400),
  };
}
