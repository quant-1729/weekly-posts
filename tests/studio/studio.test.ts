// Design Studio: the week parser, the shared renderer (text as paths, QR that scans), templates, and document operations.
import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { parseWeek, readOffer, offerWords, weekDates } from '@/lib/plans/parse';
import { getServerShaper, renderStudioDoc, resolveImages } from '@/lib/studio/server';
import { buildOptions, offerBadgeText, TEMPLATE_IDS } from '@/lib/studio/templates';
import { adaptDoc, applyDay, recolor, wordsOf } from '@/lib/studio/ops';
import { buildScene, docTexts } from '@/lib/studio/scene';
import { toSvgString } from '@/lib/studio/vnode';
import { brandPalettes, CURATED } from '@/lib/studio/palette';
import { analyzePixels, cutoutPixels } from '@/lib/studio/photo';
import { studioDocSchema, type StudioInput } from '@/lib/studio/types';
import { decodeQrPng } from '@/lib/qr/decode';

const input = (over: Partial<StudioInput['content']> = {}, format: StudioInput['format'] = 'square'): StudioInput => ({
  format,
  content: { brandName: 'Sweet Crumbs Bakery', headline: "Monday's special", subline: '', offer: '20% OFF', offerNote: 'On all cakes · Monday only', cta: 'Order on WhatsApp', contacts: [{ kind: 'phone', text: '+91 98200 12345' }], qr: { data: 'https://example.com/r/abc1234', label: 'Scan to visit' }, language: 'en', ...over },
  brand: { colors: { primary: '#1F4E9C', secondary: '#F5A623', accent: '#F5A623', background: '#FFFFFF' }, fonts: { headline: 'sans', body: 'sans' }, logo: null, character: null },
  photo: null,
});

describe('week parser', () => {
  it('reads the way an owner says it', () => {
    const r = parseWeek('on Monday I will issue 10% discount, on Tuesday it would be 20% discount, Wednesday 30%, Friday again 10%, Saturday and Sunday 15%');
    const on = Object.fromEntries(r.days.filter((d) => d.on).map((d) => [d.day, d.value]));
    expect(on).toEqual({ mon: 10, tue: 20, wed: 30, fri: 10, sat: 15, sun: 15 });
    expect(r.unread).toEqual([]);
  });
  it('reads short forms, ranges, amounts and text offers', () => {
    const r = parseWeek('Mon-Wed Rs 50 off, weekend buy 1 get 1 free on pastries');
    expect(r.on).toBe('pastries');
    expect(r.days.find((d) => d.day === 'tue')).toMatchObject({ on: true, kind: 'amount', value: 50 });
    expect(r.days.find((d) => d.day === 'sun')).toMatchObject({ on: true, kind: 'text' });
    expect(r.days.find((d) => d.day === 'thu')?.on).toBe(false);
  });
  it('formats offers and dates', () => {
    expect(readOffer('25 percent')).toEqual({ kind: 'percent', value: 25, text: '' });
    expect(offerWords({ kind: 'amount', value: 50, text: '' })).toBe('₹50 OFF');
    expect(weekDates('2026-10-17').mon).toBe('2026-10-19');
    expect(offerBadgeText('20% OFF')).toBe('20%\nOFF');
  });
});

describe('studio rendering', () => {
  it('draws five valid options with every word as paths and a QR that scans', async () => {
    const shaper = await getServerShaper();
    const opts = buildOptions(input(), shaper);
    expect(opts.map((o) => o.doc.meta.template)).toEqual([...TEMPLATE_IDS]);
    for (const o of opts) {
      expect(studioDocSchema.safeParse(o.doc).success).toBe(true);
      const svg = toSvgString(buildScene(o.doc, shaper));
      expect(svg).not.toContain('<text');
      expect(docTexts(o.doc).map((t) => t.text)).toContain("Monday's special");
    }
    const r = await renderStudioDoc(opts[0].doc, { brandId: 'b', qrData: 'https://example.com/r/zzz9999' });
    expect(r.problems).toEqual([]);
    expect(await decodeQrPng(r.png)).toBe('https://example.com/r/zzz9999');
  }, 60_000);

  it('shapes Devanagari', async () => {
    const shaper = await getServerShaper();
    const w = shaper.measure('सभी केक पर छूट', 'baloo', 700, 60);
    expect(w).toBeGreaterThan(100);
    expect(shaper.line('दुकान', 'poppins', 700, 60, 0, 0, 60).d.length).toBeGreaterThan(50);
  });

  it('never resolves images outside the brand', async () => {
    const shaper = await getServerShaper();
    const doc = buildOptions(input(), shaper)[0].doc;
    doc.layers.push({ id: 'x', kind: 'image', name: 'x', src: '/api/files/photos/other-brand/a.jpg', natW: 10, natH: 10, fit: 'cover', fx: 0.5, fy: 0.5, zoom: 1, mask: 'none', radius: 0, x: 0, y: 0, w: 10, h: 10, rot: 0, opacity: 1 });
    doc.layers.push({ id: 'y', kind: 'image', name: 'y', src: 'https://evil.example/a.png', natW: 10, natH: 10, fit: 'cover', fx: 0.5, fy: 0.5, zoom: 1, mask: 'none', radius: 0, x: 0, y: 0, w: 10, h: 10, rot: 0, opacity: 1 });
    const map = await resolveImages(doc, 'my-brand', { get: async () => ({ bytes: new Uint8Array([1]), contentType: 'image/png' }) } as never);
    expect(map.size).toBe(0);
  });
});

describe('document operations', () => {
  it('puts each day’s offer in, keeping the owner’s wording', async () => {
    const shaper = await getServerShaper();
    const doc = buildOptions(input({ headline: '20% off all cakes' }), shaper)[1].doc;
    const tue = applyDay(doc, { offer: '30% OFF', offerNote: 'x', date: '2026-10-20' }, shaper);
    const w = wordsOf(tue);
    expect(w.headline).toBe('30% off all cakes');
    expect(w.date).toBe('On all cakes · Tuesday only');
  });
  it('recolours and adapts to another size', async () => {
    const shaper = await getServerShaper();
    const doc = buildOptions(input(), shaper)[0].doc;
    const from = brandPalettes(input().brand.colors).find((p) => p.id === 'brand')!;
    const re = recolor(doc, from, CURATED[0]);
    expect(re.meta.palette).toBe(CURATED[0].id);
    expect(JSON.stringify(re)).not.toEqual(JSON.stringify(doc));
    const story = adaptDoc(doc, 'vertical', input(), shaper);
    expect(story.height).toBe(1920);
    expect(wordsOf(story).headline).toBe("Monday's special");
  });
});

describe('photo tools', () => {
  it('finds a plain background and cuts it out', async () => {
    const { data, info } = await sharp({ create: { width: 60, height: 60, channels: 4, background: '#FFFFFF' } })
      .composite([{ input: await sharp({ create: { width: 30, height: 30, channels: 4, background: '#C04020' } }).png().toBuffer(), left: 15, top: 15 }])
      .raw()
      .toBuffer({ resolveWithObject: true });
    const a = analyzePixels(data, info.width, info.height);
    expect(a.plainBackground).toBe(true);
    expect(a.colors.length).toBeGreaterThan(0);
    const cut = cutoutPixels(data, info.width, info.height);
    expect(cut.removed).toBeGreaterThan(0.6);
    expect(cut.data[(30 * 60 + 30) * 4 + 3]).toBe(255);
    expect(cut.data[3]).toBe(0);
  });
});
