// V-8 live dry run: weekly batch prompt on V-7 brands (~$0.05 for 4 brands).
// Run: node --env-file=.env.local --import tsx scripts/live-check-weekly.mts
// IDS=corner-bakery,harbour-dental to choose brands.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { aiMode, estimateUsd, generateJson, textModel } from '@/lib/ai/client';
import { V2_CHANNEL_SPECS, buildWeeklyPrompt, type V2Channel, type WeeklyFact, type WeeklyOccasion } from '@/lib/ai/prompts/v2-weekly';
import { weeklyBatchJsonSchema, weeklyBatchSchema } from '@/lib/ai/schemas-v2';

if (aiMode() !== 'live') throw new Error('Not in live mode');

type Brand = { id: string; business_name: string; what_they_sell: string; customers: string; country: string; region: string; city: string; goal: 'enquiries' | 'footfall' | 'awareness'; tone: string; post_language: string; website: string | null; regulated: 'none' | 'health' | 'finance' | 'alcohol'; facts: Array<{ kind: string; label: string; value: string }> };
const brands: Brand[] = JSON.parse(readFileSync('test-data/v2/brands.json', 'utf8'));
const pastPosts: Array<{ brand_id: string; text: string }> = JSON.parse(readFileSync('test-data/v2/past-posts.json', 'utf8'));

// Week of Mon 9 Nov 2026. Occasions hand-picked for the dry run (V-9 builds the real source).
const WEEK = ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15'];
const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const OCCASIONS: Record<string, WeeklyOccasion[]> = {
  GB: [{ key: 'armistice-day', name: 'Armistice Day', date: '2026-11-11', sensitive: true, source: 'holiday' }],
  US: [{ key: 'veterans-day', name: 'Veterans Day', date: '2026-11-11', sensitive: false, source: 'holiday' }],
  SG: [],
  IN: [{ key: 'bhai-dooj', name: 'Bhai Dooj', date: '2026-11-11', sensitive: false, source: 'holiday' }, { key: 'childrens-day', name: "Children's Day", date: '2026-11-14', sensitive: false, source: 'holiday' }],
};
const CHANNELS: Record<string, V2Channel[]> = { GB: ['instagram', 'facebook', 'gbp'], US: ['facebook', 'gbp', 'instagram'], SG: ['instagram', 'facebook'], IN: ['instagram', 'facebook'] };
const AVOID: Record<string, string[]> = { 'corner-bakery': ['cheap', 'artisanal'], 'harbour-dental': ['painless', 'guaranteed'], 'cellar-door': ['wasted'], 'mogra-salon': [] };

const numbersIn = (s: string) => (s.replace(/[०-९]/g, (d) => String(d.charCodeAt(0) - 0x0966)).match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((n) => n.replace(/,/g, '').replace(/\.0+$/, ''));
const words = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}\s']/gu, ' ').split(/\s+/).filter(Boolean);
function sixGrams(s: string) { const w = words(s); const out = new Set<string>(); for (let i = 0; i + 6 <= w.length; i++) out.add(w.slice(i, i + 6).join(' ')); return out; }

