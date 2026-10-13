"use server";

import { getCurrentUser } from "@/lib/auth";
import { getCurrentBrand } from "@/lib/brand/current";
import { dateWindow, parseHistoryFilters, type HistoryFilters } from "@/lib/posts/history-filters";
import { DEFAULT_PAGE_SIZE, listPosts, type PostPage } from "@/lib/posts/history";

export type LoadMoreResult = ({ ok: true } & PostPage) | { ok: false };

/** "Load more": the next page of the current brand's posts for the same filters. */
export async function loadMorePosts(filters: HistoryFilters, cursor: string): Promise<LoadMoreResult> {
  try {
    const user = await getCurrentUser();
    if (!user) return { ok: false };
    const brand = await getCurrentBrand(user.id);
    if (!brand) return { ok: false };
    // Re-parse: the arguments come from the browser.
    const safe = parseHistoryFilters({ range: filters?.range, date: filters?.date ?? undefined, lang: filters?.language ?? undefined });
    const { from, to } = dateWindow(safe);
    const page = await listPosts(user.id, brand.id, {
      from,
      to,
      language: safe.language,
      cursor: typeof cursor === "string" ? cursor : null,
      limit: DEFAULT_PAGE_SIZE,
    });
    return { ok: true, ...page };
  } catch (e) {
    console.error("[history] load more failed", e);
    return { ok: false };
  }
}
