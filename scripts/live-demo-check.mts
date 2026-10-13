// Demo AC live check: website URL -> finished week of posts in under 3 minutes (~$0.05).
// Owner account, website read (local copy of a test site), 2 photos, weekly generation
// with guardrail and 3 image formats. Uses an in-memory db and a temp storage dir.
// Run: node --env-file=.env.local --import tsx scripts/live-demo-check.mts [site]

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { aiMode } from '@/lib/ai/client';
import { createMockDb, setMockDbForTests } from '@/lib/db/mock';
import { samplePhoto } from '@/lib/render/fixtures';
import { createMockStorage } from '@/lib/storage/mock';
import { addPhoto } from '@/lib/uploads/photos';
import { readWebsiteFacts } from '@/lib/website/extract';
import { generateWeek } from '@/lib/weekly/generate';
import { rewritePost } from '@/lib/approvals/rewrite';
import { LOCAL_ENV, serveSite } from '../tests/website/site-server';

if (aiMode() !== 'live') throw new Error('Not in live mode');
const site = process.argv[2] ?? 'corner-bakery';
const OUT = path.resolve('test-results/demo');
mkdirSync(OUT, { recursive: true });
const storage = createMockStorage(path.join(OUT, 'storage'));
const db = await createMockDb();
setMockDbForTests(db);
const server = await serveSite(site);

const t0 = Date.now();
const lap = (label: string) => console.log(`${((Date.now() - t0) / 1000).toFixed(1)} s  ${label}`);

const userId = await db.withAdmin(async (tx) => {
  const [u] = await tx.query<{ id: string }>("insert into auth.users (email) values ('demo@example.com') returning id");
  await tx.query("insert into public.profiles (id, email, consent_at) values ($1, 'demo@example.com', now())", [u.id]);
  return u.id;
});
const [{ id: brandId }] = await db.withUser(userId, (tx) => tx.query<{ id: string }>("select public.create_brand('Corner Bakery') as id"));
await db.withUser(userId, (tx) =>
  tx.query(
    `update public.brand_memory set business_name = 'Corner Bakery', category = 'bakery: sourdough, pastries and cakes',
       audience = 'neighbours and commuters in Camberwell', country = 'GB', region = 'GB-ENG', city = 'London',
       timezone = 'Europe/London', goal = 'footfall', tone = 'friendly', post_language = 'en-GB', minutes_per_post = 30,
       website_url = $2, colors = '{"primary":"#7a1e2b","secondary":"#fff4e0","accent":"#f2a900"}', setup_completed_at = now()
     where brand_id = $1`,
    [brandId, server.origin + '/'],
  ),
);
lap('owner and brand set up (setup answers saved)');

const read = await readWebsiteFacts({ userId, brandId, url: server.origin + '/', options: { fetch: { ...LOCAL_ENV, timeoutMs: 8000 } } });
lap(`website read: ${read.status}, ${read.factsSaved} facts from ${read.pagesRead.length} pages`);

for (const [w, h] of [[1600, 1200], [1200, 1600]]) {
  const r = await addPhoto({ userId, brandId, bytes: await samplePhoto(w, h), mimeType: 'image/jpeg', storage });
  if (!('photoId' in r) && !('id' in r)) console.log('  photo result', r);
}
lap('2 photos uploaded and described');

const result = await generateWeek({ brandId, weekStart: '2026-11-16', trigger: 'button', userId }, { storage, now: new Date('2026-11-13T10:00:00Z') });
lap(`weekly generation: ${result.status}`);
const total = (Date.now() - t0) / 1000;

if (result.status === 'ready') {
  console.log(`  timings ${JSON.stringify(result.timings)} | usd ${result.usd.toFixed(4)} | rewrites ${result.rewrites}`);
  for (const p of result.posts as unknown as Array<Record<string, unknown>>) {
    const flags = (p.fact_flags as Array<{ kind: string; text: string; status: string }> | undefined) ?? [];
    console.log(`\n  ${p.suggested_day} ${p.channel} [${p.occasion ?? '-'}] photo ${p.photo_id ? 'yes' : 'no'} | open flags: ${flags.filter((f) => f.status === 'open').map((f) => `${f.kind}:${f.text}`).join('; ') || 'none'}`);
    console.log(`    ${String(p.caption).replace(/\n+/g, ' / ').slice(0, 240)}`);
    console.log(`    cta: ${p.cta} | ${(p.hashtags as string[]).join(' ')}`);
  }
  // Copy the square renders out for review.
  const images = await db.withAdmin((tx) => tx.query<{ post_id: string; format: string; image_path: string }>(
    "select post_id, format::text as format, image_path from public.post_images where brand_id = $1 order by post_id, format", [brandId]));
  for (const im of images) {
    const f = await storage.get('renders', im.image_path.replace(/^renders\//, ''));
    if (f) writeFileSync(path.join(OUT, `${im.post_id.slice(0, 8)}-${im.format}.png`), f.bytes);
  }
  console.log(`\n  ${images.length} images written to ${OUT}`);
} else {
  console.log(JSON.stringify(result));
}
console.log(`\nTOTAL ${total.toFixed(1)} s (target < 180 s): ${result.status === 'ready' && total < 180 ? 'PASS' : 'FAIL'}`);

// AC 15: live rewrite with an instruction on the first post, under 15 s, instruction saved.
if (result.status === 'ready') {
  const [first] = await db.withAdmin((tx) => tx.query<{ id: string }>('select id from public.posts where brand_id = $1 order by suggested_day limit 1', [brandId]));
  for (const instruction of ['shorter and less salesy', 'mention our gluten-free range']) {
    const t = Date.now();
    const rw = await rewritePost({ brandId, postId: first.id, actor: { via: 'dashboard', userId }, instruction }, { storage });
    console.log(`\nRewrite "${instruction}": ${Date.now() - t} ms (target < 15000)\n  ${JSON.stringify(rw).slice(0, 500)}`);
  }
  const [after] = await db.withAdmin((tx) => tx.query<{ caption: string }>('select caption from public.posts where id = $1', [first.id]));
  console.log(`  caption now: ${after.caption.replace(/\n+/g, ' / ')}`);
  const fb = await db.withAdmin((tx) => tx.query<{ instruction: string }>('select instruction from public.voice_feedback where brand_id = $1', [brandId]));
  console.log(`voice_feedback rows: ${fb.map((r) => r.instruction).join(' | ')}`);
  const cost = await db.withAdmin((tx) => tx.query<{ usd: string }>('select coalesce(sum(usd),0)::text as usd from public.usage_events where brand_id = $1', [brandId]));
  console.log(`Total logged cost for the demo account: $${Number(cost[0].usd).toFixed(4)}`);
}
await server.close();
await db.close();
