// V2 guardrail (Req 11-13): the library the weekly pipeline (V-10) and the approval
// pages (V-16) call. Design: docs/guardrail.md (sections 1-6 and the v2 addendum).
//
//   Req 11  prices, offers, hours, claims and contact details only from brand memory,
//           otherwise a "please check" flag (both layers, merged)
//   Req 12  regulated brands: outcome promises are always flagged, plus a reminder
//   Req 13  words to avoid, and 6+ word repetition against the last 28 days

import type { V2CheckPost } from '@/lib/ai/prompts/v2-fact-check';
import type { WeeklyFact } from '@/lib/ai/prompts/v2-weekly';
import type { V2FactCheck } from '@/lib/ai/schemas-v2';
import { resolveRegulated } from '@/lib/ai/regulated';
import { getDb, type Tx } from '@/lib/db';
import { regionsByCountry } from '@/lib/setup/regions';
import { checkPostsAi, type AiStatement } from './ai';
import { checkPostDeterministic } from './deterministic';
import { flagId, mergeFlags } from './merge';
import { findRepeats, HISTORY_DAYS, type HistoryCaption } from './repetition';
import { checkUspRules, type UspRuleContext } from './usp-rules';
import {
  AI_UNCHECKED_TEXT,
  REGULATED_REMINDER_TEXT,
  type Flag,
  type FormatIssue,
  type GuardrailPost,
  type RegulatedKind,
} from './types';

export * from './types';
export { hasBlockingFlags, confirmFlag, removeFlagText, resolveRemovedSpans, GuardrailActionError } from './actions';
export { findRepeats } from './repetition';
export { checkPostDeterministic } from './deterministic';
export { checkPostsAi } from './ai';
export { withNumberDigits, normalizeNumberWords } from './number-words';
export { checkUspRules, SUPERLATIVE_TERMS } from './usp-rules';
export type { UspRuleContext, UspRulePost, UspRuleQr, UspRuleUsp } from './usp-rules';

export interface GuardrailContext {
  /** Active facts with short ids f1, f2, ... in a stable order (created_at, id). */
  facts: WeeklyFact[];
  regulated: RegulatedKind;
  wordsToAvoid: string[];
}

function setupFacts(mem: { business_name: string | null; city: string | null; region: string | null; country: string | null } | undefined): Array<{ kind: string; label: string; value: string }> {
  if (!mem) return [];
  const out: Array<{ kind: string; label: string; value: string }> = [];
  if (mem.business_name?.trim()) out.push({ kind: 'other', label: 'Business name', value: mem.business_name.trim() });
  const country = mem.country ? (new Intl.DisplayNames(['en'], { type: 'region' }).of(mem.country) ?? mem.country) : '';
  const region = mem.region && mem.country ? (regionsByCountry()[mem.country]?.find((r) => r.code === mem.region)?.name ?? '') : '';
  const place = [mem.city?.trim(), region, country].filter(Boolean).join(', ');
  if (place) out.push({ kind: 'address', label: 'Location (city, region, country)', value: place });
  return out;
}

async function loadContext(tx: Tx, brandId: string): Promise<GuardrailContext> {
  const rows = await tx.query<{ kind: string; label: string | null; value: string; outcome_promise: boolean }>(
    `select kind::text as kind, label, value, outcome_promise
       from public.brand_facts
      where brand_id = $1 and active
      order by created_at, id`,
    [brandId],
  );
  const [mem] = await tx.query<{
    category: string | null;
    regulated: string | null;
    words_to_avoid: string[] | null;
    business_name: string | null;
    city: string | null;
    region: string | null;
    country: string | null;
  }>(
    `select category, regulated::text as regulated, words_to_avoid, business_name, city, region, country
       from public.brand_memory where brand_id = $1`,
    [brandId],
  );
  const regulated = resolveRegulated(mem?.regulated, mem?.category) as RegulatedKind;
  // A fact that promises an outcome is never used by a regulated brand's posts.
  const facts: WeeklyFact[] = rows.map((r, i) => ({ id: `f${i + 1}`, kind: r.kind, label: r.label ?? '', value: r.value, neverUse: regulated !== 'none' && r.outcome_promise }));
  // The business name and location from setup count as facts too (appended, so stored ids keep their numbers).
  for (const extra of setupFacts(mem)) facts.push({ id: `f${facts.length + 1}`, ...extra, neverUse: false });
  return {
    facts,
    regulated,
    wordsToAvoid: mem?.words_to_avoid ?? [],
  };
}

/**
 * Facts, regulated group and words to avoid of a brand. With `userId` it reads as that
 * user (row-level security applies); without it, as the service role (the cron job).
 */
