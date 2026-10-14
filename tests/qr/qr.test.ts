import { describe, expect, it } from 'vitest';
import { Resvg } from '@resvg/resvg-js';
import sharp from 'sharp';
import { QUIET_ZONE_MODULES, QrEncodeError, assertDarkOnLight, contrastRatio, qrMatrix, qrPixels, qrPng, qrSvg, totalModules } from '@/lib/qr/encode';
import { decodeQrPng, verifyRendered } from '@/lib/qr/decode';
import { PaymentFormatError, buildPaymentUri, cleanPayeeName, parsePaymentUri, schemesForCountry, validPayeeName, validatePaymentAddress } from '@/lib/qr/payment';
import { MIN_QR_PX_AT_1080, fitsSlot, minQrPx, minSlotPx } from '@/lib/qr/size';
import { linkQrContent } from '@/lib/qr/link';

const LINK = linkQrContent('https://app.example.com', 'abcd1234');

describe('encode', () => {
  it('link QR: PNG round trip decodes to the exact short link', async () => {
    const png = await qrPng(LINK, { scale: 8 });
    expect(await decodeQrPng(png)).toBe(LINK);
    expect(LINK).toBe('https://app.example.com/r/abcd1234?q=1');
  });

  it('UPI QR with a unicode payee name and an amount round trips exactly', async () => {
    const uri = buildPaymentUri('upi', { address: 'ravi.kumar@okhdfcbank', payeeName: 'रवि कुमार & Sons Café', amount: 250.5 });
    const png = await qrPng(uri, { scale: 8 });
    expect(await decodeQrPng(png)).toBe(uri);
    const parsed = parsePaymentUri('upi', uri)!;
    expect(parsed).toEqual({ address: 'ravi.kumar@okhdfcbank', payeeName: 'रवि कुमार & Sons Café', currency: 'INR', amount: 250.5 });
  });

  it('SVG is plain rects/paths (no CSS, no transforms) and resvg renders it to a code that decodes', async () => {
    const svg = qrSvg(LINK, { sizePx: 400 });
    expect(svg).not.toMatch(/<style|transform=|class=|style=|<image|<text/);
    expect(svg).toMatch(/^<svg [^>]*viewBox="0 0 \d+ \d+"/);
    const png = new Resvg(svg, { fitTo: { mode: 'width', value: 400 } }).render().asPng();
    expect(await decodeQrPng(Buffer.from(png))).toBe(LINK);
  });

  it('uses error correction M by default and at least a 4 module quiet zone', () => {
    // The finder pattern starts exactly QUIET_ZONE modules in: everything before it is light.
    const px = qrPixels(LINK, { scale: 3 });
    const q = QUIET_ZONE_MODULES * px.scale;
    const at = (x: number, y: number) => px.data[(y * px.width + x) * 4];
    for (let i = 0; i < px.width; i++) {
      for (let k = 0; k < q; k++) {
        expect(at(i, k)).toBe(255); // top margin
        expect(at(k, i)).toBe(255); // left margin
        expect(at(px.width - 1 - k, i)).toBe(255);
        expect(at(i, px.width - 1 - k)).toBe(255);
      }
    }
    expect(at(q, q)).toBe(0); // first module of the top-left finder is dark
    expect(px.width / px.scale).toBe(totalModules(qrMatrix(LINK).size));
    // M holds more than H for the same text: the version (size) is not larger for M.
    expect(qrMatrix(LINK, 'M').size).toBeLessThanOrEqual(qrMatrix(LINK, 'H').size);
  });

  it('refuses a quiet zone below 4 and light-on-dark or low-contrast colours', () => {
    expect(() => qrSvg(LINK, { quietZone: 2 })).toThrow(QrEncodeError);
    expect(() => qrSvg(LINK, { dark: '#FFFFFF', light: '#000000' })).toThrow(/dark on a light/);
    expect(() => qrSvg(LINK, { dark: '#888888', light: '#AAAAAA' })).toThrow(/contrast/);
    expect(() => assertDarkOnLight('#111111', '#FAFAFA')).not.toThrow();
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 0);
  });

  it('dark brand colour on a light plate still decodes', async () => {
    const png = await qrPng(LINK, { scale: 6, dark: '#1B2A41', light: '#F5F1E8' });
    expect(await decodeQrPng(png)).toBe(LINK);
  });

  it('empty and oversized text fail with a typed error', () => {
    expect(() => qrMatrix('')).toThrow(QrEncodeError);
    expect(() => qrMatrix('x'.repeat(5000))).toThrow(/too long/);
  });
});

describe('verifyRendered', () => {
  it('passes the exact string and catches a wrong payment ID', async () => {
    const good = buildPaymentUri('upi', { address: 'shop@okaxis', payeeName: 'Shop' });
    const wrong = buildPaymentUri('upi', { address: 'shop@okaxi', payeeName: 'Shop' });
    const rendered = await qrPng(wrong, { scale: 6 });
    const bad = await verifyRendered(rendered, good);
    expect(bad.ok).toBe(false);
    expect(bad.decoded).toBe(wrong);
    expect((await verifyRendered(await qrPng(good, { scale: 6 }), good)).ok).toBe(true);
  });

  it('is exact: no trimming or case folding', async () => {
    const png = await qrPng('upi://pay?pa=Shop@okaxis&pn=Shop&cu=INR', { scale: 6 });
    expect((await verifyRendered(png, 'upi://pay?pa=shop@okaxis&pn=Shop&cu=INR')).ok).toBe(false);
  });

  it('fails when the picture holds no QR code', async () => {
    const blank = await sharp({ create: { width: 200, height: 200, channels: 3, background: '#ffffff' } }).png().toBuffer();
    expect(await verifyRendered(blank, 'anything')).toEqual({ ok: false, decoded: null });
  });

  it('finds a QR inside a larger post image, and a region limits the search', async () => {
    const uri = buildPaymentUri('upi', { address: 'shop@okaxis', payeeName: 'Shop' });
    const qr = await qrPng(uri, { scale: 8 });
    const meta = await sharp(qr).metadata();
    const post = await sharp({ create: { width: 1080, height: 1080, channels: 3, background: '#E4572E' } })
      .composite([{ input: qr, left: 600, top: 650 }])
      .png()
      .toBuffer();
    expect((await verifyRendered(post, uri)).ok).toBe(true);
    expect((await verifyRendered(post, uri, { left: 600, top: 650, width: meta.width!, height: meta.height! })).ok).toBe(true);
    expect((await verifyRendered(post, uri, { left: 0, top: 0, width: 400, height: 400 })).ok).toBe(false);
  });
});

