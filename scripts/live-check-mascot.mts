// Mascot concepts prompt live check, global (~$0.005). Run: node --env-file=.env.local --import tsx scripts/live-check-mascot.mts
import { aiMode, generateJson } from '@/lib/ai/client';
import { findBlockedTerm } from '@/lib/ai/mascot-blocklist';
import { buildMascotPrompt } from '@/lib/ai/prompts/mascot';
import { mascotConceptsJsonSchema, mascotConceptsSchema } from '@/lib/ai/schemas';
if (aiMode() !== 'live') throw new Error('Not in live mode');
const cases = [
  { businessName: 'Corner Bakery', category: 'bakery', city: 'London', audience: 'neighbours and commuters', tone: 'friendly', productNames: ['sourdough', 'croissant', 'cinnamon bun'], colors: { primary: '#7a1e2b', accent: '#f2a900' }, hint: '', postLanguage: 'en-GB' },
  { businessName: 'Mogra Beauty Salon', category: 'beauty salon', city: 'Mumbai', audience: 'women in Bandra', tone: 'friendly', productNames: ['haircut', 'facial', 'bridal makeup'], colors: { primary: '#8e3b8a' }, hint: 'something with a flower', postLanguage: 'hi' },
  { businessName: 'Corner Bakery', category: 'bakery', city: 'London', audience: '', tone: 'friendly', productNames: [], colors: {}, hint: 'make it look like Paddington Bear', postLanguage: 'en-GB' },
];
for (const c of cases) {
  const p = buildMascotPrompt(c);
  const t = Date.now();
  const { data } = await generateJson({ system: p.system, user: p.user, zodSchema: mascotConceptsSchema, jsonSchema: mascotConceptsJsonSchema, temperature: 0.9, timeoutMs: 20000, budgetMs: 30000 });
  console.log(`\n${c.businessName} (${c.postLanguage}) hint "${c.hint}" ${Date.now() - t} ms refused=${data.refused} ${data.refusal_reason}`);
  for (const k of data.concepts) console.log(`  ${k.name} / ${k.name_local} | ${k.spec.body.shape} ${k.spec.head} ${k.spec.neck} | blocked: ${findBlockedTerm(`${k.name} ${k.personality}`, [c.businessName]) ?? 'no'} | ${k.personality}`);
}