export async function loadGuardrailContext(brandId: string, userId?: string): Promise<GuardrailContext> {
  const db = getDb();
  return userId ? db.withUser(userId, (tx) => loadContext(tx, brandId)) : db.withService((tx) => loadContext(tx, brandId));
}

/**
 * The facts for the generation prompt, with the ids the fact check uses too, and
 * outcome-promise facts marked NEVER USE for regulated brands. V-10 passes the same
 * list to generation and to runGuardrail (which reloads it; the order is stable).
 */
export async function factsForPrompt(brandId: string, userId?: string): Promise<WeeklyFact[]> {
  return (await loadGuardrailContext(brandId, userId)).facts;
}

export interface GuardrailPostInput extends GuardrailPost {
  /** The stored post's id when it already exists, so it does not count as its own history. */
  id?: string;
}

export interface PostGuardrailResult {
  flags: Flag[];
  /** True when any flag other than the regulated reminder is open. */
  blocking: boolean;
  /** 6+ word phrases repeated from the last 4 weeks or from another post of the batch. */
  repeats: string[];
  /** Channel-limit problems, for the pipeline's retry logic. */
  formatIssues: FormatIssue[];
  /** False when the AI check failed: a "facts not checked" flag is on the post. */
  aiChecked: boolean;
}

const isoDate = (d: Date) => d.toISOString().slice(0, 10);
function addDays(iso: string, days: number): string {
  return isoDate(new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000));
}

