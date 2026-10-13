// Req 15 live check: rewrite with instruction (<15 s), refuses facts not in FACTS (~$0.005).
// Run: node --env-file=.env.local --import tsx scripts/live-check-rewrite.mts
import { readFileSync } from 'node:fs';
import { aiMode, generateJson } from '@/lib/ai/client';
import { buildRewritePrompt, type WeeklyFact } from '@/lib/ai/prompts/v2-weekly';
import { rewriteJsonSchema, rewriteSchema } from '@/lib/ai/schemas-v2';

if (aiMode() !== 'live') throw new Error('Not in live mode');
const raw = JSON.parse(readFileSync('test-data/v2/websites/corner-bakery/expected-facts.json', 'utf8'));
const facts: WeeklyFact[] = (Array.isArray(raw) ? raw : raw.facts).map((f: { kind: string; label: string; value: string }, i: number) => ({ id: `f${i + 1}`, ...f, neverUse: false }));
const post = {
  caption: 'Good bread takes its own sweet time.\nEvery sourdough loaf gets a full 24 hours of proving before it meets the oven.\nIt makes all the difference to the crust and crumb.\nWe are here until 6pm today if you would like to pick one up.',
  cta: 'Drop in before 6pm to collect a loaf',
  hashtags: ['#SourdoughLoaf', '#RealBread', '#CamberwellFood'],
  image_text: { headline: 'Slow Proved Sourdough', subline: 'Proved for 24 hours for proper flavour' },
};
let pass = true;
for (const instruction of (process.env.ONLY ? [process.env.ONLY] : ['shorter and less salesy', 'add 20% off all loaves this week'])) {
  const p = buildRewritePrompt({ channel: 'instagram', postLanguage: 'en-GB', voiceDescription: 'Warm, neighbourly, short sentences, light emoji.', wordsToAvoid: ['cheap'], facts, post, instruction });
  const t = Date.now();
  const { data } = await generateJson({ system: p.system, user: p.user, zodSchema: rewriteSchema, jsonSchema: rewriteJsonSchema, temperature: 0.6, timeoutMs: 10_000, budgetMs: 14_000 });
  const ms = Date.now() - t;
  const invented = /20\s?%/.test(data.caption + data.image_text.headline + data.image_text.subline);
  if (ms > 15000 || invented) pass = false;
  console.log(`\n"${instruction}" -> ${ms} ms${invented ? ' INVENTED 20%' : ''}\n  ${data.caption.replace(/\n/g, ' / ')}\n  img: ${data.image_text.headline} / ${data.image_text.subline}\n  note: ${data.note || '-'}`);
}
console.log(pass ? '\nPASS' : '\nFAIL');
process.exit(pass ? 0 : 1);
