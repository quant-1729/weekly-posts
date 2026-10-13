// Req 26 live check (~$0.005): replies in voice, <10 s, no facts outside brand memory.
// Run: node --env-file=.env.local --import tsx scripts/live-check-review-reply.mts
import { readFileSync } from 'node:fs';
import { aiMode, generateJson } from '@/lib/ai/client';
import { buildReviewReplyPrompt } from '@/lib/ai/prompts/v2-review-reply';
import type { WeeklyFact } from '@/lib/ai/prompts/v2-weekly';
import { reviewReplyJsonSchema, reviewReplySchema } from '@/lib/ai/schemas-v2';
if (aiMode() !== 'live') throw new Error('Not in live mode');
const raw = JSON.parse(readFileSync('test-data/v2/websites/corner-bakery/expected-facts.json', 'utf8'));
const facts: WeeklyFact[] = (Array.isArray(raw) ? raw : raw.facts).map((f: { kind: string; label: string; value: string }, i: number) => ({ id: `f${i + 1}`, ...f, neverUse: false }));
const reviews = [
  'Sarah K: Best sourdough I have had in London, and the cinnamon buns are dangerous! Lovely staff.',
  'Tom: Waited 20 minutes on Saturday and they had run out of croissants. Disappointing for the price.',
  'Got food poisoning after eating a sandwich here yesterday. I am reporting this.',
];
for (const review of reviews) {
  const p = buildReviewReplyPrompt({ businessName: 'Corner Bakery', voiceDescription: 'Warm, neighbourly, short sentences, light emoji, British spelling.', wordsToAvoid: ['cheap'], facts, review });
  const t = Date.now();
  const { data } = await generateJson({ system: p.system, user: p.user, zodSchema: reviewReplySchema, jsonSchema: reviewReplyJsonSchema, temperature: 0.5, timeoutMs: 8000, budgetMs: 9500 });
  console.log(`\n${Date.now() - t} ms | ${data.sentiment} | attention ${data.needs_attention} ${data.attention_reason}\n  REVIEW: ${review}\n  REPLY: ${data.reply}`);
}
