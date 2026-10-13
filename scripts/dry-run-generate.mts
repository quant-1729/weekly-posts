// T-4 dry run: the generate prompt on 10 test inputs, live Gemini.
// Run: node --env-file=.env.local --import tsx scripts/dry-run-generate.mts [--yes]
// Prints a cost estimate first; refuses to run above $0.50 without --yes.
// Writes test-data/results/t4-dry-run.json for review.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { checkAllOutputs } from '../src/lib/ai/checks';
import { aiMode, estimateUsd, generateJson, textModel } from '../src/lib/ai/client';
import { buildGeneratePrompt, ownerSourcesText, type GenerateInput } from '../src/lib/ai/prompts/generate';
import { isRegulatedCategory } from '../src/lib/ai/regulated';
import { generateResultJsonSchema, generateResultSchema, type ContentLanguage } from '../src/lib/ai/schemas';

type Brand = {
  id: string; business_name: string; category: string; city: string;
  products: { name: string; price: string; unit: string; note: string }[];
  audience: string; tone: string; default_language: ContentLanguage; notes: string;
};
type Input = {
  id: string; brand_id: string; input_type: 'text' | 'voice' | 'photo'; text: string;
  photo_description: string | null; notes: string;
};

const IDS = process.env.DRY_RUN_IDS?.split(',') ?? ['in-01', 'in-03', 'in-06', 'in-08', 'in-11', 'in-14', 'in-17', 'in-21', 'in-22', 'in-29'];
const EXPECT_NEEDS_INPUT = new Set(['in-06']);
const MAX_USD = 0.5;

const brands: Brand[] = JSON.parse(readFileSync('test-data/brands.json', 'utf8'));
const inputs: Input[] = JSON.parse(readFileSync('test-data/inputs-30.json', 'utf8'));
const cases = IDS.map((id) => {
  const input = inputs.find((i) => i.id === id)!;
  const brand = brands.find((b) => b.id === input.brand_id)!;
  const g: GenerateInput = {
    brand: {
      business_name: brand.business_name, category: brand.category, city: brand.city,
      products: brand.products, audience: brand.audience, tone: brand.tone, notes: brand.notes,
    },
    regulated: isRegulatedCategory(brand.category),
    language: brand.default_language,
    // No real photos in the test set yet; the description stands in for the image.
    input: {
      type: input.input_type,
      text: input.photo_description ? `${input.text}\n(Photo shows: ${input.photo_description})` : input.text,
    },
    hasPhoto: false,
  };
  return { input, brand, g };
});

// Estimate: prompt size from the real prompt (~4 chars/token), output ~2,500 incl. thinking.
const model = textModel();
const estIn = cases.reduce((n, c) => { const p = buildGeneratePrompt(c.g); return n + (p.system.length + p.user.length) / 3; }, 0);
const estUsd = estimateUsd(model, estIn, cases.length * 2500);
console.log(`Dry run: ${cases.length} calls on ${model}, estimated ~$${estUsd.toFixed(3)} (mode: ${aiMode()})`);
if (aiMode() !== 'live') { console.error('Not in live mode; set Vertex or GEMINI_API_KEY in .env.local'); process.exit(1); }
if (estUsd > MAX_USD && !process.argv.includes('--yes')) { console.error(`Above $${MAX_USD}; rerun with --yes after approval.`); process.exit(1); }

const results = [];
let usd = 0;
for (const c of cases) {
  const { system, user } = buildGeneratePrompt(c.g);
  const t = Date.now();
  try {
    const { data, stats } = await generateJson({
      system, user, zodSchema: generateResultSchema, jsonSchema: generateResultJsonSchema,
    });
    usd += stats?.usd ?? 0;
    const issues = data.status === 'ok' ? checkAllOutputs(data.outputs, c.g.language, ownerSourcesText(c.g)) : [];
    const statusOk = EXPECT_NEEDS_INPUT.has(c.input.id) ? data.status === 'needs_input' : data.status === 'ok';
    results.push({ id: c.input.id, brand: c.brand.id, language: c.g.language, regulated: c.g.regulated, ms: Date.now() - t, statusOk, issues, result: data });
    console.log(`${c.input.id} ${c.g.language.padEnd(8)} ${data.status.padEnd(11)} ${statusOk ? 'status-ok' : 'STATUS-WRONG'} issues=${issues.length} ${Date.now() - t}ms`);
    for (const i of issues) console.log(`    ${i.channel}.${i.field} ${i.code}: ${i.detail}`);
  } catch (e) {
    results.push({ id: c.input.id, error: String(e) });
    console.log(`${c.input.id} ERROR ${String(e).slice(0, 200)}`);
  }
}

mkdirSync('test-data/results', { recursive: true });
writeFileSync('test-data/results/t4-dry-run.json', JSON.stringify({ model, usd, results }, null, 2));
console.log(`\nActual cost ~$${usd.toFixed(3)}. Results: test-data/results/t4-dry-run.json`);