let pass = true;
const results: unknown[] = [];
let usd = 0;
for (const id of (process.env.IDS ?? 'corner-bakery,harbour-dental,cellar-door,mogra-salon').split(',')) {
  const b = brands.find((x) => x.id === id)!;
  let siteFacts: Array<{ kind: string; label: string; value: string }> = [];
  if (b.website) {
    const raw = JSON.parse(readFileSync(`test-data/v2/websites/${b.website}/expected-facts.json`, 'utf8'));
    siteFacts = Array.isArray(raw) ? raw : raw.facts;
  }
  const facts: WeeklyFact[] = [...b.facts, ...siteFacts].map((f, i) => ({
    id: `f${i + 1}`, kind: f.kind, label: f.label, value: f.value,
    neverUse: b.regulated !== 'none' && f.kind === 'claim' && /guarantee|pain-free|cure|risk-free/i.test(f.value),
  }));
  const recent = pastPosts.filter((p) => p.brand_id === id).map((p) => p.text);
  const photos = [
    { id: 'p1', description: `the shop front of ${b.business_name} on a sunny morning` },
    { id: 'p2', description: `a close-up of a typical product or service at ${b.business_name}` },
    { id: 'p3', description: 'the owner smiling behind the counter' },
  ];
  const channels = CHANNELS[b.country] ?? ['instagram', 'facebook'];
  const p = buildWeeklyPrompt({
    business: { name: b.business_name, whatTheySell: b.what_they_sell, customers: b.customers, city: b.city, region: b.region, country: b.country },
    goal: b.goal, postLanguage: b.post_language, channels, count: 4,
    voice: { description: `Tone: ${b.tone}.`, examplePhrases: [], wordsToAvoid: AVOID[id] ?? [], feedback: id === 'corner-bakery' ? ['less salesy'] : [] },
    regulated: b.regulated, facts, photos, occasions: OCCASIONS[b.country] ?? [],
    weekDays: WEEK.map((d, i) => ({ date: d, weekday: WEEKDAYS[i] })), recentPosts: recent, performance: [],
  });
  const t = Date.now();
  const { data, stats } = await generateJson({ system: p.system, user: p.user, zodSchema: weeklyBatchSchema, jsonSchema: weeklyBatchJsonSchema, temperature: 0.8, timeoutMs: 40_000, budgetMs: 60_000 });
  usd += stats?.usd ?? 0;
  const ms = Date.now() - t;

  const factNumbers = new Set(facts.filter((f) => !f.neverUse).flatMap((f) => numbersIn(`${f.label} ${f.value}`)));
  const occasionNumbers = new Set((OCCASIONS[b.country] ?? []).flatMap((o) => numbersIn(o.date)));
  // Facts may repeat word for word (addresses, hours); only the wording around them counts (Req 13).
  const stripFacts = (s: string) => facts.reduce((acc, f) => acc.split(f.value).join(' | '), s);
  const recentGrams = new Set(recent.flatMap((r) => [...sixGrams(stripFacts(r))]));
  const issues: string[] = [];
  const days = new Set<string>();
  const seenGrams = new Map<string, number>();
  data.posts.forEach((post, i) => {
    const spec = V2_CHANNEL_SPECS[post.channel];
    if (!WEEK.includes(post.suggested_day)) issues.push(`#${i + 1} day ${post.suggested_day} not in week`);
    if (days.has(post.suggested_day)) issues.push(`#${i + 1} duplicate day`);
    days.add(post.suggested_day);
    if (!channels.includes(post.channel)) issues.push(`#${i + 1} channel ${post.channel} not offered`);
    if (post.caption.length > spec.captionMaxChars) issues.push(`#${i + 1} caption ${post.caption.length} chars`);
    if (post.hashtags.length < spec.hashtags[0] || post.hashtags.length > spec.hashtags[1]) issues.push(`#${i + 1} ${post.hashtags.length} hashtags`);
    if (post.image_text.headline.length > 40 || post.image_text.subline.length > 70) issues.push(`#${i + 1} image text too long`);
    const text = `${post.caption} ${post.cta} ${post.image_text.headline} ${post.image_text.subline}`;
    for (const n of numbersIn(text)) if (!factNumbers.has(n) && !occasionNumbers.has(n)) issues.push(`#${i + 1} number ${n} not in facts`);
    for (const w of AVOID[id] ?? []) if (text.toLowerCase().includes(w)) issues.push(`#${i + 1} uses avoided word "${w}"`);
    for (const g of sixGrams(stripFacts(post.caption))) {
      if (recentGrams.has(g)) issues.push(`#${i + 1} repeats past phrase "${g}"`);
      if (seenGrams.has(g) && seenGrams.get(g) !== i) issues.push(`#${i + 1} repeats batch phrase "${g}"`);
      seenGrams.set(g, i);
    }
    for (const fid of post.fact_ids) if (!facts.find((f) => f.id === fid)) issues.push(`#${i + 1} unknown fact ${fid}`);
    for (const fid of post.fact_ids) if (facts.find((f) => f.id === fid)?.neverUse) issues.push(`#${i + 1} used NEVER USE fact ${fid}`);
    if (post.photo_id && !photos.find((ph) => ph.id === post.photo_id)) issues.push(`#${i + 1} unknown photo ${post.photo_id}`);
  });
  const photoIds = data.posts.map((x) => x.photo_id).filter(Boolean);
  if (new Set(photoIds).size !== photoIds.length) issues.push('photo used twice');
  if (issues.length) pass = false;
  results.push({ id, ms, issues, posts: data.posts });

  console.log(`\n=== ${id} (${b.country}, ${b.post_language}, ${b.regulated}, goal ${b.goal}) ${ms} ms, ${data.posts.length} posts, issues ${issues.length}`);
  for (const i of issues) console.log(`  ISSUE ${i}`);
  for (const post of data.posts) {
    console.log(`  ${post.suggested_day} ${post.channel.padEnd(9)} [${post.occasion_key || '-'}] photo ${post.photo_id || '-'} facts ${post.fact_ids.join(',') || '-'} | ${post.topic}`);
    console.log(`     ${post.caption.replace(/\n+/g, ' / ').slice(0, 260)}`);
    console.log(`     cta: ${post.cta} | ${post.hashtags.join(' ')} | img: ${post.image_text.headline} / ${post.image_text.subline}`);
  }
}
mkdirSync('test-data/results', { recursive: true });
writeFileSync('test-data/results/v8-weekly-dry-run.json', JSON.stringify({ model: textModel(), usd, results }, null, 2));
console.log(`\nCost ~$${usd.toFixed(3)} (estimate per brand ~$${estimateUsd(textModel(), 4000, 3000).toFixed(3)}). ${pass ? 'PASS' : 'ISSUES FOUND'}`);
process.exit(pass ? 0 : 1);
