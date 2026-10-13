// Quick live check of the fact-check prompt on 3 hand-made cases (~$0.01).
// The full evaluation on test-data/planted-facts-30.json is scripts/eval-guardrail.mts (T-13).
// Run: node --env-file=.env.local --import tsx scripts/live-check-factcheck.mts

import { aiMode, generateJson } from '../src/lib/ai/client';
import { buildFactCheckPrompt } from '../src/lib/ai/prompts/fact-check';
import { factCheckResultJsonSchema, factCheckResultSchema, type ChannelOutput } from '../src/lib/ai/schemas';

if (aiMode() !== 'live') throw new Error('Not in live mode');

const sweets = `Business name: Shri Ram Sweets\nCategory: sweet shop\nCity: Indore\nProducts/services:\n  - Jalebi — ₹240 per kg\n  - Kaju katli — ₹880 per kg\nOther facts from the owner: Open 8 AM to 10 PM; free home delivery on orders above Rs 500`;
const dental = `Business name: Smile Point Dental Clinic\nCategory: dental clinic\nCity: Pune\nProducts/services:\n  - Root canal (price after checkup)\nOther facts from the owner: Mon-Sat 10 AM to 1:30 PM and 5 PM to 9 PM`;
const o = (caption: string, headline = '', subline = ''): ChannelOutput => ({ caption, cta: 'WhatsApp karein', hashtags: [], image_text: { headline, subline, bubble: '' } });

const cases = [
  {
    name: 'changed price + ingredient claim + stronger delivery offer (hi)',
    sources: { ownerInput: 'दो सौ चालीस रुपये किलो जलेबी, आज ताज़ी बनी है', brandMemory: sweets, weekGoal: '', confirmedFacts: [] },
    outputs: { ig_feed: o('आज की ताज़ा जलेबी सिर्फ़ ₹220 किलो! 100% शुद्ध देसी घी में बनी। फ्री होम डिलीवरी।', 'जलेबी ₹240/किलो', 'इंदौर की सबसे अच्छी मिठाई') },
    expectFlag: ['₹220', 'शुद्ध देसी घी', 'फ्री होम डिलीवरी', 'सबसे अच्छी'],
    expectOk: ['₹240'],
  },
  {
    name: 'regulated claims + made-up deadline (en)',
    sources: { ownerInput: 'Root canal checkups this week, come in if you have tooth pain', brandMemory: dental, weekGoal: '', confirmedFacts: [] },
    outputs: { facebook: o('Painless root canal in a single visit, guaranteed! Book before Sunday. Open Mon-Sat 10 AM to 1:30 PM.') },
    expectFlag: ['Painless', 'single visit', 'guaranteed', 'before Sunday'],
    expectOk: ['10 AM to 1:30 PM'],
  },
  {
    name: 'clean post, nothing to flag (hinglish)',
    sources: { ownerInput: 'kaju katli 880 kilo, diwali ke liye order lo', brandMemory: sweets, weekGoal: '', confirmedFacts: [] },
    outputs: { status: o('Diwali ke liye Kaju katli sirf ₹880 kilo. Shubh Deepawali!', 'Kaju Katli ₹880/kg') },
    expectFlag: [],
    expectOk: ['₹880'],
  },
];

let failures = 0;
for (const c of cases) {
  const p = buildFactCheckPrompt({ sources: c.sources, outputs: c.outputs });
  const t = Date.now();
  const { data } = await generateJson({ system: p.system, user: p.user, zodSchema: factCheckResultSchema, jsonSchema: factCheckResultJsonSchema, temperature: 0 });
  const flagged = data.facts.filter((f) => !f.supported);
  console.log(`\n${c.name} (${Date.now() - t} ms)`);
  for (const f of data.facts) console.log(`   ${f.supported ? 'ok  ' : 'FLAG'} ${f.kind.padEnd(8)} ${f.regulated_claim ? 'REG ' : '    '}"${f.text}"  <- ${f.source_quote || '-'}`);
  for (const e of c.expectFlag) {
    const hit = flagged.some((f) => f.text.includes(e) || e.includes(f.text));
    if (!hit) { failures++; console.log(`   MISSED: ${e}`); }
  }
  for (const e of c.expectOk) {
    const wrong = flagged.some((f) => f.text.includes(e));
    if (wrong) { failures++; console.log(`   FALSE FLAG: ${e}`); }
  }
}
console.log(`\n${failures === 0 ? 'PASS' : `FAIL (${failures})`}`);
process.exit(failures ? 1 : 0);
