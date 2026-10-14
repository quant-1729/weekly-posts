import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

// Payment IDs never reach a model (CLAUDE.md rule). The Gemini SDK is replaced and records what it is
// called with; AI_MODE=live only switches the client into its real code path, no network call is made.
const sdk = vi.hoisted(() => ({ requests: [] as Array<Record<string, unknown>> }));
vi.mock('@google/genai', () => ({
  ThinkingLevel: { LOW: 'LOW' },
  GoogleGenAI: class {
    models = {
      generateContent: async (req: Record<string, unknown>) => {
        sdk.requests.push(req);
        return { text: '{"ok":true}', usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 2, thoughtsTokenCount: 0 } };
      },
    };
  },
}));

import { generateJson, generateText } from '@/lib/ai/client';

const ACTIVE = 'ravi.sweets@okhdfcbank';
const URI = `upi://pay?pa=${ACTIVE}&pn=Ravi%20Sweets&cu=INR&am=120.00`;
const schema = z.object({ ok: z.literal(true) });

/** Everything the SDK was given, as one lower-case string. */
const sent = () => JSON.stringify(sdk.requests).toLowerCase();

afterEach(() => {
  vi.unstubAllEnvs();
  sdk.requests = [];
});

describe('the AI client removes payment IDs before calling Gemini', () => {
  it('generateJson: an active UPI address and a upi:// URI in the user prompt never reach the SDK', async () => {
    vi.stubEnv('AI_MODE', 'live');
    await generateJson({
      system: 'Fill the brief from the owner note.',
      user: `Owner note: 20% off sweets till Sunday. Pay ${ACTIVE} or scan ${URI} or write to hello@bakery.example.com`,
      zodSchema: schema,
      jsonSchema: {},
    });
    expect(sdk.requests).toHaveLength(1);
    const all = sent();
    expect(all).not.toContain(ACTIVE);
    expect(all).not.toContain('upi://');
    expect(all).not.toContain('okhdfcbank');
    // The rest of the note, including an ordinary email address, is passed on.
    expect(all).toContain('20% off sweets till sunday');
    expect(all).toContain('hello@bakery.example.com');
  });

  it('generateJson: also removed from the system prompt', async () => {
    vi.stubEnv('AI_MODE', 'live');
    await generateJson({ system: `Brand notes: UPI ${ACTIVE}`, user: 'Write a caption.', zodSchema: schema, jsonSchema: {} });
    expect(String((sdk.requests[0].config as { systemInstruction: string }).systemInstruction)).not.toContain(ACTIVE);
    expect(sent()).not.toContain(ACTIVE);
  });

  it('generateText: removed from the instruction too', async () => {
    vi.stubEnv('AI_MODE', 'live');
    await generateText({ instruction: `Transcribe. Context: pay ${URI}`, media: [] });
    expect(sdk.requests).toHaveLength(1);
    expect(sent()).not.toContain(ACTIVE);
    expect(sent()).not.toContain('upi://');
  });

  it('a retry after invalid output sends the redacted prompt again', async () => {
    vi.stubEnv('AI_MODE', 'live');
    await generateJson({ system: 's', user: `Pay ${ACTIVE}`, zodSchema: z.object({ ok: z.literal(false) }), jsonSchema: {}, budgetMs: 5000 }).catch(() => undefined);
    expect(sdk.requests.length).toBeGreaterThanOrEqual(2);
    expect(sent()).not.toContain(ACTIVE);
  });
});
