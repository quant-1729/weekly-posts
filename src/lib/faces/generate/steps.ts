// Brand Face generation (F-5): the three AI steps a Face card calls, in order.
//   a. makeOptions  FACE_OPTIONS master options (draft files)      -> owner picks one: setMaster
//   b. makeSheet    character sheet (front, 3/4, side) from master  -> owner approves it: approveSheet
//   c. makePoses    TRIES_PER_POSE tries per pose from master+sheet, a vision check each, the best try cut out and saved
//                   as an UNAPPROVED pose (F-1 savePoseImage)       -> owner approves each pose (F-1 approvePose)
//
// Every generating step takes `approvedEstimateUsd`: the price the owner saw and approved. It is refused when that is
// missing or lower than the step's current estimate, or when this face's spend plus the estimate passes FACE_CAP_USD; a
// running step also stops at the approved amount. Every model call is an injected dependency, so tests use fixtures.

import sharp from 'sharp';
import { buildOptionPrompt, buildPosePrompt, buildSheetPrompt, DEFAULT_FACE_STYLE, type FacePromptInput } from '@/lib/ai/prompts/faces';
import { requireBrandMember } from '@/lib/brand/current';
import { getDb } from '@/lib/db';
import { loadGuardrailContext } from '@/lib/guardrail';
import { emitFaceProgress, type FaceLive } from '@/lib/realtime';
import { getStorage, type Storage } from '@/lib/storage';
import { recordUsage } from '@/lib/usage';
import { FaceError } from '../errors';
import { FACE_BUCKET, relOfStored } from '../paths';
import { copiesKnownCharacter, namesRealPerson, unsuitableDescription } from '../rules';
import { getFace, savePoseImage } from '../service';
import {
  AI_FACE_KINDS,
  FACE_IMAGE_USD,
  FACE_OPTIONS,
  FACE_POSES,
  TRIES_PER_POSE,
  faceKindAllowed,
  type BrandFace,
  type FaceCheck,
  type FacePose,
} from '../types';
import { checkPasses, checkWithGemini, pickBestTry, type FaceCheckFn } from './check';
import { cutout, type CutoutFn } from './cutout';
import { assertStepAllowed, BUSY_RETRY_PAUSE_MS, FACE_CHECK_USD, StepBudget, stepEstimateUsd } from './estimate';
import { FaceGenError, isRateLimited } from './errors';
import { generateFaceImage, type FaceImageFn, type FaceImageResult } from './image-client';
import { faceMasterRel, faceOptionRel, faceSheetDraftRel, faceSheetRel, toStored } from './paths';
import { provenanceEntry, type FaceProvenanceEntry } from './provenance';

// ---------------------------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------------------------

export interface FaceGenDeps {
  /** Makes one image. Default: Gemini image model on Vertex (refuses in fixture mode). */
  image: FaceImageFn;
  /** Vision check of a pose try against the master. Default: Gemini text model with both images. */
  check: FaceCheckFn;
  /** Transparent PNG from a picture. Default: chroma key for AI images. */
  cutout: CutoutFn;
  storage: Storage;
  /** Writes one 'face_create' usage event. */
  record: (brandId: string, userId: string, usd: number) => Promise<void>;
  now: () => Date;
  /** Waits (used for the pause before retrying a rate-limited image call). */
  sleep: (ms: number) => Promise<void>;
  /** Tells the browser how far a step is (live status, docs/14-firebase-plan.md). Default: emitFaceProgress for this face. */
  progress: (p: FaceProgress) => Promise<void>;
}

/** One live progress update for a face: everything in FaceLive except the face id, which the default `progress` adds. */
export type FaceProgress = Omit<FaceLive, 'faceId'>;