describe('UPI payment strings', () => {
  it('builds upi://pay?pa=&pn=&cu=INR with percent-encoding, plus am only when set', () => {
    expect(buildPaymentUri('upi', { address: 'shop@okaxis', payeeName: 'Corner Bakery' })).toBe('upi://pay?pa=shop@okaxis&pn=Corner%20Bakery&cu=INR');
    expect(buildPaymentUri('upi', { address: 'shop@okaxis', payeeName: 'Corner Bakery', amount: 99 })).toBe('upi://pay?pa=shop@okaxis&pn=Corner%20Bakery&cu=INR&am=99.00');
    const tricky = buildPaymentUri('upi', { address: 'a.b-c_d@ybl', payeeName: "O'Neil & Co (Pune) *" });
    expect(tricky).toContain('pn=O%27Neil%20%26%20Co%20%28Pune%29%20%2A');
    expect(tricky).not.toMatch(/&pn=[^&]*[ '()*]/);
    expect(parsePaymentUri('upi', tricky)?.payeeName).toBe("O'Neil & Co (Pune) *");
    expect(buildPaymentUri('upi', { address: 'shop@okaxis', payeeName: 'रवि' })).toContain('pn=%E0%A4%B0%E0%A4%B5%E0%A4%BF');
  });

  it('validates addresses like the database check', () => {
    for (const ok of ['name@bank', 'ravi.kumar@okhdfcbank', '9876543210@ybl', 'a_b-c@paytm']) expect(validatePaymentAddress('upi', ok)).toBe(true);
    for (const bad of ['', 'name', '@bank', 'a@b', 'name@bank.com', 'na me@bank', 'name@1bank', 'x@bank@bank', 'name@bank ']) expect(validatePaymentAddress('upi', bad)).toBe(false);
    expect(() => buildPaymentUri('upi', { address: 'nope', payeeName: 'X' })).toThrow(PaymentFormatError);
    expect(() => buildPaymentUri('upi', { address: 'a@bank', payeeName: '   ' })).toThrow(PaymentFormatError);
    expect(() => buildPaymentUri('upi', { address: 'ab@bank', payeeName: 'X', amount: 0 })).toThrow(PaymentFormatError);
    expect(() => buildPaymentUri('upi', { address: 'ab@bank', payeeName: 'X', amount: -5 })).toThrow(PaymentFormatError);
  });

  it('cleans payee names', () => {
    expect(cleanPayeeName('  Corner \n  Bakery​ ')).toBe('Corner Bakery');
    expect(validPayeeName('Corner Bakery')).toBe(true);
    expect(validPayeeName('x'.repeat(61))).toBe(false);
    expect(validPayeeName('   ')).toBe(false);
  });

  it('offers UPI in India only', () => {
    expect(schemesForCountry('IN').map((s) => s.id)).toEqual(['upi']);
    expect(schemesForCountry('in').length).toBe(1);
    expect(schemesForCountry('GB')).toEqual([]);
    expect(schemesForCountry(null)).toEqual([]);
  });
});

describe('size rules', () => {
  it('300 px at 1080 px wide, scaled for other widths', () => {
    expect(MIN_QR_PX_AT_1080).toBe(300);
    expect(minQrPx(1080)).toBe(300);
    expect(minQrPx(540)).toBe(150);
    expect(minQrPx(1280)).toBe(356);
  });

  it('fitsSlot: whole pixels per module, refuses a slot below the minimum', () => {
    const modules = totalModules(qrMatrix(LINK).size);
    const big = fitsSlot({ text: LINK, slot: { width: 420, height: 420 }, canvasWidth: 1080 });
    expect(big.fits).toBe(true);
    expect(big.qrPx).toBe(big.modulePx * modules);
    expect(big.qrPx).toBeLessThanOrEqual(420);
    expect(big.qrPx).toBeGreaterThanOrEqual(300);
    const small = fitsSlot({ text: LINK, slot: { width: 200, height: 200 }, canvasWidth: 1080 });
    expect(small).toMatchObject({ fits: false, reason: 'too_small' });
    // Uses the smaller side of the slot.
    expect(fitsSlot({ text: LINK, slot: { width: 900, height: 200 }, canvasWidth: 1080 }).fits).toBe(false);
    expect(fitsSlot({ text: LINK, slot: { width: 60, height: 60 }, canvasWidth: 1080 })).toMatchObject({ fits: false, reason: 'module_too_small' });
  });

  it('minSlotPx is the smallest slot that fits', () => {
    const px = minSlotPx(LINK, 1080);
    expect(fitsSlot({ text: LINK, slot: { width: px, height: px }, canvasWidth: 1080 }).fits).toBe(true);
    expect(fitsSlot({ text: LINK, slot: { width: px - totalModules(qrMatrix(LINK).size), height: px - totalModules(qrMatrix(LINK).size) }, canvasWidth: 1080 }).fits).toBe(false);
  });
});
