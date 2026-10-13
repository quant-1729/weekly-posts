// R4 live check: text, photo and Hindi voice -> 4 outputs each, timed. ~$0.03.
// Uses an in-memory database and writes renders to test-results/live-generate/.
// Run: node --env-file=.env.local --import tsx scripts/live-check-generate.mts

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { aiMode } from '@/lib/ai/client';
import { saveBrandProfile } from '@/lib/brand/profile';
import { createMockDb, setMockDbForTests } from '@/lib/db/mock';
import { composeShareText } from '@/lib/posts/compose';
import { generatePost, type PostInput } from '@/lib/posts/generate';
import { samplePhoto } from '@/lib/render/fixtures';
import { createMockStorage } from '@/lib/storage/mock';

if (aiMode() !== 'live') throw new Error('Not in live mode');

const OUT = 'test-results/live-generate';
mkdirSync(OUT, { recursive: true });
const db = await createMockDb();
setMockDbForTests(db);
const storage = createMockStorage(path.resolve(OUT, 'storage'));

const userId = await db.withAdmin(async (tx) => {
  const [u] = await tx.query<{ id: string }>("insert into auth.users (phone) values ('+919810000001') returning id");
  await tx.query("insert into public.profiles (id, phone, consent_at) values ($1, '+919810000001', now())", [u.id]);
  return u.id;
});
const [{ id: brandId }] = await db.withUser(userId, (tx) => tx.query<{ id: string }>("select public.create_brand('Shri Ram Sweets') as id"));
await saveBrandProfile(userId, brandId, {
  business_name: 'Shri Ram Sweets',
  category: 'sweet shop',
  city: 'Indore, Sarafa Road',
  products: [
    { name: 'जलेबी', price: '240', unit: 'kg', note: '' },
    { name: 'काजू कतली', price: '880', unit: 'kg', note: 'gift box available' },
    { name: 'समोसा', price: '20', unit: 'piece', note: '' },
  ],
  audience: 'families and office-goers',
  tone: 'Festive and lively',
  languages: ['hi', 'hinglish'],
  default_language: 'hi',
  colors: { primary: '#b5121b', secondary: '#fff4e0', accent: '#f2a900' },
  whatsapp_number: '9876543210',
  notes: 'Open 8 AM to 10 PM daily; home delivery within 2 km',
}, { completeSetup: { transcript: 'live check' } });

let photoBytes: Uint8Array;
try {
  photoBytes = readFileSync(process.env.LIVE_PHOTO ?? 'test-data/photos/jalebi-rs99.png');
} catch {
  photoBytes = await samplePhoto();
}

const runs: Array<[string, PostInput]> = [
  ['text', { type: 'text', text: 'आज शाम 6 बजे से गर्म समोसे ताज़ा निकलेंगे, 20 रुपये पीस। आइए।' }],
  ['photo', { type: 'photo', bytes: photoBytes, caption: 'aaj ki special garam jalebi' }],
  ['voice', { type: 'voice', bytes: readFileSync('test-data/audio/setup-hi-sharma-16k.wav') }],
];

let worst = 0;
let pass = true;
for (const [name, input] of runs.filter(([n]) => !process.env.LIVE_ONLY || process.env.LIVE_ONLY === n)) {
  const r = await generatePost({ userId, brandId, input, storage });
  if (!r.ok) {
    pass = false;
    console.log(`\n${name}: FAILED ${r.code} ${r.message}`);
    continue;
  }
  worst = Math.max(worst, r.timings.totalMs);
  if (r.timings.totalMs > 60_000) pass = false;
  console.log(`\n${name}: ${JSON.stringify(r.timings)} open flags: ${r.openFlags}`);
  const outs = await db.withAdmin((tx) => tx.query<{ channel: string; caption: string; cta: string; hashtags: string[]; image_text: object; image_path: string | null; fact_flags: Array<{ text: string; kind: string }> }>(
    'select channel::text as channel, caption, cta, hashtags, image_text, image_path, fact_flags from public.outputs where post_id = $1 order by channel', [r.postId]));
  for (const o of outs) {
    console.log(`  [${o.channel}] ${o.caption.replace(/\n/g, ' / ').slice(0, 160)}`);
    console.log(`     img ${JSON.stringify(o.image_text)} flags ${JSON.stringify(o.fact_flags.map((f) => `${f.kind}:${f.text}`))}`);
    if (o.image_path) {
      const f = await storage.get('renders', o.image_path.replace(/^renders\//, ''));
      if (f) writeFileSync(path.join(OUT, `${name}-${o.channel}.png`), f.bytes);
    }
  }
  console.log(`  share text (ig_feed):\n${composeShareText(outs.find((o) => o.channel === 'ig_feed') as never, r.postCode, 'https://postmitra.example')}`);
}
console.log(`\nSlowest ${worst} ms (target < 60000). ${pass ? 'PASS' : 'FAIL'}. Renders in ${OUT}/`);
await db.close();
process.exit(pass ? 0 : 1);