export async function runGuardrail(args: {
  userId: string;
  brandId: string;
  posts: GuardrailPostInput[];
  /** Per post (same order): texts the owner confirmed as true. They count as facts. */
  confirmedByPost?: string[][];
  now?: Date;
  /** Monday of the batch (YYYY-MM-DD). Defaults to today. History = batches from 28 days before it. */
  weekStart?: string;
  /** Add `repeat` flags for repeated phrases. Pass false on the first pass if you regenerate on a repeat. Default true. */
  flagRepeats?: boolean;
  /** Compare the posts of this call with each other (a weekly batch). False for one brief's channels, which share wording on purpose. Default true. */
  compareWithinCall?: boolean;
  /** A brief whose own posts are not history (its channels and earlier drafts). */
  excludeBriefId?: string;
  /** The exact facts the posts were generated from (same ids as the prompt). Default: reload them in the same order. */
  facts?: WeeklyFact[];
  /**
   * Per post (same order): the brief's USPs and QR, to run the per-USP rules (C-12). Posts without a
   * brief pass undefined. The brand's active payment addresses are loaded here when not given.
   */
  uspRules?: Array<UspRuleContext | undefined>;
  /** Fixture mode only (tests and offline dev). */
  aiFixture?: V2FactCheck | (() => V2FactCheck);
  /** Time limit for one attempt of the AI check, in ms. Default 25 000. If it runs out, the posts get the "facts not checked" flag. */
  aiTimeoutMs?: number;
  /** Time limit for the whole AI check with retries, in ms. Default 40 000. */
  aiBudgetMs?: number;
  /** Called with the cost (USD) of the AI check once it has answered, so the caller can add it to a batch. */
  onAiUsd?: (usd: number) => void;
}): Promise<PostGuardrailResult[]> {
  const now = args.now ?? new Date();
  if (args.posts.length === 0) return [];
  const ref = args.weekStart ?? isoDate(now);

  const { ctx, history, paymentAddresses } = await getDb().withUser(args.userId, async (tx) => {
    const ctx = await loadContext(tx, args.brandId);
    const paymentAddresses = args.uspRules?.some(Boolean)
      ? (await tx.query<{ address: string }>("select address from public.payment_ids where brand_id = $1 and status = 'active'", [args.brandId])).map((r) => r.address)
      : [];
    if (args.facts) ctx.facts = args.facts;
    const own = new Set(args.posts.map((p) => p.id).filter((x): x is string => Boolean(x)));
    // History: weekly posts (by their week) and posts made from a brief on /create (by the day they
    // were made), from the last 28 days. A brief's own posts (its other channels, earlier drafts) are
    // never history for that brief.
    const rows = await tx.query<{ id: string; caption: string; week_start: string }>(
      `select p.id::text as id, p.caption, b.week_start::text as week_start
         from public.posts p
         join public.weekly_batches b on b.id = p.batch_id and b.brand_id = p.brand_id
        where p.brand_id = $1 and p.caption is not null and p.status <> 'skipped'
          and b.week_start >= $2::date and b.week_start <= $3::date
       union all
       select p.id::text, p.caption, (p.created_at at time zone 'UTC')::date::text
         from public.posts p
        where p.brand_id = $1 and p.batch_id is null and p.brief_id is not null
          and p.caption is not null and p.status <> 'skipped' and p.slide_index is null
          -- the brief itself, and the other days of the same weekly plan (they are meant to share their wording)
          and ($4::uuid is null or (p.brief_id <> $4::uuid and p.brief_id not in (
                select o.id from public.post_briefs o join public.post_briefs me on me.id = $4::uuid
                 where me.plan_id is not null and o.plan_id = me.plan_id)))
          -- UTC days on both sides (ref is a UTC date), whatever the database session's time zone is
          and (p.created_at at time zone 'UTC')::date >= $2::date and (p.created_at at time zone 'UTC')::date <= $3::date`,
      [args.brandId, addDays(ref, -HISTORY_DAYS), ref, args.excludeBriefId ?? null],
    );
    const history: HistoryCaption[] = rows.filter((r) => !own.has(r.id)).map((r) => ({ caption: r.caption, weekStart: r.week_start }));
    return { ctx, history, paymentAddresses };
  });

  const regulated = ctx.regulated !== 'none';
  const confirmedFor = (i: number) => args.confirmedByPost?.[i] ?? [];

  // Layer 1: code (also the repetition and format checks).
  const det = args.posts.map((post, i) =>
    checkPostDeterministic({ post, facts: ctx.facts, regulated: ctx.regulated, wordsToAvoid: ctx.wordsToAvoid, confirmed: confirmedFor(i) }),
  );
  const repeats = args.posts.map((post, i) =>
    findRepeats({
      candidate: post.caption,
      history,
      batchOthers: args.compareWithinCall === false ? [] : args.posts.filter((_, k) => k !== i).map((p) => p.caption),
      facts: ctx.facts,
      weekStart: ref,
    }),
  );

  // Layer 2: AI, once for the whole batch. If it fails, say so; never pass silently.
  let statements: AiStatement[] = [];
  let aiOk = true;
  try {
    const checkPosts: V2CheckPost[] = args.posts.map((p, i) => ({ index: i + 1, caption: p.caption, cta: p.cta, image_text: p.image_text }));
    const res = await checkPostsAi({
      facts: ctx.facts,
      confirmed: [...new Set(args.posts.flatMap((_, i) => confirmedFor(i)))],
      posts: checkPosts,
      usage: { brandId: args.brandId, userId: args.userId },
      fixture: args.aiFixture,
      aiTimeoutMs: args.aiTimeoutMs,
      aiBudgetMs: args.aiBudgetMs,
      onUsd: args.onAiUsd,
      now,
    });
    statements = res.statements;
  } catch (e) {
    aiOk = false;
    console.error(`[guardrail] AI fact check failed for brand ${args.brandId}: ${e instanceof Error ? e.message : String(e)}`);
  }

  return args.posts.map((post, i) => {
    const flags = mergeFlags({
      post,
      det: det[i].issues,
      ai: statements.filter((s) => s.post === i + 1),
      brandRegulated: regulated,
      confirmed: confirmedFor(i),
      now,
    });
    const rules = args.uspRules?.[i];
    if (rules) {
      const have = new Set(flags.map((f) => f.id));
      const extra = checkUspRules({
        ...rules,
        activePaymentAddresses: rules.activePaymentAddresses ?? paymentAddresses,
        post,
        regulated: ctx.regulated,
        now,
      });
      for (const f of extra) if (!have.has(f.id)) flags.push(f);
    }
    if (args.flagRepeats !== false) {
      for (const phrase of repeats[i]) {
        flags.push({ id: flagId('caption', 'repeat', phrase), text: phrase, kind: 'repeat', field: 'caption', layer: 'code', regulated: false, highlight: post.caption.includes(phrase), status: 'open', decided_at: null });
      }
    }
    if (!aiOk) {
      flags.push({ id: flagId('caption', 'claim', AI_UNCHECKED_TEXT), text: AI_UNCHECKED_TEXT, kind: 'claim', field: 'caption', layer: 'code', regulated: false, highlight: false, status: 'open', decided_at: null });
    }
    if (regulated) {
      flags.push({ id: flagId('caption', 'regulated_reminder', REGULATED_REMINDER_TEXT), text: REGULATED_REMINDER_TEXT, kind: 'regulated_reminder', field: 'caption', layer: 'code', regulated: true, highlight: false, status: 'open', decided_at: null });
    }
    return {
      flags,
      blocking: flags.some((f) => f.status === 'open' && f.kind !== 'regulated_reminder'),
      repeats: repeats[i],
      formatIssues: det[i].formatIssues,
      aiChecked: aiOk,
    };
  });
}
