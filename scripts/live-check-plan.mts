// R3 live check: weekly plan prompt on two brands/weeks (~$0.01).
// Run: node --env-file=.env.local --import tsx scripts/live-check-plan.mts

import { readFileSync } from 'node:fs';
import { aiMode, generateJson } from '@/lib/ai/client';
import { buildPlanPrompt, type PlanOccasion } from '@/lib/ai/prompts/plan';
import { isRegulatedCategory } from '@/lib/ai/regulated';
import { planResultJsonSchema, planResultSchema, type ContentLanguage } from '@/lib/ai/schemas';

if (aiMode() !== 'live') throw new Error('Not in live mode');

type Fest = { key: string; name_en: string; name_hi: string; date: string; end_date: string | null; lead_days: number; post_angle_en: string; good_for: string[]; type: string; religion: string | null };
const cal: Fest[] = JSON.parse(readFileSync('src/lib/calendar/festivals.json', 'utf8'));
const brands = JSON.parse(readFileSync('test-data/brands.json', 'utf8'));

function week(monday: string) {
  const days = [];
  const d = new Date(`${monday}T00:00:00Z`);
  for (let i = 0; i < 7; i++) {
    const x = new Date(d.getTime() + i * 86400000);
    days.push({ date: x.toISOString().slice(0, 10), weekday: x.toLocaleDateString('en-IN', { weekday: 'long', timeZone: 'UTC' }) });
  }
  return days;
}
// Simple stand-in for the plan module's selection: occasions in the week, or starting
// within lead_days after it, that suit the category; seasons and observances excluded.
function occasionsFor(days: { date: string }[], goodFor: string): PlanOccasion[] {
  const start = days[0].date, end = days[6].date;
  return cal
    .filter((f) => f.type === 'festival' || f.type === 'national' || f.type === 'shopping')
    .filter((f) => (f.good_for.includes(goodFor) || f.good_for.includes('all')))
    .filter((f) => (f.end_date ?? f.date) >= start && f.date <= new Date(new Date(`${end}T00:00:00Z`).getTime() + 3 * 86400000).toISOString().slice(0, 10))
    .map((f) => ({ key: f.key, name: f.name_en, name_hi: f.name_hi, date: f.date, end_date: f.end_date, angle: f.post_angle_en, sensitive: /muharram/.test(f.key) }));
}

const cases = [
  { brand: 'brand-sweets', goodFor: 'sweets', monday: '2026-11-02', goal: 'offer' as const, detail: '2 kilo se upar 5% chhoot, gift box order par', lang: undefined },
  { brand: 'brand-dental', goodFor: 'dental', monday: '2026-10-12', goal: 'enquiries' as const, detail: '', lang: undefined },
];

let pass = true;
for (const c of cases) {
  const b = brands.find((x: { id: string }) => x.id === c.brand);
  const days = week(c.monday);
  const occasions = occasionsFor(days, c.goodFor);
  const p = buildPlanPrompt({
    brand: { business_name: b.business_name, category: b.category, city: b.city, products: b.products, audience: b.audience, tone: b.tone, notes: b.notes },
    regulated: isRegulatedCategory(b.category),
    language: (c.lang ?? b.default_language) as ContentLanguage,
    goal: c.goal, goalDetail: c.detail, weekDays: days, occasions, recentTitles: [],
  });
  const t = Date.now();
  const { data } = await generateJson({ system: p.system, user: p.user, zodSchema: planResultSchema, jsonSchema: planResultJsonSchema, temperature: 0.8 });
  const ms = Date.now() - t;
  const dayset = new Set(days.map((d) => d.date));
  const okDays = data.ideas.every((i) => dayset.has(i.suggested_day));
  const uniqueDays = new Set(data.ideas.map((i) => i.suggested_day)).size === data.ideas.length;
  const usesOccasion = occasions.length === 0 || data.ideas.some((i) => occasions.some((o) => o.key === i.occasion_key));
  const ok = ms < 15000 && okDays && uniqueDays && usesOccasion;
  if (!ok) pass = false;
  console.log(`\n${c.brand} week ${c.monday} (${occasions.map((o) => o.key).join(', ') || 'no occasions'}): ${ms} ms, ${data.ideas.length} ideas, days ok ${okDays}, unique ${uniqueDays}, occasion used ${usesOccasion}`);
  for (const i of data.ideas) console.log(`  ${i.suggested_day} [${i.occasion_key || '-'}] ${i.title}\n      ${i.description}\n      photo: ${i.photo_tip} | starter: ${i.starter_text}`);
}
console.log(`\n${pass ? 'PASS' : 'FAIL'}`);
process.exit(pass ? 0 : 1);
