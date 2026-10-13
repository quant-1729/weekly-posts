// Rewrite one post with the owner's short instruction (Req 15, AC 15: under 15 seconds).
//
//   cap checks (daily, weekly) -> rewrite prompt (10 s per try, 14 s in all) -> tidy to the channel
//   limits -> guardrail for this post + redraw the images (at the same time) -> save, with the
//   instruction in voice_feedback
//
// The guardrail's AI check is given the time that is left of the 15 s (minus a small margin, at
// least 1 s). If it does not answer in time the guardrail itself gives the post the "facts not
// checked" flag (never passes silently) plus the code-only flags, and the owner has to confirm or
// remove it. The cost of the rewrite and of its fact check is added to the post's weekly batch.

import { V2_CHANNEL_SPECS, buildRewritePrompt } from '@/lib/ai/prompts/v2-weekly';
import { generateJson } from '@/lib/ai/client';
import { rewriteJsonSchema, rewriteSchema, type Rewrite, type V2FactCheck } from '@/lib/ai/schemas-v2';
import { getDb } from '@/lib/db';
import { hasBlockingFlags, loadGuardrailContext, runGuardrail, type GuardrailPostInput } from '@/lib/guardrail';
import { s } from '@/lib/i18n/strings';
import { DailyCapError, assertUnderDailyCap, failedCallUsd, recordUsage } from '@/lib/usage';
import { WeeklyCapError, assertUnderWeeklyCap } from '@/lib/usage/caps';
import { fixtureFactCheck } from '@/lib/weekly/fixtures';
import { fitHashtags, fitImageText, trimAtWord, trimCaption } from '@/lib/weekly/normalize';
import { commitChange } from './commit';
import { begin, brandMemberFor, fail, renderPost, storageOf } from './data';
import { fixtureRewriteFor, type PostCopy } from './fixtures';
import { cleanText } from './parse';
import type { OpDeps, OpResult, PostRecord, PostRef } from './types';

const e = s.approvals.errors;

export const REWRITE_LIMITS = { instructionMin: 3, instructionMax: 200, timeoutMs: 10_000, budgetMs: 14_000, totalMs: 15_000 } as const;
/** Kept back from the 15 s for saving, and the least time the guardrail's AI check is ever given. */
const MARGIN_MS = 500;
const MIN_AI_MS = 1000;
const MAX_CTA_CHARS = 45;

export interface RewriteDeps extends OpDeps {
  /** Replace the fixture-mode answers (used only when the model is not live). May throw to simulate a failed call. */
  fixtures?: {
    rewrite?: (post: PostCopy, instruction: string) => Rewrite;
    factCheck?: (posts: GuardrailPostInput[]) => V2FactCheck;
  };
  /** Test hook: replaces runGuardrail. */
  guardrail?: typeof runGuardrail;
  /** Test hook: the time the whole operation aims to stay under. Default 15 000 ms. */
  totalMs?: number;
}

export interface RewriteOk {
  /** A fact the model could not add (it is not in brand memory); show it to the owner. '' when none. */
  note: string;
  /** True when the new version has a flag that must be confirmed or removed first. */
  blocking: boolean;
  /** The guardrail's AI check did not answer in time, so the post carries the "facts not checked" flag. */
  guardrailTimedOut: boolean;
  /** The post was approved before; it needs approving again. */
  reapprove: boolean;
  timings: { aiMs: number; guardrailMs: number; renderMs: number; totalMs: number };
}

interface Memory {
  voice: string;
  name: string;
  city: string;
  region: string;
}

async function loadMemory(brandId: string): Promise<Memory> {
  const [row] = await getDb().withService((tx) =>
    tx.query<{ voice: string | null; tone: string | null; name: string; city: string | null; region: string | null }>(
      `select m.voice_description as voice, m.tone, coalesce(nullif(trim(m.business_name), ''), b.name) as name, m.city, m.region
         from public.brands b left join public.brand_memory m on m.brand_id = b.id where b.id = $1`,
      [brandId],
    ),
  );
  return { voice: (row?.voice ?? '').trim() || (row?.tone ?? '').trim(), name: row?.name ?? '', city: row?.city ?? '', region: row?.region ?? '' };
}

