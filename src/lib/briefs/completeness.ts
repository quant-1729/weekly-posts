// Completeness check and USP limits for a brief (PRD v3 B-8 and B-2). Pure; safe in the browser.

import { fill, s } from '@/lib/i18n/strings';
import { REQUIRED_BY_TYPE, USP_LIMITS, type Brief } from './types';

export type MissingKey = 'description' | 'primaryUsp' | 'dates' | 'cta';

export interface MissingItem {
  key: MissingKey;
  /** One line to ask the owner. */
  question: string;
}

/** Kinds that say "how much" in an offer: a discount, a price or a free extra. */
const OFFER_AMOUNT_KINDS = new Set(['discount', 'price', 'free_extra']);

function pick(map: Record<string, string>, type: string): string {
  return map[type] ?? map.default;
}

/**
 * What is still missing before design starts, per `REQUIRED_BY_TYPE`, each with a one-line
 * question for the owner. An offer needs a date it ends (`endsOn`); an event needs a date (start
 * or end); an offer's main point must be a discount, price or free extra (the "how much").
 * A post also needs something to say: the owner's description (`notes`) or a main point.
 * An empty list means the brief is complete.
 */
export function checkCompleteness(brief: Brief): MissingItem[] {
  const q = s.brief.questions;
  const missing: MissingItem[] = [];
  if (!brief.notes?.trim() && !brief.primaryUspId) missing.push({ key: 'description', question: q.description });
  for (const key of REQUIRED_BY_TYPE[brief.postType]) {
    if (key === 'primaryUsp') {
      if (!brief.primaryUspId) {
        missing.push({ key, question: pick(q.primaryUsp, brief.postType) });
      } else if (brief.postType === 'offer') {
        const primary = brief.uspSnapshot.find((u) => u.role === 'primary');
        if (primary && !OFFER_AMOUNT_KINDS.has(primary.kind)) missing.push({ key, question: s.brief.offerNeedsAmount });
      }
    } else if (key === 'dates') {
      const ok = brief.postType === 'offer' ? !!brief.endsOn || brief.openEnded : !!(brief.startsOn || brief.endsOn);
      if (!ok) missing.push({ key, question: pick(q.dates, brief.postType) });
    } else if (key === 'cta') {
      if (!brief.cta) missing.push({ key, question: pick(q.cta, brief.postType) });
    }
  }
  return missing;
}

export type FormatFamily = keyof typeof USP_LIMITS;

export interface UspLimitWarning {
  format: FormatFamily;
  primary: number;
  secondary: number;
  limit: { primary: number; secondary: number };
  message: string;
  /** The owner is offered a carousel (one point per slide) instead. */
  offerCarousel: true;
}

/** One warning per format that cannot fit the brief's main and extra points ("Too many points ..."). */
export function uspLimitWarnings(brief: Pick<Brief, 'primaryUspId' | 'secondaryUspIds'>, formats: readonly FormatFamily[]): UspLimitWarning[] {
  const primary = brief.primaryUspId ? 1 : 0;
  const secondary = brief.secondaryUspIds.length;
  const out: UspLimitWarning[] = [];
  for (const format of new Set(formats)) {
    const limit = USP_LIMITS[format];
    if (!limit || (primary <= limit.primary && secondary <= limit.secondary)) continue;
    out.push({
      format,
      primary,
      secondary,
      limit: { primary: limit.primary, secondary: limit.secondary },
      message: fill(s.brief.tooManyPoints, { format, primary: limit.primary, secondary: limit.secondary }),
      offerCarousel: true,
    });
  }
  return out;
}
