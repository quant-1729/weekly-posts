// W-1 live check: a site that builds its pages with JavaScript (empty root div), read end to end with the
// real Jina Reader (no key needed, free rate) and real Gemini (~$0.01), in an in-memory mock db.
// Run: node --env-file=.env.local --import tsx scripts/live-check-website-js.mts
// Optional: URL=https://... to try another site.

import { aiMode } from '@/lib/ai/client';
import { createMockDb, setMockDbForTests } from '@/lib/db/mock';
import { readWebsiteFacts } from '@/lib/website/extract';

if (aiMode() !== 'live') throw new Error('Not in live mode');
const url = process.env.URL ?? 'https://www.nostaviahealth.com/';

const db = await createMockDb();
setMockDbForTests(db);
const userId = await db.withAdmin(async (tx) => {
  const [u] = await tx.query<{ id: string }>("insert into auth.users (email) values ('live@example.com') returning id");
  await tx.query("insert into public.profiles (id, email, consent_at) values ($1, 'live@example.com', now())", [u.id]);
  return u.id;
});
const [{ id: brandId }] = await db.withUser(userId, (tx) => tx.query<{ id: string }>('select public.create_brand($1) as id', ['Nostavia Health']));

const t = Date.now();
const r = await readWebsiteFacts({ userId, brandId, url });
const ms = Date.now() - t;

const facts = await db.withUser(userId, (tx) =>
  tx.query<{ kind: string; label: string | null; value: string; source_ref: string; source_quote: string }>(
    "select kind::text, label, value, source_ref, source_quote from public.brand_facts where brand_id = $1 and active and source_type = 'website' order by created_at, id",
    [brandId],
  ),
);
const usage = await db.withAdmin((tx) => tx.query<{ kind: string; usd: string | null }>('select kind::text, usd::text from public.usage_events where brand_id = $1', [brandId]).catch(() => []));

console.log(`status ${r.status}${r.reason ? ` (${r.reason})` : ''} in ${ms} ms`);
console.log(`pages read (${r.pagesRead.length}): ${r.pagesRead.join(' | ')}`);
console.log(`pages through the reader (${r.readerPages.length}): ${r.readerPages.join(' | ')}`);
console.log(`skipped: ${JSON.stringify(r.skipped)}`);
console.log(`facts saved ${r.factsSaved}, dropped ${r.factsDropped}`);
for (const f of facts) console.log(`  [${f.kind}] ${f.label}: ${f.value} | "${f.source_quote}" (${f.source_ref})`);
console.log(`summary: ${r.summary}`);
console.log(`usage: ${JSON.stringify(usage)}`);
await db.close();
const pass = (r.status === 'ok' || r.status === 'partial') && r.readerPages.length > 0 && r.factsSaved > 0;
console.log(pass ? 'PASS' : 'FAIL');
process.exit(pass ? 0 : 1);