/** Adds a cost to the weekly batch of the post that was rewritten, so the batch shows the whole cost of its posts. */
async function addToBatchUsd(brandId: string, batchId: string, usd: number): Promise<void> {
  if (!(usd > 0)) return;
  await getDb().withService((tx) =>
    tx.query('update public.weekly_batches set usd = usd + $3 where id = $1 and brand_id = $2', [batchId, brandId, usd]),
  );
}

export async function rewritePost(ref: PostRef & { instruction: string }, deps: RewriteDeps = {}): Promise<OpResult<RewriteOk>> {
  const t0 = Date.now();
  const total = deps.totalMs ?? REWRITE_LIMITS.totalMs;
  const instruction = cleanText(ref.instruction).replace(/\s+/g, ' ');
  const length = Array.from(instruction).length;
  if (length < REWRITE_LIMITS.instructionMin || length > REWRITE_LIMITS.instructionMax) {
    return fail('invalid', e.instructionLength, { errors: [e.instructionLength] });
  }

  const started = await begin(ref);
  if ('fail' in started) return started.fail;
  const post: PostRecord = started.post;
  if (post.status === 'posted') return fail('posted', e.posted);
  const now = deps.now ?? new Date();

  try {
    await assertUnderDailyCap(ref.brandId, now);
  } catch (err) {
    if (err instanceof DailyCapError) return fail('cap', e.cap);
    throw err;
  }
  try {
    await assertUnderWeeklyCap(ref.brandId, 'rewrite', { now });
  } catch (err) {
    if (err instanceof WeeklyCapError) return fail('cap', err.message);
    throw err;
  }

  const [ctx, memory] = await Promise.all([loadGuardrailContext(ref.brandId), loadMemory(ref.brandId)]);
  const spec = V2_CHANNEL_SPECS[post.channel];
  const current: PostCopy = { caption: post.caption, cta: post.cta, hashtags: post.hashtags, image_text: post.imageText };
  const prompt = buildRewritePrompt({
    channel: post.channel,
    postLanguage: post.postLanguage,
    voiceDescription: memory.voice,
    wordsToAvoid: ctx.wordsToAvoid,
    facts: ctx.facts,
    post: current,
    instruction,
  });

  // --- the rewrite --------------------------------------------------------------------------
  const tAi = Date.now();
  const actorUser = ref.actor.via === 'dashboard' ? ref.actor.userId : null;
  let generated;
  try {
    generated = await generateJson({
      system: prompt.system,
      user: prompt.user,
      zodSchema: rewriteSchema,
      jsonSchema: rewriteJsonSchema,
      temperature: 0.7,
      timeoutMs: REWRITE_LIMITS.timeoutMs,
      budgetMs: REWRITE_LIMITS.budgetMs,
      logContext: { brandId: ref.brandId },
      fixture: () => (deps.fixtures?.rewrite ?? fixtureRewriteFor)(current, instruction),
    });
  } catch (err) {
    console.warn(`[approvals] rewrite failed for post ${ref.postId}: ${err instanceof Error ? err.message : String(err)}`);
    // An answer that did not validate still cost money (h-2).
    const lost = failedCallUsd(err);
    if (lost > 0) {
      await recordUsage(ref.brandId, actorUser, 'rewrite', lost);
      await addToBatchUsd(ref.brandId, post.batchId, lost);
    }
    return fail('ai_failed', e.aiFailed);
  }
  const aiMs = Date.now() - tAi;
  const rewriteUsd = generated.stats?.usd ?? 0;
  await recordUsage(ref.brandId, actorUser, 'rewrite', rewriteUsd);
  await addToBatchUsd(ref.brandId, post.batchId, rewriteUsd);

  // --- tidy to the channel limits -----------------------------------------------------------
  const r = generated.data;
  const brand = { name: memory.name, city: memory.city, region: memory.region };
  const next = {
    caption: trimCaption(r.caption, spec.captionMaxChars),
    cta: trimAtWord(r.cta.replace(/\s+/g, ' '), MAX_CTA_CHARS) || post.cta,
    hashtags: fitHashtags(r.hashtags.length ? r.hashtags : post.hashtags, post.channel, brand),
    imageText: fitImageText(r.image_text),
  };

  // --- guardrail for this one post, and the new images, at the same time ----------------------
  const confirmed = post.flags.filter((f) => f.status === 'confirmed').map((f) => f.text);
  const guarded: GuardrailPostInput = {
    id: post.id,
    channel: post.channel,
    caption: next.caption,
    cta: next.cta,
    hashtags: next.hashtags,
    // The mascot's words are not rewritten, but they are still checked (their flags must survive the new check).
    image_text: { ...next.imageText, bubble: post.imageText.bubble },
  };
  const storage = storageOf(deps);
  const guardUser = actorUser ?? (await brandMemberFor(ref.brandId));
  const check = deps.guardrail ?? runGuardrail;
  // The AI check gets what is left of the 15 s. If it fails or runs out of time, runGuardrail gives
  // the post the "facts not checked" flag and the code-only flags (result.aiChecked is false).
  const aiLeftMs = Math.max(MIN_AI_MS, total - (Date.now() - t0) - MARGIN_MS);
  let factCheckUsd = 0;

  const tG = Date.now();
  const guardrailRun = check({
    userId: guardUser,
    brandId: ref.brandId,
    posts: [guarded],
    confirmedByPost: [confirmed],
    now,
    weekStart: post.weekStart,
    flagRepeats: true,
    facts: ctx.facts,
    aiFixture: () => (deps.fixtures?.factCheck ?? fixtureFactCheck)([guarded]),
    aiTimeoutMs: aiLeftMs,
    aiBudgetMs: aiLeftMs,
    onAiUsd: (usd) => {
      factCheckUsd += usd;
    },
  }).then((res) => ({ flags: res[0].flags, timedOut: !res[0].aiChecked, ms: Date.now() - tG }));
  const tR = Date.now();
  const renderRun = renderPost({ storage, post, photoId: post.photoId, cta: next.cta, imageText: next.imageText }).then((images) => ({
    images,
    ms: Date.now() - tR,
  }));
  const [guard, rendered] = await Promise.all([guardrailRun, renderRun]);
  await addToBatchUsd(ref.brandId, post.batchId, factCheckUsd);

  // --- save: the new copy (the original stays as it was) and the instruction as voice feedback --
  const saved = await commitChange({
    ref,
    deps,
    storage,
    patch: { caption: next.caption, cta: next.cta, hashtags: next.hashtags, imageText: next.imageText, flags: guard.flags },
    images: rendered.images,
    action: 'rewrite',
    detail: { instruction, guardrail_timed_out: guard.timedOut || undefined },
    also: async (tx) => {
      await tx.query('insert into public.voice_feedback (brand_id, post_id, instruction) values ($1, $2, $3)', [ref.brandId, ref.postId, instruction]);
    },
  });
  if (!saved.ok) return saved;
  const timings = { aiMs, guardrailMs: guard.ms, renderMs: rendered.ms, totalMs: Date.now() - t0 };
  console.info(`[approvals] rewrite post=${ref.postId} ${JSON.stringify({ ...timings, usd: rewriteUsd + factCheckUsd, timedOut: guard.timedOut })}`);
  return {
    ok: true,
    post: saved.post,
    note: r.note.trim(),
    blocking: hasBlockingFlags(guard.flags),
    guardrailTimedOut: guard.timedOut,
    reapprove: saved.reapprove,
    timings,
  };
}
