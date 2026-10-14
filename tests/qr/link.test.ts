import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockDb, setMockDbForTests, type MockDb } from '@/lib/db/mock';
import { GET } from '@/app/r/[code]/route';
import { resetClickDedupe } from '@/lib/shortlinks/bots';
import { QrLinkError, buildLinkQrSpec, checkQrUrl, isQrScanRequest, qrScansByPost } from '@/lib/qr/link';
import { clicksByPost } from '@/lib/shortlinks';
import { qrContentFor, QrContentError } from '@/lib/qr/content';
import { decodeQrPng } from '@/lib/qr/decode';
import { qrPng } from '@/lib/qr/encode';
import { qrSpecSchema } from '@/lib/briefs/types';
import { count } from '../weekly/helpers';
import { seedLinkBrand, type Seeded } from '../shortlinks/helpers';

const pending: Array<() => unknown> = [];
vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: (fn: () => unknown) => {
    pending.push(fn);
  },
}));
const flush = async () => {
  while (pending.length) await pending.shift()!();
};

const CHROME = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';
const PUBLIC_DNS = async () => [{ address: '93.184.216.34' }];

describe('checkQrUrl (no private or non-http URLs, max 500 characters)', () => {
  const ok = (u: string) => checkQrUrl(u, { resolver: PUBLIC_DNS });

  it('accepts a public http(s) URL', async () => {
    expect(await ok('https://wa.me/447700900123?text=Hi')).toEqual({ ok: true, url: 'https://wa.me/447700900123?text=Hi' });
    expect((await ok('http://example.com/menu')).ok).toBe(true);
    expect((await checkQrUrl('https://1.1.1.1/x', { resolve: false })).ok).toBe(true);
  });

  it.each([
    ['', 'empty'],
    ['javascript:alert(1)', 'not_http'],
    ['ftp://example.com/a', 'not_http'],
    ['data:text/html,hi', 'not_http'],
    ['upi://pay?pa=a@b', 'not_http'],
    ['not a url', 'not_http'],
    ['https://user:pw@example.com/', 'credentials'],
    ['http://localhost/admin', 'private_address'],
    ['http://printer.local/', 'private_address'],
    ['http://127.0.0.1/', 'private_address'],
    ['http://10.1.2.3/', 'private_address'],
    ['http://192.168.1.10:8080/', 'private_address'],
    ['http://169.254.169.254/latest/meta-data/', 'private_address'],
    ['http://[::1]/', 'private_address'],
    ['http://[fd00::1]/', 'private_address'],
    ['http://metadata/', 'private_address'],
  ])('refuses %s', async (url, reason) => {
    expect(await ok(url)).toEqual({ ok: false, reason });
  });

  it('refuses a name that resolves to a private address, or does not resolve', async () => {
    expect(await checkQrUrl('https://evil.example/', { resolver: async () => [{ address: '93.184.216.34' }, { address: '10.0.0.5' }] })).toEqual({ ok: false, reason: 'private_address' });
    expect(await checkQrUrl('https://nowhere.example/', { resolver: async () => { throw new Error('ENOTFOUND'); } })).toEqual({ ok: false, reason: 'dns' });
  });

  it('refuses more than 500 characters', async () => {
    expect(await ok(`https://example.com/${'a'.repeat(490)}`)).toEqual({ ok: false, reason: 'too_long' });
    expect((await ok(`https://example.com/${'a'.repeat(470)}`)).ok).toBe(true);
  });

  it('buildLinkQrSpec returns a spec that passes the shared schema, or throws', async () => {
    const spec = await buildLinkQrSpec({ target: 'booking', url: 'https://book.example.com/t', resolver: PUBLIC_DNS });
    expect(qrSpecSchema.parse(spec)).toEqual({ kind: 'link', target: 'booking', url: 'https://book.example.com/t' });
    await expect(buildLinkQrSpec({ target: 'booking', url: 'http://10.0.0.1/', resolver: PUBLIC_DNS })).rejects.toThrow(QrLinkError);
    await expect(buildLinkQrSpec({ target: 'nope' as never, url: 'https://example.com', resolver: PUBLIC_DNS })).rejects.toMatchObject({ reason: 'bad_target' });
  });
});

