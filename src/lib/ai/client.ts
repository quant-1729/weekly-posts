// Gemini access for the whole app. Owned by the orchestrator.
// - Vertex AI when GOOGLE_GENAI_USE_VERTEXAI=true (project + ADC credentials),
//   otherwise an AI Studio key (GEMINI_API_KEY).
// - Fixture mode (AI_MODE=fixture, or no credentials, or under vitest): no network;
//   callers pass a fixture to return. Tests never make live calls.
// - Every live call logs model, latency, tokens and an estimated cost.

import { GoogleGenAI, ThinkingLevel, type Part } from '@google/genai';
import type { z } from 'zod';

export const DEFAULT_TEXT_MODEL = 'gemini-3.8-flash';
export const DEFAULT_TRANSCRIBE_MODEL = 'gemini-3.8-flash';

// Rough USD per 1M tokens, for logging and run estimates only. Thinking tokens bill as output.
// Update when Google's price list changes.
const PRICE_PER_M: Record<string, { input: number; output: number }> = {
  'gemini-3.8-flash': { input: 0.5, output: 3.0 },
  'gemini-3.5-flash': { input: 0.3, output: 2.5 },
};
const FALLBACK_PRICE = { input: 1.0, output: 5.0 }; // deliberately high for unknown models

export type AiMode = 'live' | 'fixture';

export function aiMode(): AiMode {
  if (process.env.AI_MODE === 'fixture' || process.env.AI_MODE === 'live') return process.env.AI_MODE;
  if (process.env.VITEST) return 'fixture';
  const vertex = process.env.GOOGLE_GENAI_USE_VERTEXAI === 'true' && !!process.env.GOOGLE_CLOUD_PROJECT;
  return vertex || process.env.GEMINI_API_KEY ? 'live' : 'fixture';
}

export function textModel(): string {
  return process.env.GEMINI_MODEL || DEFAULT_TEXT_MODEL;
}
export function transcribeModel(): string {
  return process.env.GEMINI_TRANSCRIBE_MODEL || DEFAULT_TRANSCRIBE_MODEL;
}

let client: GoogleGenAI | null = null;
function genai(): GoogleGenAI {
  if (client) return client;
  client =
    process.env.GOOGLE_GENAI_USE_VERTEXAI === 'true'
      ? new GoogleGenAI({
          vertexai: true,
          project: process.env.GOOGLE_CLOUD_PROJECT,
          location: process.env.GOOGLE_CLOUD_LOCATION || 'global',
        })
      : new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  return client;
}

export interface CallStats {
  model: string;
  ms: number;
  inputTokens: number;
  outputTokens: number; // includes thinking
  usd: number;
}

export function estimateUsd(model: string, inputTokens: number, outputTokens: number): number {
  const p = PRICE_PER_M[model] ?? FALLBACK_PRICE;
  return (inputTokens * p.input + outputTokens * p.output) / 1_000_000;
}

export class AiError extends Error {
  constructor(
    public code: 'invalid_output' | 'call_failed' | 'no_fixture',
    message: string,
    /** Stats of every attempt that got a response from the model before this error, so a failed call can still be costed. */
    public stats?: CallStats[],
  ) {
    super(message);
  }
}

type Usage = { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };

/** Extra fields for the one log line per call. Ids only, never names or text. */
export interface LogContext {
  brandId?: string;
}

function stats(model: string, start: number, u: Usage | undefined, log?: LogContext): CallStats {
  const inputTokens = u?.promptTokenCount ?? 0;
  const outputTokens = (u?.candidatesTokenCount ?? 0) + (u?.thoughtsTokenCount ?? 0);
  const s = { model, ms: Date.now() - start, inputTokens, outputTokens, usd: estimateUsd(model, inputTokens, outputTokens) };
  console.info(`[ai] ${model}${log?.brandId ? ` brand=${log.brandId}` : ""} ${s.ms}ms in=${inputTokens} out=${outputTokens} ~${s.usd.toFixed(4)}`);
  return s;
}

export interface MediaPart {
  mimeType: string; // image/jpeg, image/png, image/webp, audio/wav, audio/ogg, audio/mpeg
  data: Buffer | Uint8Array;
}

function mediaParts(media: MediaPart[] = []): Part[] {
  return media.map((m) => ({ inlineData: { mimeType: m.mimeType, data: Buffer.from(m.data).toString('base64') } }));
}

// Rate limits (429), overload (503) and hung calls are real on a shared Vertex
// project. Every call has a time limit; transient failures are retried with
// backoff, but never past the caller's overall budget (R4: 60 s for a full post).
const RETRY_DELAYS_MS = [2000, 5000, 10000];
export const DEFAULT_CALL_TIMEOUT_MS = 25_000;
export const DEFAULT_BUDGET_MS = 50_000;

export function isTransient(e: unknown): boolean {
  const msg = e instanceof Error ? `${e.name} ${e.message}` : String(e);
  return /(429|503)|RESOURCE_EXHAUSTED|UNAVAILABLE|overloaded|AbortError|TimeoutError|aborted|timed? ?out/i.test(msg);
}

