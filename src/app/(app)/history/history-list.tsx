"use client";

import { useState, useTransition } from "react";
import { secondaryButton } from "@/components/ui";
import { s } from "@/lib/i18n/strings";
import type { HistoryPost } from "@/lib/posts/history";
import type { HistoryFilters } from "@/lib/posts/history-filters";
import { loadMorePosts } from "./actions";
import { HistoryCard } from "./history-card";

/** The post cards plus "Load more". The page remounts this (key) when the filters change. */
export function HistoryList({
  initialPosts,
  initialCursor,
  filters,
  brandName,
}: {
  initialPosts: HistoryPost[];
  initialCursor: string | null;
  filters: HistoryFilters;
  brandName: string;
}) {
  const [posts, setPosts] = useState(initialPosts);
  const [cursor, setCursor] = useState(initialCursor);
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();

  function loadMore() {
    if (!cursor) return;
    setFailed(false);
    startTransition(async () => {
      const res = await loadMorePosts(filters, cursor);
      if (!res.ok) return setFailed(true);
      // Guard against a double tap adding the same page twice.
      setPosts((prev) => {
        const seen = new Set(prev.map((p) => p.id));
        return [...prev, ...res.posts.filter((p) => !seen.has(p.id))];
      });
      setCursor(res.nextCursor);
    });
  }

  return (
    <div className="space-y-3">
      <ul className="space-y-3">
        {posts.map((p) => (
          <HistoryCard key={p.id} post={p} brandName={brandName} />
        ))}
      </ul>
      {failed && (
        <p role="alert" className="text-sm text-red-700">
          {s.history.loadMoreFailed}
        </p>
      )}
      {cursor && (
        <button type="button" className={secondaryButton} disabled={pending} onClick={loadMore}>
          {pending ? s.history.loadingMore : s.history.loadMore}
        </button>
      )}
    </div>
  );
}
