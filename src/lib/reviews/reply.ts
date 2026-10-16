// Review replies (Req 26, stretch; AC 26: a reply within 10 seconds, in the owner's voice, with no
// facts outside brand memory).
//
//   length check -> member check -> caps (daily, weekly) -> prompt with the brand's facts and voice
//   (7 s per try, 9 s in all) -> usage event -> the guardrail's code layer on the reply (no second
//   AI call, so the whole thing stays under 10 s)
//
// The owner copies the reply by hand, so flags never block: they are shown as "Please check".
// The review text is not stored anywhere; the only thing written is the usage event.

import { AiError, generateJson } from '@/lib/ai/client';
import { buildReviewReplyPrompt } from '@/lib/ai/prompts/v2-review-reply';
import { reviewReplyJsonSchema, reviewReplySchema, type ReviewReply } from '@/lib/ai/schemas-v2';
import { BrandAccessError } from '@/lib/brand/current';
import { getDb } from '@/lib/db';
import { checkPostDeterministic, loadGuardrailContext, type FlagKind } from '@/lib/guardrail';
import { POST_LANGUAGE_CODES } from '@/lib/setup/languages';
import { assertUnderDailyCap, failedCallModel, failedCallUsd, recordUsage } from '@/lib/usage';
import { assertUnderWeeklyCap } from '@/lib/usage/caps';
import { reviewReplyFixture } from './fixtures';

export const REVIEW_LIMITS = { min: 10, max: 3000, timeoutMs: 7000, budgetMs: 9000, temperature: 0.5 } as const;

/** The review is too short or too long, or the reply language is not one we offer. */
export class ReviewReplyInputError extends Error {
  constructor(
    public readonly code: 'too_short' | 'too_long' | 'bad_language',
    message: string,
  ) {
    super(message);
    this.name = 'ReviewReplyInputError';
  }
}

/** The model did not give a usable reply. Nothing was recorded or stored. */
export class ReviewReplyAiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReviewReplyAiError';
  }
}

export interface ReviewReplyFlag {
  /** The exact text in the reply that needs checking. */
  text: string;
  kind: FlagKind;
}

export interface ReviewReplyResult {
  reply: string;
  sentiment: ReviewReply['sentiment'];
  needsAttention: boolean;
  attentionReason: string;
  /** "Please check" items found by the code layer of the guardrail. They never block. */
  flags: ReviewReplyFlag[];
  timings: { loadMs: number; aiMs: number; guardrailMs: number; totalMs: number };
}

export interface DraftReviewReplyDeps {
  now?: Date;
  /** Replaces the fixture-mode answer (used only when the model is not live). */
  fixture?: (review: string) => ReviewReply;
}

interface Memory {
  voice: string;
  name: string;
}

/** Throws BrandAccessError unless the user is a member of the brand. Row-level security applies. */
async function loadMemory(userId: string, brandId: string): Promise<Memory> {
  return getDb().withUser(userId, async (tx) => {
    const [m] = await tx.query<{ ok: boolean }>('select public.is_brand_member($1::uuid) as ok', [brandId]);
    if (!m?.ok) throw new BrandAccessError();
    const [row] = await tx.query<{ voice: string | null; tone: string | null; name: string | null }>(
      `select m.voice_description as voice, m.tone, coalesce(nullif(trim(m.business_name), ''), b.name) as name
         from public.brands b left join public.brand_memory m on m.brand_id = b.id where b.id = $1`,
      [brandId],
    );
    return { voice: (row?.voice ?? '').trim() || (row?.tone ?? '').trim(), name: row?.name ?? '' };
  });
}

/** Trims, drops control characters (keeps line breaks), and checks the 10-3000 character limits. */
export function cleanReview(raw: string): string {
  const text = String(raw ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\r\n?/g, '\n')
    .trim();
  const length = Array.from(text).length;
  if (length < REVIEW_LIMITS.min) throw new ReviewReplyInputError('too_short', `A review needs at least ${REVIEW_LIMITS.min} characters`);
  if (length > REVIEW_LIMITS.max) throw new ReviewReplyInputError('too_long', `A review can have at most ${REVIEW_LIMITS.max} characters`);
  return text;
}

const L = String.raw`[\p{L}\p{M}\p{N}]`;
// Whole words and phrases a review reply must not promise on its own. "free" is skipped in "feel free to",
// "free of", "free from" and in words like "gluten-free"; "% off" takes its number with it ("10% off").
const PROMISE_RE = new RegExp(
  [
    String.raw`(?<!${L})(?:refund(?:s|ed|ing)?|money back|compensation|compensate[sd]?|vouchers?|gift cards?|discount(?:s|ed)?|complimentary|on the house)(?!${L})`,
    String.raw`(?<!${L})replace your order(?!${L})`,
    String.raw`(?<!${L})we(?: will|['’]ll) pay(?!${L})`,
    String.raw`(?<!${L}|-)(?<!feel )free(?!${L}|-)(?! to\b| of\b| from\b)`,
    String.raw`(?:(?<!${L})\d+(?:[.,]\d+)?\s*)?%\s*off(?!${L})`,
  ].join('|'),
  'giu',
);

