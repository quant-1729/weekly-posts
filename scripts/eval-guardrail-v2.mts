// v2 guardrail evaluation on test-data/v2/guardrail:
//   AC 11 (planted-30) and AC 12 (regulated-20): live AI, about $0.15.
//   AC 13 (repetition.json): no AI, free.
// Runs the real library (src/lib/guardrail runGuardrail / findRepeats), not the raw layers:
// both layers merged, the regulated rules, words to avoid, the AI-failure fallback.
// Each test brand is seeded into an in-memory database (the real schema on PGlite), so the
// library loads facts, regulated group and history the way production does.
// Run: node --env-file=.env.local --import tsx scripts/eval-guardrail-v2.mts [planted|regulated|repetition]
//      (no argument = all three; "repetition" alone needs no AI)

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { aiMode } from '@/lib/ai/client';
import { createMockDb, setMockDbForTests, type MockDb } from '@/lib/db/mock';
import { findRepeats, loadGuardrailContext, runGuardrail, type Flag } from '@/lib/guardrail';

const which = process.argv[2] ?? 'both';
const needsAi = which !== 'repetition';
if (needsAi && aiMode() !== 'live') throw new Error('Not in live mode');
process.env.DATA_BACKEND = 'mock'; // the seeded in-memory database, whatever .env.local says

type Fact = { kind: string; label: string; value: string };
type Post = { caption: string; cta: string; image_text: { headline: string; subline: string } };
type BrandRow = { id: string; what_they_sell: string; regulated: string; website: string | null; facts: Fact[] };
const brands: BrandRow[] = JSON.parse(readFileSync('test-data/v2/brands.json', 'utf8'));
const overlaps = (a: string, b: string) => a.length > 0 && b.length > 0 && (a.includes(b) || b.includes(a));
const channelOf = (c: string) => (c === 'google_business_profile' ? 'gbp' : (c as 'instagram' | 'facebook' | 'linkedin'));

function factRowsFor(brandId: string, inline?: { facts?: Fact[] }): Fact[] {
  let all: Fact[] = inline?.facts ?? [];
  const b = brands.find((x) => x.id === brandId);
  if (b) {
    all = [...b.facts];
    if (b.website) {
      const raw = JSON.parse(readFileSync(`test-data/v2/websites/${b.website}/expected-facts.json`, 'utf8'));
      all.push(...(Array.isArray(raw) ? raw : raw.facts));
    }
  }
  return all;
}

const db: MockDb = await createMockDb();
setMockDbForTests(db);
const seeded = new Map<string, { userId: string; brandId: string }>();
// Website extraction marks a fact that promises a result (Req 12); the test sites' banners do.
const PROMISE = /guarantee|cure|pain.?free/i;

async function brandFor(key: string, category: string, regulated: string, facts: Fact[]) {
  const have = seeded.get(key);
  if (have) return have;
  const email = `${key}@eval.example.com`;
  const userId = await db.withAdmin(async (tx) => {
    const [u] = await tx.query<{ id: string }>('insert into auth.users (email) values ($1) returning id', [email]);
    await tx.query('insert into public.profiles (id, email, consent_at) values ($1, $2, now())', [u.id, email]);
    return u.id;
  });
  const brandId = await db.withUser(userId, async (tx) => {
    const [b] = await tx.query<{ id: string }>('select public.create_brand($1) as id', [key]);
    await tx.query('update public.brand_memory set category = $2, regulated = $3::public.regulated_category where brand_id = $1', [b.id, category, regulated]);
    for (const f of facts) {
      await tx.query(
        `insert into public.brand_facts (brand_id, kind, label, value, source_type, outcome_promise)
         values ($1, $2::public.fact_kind, $3, $4, 'website', $5)`,
        [b.id, f.kind, f.label, f.value, regulated !== 'none' && PROMISE.test(f.value)],
      );
    }
    return b.id;
  });
  const out = { userId, brandId };
  seeded.set(key, out);
  return out;
}

async function brandForTestBrand(brandId: string, inline?: { id: string; what_they_sell: string; regulated: string; facts: Fact[] }) {
  const b = brands.find((x) => x.id === brandId) ?? inline;
  if (!b) throw new Error(`Unknown test brand ${brandId}`);
  return brandFor(b.id, b.what_they_sell, b.regulated, factRowsFor(b.id, inline));
}

/** One case through the library. The library turns a failed AI call into a "facts not checked" flag; here that is a failed run, so retry. */
async function flagsFor(brandKey: string, inline: Parameters<typeof brandForTestBrand>[1], channel: string, post: Post): Promise<{ flags: Flag[] }> {
  const { userId, brandId } = await brandForTestBrand(brandKey, inline);
  for (let attempt = 0; ; attempt++) {
    const [res] = await runGuardrail({ userId, brandId, posts: [{ channel: channelOf(channel), hashtags: [], ...post }] });
    if (res.aiChecked) return { flags: res.flags.filter((f) => f.kind !== 'regulated_reminder') };
    if (attempt >= 2) throw new Error(`AI check failed 3 times for ${brandKey}`);
    console.warn('  (AI check failed, retrying case in 5 s)');
    await new Promise((r) => setTimeout(r, 5000));
  }
}

const report: Record<string, unknown> = {};

