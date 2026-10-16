// Weekly generation (Req 7-13): one LLM call for 3-5 posts, cleaned in code, checked by the
// guardrail, rendered in three formats and saved in one transaction.
//
//   claim batch -> inputs -> daily cap -> LLM (retry once) -> normalise -> guardrail pass 1
//   -> one rewrite for posts that repeat or use avoided words -> guardrail pass 2 (those posts)
//   -> render 3 formats per post -> save posts, images and `ready` in one transaction
//
// A failed run leaves no posts: the batch is marked `failed` (or put back to `ready` when it was
// a regeneration, so the owner keeps their drafts) and the email step (V-15) sends the late notice.

import { randomInt, randomUUID } from 'node:crypto';
import { generateJson } from '@/lib/ai/client';
import {
  V2_CHANNELS,
  V2_CHANNEL_SPECS,
  buildRewritePrompt,
  buildWeeklyPrompt,
  type V2Channel,
} from '@/lib/ai/prompts/v2-weekly';
import { rewriteJsonSchema, rewriteSchema, weeklyBatchJsonSchema, weeklyBatchSchema, type Rewrite, type V2FactCheck, type WeeklyBatch } from '@/lib/ai/schemas-v2';
import { BrandAccessError, requireBrandMember } from '@/lib/brand/current';
import { getDb } from '@/lib/db';
import { sendLateNotice, sendWeeklyEmail } from '@/lib/email/weekly';
import { runGuardrail, type Flag, type GuardrailPostInput, type PostGuardrailResult } from '@/lib/guardrail';
import { addDaysIso, isValidIsoDate, weekDays } from '@/lib/occasions/dates';
import type { Format } from '@/lib/render';
import { getStorage, type Storage } from '@/lib/storage';
import { DailyCapError, assertUnderDailyCap, failedCallModel, failedCallUsd, recordUsage, type UsageMeta } from '@/lib/usage';
import { WeeklyCapError, assertUnderWeeklyCap } from '@/lib/usage/caps';
import { fixtureFactCheck, fixtureRewrite, fixtureWeeklyBatch, type FixtureContext } from './fixtures';
import { mascotForRender } from '@/lib/mascot/posts';
import { loadWeekInputs, type WeekInputs } from './inputs';
import {
  MAX_CRON_ATTEMPTS,
  BATCH_STATE_COLUMNS,
  MAX_REGENERATIONS,
  RETRY_WINDOW_MS,
  STALE_GENERATING_MS,
  errorColumn,
  readBatchState,
  toDate,
  type BatchState,
} from './meta';
import { fitHashtags, fitImageText, normalizePosts, trimCaption, type NormalizedPost } from './normalize';
import { loadLogoFile, loadPhotoFile, renderAndStore, resolveBrandColors } from './render-post';
import { isoWeekday } from './schedule';

export type Trigger = 'cron' | 'button';

export interface GenerateArgs {
  brandId: string;
  /** Monday (local) of the week the posts are for, "YYYY-MM-DD". */
  weekStart: string;
  trigger: Trigger;
  /** Required for the button: must be a member of the brand. The cron may omit it. */
  userId?: string;
}

type PostCopy = { caption: string; cta: string; hashtags: string[]; image_text: { headline: string; subline: string } };

/** Test and dev hooks. Production code passes none. */
export interface GenerateDeps {
  now?: Date;
  storage?: Storage;
  /** Replace the fixture-mode answers (used only when the model is not live). May throw to simulate a failed call. */
  fixtures?: {
    weekly?: (ctx: FixtureContext) => WeeklyBatch;
    rewrite?: (post: PostCopy, remove: { phrases: string[]; words: string[] }) => Rewrite;
    factCheck?: (posts: GuardrailPostInput[]) => V2FactCheck;
  };
}

