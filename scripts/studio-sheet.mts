// Studio starting designs, as a contact sheet. Run: npx tsx scripts/studio-sheet.mts [photo.png] [out-dir]
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { getServerShaper, renderStudioDoc } from '../src/lib/studio/server';
import { buildOptions } from '../src/lib/studio/templates';
import { analyzePixels } from '../src/lib/studio/photo';
import type { StudioInput, StudioFormat } from '../src/lib/studio/types';

const photoPath = process.argv[2];
const outDir = process.argv[3] ?? 'test-results/studio';
mkdirSync(outDir, { recursive: true });
const shaper = await getServerShaper();

let photo: StudioInput['photo'] = null;
if (photoPath && photoPath !== 'none') {
  const buf = readFileSync(photoPath);
  const meta = await sharp(buf).metadata();
  const { data, info } = await sharp(buf).resize(120, 120, { fit: 'inside' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const a = analyzePixels(data, info.width, info.height);
  photo = { src: `data:image/png;base64,${(await sharp(buf).png().toBuffer()).toString('base64')}`, w: meta.width!, h: meta.height!, colors: a.colors, focus: a.focus, plainBackground: a.plainBackground };
  console.log('analysis', a);
}
const lang = process.env.LANG_HI ? 'hi' : 'en';
const content = lang === 'hi'
  ? { brandName: 'स्वीट क्रम्ब्स बेकरी', headline: 'सभी केक पर ख़ास छूट', subline: '', offer: '20% छूट', offerNote: 'सिर्फ़ सोमवार को', cta: 'WhatsApp पर ऑर्डर करें', contacts: [{ kind: 'phone' as const, text: '+91 98200 12345' }, { kind: 'whatsapp' as const, text: '+91 98200 12345' }], qr: null, language: 'hi' }
  : { brandName: 'Sweet Crumbs Bakery', headline: 'Fresh cakes, sweeter prices', subline: '', offer: '20% OFF', offerNote: 'On all cakes · Monday only', cta: 'Order on WhatsApp', contacts: [{ kind: 'phone' as const, text: '+91 98200 12345' }, { kind: 'whatsapp' as const, text: '+91 98200 12345' }, { kind: 'instagram' as const, text: '@sweetcrumbs' }], qr: process.env.QR ? { data: 'https://example.com/r/abc123', label: 'Scan to visit' } : null, language: 'en' };
for (const format of (process.env.FORMATS ?? 'square').split(',') as StudioFormat[]) {
  const input: StudioInput = { format, content, brand: { colors: { primary: '#1F4E9C', secondary: '#F5A623', accent: '#F5A623', background: '#FFFFFF' }, fonts: { headline: 'sans', body: 'sans' }, logo: null, character: null }, photo };
  const shuffle = Number(process.env.SHUFFLE ?? 0);
  const opts = buildOptions(input, shaper, shuffle);
  const tiles: Buffer[] = [];
  for (const o of opts) {
    const r = await renderStudioDoc(o.doc, { brandId: 'test', verifyQr: !!process.env.QR });
    if (r.problems.length) console.log(o.id, r.problems);
    tiles.push(await sharp(r.png).resize(400).png().toBuffer()); await sharp(r.png).resize(640).toFile(path.join(outDir, `${o.id}-${format}.png`));
  }
  const th = Math.round(400 * (opts[0].doc.height / opts[0].doc.width));
  const sheet = sharp({ create: { width: 400 * tiles.length + 20 * (tiles.length + 1), height: th + 40, channels: 3, background: '#DDDDDD' } }).composite(tiles.map((t, i) => ({ input: t, left: 20 + i * 420, top: 20 })));
  const out = path.join(outDir, `sheet-${format}${photo ? '' : '-nophoto'}${shuffle ? '-s' + shuffle : ''}${lang === 'hi' ? '-hi' : ''}.png`);
  await sheet.png().toFile(out);
  console.log('wrote', out);
}
