// "Keep my look" live check (C-17), about 1 cent: one style read on sample post images, then the kit mapping.
// Run: node --env-file=.env.local --import tsx scripts/live-check-style.mts [image ...]
// Without arguments it uses up to 6 English sample posts from test-results/render/samples-v2 (made by the renderer).
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { aiMode, generateJson } from '@/lib/ai/client';
import { STYLE_READ_SYSTEM, buildStyleReadUser } from '@/lib/ai/prompts/v3';
import { styleReadJsonSchema, styleReadSchema } from '@/lib/ai/schemas-v3';
import { DEFAULT_KIT } from '@/lib/design/types';
import { suggestKitDetailed } from '@/lib/style/kit';
import { shrinkForModel } from '@/lib/uploads/image';

if (aiMode() !== 'live') throw new Error('Not in live mode (check .env.local: AI_MODE, GOOGLE_GENAI_USE_VERTEXAI, GOOGLE_CLOUD_PROJECT)');

let files = process.argv.slice(2);
if (files.length === 0) {
  const dir = 'test-results/render/samples-v2';
  files = readdirSync(dir)
    .filter((f) => /english/.test(f) && f.endsWith('.png'))
    .slice(0, 6)
    .map((f) => path.join(dir, f));
}
if (files.length < 3) throw new Error(`Need at least 3 images, got ${files.length}`);

const media = [];
for (const f of files) media.push({ mimeType: 'image/jpeg', data: await shrinkForModel(readFileSync(f), 768) });

const t = Date.now();
const { data, stats } = await generateJson({
  system: STYLE_READ_SYSTEM,
  user: buildStyleReadUser({ brandName: 'Sample Bakery', sells: 'bakery', imageCount: media.length, websiteColors: [] }),
  media,
  zodSchema: styleReadSchema,
  jsonSchema: styleReadJsonSchema,
  temperature: 0.2,
  timeoutMs: 40_000,
  budgetMs: 60_000,
});
console.log('images:', files.length, files.map((f) => path.basename(f)));
console.log('ms:', Date.now() - t, 'usd:', stats?.usd.toFixed(5), 'tokens in/out:', stats?.inputTokens, stats?.outputTokens);
console.log('read:', JSON.stringify(data, null, 2));

const current = { ...DEFAULT_KIT, colors: { primary: '#1F4E9C', secondary: '#EAF1FB', accent: '#F59E0B', background: '#FFFFFF' } };
const s = suggestKitDetailed(data, current, 'instagram');
console.log('suggestion clear:', s.clear, 'notes:', s.notes, 'message:', s.message);
console.log('kit:', JSON.stringify(s.kit));