const squash = (s: string) => s.toLowerCase().replace(/’/g, "'").replace(/\s+/g, ' ').trim();

/** Promise-like spans in a reply that no active fact contains. */
export function findPromises(reply: string, facts: Array<{ value: string; neverUse?: boolean }>): string[] {
  const values = facts.filter((f) => !f.neverUse).map((f) => squash(f.value));
  const out: string[] = [];
  for (const m of reply.matchAll(PROMISE_RE)) {
    const span = m[0].replace(/\s+/g, ' ').trim();
    if (values.some((v) => v.includes(squash(span)))) continue; // the owner's own fact says it
    if (!out.some((o) => o.toLowerCase() === span.toLowerCase())) out.push(span);
  }
  return out;
}

export async function draftReviewReply(
  args: { userId: string; brandId: string; review: string; replyLanguage?: string },
  deps: DraftReviewReplyDeps = {},
): Promise<ReviewReplyResult> {
  const t0 = Date.now();
  const now = deps.now ?? new Date();
  const review = cleanReview(args.review);
  const replyLanguage = (args.replyLanguage ?? '').trim();
  if (replyLanguage && !POST_LANGUAGE_CODES.includes(replyLanguage)) {
    throw new ReviewReplyInputError('bad_language', 'That reply language is not available');
  }

  const memory = await loadMemory(args.userId, args.brandId); // members only
  await assertUnderDailyCap(args.brandId, now);
  await assertUnderWeeklyCap(args.brandId, 'review_reply', { now });
  const ctx = await loadGuardrailContext(args.brandId, args.userId);
  const loadMs = Date.now() - t0;

  const prompt = buildReviewReplyPrompt({
    businessName: memory.name,
    voiceDescription: memory.voice,
    wordsToAvoid: ctx.wordsToAvoid,
    facts: ctx.facts,
    review,
    replyLanguage,
  });

  const tAi = Date.now();
  let generated;
  try {
    generated = await generateJson({
      system: prompt.system,
      user: prompt.user,
      zodSchema: reviewReplySchema,
      jsonSchema: reviewReplyJsonSchema,
      temperature: REVIEW_LIMITS.temperature,
      timeoutMs: REVIEW_LIMITS.timeoutMs,
      budgetMs: REVIEW_LIMITS.budgetMs,
      logContext: { brandId: args.brandId },
      fixture: () => (deps.fixture ?? reviewReplyFixture)(review),
    });
  } catch (err) {
    const lost = failedCallUsd(err); // an answer that did not validate still cost money (H-2)
    if (lost > 0) await recordUsage(args.brandId, args.userId, 'review_reply', lost, { ok: false, model: failedCallModel(err) }).catch(() => undefined);
    // Ids and the error type only in the log: a message could echo the review or the reply.
    console.warn(`[reviews] reply failed for brand ${args.brandId}: ${err instanceof AiError ? err.code : err instanceof Error ? err.name : 'error'}`);
    throw new ReviewReplyAiError('The AI did not give a reply');
  }
  const aiMs = Date.now() - tAi;
  await recordUsage(args.brandId, args.userId, 'review_reply', generated.stats?.usd ?? 0, { model: generated.stats?.model });

  // The guardrail's code layer only: numbers, contact details, risky phrases and words to avoid,
  // against the brand's facts. No second AI call.
  const tG = Date.now();
  const data = generated.data;
  const reply = data.reply.trim();
  const det = checkPostDeterministic({
    post: { channel: 'gbp', caption: reply, cta: '', hashtags: [], image_text: { headline: '', subline: '' } },
    facts: ctx.facts,
    regulated: ctx.regulated,
    wordsToAvoid: ctx.wordsToAvoid,
  });
  const seen = new Set<string>();
  const flags: ReviewReplyFlag[] = [];
  for (const i of det.issues) {
    const key = `${i.kind}:${i.text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    flags.push({ text: i.text, kind: i.kind });
  }
  // Review-specific check: a reply must not promise compensation or a freebie unless a fact says so.
  for (const span of findPromises(reply, ctx.facts)) {
    const lower = span.toLowerCase();
    if (flags.some((f) => f.kind === 'offer' && f.text.toLowerCase().includes(lower))) continue; // already flagged
    flags.push({ text: span, kind: 'offer' });
  }
  const guardrailMs = Date.now() - tG;

  const timings = { loadMs, aiMs, guardrailMs, totalMs: Date.now() - t0 };
  console.info(`[reviews] reply brand=${args.brandId} ${JSON.stringify({ ...timings, flags: flags.length, needsAttention: data.needs_attention })}`);
  return {
    reply,
    sentiment: data.sentiment,
    needsAttention: data.needs_attention,
    attentionReason: data.attention_reason.trim(),
    flags,
    timings,
  };
}