export interface GeneratedPost {
  id: string;
  postCode: string;
  suggestedDay: string;
  channel: V2Channel;
  postLanguage: string;
  caption: string;
  cta: string;
  hashtags: string[];
  /** The channel allows a clickable link, so the short link goes with this post (V-18). */
  link: boolean;
  imageText: { headline: string; subline: string };
  occasion: string | null;
  photoId: string | null;
  /** The mascot drawn on the square and vertical images, or null (off, or a sensitive occasion). */
  mascotId: string | null;
  flags: Flag[];
  images: Array<{ format: Format; templateId: string; path: string }>;
}

export interface Timings {
  aiMs: number;
  guardrailMs: number;
  renderMs: number;
  totalMs: number;
}

export type SkipReason = 'already_ready' | 'busy' | 'has_approved' | 'limit_reached' | 'retry_limit' | 'too_old';

export type GenerateResult =
  | { status: 'ready'; batchId: string; posts: GeneratedPost[]; timings: Timings; usd: number; rewrites: number }
  | {
      status: 'failed';
      batchId: string;
      error: string;
      /** True when the previous drafts were kept (a failed regeneration). */
      keptPrevious: boolean;
      usd: number;
    }
  | { status: 'skipped'; reason: SkipReason; batchId: string | null };

export type StartResult =
  | { started: true; batchId: string; run: () => Promise<GenerateResult> }
  | { started: false; reason: SkipReason; batchId: string | null };

const LLM = { temperature: 0.8, timeoutMs: 45_000, budgetMs: 70_000 } as const;
const REWRITE = { timeoutMs: 15_000, budgetMs: 20_000 } as const;
const POST_COUNT = 4;

// ---------------------------------------------------------------------------
// Claiming the batch row
// ---------------------------------------------------------------------------

type Previous = 'new' | 'failed' | 'ready';
type Claimed = { ok: true; batchId: string; previous: Previous; meta: BatchState; priorUsd: number };
type Claim = Claimed | { ok: false; reason: SkipReason; batchId: string | null };

async function claimBatch(args: GenerateArgs, now: Date): Promise<Claim> {
  return getDb().withService(async (tx): Promise<Claim> => {
    const claimedAt = now.toISOString();
    const fresh: BatchState = { attempts: 1, regens: 0, claimedAt, message: '' };
    const inserted = await tx.query<{ id: string }>(
      `insert into public.weekly_batches (brand_id, week_start, status, trigger, error, attempts, regens, claimed_at, created_at)
       values ($1, $2::date, 'generating', $3, null, $4, $5, $6::timestamptz, $6::timestamptz)
       on conflict (brand_id, week_start) do nothing
       returning id::text as id`,
      [args.brandId, args.weekStart, args.trigger, fresh.attempts, fresh.regens, claimedAt],
    );
    if (inserted[0]) return { ok: true, batchId: inserted[0].id, previous: 'new', meta: fresh, priorUsd: 0 };

    // The row exists. Lock it, so two runs cannot both take it.
    const [row] = await tx.query<{
      id: string;
      status: string;
      error: string | null;
      attempts: number;
      regens: number;
      claimed_at: Date | string | null;
      created_at: Date | string;
      usd: string | number;
    }>(
      `select id::text as id, status::text as status, ${BATCH_STATE_COLUMNS}, created_at, usd
         from public.weekly_batches where brand_id = $1 and week_start = $2::date for update`,
      [args.brandId, args.weekStart],
    );
    if (!row) throw new Error('Batch disappeared while claiming');
    const meta = readBatchState(row); // reads an old JSON `error` once; the update below writes the columns
    const button = args.trigger === 'button';
    let previous: Previous = 'failed';
    let regens = meta.regens;

    if (row.status === 'generating') {
      const since = meta.claimedAt ? new Date(meta.claimedAt) : toDate(row.created_at);
      if (now.getTime() - since.getTime() <= STALE_GENERATING_MS) return { ok: false, reason: 'busy', batchId: row.id };
      if (!button && meta.attempts >= MAX_CRON_ATTEMPTS) return { ok: false, reason: 'retry_limit', batchId: row.id };
    } else if (row.status === 'failed') {
      if (!button) {
        if (Math.max(1, meta.attempts) >= MAX_CRON_ATTEMPTS) return { ok: false, reason: 'retry_limit', batchId: row.id };
        if (now.getTime() - toDate(row.created_at).getTime() >= RETRY_WINDOW_MS) return { ok: false, reason: 'too_old', batchId: row.id };
      }
    } else {
      // ready
      if (!button) return { ok: false, reason: 'already_ready', batchId: row.id };
      const [approved] = await tx.query<{ n: number }>(
        `select count(*)::int as n from public.posts where batch_id = $1 and status in ('approved', 'posted')`,
        [row.id],
      );
      if ((approved?.n ?? 0) > 0) return { ok: false, reason: 'has_approved', batchId: row.id };
      if (meta.regens >= MAX_REGENERATIONS) return { ok: false, reason: 'limit_reached', batchId: row.id };
      previous = 'ready';
      regens += 1;
    }

    const next: BatchState = { attempts: Math.max(meta.attempts, row.status === 'failed' ? 1 : 0) + 1, regens, claimedAt, message: '' };
    await tx.query(
      `update public.weekly_batches
          set status = 'generating', trigger = $2, error = null, attempts = $3, regens = $4, claimed_at = $5::timestamptz
        where id = $1`,
      [row.id, args.trigger, next.attempts, next.regens, claimedAt],
    );
    return { ok: true, batchId: row.id, previous, meta: next, priorUsd: Number(row.usd) || 0 };
  });
}

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

