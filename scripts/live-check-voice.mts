// Voice prompt live check on V-7 past posts (~$0.01). Example phrases must be verbatim.
// Run: node --env-file=.env.local --import tsx scripts/live-check-voice.mts
import { readFileSync } from 'node:fs';
import { aiMode, generateJson } from '@/lib/ai/client';
import { buildVoicePrompt } from '@/lib/ai/prompts/v2-memory';
import { voiceJsonSchema, voiceSchema } from '@/lib/ai/schemas-v2';

if (aiMode() !== 'live') throw new Error('Not in live mode');
const brands = JSON.parse(readFileSync('test-data/v2/brands.json', 'utf8'));
const posts: Array<{ brand_id: string; text: string }> = JSON.parse(readFileSync('test-data/v2/past-posts.json', 'utf8'));
let pass = true;
for (const id of (process.env.IDS ?? 'spoke-and-sprocket,harbour-dental').split(',')) {
  const b = brands.find((x: { id: string }) => x.id === id);
  const samples = posts.filter((p) => p.brand_id === id).map((p) => p.text);
  const p = buildVoicePrompt({ businessName: b.business_name, pickedTone: b.tone, pastPosts: samples, websiteCopy: '' });
  const t = Date.now();
  const { data } = await generateJson({ system: p.system, user: p.user, zodSchema: voiceSchema, jsonSchema: voiceJsonSchema, temperature: 0.2 });
  const all = samples.join('\n').toLowerCase();
  const invented = data.example_phrases.filter((ph) => !all.includes(ph.toLowerCase()));
  if (invented.length) pass = false;
  console.log(`\n${id} (${b.tone}) ${Date.now() - t} ms\n  ${data.voice_description}\n  phrases: ${JSON.stringify(data.example_phrases)}\n  invented: ${JSON.stringify(invented)}\n  avoid: ${JSON.stringify(data.avoid_suggestions)} | emoji ${data.emoji_use} | ${data.typical_length}`);
}
console.log(pass ? '\nPASS' : '\nFAIL (invented phrases)');
process.exit(pass ? 0 : 1);
