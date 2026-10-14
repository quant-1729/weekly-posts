// Live check (~$0.0001): Gemini via Vertex with credentials from GOOGLE_SERVICE_ACCOUNT_JSON only, as on Vercel.
// Run: node --env-file=.env.local --import tsx scripts/live-check-credentials.mts
import fs from 'node:fs';
import { z } from 'zod';
const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS!;
process.env.GOOGLE_SERVICE_ACCOUNT_JSON = fs.readFileSync(keyPath, 'utf8');
delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
const { generateJson, aiMode } = await import('@/lib/ai/client');
console.log('mode', aiMode(), '| file path set:', Boolean(process.env.GOOGLE_APPLICATION_CREDENTIALS));
const res = await generateJson({
  system: 'Reply with JSON only.',
  user: 'Return {"ok": true}.',
  zodSchema: z.object({ ok: z.boolean() }),
  jsonSchema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] },
  timeoutMs: 20_000,
  budgetMs: 40_000,
});
console.log('answer', JSON.stringify(res.data), '| usd', res.stats?.usd.toFixed(6), '| ms', res.stats?.ms);