/**
 * Claims the week's batch and returns a function that does the work. Use this when the work
 * must continue after a response is sent (the button); `generateWeek` is claim plus run.
 * The button path checks membership first (BrandAccessError), then works as the service role.
 */
export async function startGeneration(args: GenerateArgs, deps: GenerateDeps = {}): Promise<StartResult> {
  if (!isValidIsoDate(args.weekStart) || isoWeekday(args.weekStart) !== 1) throw new Error(`Week start must be a Monday: ${args.weekStart}`);
  if (args.trigger === 'button') {
    if (!args.userId) throw new BrandAccessError();
    await requireBrandMember(args.userId, args.brandId);
  }
  const now = deps.now ?? new Date();
  const claim = await claimBatch(args, now);
  if (!claim.ok) {
    console.info(`[weekly] skipped brand ${args.brandId} week ${args.weekStart}: ${claim.reason}`);
    if (claim.reason === 'retry_limit' && claim.batchId) await emailLate(claim.batchId); // V-15
    return { started: false, reason: claim.reason, batchId: claim.batchId };
  }
  return { started: true, batchId: claim.batchId, run: () => runClaimed(args, claim, deps, now) };
}

export async function generateWeek(args: GenerateArgs, deps: GenerateDeps = {}): Promise<GenerateResult> {
  const started = await startGeneration(args, deps);
  if (!started.started) return { status: 'skipped', reason: started.reason, batchId: started.batchId };
  return started.run();
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

class SaveConflict extends Error {}

/** True when the batch row still carries this run's claim (same attempt number and start time). */
function ownsClaim(state: BatchState, claim: Claimed): boolean {
  return state.attempts === claim.meta.attempts && state.claimedAt === claim.meta.claimedAt;
}

const unique = <T>(xs: T[]) => [...new Set(xs)];
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const toGuard = (p: NormalizedPost): GuardrailPostInput => ({
  channel: p.channel,
  caption: p.caption,
  cta: p.cta,
  hashtags: p.hashtags,
  // The mascot's bubble is checked like every other piece of text on the image (V-25).
  image_text: { ...p.imageText, bubble: p.bubble },
});

/** The image text as stored on the post: bubble and pose only for brands that use their mascot. */
const storedImageText = (p: NormalizedPost, withMascot: boolean) =>
  withMascot ? { ...p.imageText, bubble: p.bubble, pose: p.pose } : p.imageText;

function newPostCode(): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length: 7 }, () => alphabet[randomInt(alphabet.length)]).join('');
}