if (which === 'both' || which === 'planted') {
  type Case = { id: string; brand_id: string; channel: string; post: Post; planted: Array<{ text: string; field: string }>; allowed: string[] };
  const cases: Case[] = JSON.parse(readFileSync('test-data/v2/guardrail/planted-30.json', 'utf8'));
  let planted = 0, caught = 0, fp = 0;
  const rows = [];
  for (const c of cases) {
    const { flags } = await flagsFor(c.brand_id, undefined, c.channel, c.post);
    const missed = c.planted.filter((pl) => !flags.some((f) => f.field === pl.field && overlaps(f.text, pl.text)));
    const falsePos = flags.filter((f) => c.allowed.some((a) => overlaps(f.text, a)) && !c.planted.some((pl) => overlaps(f.text, pl.text)));
    planted += c.planted.length; caught += c.planted.length - missed.length; fp += falsePos.length;
    rows.push({ id: c.id, missed, falsePos });
    console.log(`${c.id} planted ${c.planted.length} missed ${missed.length} fp ${falsePos.length}` +
      (missed.length ? ` MISSED: ${missed.map((m) => m.text).join(' | ')}` : '') + (falsePos.length ? ` FP: ${falsePos.map((f) => `${f.layer}:${f.text}`).join(' | ')}` : ''));
  }
  console.log(`\nAC 11 recall ${caught}/${planted} (${((100 * caught) / planted).toFixed(1)}%), false positives ${fp}\n`);
  report.planted = { planted, caught, fp, rows };
}

if (which === 'both' || which === 'regulated') {
  type RCase = { id: string; brand_id?: string; brand?: { id: string; what_they_sell: string; regulated: string; facts: Fact[] }; post: Post; has_outcome_promise: boolean; promise_text: string };
  const cases: RCase[] = JSON.parse(readFileSync('test-data/v2/guardrail/regulated-20.json', 'utf8'));
  let promises = 0, flagged = 0, cleanFlaggedPromise = 0;
  const rows = [];
  for (const c of cases) {
    const { flags } = await flagsFor(c.brand_id ?? c.brand!.id, c.brand, 'facebook', c.post);
    const hit = c.has_outcome_promise ? flags.some((f) => overlaps(f.text.toLowerCase(), c.promise_text.toLowerCase())) : false;
    // On a clean post, a flag marked regulated (an outcome promise or an unsupported claim) is a false alarm.
    const promiseFlagsOnClean = c.has_outcome_promise ? [] : flags.filter((f) => f.regulated);
    if (c.has_outcome_promise) { promises++; if (hit) flagged++; }
    cleanFlaggedPromise += promiseFlagsOnClean.length;
    rows.push({ id: c.id, has: c.has_outcome_promise, hit, flags });
    console.log(`${c.id} ${c.has_outcome_promise ? (hit ? 'promise FLAGGED' : `promise MISSED: ${c.promise_text}`) : `clean, promise-flags ${promiseFlagsOnClean.length}${promiseFlagsOnClean.length ? ' ' + promiseFlagsOnClean.map((f) => f.text).join(' | ') : ''}`}`);
  }
  console.log(`\nAC 12 promises flagged ${flagged}/${promises}; promise flags on clean posts ${cleanFlaggedPromise}`);
  report.regulated = { promises, flagged, cleanFlaggedPromise, rows };
}

if (which === 'both' || which === 'repetition') {
  type RepCase = { id: string; brand_id: string; history: Array<{ week_start: string; caption: string }>; candidate: string; week_start: string; repeats: boolean; repeated_phrase: string };
  const cases: RepCase[] = JSON.parse(readFileSync('test-data/v2/guardrail/repetition.json', 'utf8'));
  let correct = 0;
  const byKind: Record<string, [number, number]> = {};
  const rows = [];
  for (const c of cases) {
    const { userId, brandId } = await brandForTestBrand(c.brand_id);
    const { facts } = await loadGuardrailContext(brandId, userId);
    const found = findRepeats({
      candidate: c.candidate,
      history: c.history.map((h) => ({ caption: h.caption, weekStart: h.week_start })),
      batchOthers: [],
      facts,
      weekStart: c.week_start,
    });
    const ok = found.length > 0 === c.repeats;
    if (ok) correct++;
    const kind = c.id.replace(/-\d+$/, '');
    byKind[kind] = [(byKind[kind]?.[0] ?? 0) + (ok ? 1 : 0), (byKind[kind]?.[1] ?? 0) + 1];
    rows.push({ id: c.id, expected: c.repeats, found });
    console.log(`${c.id} ${ok ? 'ok' : 'WRONG'} expected ${c.repeats ? 'repeat' : 'clean'}, found ${found.length}${found.length ? ': ' + found.join(' | ') : ''}`);
  }
  console.log(`\nAC 13 repetition cases correct ${correct}/${cases.length} (${Object.entries(byKind).map(([k, [a, b]]) => `${k} ${a}/${b}`).join(', ')})`);
  report.repetition = { correct, total: cases.length, byKind, rows };
}

// Cost: every runGuardrail call records its usd as a fact_check usage event.
const [cost] = await db.withAdmin((tx) => tx.query<{ usd: string }>(`select coalesce(sum(usd), 0)::text as usd from public.usage_events where kind = 'fact_check'`));
const usd = Number(cost?.usd ?? 0);

mkdirSync('test-data/results', { recursive: true });
writeFileSync('test-data/results/guardrail-v2-eval.json', JSON.stringify({ usd, ...report }, null, 2));
console.log(`\nCost ~$${usd.toFixed(3)}`);
await db.close();
