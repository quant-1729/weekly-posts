// R5 live check: switch-language prompt on outputs from the T-4 dry run. ~$0.01.
// Run: node --env-file=.env.local --import tsx scripts/live-check-switch.mts

import { readFileSync } from 'node:fs';
import { checkChannelOutput } from '../src/lib/ai/checks';
import { aiMode, generateJson } from '../src/lib/ai/client';
import { buildSwitchLanguagePrompt } from '../src/lib/ai/prompts/switch-language';
import {
  switchLanguageResultJsonSchema,
  switchLanguageResultSchema,
  type Channel,
  type ChannelOutput,
  type ContentLanguage,
} from '../src/lib/ai/schemas';

if (aiMode() !== 'live') throw new Error('Not in live mode');

type Run = { results: Array<{ id: string; language: ContentLanguage; result: { outputs: Record<Channel, ChannelOutput> } }> };
const v1: Run = JSON.parse(readFileSync('test-data/results/t4-dry-run-v1.json', 'utf8'));
const pick = (id: string) => v1.results.find((r) => r.id === id)!;

const cases: Array<{ id: string; channel: Channel; to: ContentLanguage }> = [
  { id: 'in-01', channel: 'ig_feed', to: 'hinglish' }, // hi -> hinglish
  { id: 'in-11', channel: 'status', to: 'hi' }, //        hinglish -> hi
  { id: 'in-22', channel: 'facebook', to: 'hi' }, //      en (regulated) -> hi
];

let worst = 0;
let pass = true;
for (const c of cases) {
  const r = pick(c.id);
  const output = r.result.outputs[c.channel];
  const prompt = buildSwitchLanguagePrompt({ channel: c.channel, from: r.language, to: c.to, output });
  const t = Date.now();
  const { data } = await generateJson({
    system: prompt.system, user: prompt.user,
    zodSchema: switchLanguageResultSchema, jsonSchema: switchLanguageResultJsonSchema, temperature: 0.4,
  });
  const ms = Date.now() - t;
  worst = Math.max(worst, ms);
  // Sources = the original output: the switched one must add no new numbers or claims.
  const sources = [output.caption, output.cta, output.image_text.headline, output.image_text.subline].join('\n');
  const issues = checkChannelOutput(c.channel, data, c.to, sources);
  if (issues.length || ms > 10_000) pass = false;
  console.log(`\n${c.id} ${c.channel} ${r.language} -> ${c.to}: ${ms} ms, issues ${issues.length}`);
  for (const i of issues) console.log(`   ${i.field} ${i.code}: ${i.detail}`);
  console.log(`   FROM: ${output.caption.replace(/\n/g, ' / ')}`);
  console.log(`   TO:   ${data.caption.replace(/\n/g, ' / ')}`);
  console.log(`   cta: ${data.cta} | img: ${JSON.stringify(data.image_text)} | tags: ${data.hashtags.join(' ')}`);
}
console.log(`\nSlowest switch ${worst} ms (target < 10000). ${pass ? 'PASS' : 'FAIL'}`);
process.exit(pass ? 0 : 1);