function rewriteInstruction(phrases: string[], words: string[]): string {
  let s = 'Rephrase to avoid';
  if (phrases.length) s += ` these phrases: ${phrases.map((p) => `"${clip(p, 70)}"`).join('; ')}`;
  if (words.length) s += `${phrases.length ? ' / ' : ' '}these words: ${words.join(', ')}`;
  return s;
}

async function dbClock(): Promise<string> {
  const [r] = await getDb().withService((tx) => tx.query<{ t: Date | string }>('select clock_timestamp() as t'));
  return (r.t instanceof Date ? r.t : new Date(r.t)).toISOString();
}

async function runClaimed(args: GenerateArgs, claim: Claimed, deps: GenerateDeps, now: Date): Promise<GenerateResult> {
  const t0 = Date.now();
  const written: string[] = []; // renders written to storage, removed again if the run does not finish
  const storage = deps.storage ?? getStorage();
  let runStart = new Date().toISOString();
  try {
    runStart = await dbClock();
    const inputs = await loadWeekInputs(args.brandId, args.weekStart, now);
    const actor = args.userId ?? inputs.ownerUserId;

    // --- LLM: one call, retried once ------------------------------------------------------
    const tAi = Date.now();
    const batch = await callWeekly(args, inputs, actor, deps, now);
    let aiMs = Date.now() - tAi;

    // --- normalise -------------------------------------------------------------------------
    const photoIds = new Map(inputs.promptPhotos.map((p, i) => [p.id, inputs.photos[i].id]));
    let posts = normalizePosts(batch.posts, {
      weekStart: args.weekStart,
      photoIds,
      occasions: inputs.occasions,
      brand: { name: inputs.brand.name, city: inputs.brand.city, region: inputs.brand.region },
      mascot: inputs.mascot !== null,
    });
    const modelCaptions = posts.map((p) => p.caption);

    // --- guardrail pass 1 ------------------------------------------------------------------
    // History is the 4 weeks before the target week: the reference day is the day before it, so
    // the drafts this run replaces (same week) do not count as history.
    const historyRef = addDaysIso(args.weekStart, -1);
    const check = (list: NormalizedPost[], flagRepeats: boolean) => {
      const guarded = list.map(toGuard);
      return runGuardrail({
        userId: actor,
        brandId: args.brandId,
        posts: guarded,
        facts: inputs.facts,
        flagRepeats,
        weekStart: historyRef,
        now,
        aiFixture: () => (deps.fixtures?.factCheck ?? fixtureFactCheck)(guarded),
      });
    };
    const tG1 = Date.now();
    let results: PostGuardrailResult[] = await check(posts, false);
    let guardrailMs = Date.now() - tG1;

    // --- one rewrite for repeats and avoided words, then pass 2 for those posts ---------------
    const redo = results
      .map((r, i) => ({
        i,
        phrases: r.repeats,
        words: unique(r.flags.filter((f) => f.kind === 'avoid' && f.status === 'open').map((f) => f.text)),
      }))
      .filter((x) => x.phrases.length > 0 || x.words.length > 0);
    let rewrites = 0;
    if (redo.length > 0) {
      const tRw = Date.now();
      const rewritten = await Promise.all(redo.map((x) => rewriteOne(posts[x.i], x, inputs, actor, args.brandId, deps, now)));
      aiMs += Date.now() - tRw;
      rewrites = rewritten.filter(Boolean).length;
      posts = posts.map((p, i) => {
        const k = redo.findIndex((x) => x.i === i);
        return k >= 0 && rewritten[k] ? rewritten[k]! : p;
      });
      const tG2 = Date.now();
      const second = await check(redo.map((x) => posts[x.i]), true);
      guardrailMs += Date.now() - tG2;
      results = results.map((r, i) => {
        const k = redo.findIndex((x) => x.i === i);
        return k >= 0 ? second[k] : r;
      });
    }

    // --- render ----------------------------------------------------------------------------
    const tRender = Date.now();
    const logo = await loadLogoFile(inputs.brand.logoPath, storage);
    const colors = resolveBrandColors(inputs.brand.colors);
    const rendered = await Promise.all(
      posts.map(async (p, index) => {
        const id = randomUUID();
        let photo: Buffer | undefined;
        let photoId = p.photoId;
        if (photoId) {
          const row = inputs.photos.find((x) => x.id === photoId);
          const file = await loadPhotoFile(storage, row?.storagePath);
          if (file) photo = file;
          else photoId = null; // the file is gone: this post is text-only
        }
        // The mascot goes on the square and vertical images, except for a sensitive occasion (no mascot, no bubble).
        const mascot = inputs.mascot && !p.sensitive ? inputs.mascot : null;
        const images = await renderAndStore({
          storage,
          brandId: args.brandId,
          postId: id,
          brand: { name: inputs.brand.name, colors, logo },
          photo,
          text: { headline: p.imageText.headline, subline: p.imageText.subline, cta: p.cta, bubble: p.bubble },
          mascot: mascot ? mascotForRender(mascot.colors, p.pose) : null,
          seed: index,
          onWrite: (rel) => written.push(rel),
        });
        return { id, photoId, images, mascotId: mascot ? mascot.id : null };
      }),
    );
    const renderMs = Date.now() - tRender;

    // --- save: one transaction -------------------------------------------------------------------
    const saved = await savePosts({ args, claim, inputs, posts, results, rendered, modelCaptions, runStart, now });
    for (const path of saved.oldImagePaths) await storage.remove('renders', path.replace(/^renders\//, '')).catch(() => undefined);

    const timings: Timings = { aiMs, guardrailMs, renderMs, totalMs: Date.now() - t0 };
    console.info(
      `[weekly] ready brand=${args.brandId} week=${args.weekStart} trigger=${args.trigger} ${JSON.stringify({ ...timings, usd: saved.usd, posts: saved.posts.length, rewrites })}`,
    );
    await emailWeek(claim.batchId); // V-15: the weekly email (once per batch); never fails the run
    return { status: 'ready', batchId: claim.batchId, posts: saved.posts, timings, usd: saved.usd, rewrites };
  } catch (e) {
    for (const rel of written) await storage.remove('renders', rel).catch(() => undefined);
    const message = e instanceof Error ? e.message : String(e);
    console.error(`[weekly] failed brand=${args.brandId} week=${args.weekStart}: ${message}`);
    const failed = await failBatch(args, claim, message, runStart);
    // V-15: after the last automatic retry, tell the owner the posts are late (once per batch)
    if (args.trigger === 'cron' && failed.status === 'failed' && !failed.keptPrevious && claim.meta.attempts >= MAX_CRON_ATTEMPTS) {
      await emailLate(claim.batchId);
    }
    return failed;
  }
}

// --- V-15 email hooks: log and carry on, an email problem must never fail or change a generation ---

async function emailWeek(batchId: string): Promise<void> {
  try {
    await sendWeeklyEmail(batchId);
  } catch (e) {
    console.error(`[weekly] email for batch ${batchId} failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

async function emailLate(batchId: string): Promise<void> {
  try {
    await sendLateNotice(batchId);
  } catch (e) {
    console.error(`[weekly] late notice for batch ${batchId} failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

async function callWeekly(args: GenerateArgs, inputs: WeekInputs, actor: string, deps: GenerateDeps, now: Date): Promise<WeeklyBatch> {
  const b = inputs.brand;
  const prompt = buildWeeklyPrompt({
    business: { name: b.name, whatTheySell: b.whatTheySell, customers: b.customers, city: b.city, region: b.region, country: b.country },
    goal: b.goal,
    postLanguage: b.postLanguage,
    channels: [...V2_CHANNELS],
    count: POST_COUNT,
    voice: inputs.voice,
    regulated: inputs.regulated,
    facts: inputs.facts,
    photos: inputs.promptPhotos,
    occasions: inputs.occasions,
    weekDays: weekDays(args.weekStart),
    recentPosts: inputs.recentPosts,
    performance: inputs.performance,
    mascot: inputs.mascot ? { name: inputs.mascot.name, personality: inputs.mascot.personality } : null,
  });
  const fixtureCtx: FixtureContext = {
    weekStart: args.weekStart,
    photoIds: inputs.promptPhotos.map((p) => p.id),
    occasions: inputs.occasions,
    mascot: inputs.mascot !== null,
  };
  let lastError: unknown;
  // What a failed attempt cost (H-2). It goes on the run's single `weekly_batch` event, so a run
  // with a retry still counts as one run against the weekly limit.
  let lostUsd = 0;
  let lostModel: string | null = null;
  let recorded = false;
  const record = async (usd: number, meta: UsageMeta = {}) => {
    recorded = true;
    await recordUsage(args.brandId, actor, 'weekly_batch', usd, meta);
  };
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await assertUnderDailyCap(args.brandId, now);
        await assertUnderWeeklyCap(args.brandId, 'weekly_batch', { now }); // 4 runs a week, and the week's $ cap (Req 23)
        const res = await generateJson({
          system: prompt.system,
          user: prompt.user,
          zodSchema: weeklyBatchSchema,
          jsonSchema: weeklyBatchJsonSchema,
          ...LLM,
          logContext: { brandId: args.brandId },
          fixture: () => (deps.fixtures?.weekly ?? fixtureWeeklyBatch)(fixtureCtx),
        });
        await record(lostUsd + (res.stats?.usd ?? 0), { model: res.stats?.model });
        return res.data;
      } catch (e) {
        if (recorded) throw e;
        lostUsd += failedCallUsd(e);
        lostModel = failedCallModel(e) ?? lostModel;
        if (e instanceof DailyCapError || e instanceof WeeklyCapError) throw e; // retrying cannot help
        lastError = e;
        console.warn(`[weekly] LLM call ${attempt + 1} of 2 failed for ${args.brandId}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    throw new Error(`The AI call failed twice: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
  } finally {
    if (!recorded && lostUsd > 0) await record(lostUsd, { ok: false, model: lostModel }).catch(() => undefined);
  }
}

/** One rewrite of a post. Returns null when it could not be done (the post stays and pass 2 flags what is left). */
async function rewriteOne(
  post: NormalizedPost,
  why: { phrases: string[]; words: string[] },
  inputs: WeekInputs,
  actor: string,
  brandId: string,
  deps: GenerateDeps,
  now: Date,
): Promise<NormalizedPost | null> {
  try {
    // Only the daily cap here: this rewrite belongs to the batch that was already allowed. It is recorded
    // as `auto_rewrite` (H-1), so it does not use up the owner's weekly rewrites (V-16), but its cost
    // is in the week's USD total.
    await assertUnderDailyCap(brandId, now);
    const current: PostCopy = { caption: post.caption, cta: post.cta, hashtags: post.hashtags, image_text: post.imageText };
    const prompt = buildRewritePrompt({
      channel: post.channel,
      postLanguage: inputs.brand.postLanguage,
      voiceDescription: inputs.voice.description,
      wordsToAvoid: inputs.voice.wordsToAvoid,
      facts: inputs.facts,
      post: current,
      instruction: rewriteInstruction(why.phrases, why.words),
    });
    let res;
    try {
      res = await generateJson({
        system: prompt.system,
        user: prompt.user,
        zodSchema: rewriteSchema,
        jsonSchema: rewriteJsonSchema,
        ...REWRITE,
        logContext: { brandId },
        fixture: () => (deps.fixtures?.rewrite ?? fixtureRewrite)(current, why),
      });
    } catch (e) {
      const lost = failedCallUsd(e); // an answer that did not validate still cost money (H-2)
      if (lost > 0) await recordUsage(brandId, actor, 'auto_rewrite', lost, { ok: false, model: failedCallModel(e) }).catch(() => undefined);
      throw e;
    }
    await recordUsage(brandId, actor, 'auto_rewrite', res.stats?.usd ?? 0, { model: res.stats?.model });
    const r = res.data;
    const spec = V2_CHANNEL_SPECS[post.channel];
    const brand = { name: inputs.brand.name, city: inputs.brand.city, region: inputs.brand.region };
    return {
      ...post,
      caption: trimCaption(r.caption, spec.captionMaxChars),
      cta: r.cta.trim() || post.cta,
      hashtags: fitHashtags(r.hashtags.length ? r.hashtags : post.hashtags, post.channel, brand),
      imageText: fitImageText(r.image_text),
    };
  } catch (e) {
    console.warn(`[weekly] rewrite skipped for a ${post.channel} post: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

const RUN_COST_SQL = `select coalesce(sum(usd), 0) as usd from public.usage_events
  where brand_id = $1 and kind in ('weekly_batch', 'rewrite', 'auto_rewrite', 'fact_check') and created_at >= $2::timestamptz`;

async function savePosts(a: {
  args: GenerateArgs;
  claim: Claimed;
  inputs: WeekInputs;
  posts: NormalizedPost[];
  results: PostGuardrailResult[];
  rendered: Array<{ id: string; photoId: string | null; images: GeneratedPost['images']; mascotId: string | null }>;
  modelCaptions: string[];
  runStart: string;
  now: Date;
}): Promise<{ posts: GeneratedPost[]; usd: number; oldImagePaths: string[] }> {
  const { args, claim, inputs } = a;
  return getDb().withService(async (tx) => {
    const [row] = await tx.query<{ status: string; error: string | null; attempts: number; regens: number; claimed_at: Date | string | null }>(
      `select status::text as status, ${BATCH_STATE_COLUMNS} from public.weekly_batches where id = $1 for update`,
      [claim.batchId],
    );
    // Our claim wrote this attempt number and time; anything else means a later run took the batch over.
    if (!row || row.status !== 'generating' || !ownsClaim(readBatchState(row), claim)) {
      throw new SaveConflict('The batch was taken over by another run');
    }
    const [approved] = await tx.query<{ n: number }>(
      `select count(*)::int as n from public.posts where batch_id = $1 and status in ('approved', 'posted')`,
      [claim.batchId],
    );
    if ((approved?.n ?? 0) > 0) throw new SaveConflict('The week has approved posts; nothing was replaced');

    // Replace the old drafts and their images.
    const old = await tx.query<{ image_path: string }>(
      `select i.image_path from public.post_images i join public.posts p on p.id = i.post_id and p.brand_id = i.brand_id where p.batch_id = $1`,
      [claim.batchId],
    );
    await tx.query('delete from public.posts where batch_id = $1', [claim.batchId]);

    const out: GeneratedPost[] = [];
    for (let i = 0; i < a.posts.length; i++) {
      const p = a.posts[i];
      const r = a.rendered[i];
      const flags = a.results[i].flags;
      const original = {
        caption: p.caption,
        cta: p.cta,
        hashtags: p.hashtags,
        image_text: storedImageText(p, inputs.mascot !== null),
        link: p.link,
        topic: p.topic,
        fact_ids: p.factIds,
        occasion_key: p.occasionKey,
        // Set when the guardrail rewrite changed the caption: the model's first wording.
        ...(a.modelCaptions[i] !== p.caption ? { model_caption: a.modelCaptions[i] } : {}),
      };
      let code = '';
      for (let tries = 0; tries < 8 && !code; tries++) {
        const candidate = newPostCode();
        const ins = await tx.query<{ id: string }>(
          `insert into public.posts (id, brand_id, created_by, batch_id, status, post_code, suggested_day, channel, post_language,
                                     caption, cta, hashtags, image_text, occasion, photo_id, fact_flags, original, mascot_id)
           values ($1, $2, $3::uuid, $4, 'draft', $5, $6::date, $7::public.post_channel, $8,
                   $9, $10, $11::text[], $12::jsonb, $13, $14::uuid, $15::jsonb, $16::jsonb, $17::uuid)
           on conflict (post_code) do nothing
           returning id::text as id`,
          [
            r.id, args.brandId, args.userId ?? null, claim.batchId, candidate, p.suggestedDay, p.channel, inputs.brand.postLanguage,
            p.caption, p.cta, p.hashtags, JSON.stringify(storedImageText(p, inputs.mascot !== null)), p.occasion, r.photoId, JSON.stringify(flags), JSON.stringify(original),
            r.mascotId,
          ],
        );
        if (ins[0]) code = candidate;
      }
      if (!code) throw new Error('Could not make a unique post code');
      for (const img of r.images) {
        await tx.query(
          `insert into public.post_images (post_id, brand_id, format, template_id, image_path) values ($1, $2, $3::public.image_format, $4, $5)`,
          [r.id, args.brandId, img.format, img.templateId, img.path],
        );
      }
      out.push({
        id: r.id,
        postCode: code,
        suggestedDay: p.suggestedDay,
        channel: p.channel,
        postLanguage: inputs.brand.postLanguage,
        caption: p.caption,
        cta: p.cta,
        hashtags: p.hashtags,
        link: p.link,
        imageText: p.imageText,
        occasion: p.occasion,
        photoId: r.photoId,
        mascotId: r.mascotId,
        flags,
        images: r.images,
      });
    }

    const [sum] = await tx.query<{ usd: string | number | null }>(RUN_COST_SQL, [args.brandId, a.runStart]);
    const runUsd = Number(sum?.usd) || 0;
    await tx.query(
      `update public.weekly_batches
          set status = 'ready', generated_at = $2::timestamptz, usd = $3, error = null, attempts = $4, regens = $5, claimed_at = null
        where id = $1`,
      [claim.batchId, a.now.toISOString(), claim.priorUsd + runUsd, claim.meta.attempts, claim.meta.regens],
    );
    return { posts: out, usd: runUsd, oldImagePaths: old.map((o) => o.image_path) };
  });
}

/** Marks the claimed batch failed, or puts a regenerated week back to `ready` with its old drafts. */
async function failBatch(args: GenerateArgs, claim: Claimed, message: string, runStart: string): Promise<GenerateResult> {
  const keptPrevious = claim.previous === 'ready';
  try {
    const usd = await getDb().withService(async (tx) => {
      const [sum] = await tx.query<{ usd: string | number | null }>(RUN_COST_SQL, [args.brandId, runStart]);
      const runUsd = Number(sum?.usd) || 0;
      await tx.query(
        `update public.weekly_batches
            set status = $2::public.batch_status, usd = $3, error = $4, attempts = $5, regens = $6, claimed_at = null
          where id = $1 and status = 'generating' and attempts = $5 and claimed_at = $7::timestamptz`,
        [claim.batchId, keptPrevious ? 'ready' : 'failed', claim.priorUsd + runUsd, errorColumn(message), claim.meta.attempts, claim.meta.regens, claim.meta.claimedAt],
      );
      return runUsd;
    });
    return { status: 'failed', batchId: claim.batchId, error: message, keptPrevious, usd };
  } catch (e) {
    console.error(`[weekly] could not mark batch ${claim.batchId} failed: ${e instanceof Error ? e.message : String(e)}`);
    return { status: 'failed', batchId: claim.batchId, error: message, keptPrevious, usd: 0 };
  }
}
