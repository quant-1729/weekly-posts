// R8 evaluation: both guardrail layers on test-data/planted-facts-30.json (~$0.06).
// Recall target 100% (every planted fact overlaps a flag in the same field);
// false positives (flags on `allowed` spans or on clean cases) are reported.
// Run: node --env-file=.env.local --import tsx scripts/eval-guardrail.mts
// Uses src/lib/guardrail when it exists (T-13); until then the raw layers.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { checkChannelOutput } from '@/lib/ai/checks';
import { aiMode, generateJson } from '@/lib/ai/client';
import { buildFactCheckPrompt } from '@/lib/ai/prompts/fact-check';
import { factCheckResultJsonSchema, factCheckResultSchema, type ChannelOutput, type ContentLanguage } from '@/lib/ai/schemas';

if (aiMode() !== 'live') throw new Error('Not in live mode');

type Case = {
  id: string; brand_id: string; language: ContentLanguage; owner_input: string; regulated: boolean;
  output: { caption: string; cta: string; image_text: { headline: string; subline: string } };
  planted: Array<{ text: string; kind: string; where: string }>; allowed: string[];
};
const cases: Case[] = JSON.parse(readFileSync('test-data/planted-facts-30.json', 'utf8'));
const brands = JSON.parse(readFileSync('test-data/brands.json', 'utf8'));
const FIELD: Record<string, string> = { caption: 'caption', cta: 'cta', headline: 'image_text.headline', subline: 'image_text.subline' };

function brandBlock(b: { business_name: string; category: string; city: string; products: Array<{ name: string; price: string; unit: string; note: string }>; audience: string; tone: string; notes: string }) {
  const products = b.products.map((p) => `  - ${p.name}${p.price ? ` — ₹${p.price} ${p.unit}` : ''}${p.note ? ` (${p.note})` : ''}`).join('\n');
  return `Business name: ${b.business_name}\nCategory: ${b.category}\nCity: ${b.city}\nProducts/services:\n${products}\nAudience: ${b.audience}\nTone: ${b.tone}\nOther facts from the owner: ${b.notes}`;
}
const overlaps = (a: string, b: string) => a.includes(b) || b.includes(a);

let planted = 0, caught = 0, fp = 0, usd = 0;
const rows = [];
for (const c of cases) {
  const b = brands.find((x: { id: string }) => x.id === c.brand_id);
  const block = brandBlock(b);
  const out: ChannelOutput = { caption: c.output.caption, cta: c.output.cta, hashtags: [], image_text: { headline: c.output.image_text.headline, subline: c.output.image_text.subline, bubble: '' } };
  const sources = `${block}\n${c.owner_input}`;

  // Layer 1: deterministic (only the fact codes; channel 'facebook' avoids image/hashtag limits).
  const det = checkChannelOutput('facebook', out, c.language, sources)
    .filter((i) => ['unsupported_number', 'unsupported_phrase', 'contact_detail'].includes(i.code))
    .map((i) => ({ field: i.field, text: i.detail, layer: 'code' }));

  // Layer 2: AI fact-check.
  const p = buildFactCheckPrompt({ sources: { ownerInput: c.owner_input, brandMemory: block, weekGoal: '', confirmedFacts: [] }, outputs: { facebook: out } });
  const { data, stats } = await generateJson({ system: p.system, user: p.user, zodSchema: factCheckResultSchema, jsonSchema: factCheckResultJsonSchema, temperature: 0 });
  usd += stats?.usd ?? 0;
  const ai = data.facts.filter((f) => !f.supported).map((f) => ({ field: f.field, text: f.text, layer: 'ai' }));
  const flags = [...det, ...ai];

  const missed = c.planted.filter((pl) => !flags.some((f) => f.field === FIELD[pl.where] && overlaps(f.text, pl.text)));
  const falsePos = flags.filter((f) => c.allowed.some((a) => overlaps(f.text, a)) && !c.planted.some((pl) => overlaps(f.text, pl.text)));
  planted += c.planted.length;
  caught += c.planted.length - missed.length;
  fp += falsePos.length;
  rows.push({ id: c.id, missed, falsePos, flags });
  console.log(`${c.id} ${c.language.padEnd(8)} planted ${c.planted.length} missed ${missed.length} fp ${falsePos.length}` +
    (missed.length ? `  MISSED: ${missed.map((m) => m.text).join(' | ')}` : '') +
    (falsePos.length ? `  FP: ${falsePos.map((f) => `${f.layer}:${f.text}`).join(' | ')}` : ''));
}
mkdirSync('test-data/results', { recursive: true });
writeFileSync('test-data/results/guardrail-eval.json', JSON.stringify({ planted, caught, falsePositives: fp, usd, rows }, null, 2));
console.log(`\nRecall ${caught}/${planted} (${((100 * caught) / planted).toFixed(1)}%), false positives ${fp}, cost ~$${usd.toFixed(3)}`);
process.exit(caught === planted ? 0 : 1);