function defaultDeps(brandId: string, faceId: string): FaceGenDeps {
  return {
    image: generateFaceImage,
    check: checkWithGemini,
    cutout,
    storage: getStorage(),
    record: (brandId, userId, usd) => recordUsage(brandId, userId, 'face_create', usd),
    now: () => new Date(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    progress: (p) => emitFaceProgress(brandId, { faceId, ...p }),
  };
}

/** The deps with this brand's and face's live progress as the default. A progress call that fails is ignored: it never changes a result. */
function withDeps(brandId: string, faceId: string, d?: Partial<FaceGenDeps>): FaceGenDeps {
  const all = { ...defaultDeps(brandId, faceId), ...d };
  const send = all.progress;
  return {
    ...all,
    progress: async (p) => {
      try {
        await send(p);
      } catch {
        // live status is a convenience; generation goes on
      }
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Context: the face, the brand's rules, and what goes into the prompts
// ---------------------------------------------------------------------------------------------

interface GenContext {
  userId: string;
  brandId: string;
  face: BrandFace;
  prompt: FacePromptInput;
}

const HEX = /^#[0-9a-fA-F]{6}$/;

/**
 * Loads the face and applies every rule that must hold before money is spent: an AI kind, a draft, a kind this
 * brand may have (no realistic AI person for health, finance, legal or alcohol), a description that names no real person.
 */
async function loadContext(userId: string, brandId: string, faceId: string): Promise<GenContext> {
  await requireBrandMember(userId, brandId);
  const face = await getFace(userId, brandId, faceId);
  if (face.status !== 'draft') throw new FaceError('bad_status');
  if (!AI_FACE_KINDS.has(face.kind)) throw new FaceGenError('not_ai_face');
  const { regulated } = await loadGuardrailContext(brandId, userId);
  if (!faceKindAllowed(face.kind, regulated)) throw new FaceError('kind_not_allowed');

  const [mem] = await getDb().withUser(userId, (tx) =>
    tx.query<{ name: string; colors: Record<string, unknown> | null }>(
      `select coalesce(nullif(trim(m.business_name), ''), b.name) as name, m.colors
         from public.brands b left join public.brand_memory m on m.brand_id = b.id where b.id = $1`,
      [brandId],
    ),
  );
  const description = (face.description ?? '').trim();
  if (!description) throw new FaceError('bad_description', 'a description is needed');
  const hit = namesRealPerson(description, [mem?.name ?? '']);
  if (hit) throw new FaceError('real_person', hit);
  const copied = copiesKnownCharacter(description);
  if (copied) throw new FaceError('copied_character', copied);
  const bad = unsuitableDescription(description);
  if (bad) throw new FaceError('unsuitable_description', bad);

  const colors = ['primary', 'secondary', 'accent']
    .map((k) => mem?.colors?.[k])
    .filter((c): c is string => typeof c === 'string' && HEX.test(c));
  const kind = face.kind as 'illustrated' | 'photoreal';
  return {
    userId,
    brandId,
    face,
    prompt: { kind, style: face.style ?? DEFAULT_FACE_STYLE[kind], description, colors },
  };
}

// ---------------------------------------------------------------------------------------------
// The image call: logging, rate limits
// ---------------------------------------------------------------------------------------------

/** The pause before a rate-limited image call is tried once more (Vertex image quota is low: about 2 a minute). */
export { BUSY_RETRY_PAUSE_MS }; // defined in estimate.ts so the Face card can say how long the wait is

type FaceStepName = 'options' | 'sheet' | 'poses';

/** A short, safe reason for the log: the finish/block reason or the first part of the error message (never the prompt or image data). */
function failureReason(e: unknown): string {
  const raw = e instanceof FaceGenError ? e.message.replace(/^[a-z_]+:\s*/, '') : e instanceof Error ? e.message : String(e);
  return raw.replace(/\s+/g, ' ').trim().slice(0, 160);
}

/** One line per failed image call, so the next failure shows its real cause (safety, 429, timeout...). */
function logImageFailure(step: FaceStepName, e: unknown): void {
  const code = e instanceof FaceGenError && e.code === 'image_blocked' ? 'image_blocked' : 'call_failed';
  console.warn('[faces] image call failed', { step, code, reason: failureReason(e) });
}

/**
 * One image call. A rate-limited call (429) is tried once more after a pause (a failed call is not billed). Throws
 * FaceGenError('image_blocked') for a safety block, FaceGenError('busy') when still rate-limited, and the original
 * error for anything else. Every failed call is logged. `onWait` runs just before the pause (live status "waiting").
 */
async function callImage(deps: FaceGenDeps, step: FaceStepName, req: Parameters<FaceImageFn>[0], onWait?: () => Promise<void>): Promise<FaceImageResult> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await deps.image(req);
    } catch (e) {
      logImageFailure(step, e);
      if (isRateLimited(e)) {
        if (attempt === 0) {
          await onWait?.();
          await deps.sleep(BUSY_RETRY_PAUSE_MS);
          continue;
        }
        throw new FaceGenError('busy');
      }
      throw e;
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------------------------

/** Runs `fn` over `items`, at most `size` at a time, keeping the result order. */
async function pool<T, R>(items: readonly T[], size: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}

/** The model's bytes as PNG. Bytes that already are PNG are used untouched. */
async function asPng(img: FaceImageResult): Promise<Buffer> {
  return img.mimeType === 'image/png' ? img.bytes : sharp(img.bytes).png().toBuffer();
}

/** Costs of one step: each is written as a 'face_create' usage event, and the total is added to the face. */
class Spend {
  total = 0;
  constructor(
    private readonly ctx: GenContext,
    private readonly deps: FaceGenDeps,
  ) {}
  async record(usd: number): Promise<void> {
    this.total += usd;
    await this.deps.record(this.ctx.brandId, this.ctx.userId, usd);
  }
}

async function requireStored(storage: Storage, stored: string | null, missing: 'needs_master' | 'needs_sheet'): Promise<Buffer> {
  const rel = stored ? relOfStored(stored) : null;
  const file = rel ? await storage.get(FACE_BUCKET, rel) : null;
  if (!file) throw new FaceGenError(missing);
  return Buffer.from(file.bytes);
}

interface FacePatch {
  provenance: (prev: Record<string, unknown>) => Record<string, unknown>;
  addCostUsd?: number;
  /** undefined keeps the column, null clears it. */
  masterPath?: string | null;
  sheetPath?: string | null;
}

/** Writes the face's provenance, cost and paths in one statement as the signed-in user (row-level security applies). */
async function patchFace(ctx: GenContext, patch: FacePatch): Promise<void> {
  await getDb().withUser(ctx.userId, async (tx) => {
    const [cur] = await tx.query<{ provenance: Record<string, unknown> | null }>('select provenance from public.brand_faces where id = $1::uuid and brand_id = $2', [ctx.face.id, ctx.brandId]);
    if (!cur) throw new FaceError('not_found');
    await tx.query(
      `update public.brand_faces
          set provenance = $3::jsonb,
              created_cost_usd = created_cost_usd + $4,
              master_path = case when $5::boolean then $6 else master_path end,
              sheet_path = case when $7::boolean then $8 else sheet_path end,
              updated_at = now()
        where id = $1::uuid and brand_id = $2`,
      [
        ctx.face.id,
        ctx.brandId,
        JSON.stringify(patch.provenance(cur.provenance ?? {})),
        Number((patch.addCostUsd ?? 0).toFixed(4)),
        patch.masterPath !== undefined,
        patch.masterPath ?? null,
        patch.sheetPath !== undefined,
        patch.sheetPath ?? null,
      ],
    );
  });
}

/** The approval and cap gate shared by the three generating steps. Returns the budget to run inside. */
function gate(ctx: GenContext, estimateUsd: number, approvedEstimateUsd: unknown): StepBudget {
  assertStepAllowed({ estimateUsd, approvedEstimateUsd, spentUsd: ctx.face.createdCostUsd });
  return new StepBudget(approvedEstimateUsd as number, ctx.face.createdCostUsd);
}

interface StepArgs {
  userId: string;
  brandId: string;
  faceId: string;
  /** The price the owner saw and approved (stepEstimateUsd, or the whole-face figure). */
  approvedEstimateUsd: number;
  deps?: Partial<FaceGenDeps>;
}

// ---------------------------------------------------------------------------------------------
// a. Master options
// ---------------------------------------------------------------------------------------------

export interface OptionsResult {
  /** The options made, in order. `stored` is the "{bucket}/..." form for /api/files. */
  options: { index: number; stored: string }[];
  /** Options that could not be made (the model refused or failed). */
  failed: number;
  costUsd: number;
}

/**
 * Makes the master options as draft files. The owner picks one (setMaster) or asks again (another call, another price).
 * Throws FaceGenError (not_approved, over_cap, not_ai_face, image_failed when none could be made) or FaceError.
 */
export async function makeOptions(args: StepArgs): Promise<OptionsResult> {
  const deps = withDeps(args.brandId, args.faceId, args.deps);
  const ctx = await loadContext(args.userId, args.brandId, args.faceId);
  const budget = gate(ctx, stepEstimateUsd('options'), args.approvedEstimateUsd);
  const spend = new Spend(ctx, deps);
  const entries: (FaceProvenanceEntry | null)[] = [];
  let made: { index: number; stored: string }[] = [];
  let blocked = false;
  let busy = false;
  let finished = 0;
  const tell = (p: Partial<FaceProgress> = {}) => deps.progress({ step: 'options', state: 'running', done: finished, total: FACE_OPTIONS, ...p });
  try {
    await tell();
    // One at a time: Google's image quota is low, and four at once is refused.
    const results = await pool(Array.from({ length: FACE_OPTIONS }, (_, i) => i), 1, async (index) => {
      try {
        budget.reserve(FACE_IMAGE_USD);
      } catch {
        finished++;
        await tell();
        return null;
      }
      const prompt = buildOptionPrompt(ctx.prompt, index);
      let img: FaceImageResult;
      try {
        img = await callImage(deps, 'options', { prompt, aspectRatio: '3:4' }, () => tell({ phase: 'waiting' }));
      } catch (e) {
        if (e instanceof FaceGenError && e.code === 'image_blocked') blocked = true;
        if (e instanceof FaceGenError && e.code === 'busy') busy = true;
        budget.settle(FACE_IMAGE_USD, 0);
        finished++;
        await tell();
        return null;
      }
      budget.settle(FACE_IMAGE_USD, img.usd);
      await spend.record(img.usd);
      const bytes = await asPng(img);
      await deps.storage.put(FACE_BUCKET, faceOptionRel(ctx.brandId, ctx.face.id, index), bytes, 'image/png');
      entries[index] = provenanceEntry(img, prompt, deps.now());
      finished++;
      await tell();
      return { index, stored: toStored(faceOptionRel(ctx.brandId, ctx.face.id, index)) };
    });
    made = results.filter((r): r is { index: number; stored: string } => r !== null);
  } catch (e) {
    await tell({ state: 'failed' });
    throw e;
  } finally {
    if (spend.total > 0 || entries.some(Boolean)) {
      await patchFace(ctx, {
        addCostUsd: spend.total,
        provenance: (prev) => ({ ...prev, options: entries.map((e) => e ?? null) }),
      });
    }
  }
  await tell({ state: made.length === 0 ? 'failed' : 'done' });
  if (made.length === 0) throw new FaceGenError(blocked ? 'image_blocked' : busy ? 'busy' : 'image_failed');
  return { options: made, failed: FACE_OPTIONS - made.length, costUsd: spend.total };
}

/** The owner keeps option `optionIndex`: it becomes the frozen master. Costs nothing. A new master clears the old sheet. */
export async function setMaster(args: { userId: string; brandId: string; faceId: string; optionIndex: number; deps?: Partial<FaceGenDeps> }): Promise<BrandFace> {
  const deps = withDeps(args.brandId, args.faceId, args.deps);
  const ctx = await loadContext(args.userId, args.brandId, args.faceId);
  const idx = args.optionIndex;
  if (!Number.isInteger(idx) || idx < 0 || idx >= FACE_OPTIONS) throw new FaceGenError('no_option');
  const file = await deps.storage.get(FACE_BUCKET, faceOptionRel(ctx.brandId, ctx.face.id, idx));
  if (!file) throw new FaceGenError('no_option');
  // The master is the option's bytes, unmodified.
  await deps.storage.put(FACE_BUCKET, faceMasterRel(ctx.brandId, ctx.face.id), file.bytes, 'image/png');
  await patchFace(ctx, {
    masterPath: toStored(faceMasterRel(ctx.brandId, ctx.face.id)),
    sheetPath: null,
    provenance: (prev) => {
      const options = Array.isArray(prev.options) ? (prev.options as (FaceProvenanceEntry | null)[]) : [];
      const chosen = options[idx];
      const { sheet: _sheet, sheetDraft: _draft, ...rest } = prev;
      void _sheet;
      void _draft;
      return { ...rest, ...(chosen ?? {}), master: { option: idx, ...(chosen ?? {}) } };
    },
  });
  return getFace(args.userId, args.brandId, args.faceId);
}

// ---------------------------------------------------------------------------------------------
// b. Character sheet
// ---------------------------------------------------------------------------------------------

export interface SheetResult {
  /** The draft sheet, "{bucket}/..." form. Not used until the owner approves it (approveSheet). */
  stored: string;
  costUsd: number;
}

/** Makes the character sheet from the master. Throws FaceGenError (needs_master, not_approved, over_cap, image_failed). */
export async function makeSheet(args: StepArgs): Promise<SheetResult> {
  const deps = withDeps(args.brandId, args.faceId, args.deps);
  const ctx = await loadContext(args.userId, args.brandId, args.faceId);
  const master = await requireStored(deps.storage, ctx.face.masterPath, 'needs_master');
  const budget = gate(ctx, stepEstimateUsd('sheet'), args.approvedEstimateUsd);
  const spend = new Spend(ctx, deps);
  const prompt = buildSheetPrompt(ctx.prompt);
  budget.reserve(FACE_IMAGE_USD);
  const tell = (p: Partial<FaceProgress> = {}) => deps.progress({ step: 'sheet', state: 'running', done: 0, total: 1, ...p });
  await tell();
  let img: FaceImageResult;
  try {
    img = await callImage(deps, 'sheet', { prompt, references: [master], aspectRatio: '4:3' }, () => tell({ phase: 'waiting' }));
  } catch (e) {
    await tell({ state: 'failed' });
    if (e instanceof FaceGenError && (e.code === 'image_blocked' || e.code === 'busy')) throw e;
    throw new FaceGenError('image_failed');
  }
  try {
    await spend.record(img.usd);
    const bytes = await asPng(img);
    const rel = faceSheetDraftRel(ctx.brandId, ctx.face.id);
    await deps.storage.put(FACE_BUCKET, rel, bytes, 'image/png');
    const entry = provenanceEntry(img, prompt, deps.now());
    await patchFace(ctx, { addCostUsd: spend.total, provenance: (prev) => ({ ...prev, sheetDraft: entry }) });
    await tell({ state: 'done', done: 1 });
    return { stored: toStored(rel), costUsd: spend.total };
  } catch (e) {
    await tell({ state: 'failed' });
    throw e;
  }
}

/** The owner approves the made sheet: it becomes brand_faces.sheet_path. Costs nothing. */
export async function approveSheet(args: { userId: string; brandId: string; faceId: string; deps?: Partial<FaceGenDeps> }): Promise<BrandFace> {
  const deps = withDeps(args.brandId, args.faceId, args.deps);
  const ctx = await loadContext(args.userId, args.brandId, args.faceId);
  const file = await deps.storage.get(FACE_BUCKET, faceSheetDraftRel(ctx.brandId, ctx.face.id));
  if (!file) throw new FaceGenError('needs_sheet');
  await deps.storage.put(FACE_BUCKET, faceSheetRel(ctx.brandId, ctx.face.id), file.bytes, 'image/png');
  await patchFace(ctx, {
    sheetPath: toStored(faceSheetRel(ctx.brandId, ctx.face.id)),
    provenance: (prev) => {
      const { sheetDraft, ...rest } = prev;
      return { ...rest, sheet: sheetDraft ?? {} };
    },
  });
  return getFace(args.userId, args.brandId, args.faceId);
}

// ---------------------------------------------------------------------------------------------
// c. Poses
// ---------------------------------------------------------------------------------------------

export interface PoseOutcome {
  pose: FacePose;
  /** The saved try passed every vision check. When false its notes say what is wrong and the owner decides. */
  passed: boolean;
  check: FaceCheck;
}

export interface PosesResult {
  /** Saved as unapproved poses (F-1); the owner approves each. */
  saved: PoseOutcome[];
  failed: { pose: FacePose; reason: 'image_failed' | 'image_blocked' | 'busy' | 'cutout_failed' | 'over_budget' }[];
  costUsd: number;
}

interface PoseTry {
  png: Buffer;
  check: FaceCheck;
  entry: FaceProvenanceEntry;
}

const EMPTY_CHECK: FaceCheck = { notes: 'The check could not be run.' };

/**
 * Makes the poses (all seven, or the ones in `poses`): per pose TRIES_PER_POSE tries with the master and the approved
 * sheet as references, a vision check each, then the best try is cut out and saved as an unapproved pose. When no try
 * passes, the best one is kept with its notes. Throws FaceGenError (needs_master, needs_sheet, not_approved, over_cap).
 * A pose that could not be made is listed in `failed`; the rest are kept.
 */
export async function makePoses(args: StepArgs & { poses?: readonly FacePose[] }): Promise<PosesResult> {
  const deps = withDeps(args.brandId, args.faceId, args.deps);
  const ctx = await loadContext(args.userId, args.brandId, args.faceId);
  const master = await requireStored(deps.storage, ctx.face.masterPath, 'needs_master');
  const sheet = await requireStored(deps.storage, ctx.face.sheetPath, 'needs_sheet');
  const poses = [...new Set(args.poses ?? FACE_POSES)].filter((p): p is FacePose => (FACE_POSES as readonly string[]).includes(p));
  if (poses.length === 0) throw new FaceGenError('image_failed', 'no poses');
  const budget = gate(ctx, stepEstimateUsd('poses', poses.length), args.approvedEstimateUsd);
  const spend = new Spend(ctx, deps);
  const perTry = FACE_IMAGE_USD + FACE_CHECK_USD;
  let savedCount = 0;
  const tell = (p: Partial<FaceProgress> = {}) => deps.progress({ step: 'poses', state: 'running', done: savedCount, total: poses.length, ...p });

  const outcomes = new Map<FacePose, { outcome: PoseOutcome; entry: FaceProvenanceEntry } | { reason: PosesResult['failed'][number]['reason'] }>();
  try {
    await tell();
    await pool(poses, 1, async (pose) => { // one at a time: the image quota is low (about 2 a minute)
      const prompt = buildPosePrompt(ctx.prompt, pose);
      const tries: PoseTry[] = [];
      let lastReason: PosesResult['failed'][number]['reason'] = 'image_failed';
      for (let t = 0; t < TRIES_PER_POSE; t++) {
        try {
          budget.reserve(perTry);
        } catch {
          lastReason = 'over_budget';
          break;
        }
        let img: FaceImageResult;
        try {
          const at = { pose, tryNo: t + 1, tries: TRIES_PER_POSE };
          await tell({ ...at, phase: 'drawing' });
          img = await callImage(deps, 'poses', { prompt, references: [master, sheet], aspectRatio: '3:4' }, () => tell({ ...at, phase: 'waiting' }));
        } catch (e) {
          budget.settle(perTry, 0);
          lastReason = e instanceof FaceGenError && (e.code === 'image_blocked' || e.code === 'busy') ? e.code : 'image_failed';
          continue;
        }
        let usd = img.usd;
        try {
          const raw = await asPng(img);
          let check: FaceCheck = EMPTY_CHECK;
          await tell({ pose, tryNo: t + 1, tries: TRIES_PER_POSE, phase: 'checking' });
          try {
            const res = await deps.check({ master, candidate: raw, brandId: ctx.brandId });
            check = res.check;
            usd += res.usd;
          } catch {
            // an unanswered check counts as failed
          }
          let png: Buffer | null = null;
          await tell({ pose, tryNo: t + 1, tries: TRIES_PER_POSE, phase: 'cutting' });
          try {
            png = await deps.cutout(raw, 'chroma');
          } catch {
            lastReason = 'cutout_failed';
          }
          if (png) tries.push({ png, check, entry: provenanceEntry(img, prompt, deps.now()) });
        } finally {
          budget.settle(perTry, usd);
          await spend.record(usd);
        }
      }
      const best = pickBestTry(tries);
      if (!best) {
        outcomes.set(pose, { reason: lastReason });
        return;
      }
      const chosen = tries[best.index];
      const notes = chosen.check.notes?.trim() ?? '';
      const checks: FaceCheck = { ...chosen.check, notes: best.passed ? notes : `No try passed every check. ${notes}`.trim() };
      await savePoseImage({ userId: ctx.userId, brandId: ctx.brandId, faceId: ctx.face.id, pose, png: chosen.png, checks, storage: deps.storage });
      savedCount++;
      await tell({ pose, phase: 'saved' });
      outcomes.set(pose, { outcome: { pose, passed: best.passed && checkPasses(chosen.check), check: checks }, entry: chosen.entry });
    });
  } catch (e) {
    await tell({ state: 'failed' });
    throw e;
  } finally {
    const entries: Record<string, unknown> = {};
    for (const [pose, o] of outcomes) if ('entry' in o) entries[pose] = { ...o.entry, passed: o.outcome.passed };
    if (spend.total > 0 || Object.keys(entries).length > 0) {
      await patchFace(ctx, { addCostUsd: spend.total, provenance: (prev) => ({ ...prev, poses: { ...((prev.poses as Record<string, unknown> | undefined) ?? {}), ...entries } }) });
    }
  }

  const saved: PoseOutcome[] = [];
  const failed: PosesResult['failed'] = [];
  for (const pose of poses) {
    const o = outcomes.get(pose);
    if (!o) failed.push({ pose, reason: 'over_budget' });
    else if ('outcome' in o) saved.push(o.outcome);
    else failed.push({ pose, reason: o.reason });
  }
  await tell({ state: saved.length === 0 ? 'failed' : 'done' });
  return { saved, failed, costUsd: spend.total };
}