describe('short link: created, redirects, and a scan is counted', () => {
  let db: MockDb;
  let seeded: Seeded;
  let plain: Seeded;

  const call = (code: string, qs = '', ua = CHROME) =>
    GET(new Request(`http://localhost/r/${code}${qs}`, { headers: { 'user-agent': ua } }), { params: Promise.resolve({ code }) });

  beforeAll(async () => {
    db = await createMockDb();
    setMockDbForTests(db);
    seeded = await seedLinkBrand(db, { name: 'Shop', websiteUrl: 'https://shop.example/', channel: 'instagram' });
    plain = await seedLinkBrand(db, { name: 'Plain', websiteUrl: 'https://plain.example/', channel: 'instagram' });
    await db.withAdmin(async (tx) => {
      const [b] = await tx.query<{ id: string }>(
        `insert into public.post_briefs (brand_id, post_type, qr) values ($1, 'offer', $2::jsonb) returning id`,
        [seeded.brandId, JSON.stringify({ kind: 'link', target: 'booking', url: 'https://book.example.com/table?x=1' })],
      );
      await tx.query('update public.posts set brief_id = $2 where id = $1', [seeded.postId, b.id]);
    });
  });
  afterAll(async () => {
    setMockDbForTests(null);
    await db.close();
  });
  beforeEach(() => {
    resetClickDedupe();
    pending.length = 0;
  });

  it('the QR text is our short link, marked as a QR scan', async () => {
    const spec = await buildLinkQrSpec({ target: 'booking', url: 'https://book.example.com/table?x=1', resolver: PUBLIC_DNS });
    const { text, label } = await qrContentFor(spec, { brandId: seeded.brandId, postCode: seeded.postCode, baseUrl: 'https://app.example.com' });
    expect(text).toBe(`https://app.example.com/r/${seeded.postCode}?q=1`);
    expect(label).toBe('visit');
    expect(await decodeQrPng(await qrPng(text, { scale: 6 }))).toBe(text);
    expect(isQrScanRequest(text)).toBe(true);
    expect(isQrScanRequest(`https://app.example.com/r/${seeded.postCode}`)).toBe(false);
    await expect(qrContentFor(spec, { brandId: seeded.brandId, baseUrl: 'https://app.example.com' })).rejects.toThrow(QrContentError);
  });

  it('a scan redirects to the QR URL, is stored as a QR scan and counted', async () => {
    const res = await call(seeded.postCode, '?q=1');
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('https://book.example.com/table?x=1&utm_source=qr&utm_medium=social&utm_campaign=weekly-posts&utm_content=' + seeded.postCode);
    await flush();
    const [row] = await db.withAdmin((tx) => tx.query<{ user_agent: string; source: string }>('select user_agent, source from public.clicks where post_id = $1', [seeded.postId]));
    expect(row).toEqual({ user_agent: CHROME, source: 'qr' }); // the user agent is stored as it was
    const range = { from: '2000-01-01T00:00:00Z', to: '2100-01-01T00:00:00Z' };
    expect(await qrScansByPost(seeded.userId, seeded.brandId, range)).toEqual([{ postId: seeded.postId, scans: 1 }]);
    // Scans are not link clicks.
    expect(await clicksByPost(seeded.userId, seeded.brandId, range)).toEqual([]);
  });

  it('the ordinary short link still goes to the brand destination and is not a QR scan', async () => {
    resetClickDedupe();
    const res = await call(seeded.postCode, '', CHROME + ' x');
    expect(res.headers.get('location')).toContain('https://shop.example/');
    await flush();
    expect(await count(db, 'select 1 from public.clicks where post_id = $1', [seeded.postId])).toBe(2);
    const range = { from: '2000-01-01T00:00:00Z', to: '2100-01-01T00:00:00Z' };
    expect((await qrScansByPost(seeded.userId, seeded.brandId, range))[0].scans).toBe(1);
    expect(await clicksByPost(seeded.userId, seeded.brandId, range)).toEqual([{ postId: seeded.postId, clicks: 1 }]);
    expect(await count(db, "select 1 from public.clicks where post_id = $1 and source = 'link'", [seeded.postId])).toBe(1);
  });

  it('a post with no link QR in its brief falls back to the brand destination on ?q=1', async () => {
    const res = await call(plain.postCode, '?q=1');
    expect(res.headers.get('location')).toContain('https://plain.example/');
    await flush();
    expect(await count(db, 'select 1 from public.clicks where post_id = $1', [plain.postId])).toBe(1);
  });

  it('bots opening the QR link are not counted', async () => {
    const before = await count(db, 'select 1 from public.clicks where post_id = $1', [seeded.postId]);
    await call(seeded.postCode, '?q=1', 'Googlebot/2.1');
    await flush();
    expect(await count(db, 'select 1 from public.clicks where post_id = $1', [seeded.postId])).toBe(before);
  });

  it("another brand's owner cannot read these scans (RLS)", async () => {
    const range = { from: '2000-01-01T00:00:00Z', to: '2100-01-01T00:00:00Z' };
    expect(await qrScansByPost(plain.userId, seeded.brandId, range)).toEqual([]);
  });
});
