import type { BadgeTone } from "@/components/ui";
import { fill, s } from "@/lib/i18n/strings";
import { formatSlotDay } from "@/lib/queue/format";
import type { HistoryPost, V3Status } from "./history";

/** What a history entry shows as its badge and where it links to (v1/v2 and v3 posts alike). */
export interface HistoryView {
  href: string;
  label: string;
  tone: BadgeTone;
  /** Link to the live post, once published through a connection. */
  permalink: string | null;
  /** "Carousel · 5 slides" for a carousel the owner asked for, else null. */
  formatLabel: string | null;
}

const V3_TONE: Record<V3Status, BadgeTone> = {
  draft: "neutral",
  needs_approval: "info",
  approved: "ok",
  scheduled: "info",
  published: "ok",
  delivered: "ok",
  skipped: "neutral",
  expired: "neutral",
  missed: "err",
  failed: "err",
};

const V1_TONE: Record<HistoryPost["status"], BadgeTone> = { draft: "neutral", ready: "ok", failed: "err", generating: "info" };

function day(iso: string, timezone: string): string {
  try {
    return formatSlotDay(iso, timezone);
  } catch {
    return formatSlotDay(iso, "UTC");
  }
}

export function historyView(post: HistoryPost): HistoryView {
  const v3 = post.v3;
  if (!v3) return { href: `/review/${post.id}`, label: s.history.status[post.status], tone: V1_TONE[post.status], permalink: null, formatLabel: null };
  const t = s.history.v3Status;
  let label: string;
  if (v3.status === "scheduled") label = fill(t.scheduled, { when: v3.at ? day(v3.at, v3.timezone) : "" }).trim();
  else if (v3.status === "published") label = v3.at ? fill(t.published, { when: day(v3.at, v3.timezone) }) : t.publishedNoDate;
  else label = t[v3.status];
  return { href: `/create/${v3.briefId}/review`, label, tone: V3_TONE[v3.status], permalink: v3.permalink, formatLabel: v3.carouselSlides ? fill(s.create.format.carouselBadge, { n: v3.carouselSlides }) : null };
}