async function withRetry<R>(
  call: (signal: AbortSignal) => Promise<R>,
  opts: { timeoutMs: number; deadline: number },
): Promise<R> {
  for (let i = 0; ; i++) {
    const timeout = Math.max(1000, Math.min(opts.timeoutMs, opts.deadline - Date.now()));
    try {
      return await call(AbortSignal.timeout(timeout));
    } catch (e) {
      const wait = RETRY_DELAYS_MS[i];
      const timeLeft = opts.deadline - Date.now() - (wait ?? 0);
      if (wait === undefined || !isTransient(e) || timeLeft < 5000) {
        throw new AiError('call_failed', e instanceof Error ? e.message : String(e));
      }
      console.warn(`[ai] transient error (${e instanceof Error ? e.name : 'error'}), retrying in ${wait}ms`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}

function sumStats(all: CallStats[]): CallStats {
  if (all.length === 1) return all[0];
  return all.reduce((a, b) => ({
    model: b.model,
    ms: a.ms + b.ms,
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    usd: a.usd + b.usd,
  }));
}

/**
 * One JSON call, validated with zod. Invalid output is retried once, then throws.
 * In fixture mode returns `fixture` (validated the same way).
 */
export async function generateJson<T>(args: {
  system: string;
  user: string;
  media?: MediaPart[];
  zodSchema: z.ZodType<T>;
  jsonSchema: unknown;
  temperature?: number;
  model?: string;
  fixture?: T | (() => T);
  timeoutMs?: number; // per attempt; default 25 s
  budgetMs?: number; // whole call incl. retries; default 50 s
  logContext?: LogContext; // adds the brand id to the log line
}): Promise<{ data: T; stats: CallStats | null }> {
  if (aiMode() === 'fixture') {
    if (args.fixture === undefined) throw new AiError('no_fixture', 'AI is in fixture mode and no fixture was given');
    const value = typeof args.fixture === 'function' ? (args.fixture as () => T)() : args.fixture;
    return { data: args.zodSchema.parse(value), stats: null };
  }

  const model = args.model ?? textModel();
  const limits = { timeoutMs: args.timeoutMs ?? DEFAULT_CALL_TIMEOUT_MS, deadline: Date.now() + (args.budgetMs ?? DEFAULT_BUDGET_MS) };
  let lastError = '';
  const answered: CallStats[] = []; // attempts that got a response, kept for the error if the call fails
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const start = Date.now();
      const res = await withRetry((signal) =>
        genai().models.generateContent({
          model,
          contents: [{ role: 'user', parts: [...mediaParts(args.media), { text: args.user }] }],
          config: {
            abortSignal: signal,
            systemInstruction: args.system,
            responseMimeType: 'application/json',
            responseJsonSchema: args.jsonSchema,
            temperature: args.temperature ?? 0.7,
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          },
        }),
        limits,
      );
      const text: string | undefined = res.text;
      const usage: Usage | undefined = res.usageMetadata;
      const s = stats(model, start, usage, args.logContext);
      answered.push(s);
      try {
        const parsed = args.zodSchema.safeParse(JSON.parse(text ?? ''));
        // A good answer after an invalid one: the stats cover both attempts, so the first one's cost is not lost.
        if (parsed.success) return { data: parsed.data, stats: sumStats(answered) };
        lastError = parsed.error.message;
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e);
      }
    }
  } catch (e) {
    // The second attempt failed to get an answer after the first one cost something.
    if (e instanceof AiError && answered.length > 0 && !e.stats) e.stats = answered;
    throw e;
  }
  throw new AiError('invalid_output', `Model output did not match schema: ${lastError.slice(0, 300)}`, answered);
}

/** Plain-text call with media, e.g. transcription. */
export async function generateText(args: {
  instruction: string;
  media: MediaPart[];
  model?: string;
  fixture?: string;
  timeoutMs?: number;
  budgetMs?: number;
  logContext?: LogContext;
}): Promise<{ text: string; stats: CallStats | null }> {
  if (aiMode() === 'fixture') {
    if (args.fixture === undefined) throw new AiError('no_fixture', 'AI is in fixture mode and no fixture was given');
    return { text: args.fixture, stats: null };
  }
  const model = args.model ?? transcribeModel();
  const start = Date.now();
  const res = await withRetry(
    (signal) =>
      genai().models.generateContent({
        model,
        contents: [{ role: 'user', parts: [...mediaParts(args.media), { text: args.instruction }] }],
        config: { abortSignal: signal, temperature: 0, thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } },
      }),
    { timeoutMs: args.timeoutMs ?? DEFAULT_CALL_TIMEOUT_MS, deadline: Date.now() + (args.budgetMs ?? 30_000) },
  );
  return { text: (res.text ?? '').trim(), stats: stats(model, start, res.usageMetadata, args.logContext) };
}
