import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

// H-2: AiError carries the stats of every attempt that got a response. The Gemini SDK is replaced, so
// no network call is made; AI_MODE=live only switches the client into its real code path.
const sdk = vi.hoisted(() => ({ answers: [] as Array<unknown>, calls: 0 }));
vi.mock('@google/genai', () => ({
  ThinkingLevel: { LOW: 'LOW' },
  GoogleGenAI: class {
    models = {
      generateContent: async () => {
        const next = sdk.answers[sdk.calls++];
        if (next instanceof Error) throw next;
        return next;
      },
    };
  },
}));

import { AiError, estimateUsd, generateJson, textModel } from '@/lib/ai/client';
import { failedCallUsd } from '@/lib/usage';

const schema = z.object({ ok: z.literal(true) });
const answer = (text: string, inTokens: number, outTokens: number) => ({
  text,
  usageMetadata: { promptTokenCount: inTokens, candidatesTokenCount: outTokens, thoughtsTokenCount: 0 },
});
const run = () => generateJson({ system: 's', user: 'u', zodSchema: schema, jsonSchema: {}, budgetMs: 5000 });

afterEach(() => {
  vi.unstubAllEnvs();
  sdk.answers = [];
  sdk.calls = 0;
});

describe('AiError carries the stats of the attempts that answered (H-2)', () => {
  it('invalid output twice: both attempts are in stats and their usd is the sum', async () => {
    vi.stubEnv('AI_MODE', 'live');
    sdk.answers = [answer('not json', 1000, 200), answer('{"ok":false}', 3000, 500)];
    const err = await run().catch((e) => e);
    expect(err).toBeInstanceOf(AiError);
    expect(err.code).toBe('invalid_output');
    expect(err.stats).toHaveLength(2);
    const a = estimateUsd(textModel(), 1000, 200);
    const b = estimateUsd(textModel(), 3000, 500);
    expect(err.stats.map((s: { usd: number }) => s.usd)).toEqual([a, b]);
    expect(err.stats[1]).toMatchObject({ model: textModel(), inputTokens: 3000, outputTokens: 500 });
    expect(failedCallUsd(err)).toBeCloseTo(a + b, 12);
    expect(failedCallUsd(err)).toBeGreaterThan(0);
  });

  it('invalid output, then the second call itself fails: the first answer is not lost', async () => {
    vi.stubEnv('AI_MODE', 'live');
    sdk.answers = [answer('not json', 1000, 200), new Error('400 invalid argument')]; // not transient: no retry
    const err = await run().catch((e) => e);
    expect(err).toBeInstanceOf(AiError);
    expect(err.code).toBe('call_failed');
    expect(err.stats).toHaveLength(1);
    expect(failedCallUsd(err)).toBeCloseTo(estimateUsd(textModel(), 1000, 200), 12);
  });

  it('a call that never got a response has no stats', async () => {
    vi.stubEnv('AI_MODE', 'live');
    sdk.answers = [new Error('400 invalid argument')];
    const err = await run().catch((e) => e);
    expect(err).toBeInstanceOf(AiError);
    expect(err.stats).toBeUndefined();
    expect(failedCallUsd(err)).toBe(0);
  });

  it('a good answer on the second attempt returns data, with stats covering both attempts', async () => {
    vi.stubEnv('AI_MODE', 'live');
    sdk.answers = [answer('nope', 10, 10), answer('{"ok":true}', 20, 5)];
    const res = await run();
    expect(res.data).toEqual({ ok: true });
    expect(res.stats?.inputTokens).toBe(30);
    expect(res.stats?.outputTokens).toBe(15);
    expect(res.stats?.usd).toBeCloseTo(estimateUsd(res.stats!.model, 10, 10) + estimateUsd(res.stats!.model, 20, 5), 12);
  });
});
