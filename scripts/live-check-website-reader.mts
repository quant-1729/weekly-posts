// AC 3 end-to-end live check: the real reader (robots, page choice, cleaning, quote
// verification) + live Gemini, against local copies of the V-7 test sites (~$0.02).
// Run: node --env-file=.env.local --import tsx scripts/live-check-website-reader.mts

import { readFileSync } from 'node:fs';
import { aiMode } from '@/lib/ai/client';
import { createMockDb, setMockDbForTests } from '@/lib/db/mock';
import { readWebsiteFacts } from '@/lib/website/extract';
import { LOCAL_ENV, serveSite } from '../tests/website/site-server';

if (aiMode() !== 'live') throw new Error('Not in live mode');
const db = await createMockDb();
setMockDbForTests(db);
const userId = await db.withAdmin(async (tx) => {
  const [u] = await tx.query<{ id: string }>("insert into auth.users (email) values ('live@example.com') returning id");
  await tx.query("insert into public.profiles (id, email, consent_at) values ($1, 'live@example.com', now())", [u.id]);
  return u.id;
});

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9£$]+/g, ' ').trim();
let pass = true;
for (const site of (process.env.SITES ?? 'corner-bakery,harbour-dental,blue-wave-yoga').split(',')) {
  const [{ id: brandId }] = await db.withUser(userId, (tx) => tx.query<{ id: string }>('select public.create_brand($1) as id', [site]));
  const server = await serveSite(site);
  const t = Date.now();
  const r = await readWebsiteFacts({ userId, brandId, url: server.origin + '/', options: { fetch: { ...LOCAL_ENV, timeoutMs: 8000 } } });
  const ms = Date.now() - t;
  const facts = await db.withUser(userId, (tx) => tx.query<{ value: string; source_quote: string }>('select value, source_quote from public.brand_facts where brand_id = $1 and active', [brandId]));
  const raw = JSON.parse(readFileSync(`test-data/v2/websites/${site}/expected-facts.json`, 'utf8'));
  const expected: Array<{ value: string }> = Array.isArray(raw) ? raw : raw.facts;
  const found = expected.filter((e) => facts.some((f) => norm(f.value).includes(norm(e.value)) || norm(f.source_quote ?? '').includes(norm(e.value)) || norm(e.value).includes(norm(f.value))));
  const recall = expected.length ? found.length / expected.length : 1;
  const ok = site === 'blue-wave-yoga' ? r.status === 'blocked' && server.requests.every((p) => p === '/robots.txt') : recall >= 0.8 && r.status === 'ok';
  if (!ok) pass = false;
  console.log(`${site}: status ${r.status} in ${ms} ms | requests ${server.requests.join(' ')} | saved ${r.factsSaved}, dropped ${r.factsDropped} | recall ${found.length}/${expected.length} ${ok ? 'OK' : 'FAIL'}`);
  await server.close();
}
await db.close();
console.log(pass ? 'PASS' : 'FAIL');
process.exit(pass ? 0 : 1);
