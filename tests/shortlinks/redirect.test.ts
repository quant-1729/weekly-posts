import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { isPublicPath } from '@/lib/auth/public-paths';
import { createMockDb, setMockDbForTests, type MockDb } from '@/lib/db/mock';
import { resetClickDedupe } from '@/lib/shortlinks/bots';
import { clicksByPost } from '@/lib/shortlinks';
import { GET, HEAD } from '@/app/r/[code]/route';
import CardPage from '@/app/r/[code]/card/page';
import { count } from '../weekly/helpers';
import { seedLinkBrand, type Seeded } from './helpers';

// after() only works inside a Next request. Here it queues the work so a test can run it
// (flush) and see exactly what a real response would have left behind.
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
const SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const INSTAGRAM_APP = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 330.0.0.0';

let db: MockDb;
let withDest: Seeded, websiteOnly: Seeded, neither: Seeded, whatsapp: Seeded, instagram: Seeded, badStored: Seeded;

const call = (code: string, init: { method?: string; ua?: string | null; headers?: Record<string, string> } = {}) => {
  const headers = new Headers(init.headers);
  if (init.ua !== null) headers.set('user-agent', init.ua ?? CHROME);
  const req = new Request(`http://localhost/r/${code}`, { method: init.method ?? 'GET', headers });
  return (init.method === 'HEAD' ? HEAD : GET)(req, { params: Promise.resolve({ code }) });
};
const clicks = (postId: string) => count(db, 'select 1 from public.clicks where post_id = $1', [postId]);

beforeAll(async () => {
  db = await createMockDb();
  setMockDbForTests(db);
  withDest = await seedLinkBrand(db, { name: 'Dest', linkDestination: 'https://book.example.com/table?table=2&utm_source=mine#menu', websiteUrl: 'https://bakery.example/' });
  websiteOnly = await seedLinkBrand(db, { name: 'Site', websiteUrl: 'https://bakery.example/shop' });
  neither = await seedLinkBrand(db, {
    name: 'Corner Cards',
    city: 'Leeds',
    facts: [
      { kind: 'phone', label: 'Phone', value: '+44 113 496 0000' },
      { kind: 'email', label: 'Email', value: 'hello@cornercards.example' },
      { kind: 'address', label: 'Address', value: '12 High Street, Leeds LS1 1AA' },
      { kind: 'hours', label: 'Hours', value: 'Mon to Sat 9am to 5pm' },
      { kind: 'price', label: 'Card', value: '£3.20 secret-price' },
    ],
  });
  whatsapp = await seedLinkBrand(db, { name: 'Chat', linkDestination: 'https://wa.me/447700900123?text=Hi', websiteUrl: 'https://bakery.example/' });
  instagram = await seedLinkBrand(db, { name: 'Insta', websiteUrl: 'https://bakery.example/', channel: 'instagram' });
  badStored = await seedLinkBrand(db, { name: 'Bad', linkDestination: 'javascript:alert(1)', websiteUrl: 'https://bakery.example/ok' });
  // An inactive phone must not appear on the card.
  await db.withAdmin((tx) =>
    tx.query(`insert into public.brand_facts (brand_id, kind, label, value, source_type, active) values ($1, 'phone', 'Old', '+44 999 000 1111', 'owner', false)`, [neither.brandId]),
  );
});
afterAll(async () => {
  setMockDbForTests(null);
  await db.close();
});
beforeEach(() => {
  resetClickDedupe();
  pending.length = 0;
});

describe('GET /r/[code] destination', () => {
  it('redirects to link_destination with UTM, keeping existing utm params, other params and the fragment', async () => {
    const res = await call(withDest.postCode);
    expect(res.status).toBe(302);
    const loc = new URL(res.headers.get('location')!);
    expect(`${loc.origin}${loc.pathname}`).toBe('https://book.example.com/table');
    expect(loc.hash).toBe('#menu');
    expect(loc.searchParams.get('table')).toBe('2');
    expect(loc.searchParams.get('utm_source')).toBe('mine'); // not overwritten
    expect(loc.searchParams.get('utm_medium')).toBe('social');
    expect(loc.searchParams.get('utm_campaign')).toBe('weekly-posts');
    expect(loc.searchParams.get('utm_content')).toBe(withDest.postCode);
    expect(loc.searchParams.getAll('utm_source')).toHaveLength(1);
    // The destination is not the website.
    expect(res.headers.get('location')).not.toContain('bakery.example');
  });

  it('falls back to the website, with the channel as utm_source', async () => {
    const res = await call(websiteOnly.postCode);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(
      `https://bakery.example/shop?utm_source=facebook&utm_medium=social&utm_campaign=weekly-posts&utm_content=${websiteOnly.postCode}`,
    );
    const insta = await call(instagram.postCode);
    expect(new URL(insta.headers.get('location')!).searchParams.get('utm_source')).toBe('instagram');
  });

  it('goes to the public card when there is no destination or website', async () => {
    const res = await call(neither.postCode);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(`/r/${neither.postCode}/card`);
  });

  it('does not add UTM to a WhatsApp link', async () => {
    const res = await call(whatsapp.postCode);
    expect(res.headers.get('location')).toBe('https://wa.me/447700900123?text=Hi');
  });

  it('never redirects to a stored value that is not an http(s) URL', async () => {
    const res = await call(badStored.postCode);
    expect(res.headers.get('location')).toContain('https://bakery.example/ok');
  });

  it('sets no-store and the referrer policy', async () => {
    const res = await call(withDest.postCode);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer-when-downgrade');
  });

  it('is a public path', () => {
    expect(isPublicPath('/r/abc1234')).toBe(true);
    expect(isPublicPath('/r/abc1234/card')).toBe(true);
  });
});

describe('unknown code', () => {
  it('answers a friendly 404 that gives nothing away', async () => {
    for (const code of ['zzzzzzz', 'x', 'UPPER-bad!', '../etc', 'a'.repeat(40)]) {
      const res = await call(code);
      expect(res.status).toBe(404);
      const body = await res.text();
      expect(body).toContain("This link has expired or doesn't exist");
      expect(body).not.toMatch(/brand|postgres|error|stack/i);
      expect(res.headers.get('location')).toBeNull();
    }
    await flush();
  });

  it('answers the same 404 body for a well-formed code that does not exist and a malformed one', async () => {
    const a = await (await call('zzzzzzz')).text();
    const b = await (await call('!!')).text();
    expect(a).toBe(b);
  });
});

describe('click log', () => {
  it('writes one click for a normal browser, after the response, with the user agent', async () => {
    const p = withDest;
    const before = await clicks(p.postId);
    const res = await call(p.postCode, { ua: SAFARI });
    expect(res.status).toBe(302);
    expect(await clicks(p.postId)).toBe(before); // nothing written before after() runs
    expect(pending).toHaveLength(1);
    await flush();
    expect(await clicks(p.postId)).toBe(before + 1);
    const [row] = await db.withAdmin((tx) =>
      tx.query<{ user_agent: string; brand_id: string }>('select user_agent, brand_id::text as brand_id from public.clicks where post_id = $1 order by id desc limit 1', [p.postId]),
    );
    expect(row.user_agent).toBe(SAFARI);
    expect(row.brand_id).toBe(p.brandId);
  });

  it('stores the user agent cut to 300 characters', async () => {
    const p = websiteOnly;
    await call(p.postCode, { ua: `Mozilla/5.0 ${'x'.repeat(900)}` });
    await flush();
    const [row] = await db.withAdmin((tx) => tx.query<{ n: number }>('select length(user_agent)::int as n from public.clicks where post_id = $1', [p.postId]));
    expect(row.n).toBe(300);
  });

  it('counts the in-app browsers of Instagram, Facebook and Chrome as people', async () => {
    const p = instagram;
    for (const ua of [INSTAGRAM_APP, CHROME, 'Mozilla/5.0 (Linux; Android 13) Chrome/120 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/450.0]']) {
      await call(p.postCode, { ua });
    }
    await flush();
    expect(await clicks(p.postId)).toBe(3);
  });

  it('logs the card redirect the same way', async () => {
    const p = neither;
    await call(p.postCode);
    await flush();
    expect(await clicks(p.postId)).toBe(1);
  });

  it('does not log HEAD requests', async () => {
    const p = whatsapp;
    const res = await call(p.postCode, { method: 'HEAD' });
    expect(res.status).toBe(302);
    // The GET handler given a HEAD request is also not counted.
    await GET(new Request('http://localhost/r/x', { method: 'HEAD', headers: { 'user-agent': CHROME } }), { params: Promise.resolve({ code: p.postCode }) });
    await flush();
    expect(await clicks(p.postId)).toBe(0);
  });

  it.each([
    ['Purpose', 'prefetch'],
    ['Sec-Purpose', 'prefetch;prerender'],
    ['X-Moz', 'prefetch'],
  ])('does not log a prefetch (%s: %s)', async (name, value) => {
    const p = whatsapp;
    const before = await clicks(p.postId);
    const res = await call(p.postCode, { headers: { [name]: value } });
    expect(res.status).toBe(302);
    await flush();
    expect(await clicks(p.postId)).toBe(before);
  });

  const BOTS: Record<string, string> = {
    facebook: 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uagent.php)',
    twitter: 'Twitterbot/1.0',
    linkedin: 'LinkedInBot/1.0 (compatible; Mozilla/5.0; Apache-HttpClient +http://www.linkedin.com)',
    slack: 'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)',
    whatsapp: 'WhatsApp/2.23.20.0 A',
    telegram: 'TelegramBot (like TwitterBot)',
    discord: 'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)',
    google: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    bing: 'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)',
    apple: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.1.1 Safari/605.1.15 (Applebot/0.1; +http://www.apple.com/go/applebot)',
    curl: 'curl/8.4.0',
    wget: 'Wget/1.21.4',
    pythonRequests: 'python-requests/2.31.0',
    goHttp: 'Go-http-client/2.0',
    msOffice: 'Mozilla/4.0 (compatible; ms-office; MSOffice 16)',
    msOffice2: 'Microsoft Office/16.0 (Windows NT 10.0; Microsoft Outlook 16.0.17231; Pro)',
    safeLinks: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Microsoft SafeLinks Protection',
    barracuda: 'Barracuda Sentinel (EE)',
    proofpoint: 'Mozilla/5.0 (compatible; ProofpointURLDefense/1.0)',
    mimecast: 'Mimecast-Link-Protect/1.0',
    headless: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/120.0.0.0 Safari/537.36',
    noUa: '',
  };
  it.each(Object.entries(BOTS))('does not log %s', async (_name, ua) => {
    const p = withDest;
    const before = await clicks(p.postId);
    const res = await call(p.postCode, { ua });
    expect(res.status).toBe(302); // the redirect itself still works
    await flush();
    expect(await clicks(p.postId)).toBe(before);
  });

  it('does not log a repeat of the same user agent on the same post within 30 seconds', async () => {
    const p = websiteOnly;
    const before = await clicks(p.postId);
    const otherBefore = await clicks(instagram.postId);
    await call(p.postCode, { ua: CHROME });
    await call(p.postCode, { ua: CHROME });
    await call(p.postCode, { ua: CHROME });
    await flush();
    expect(await clicks(p.postId)).toBe(before + 1);
    // A different phone, or a different post, is a different click.
    await call(p.postCode, { ua: SAFARI });
    await call(instagram.postCode, { ua: CHROME });
    await flush();
    expect(await clicks(p.postId)).toBe(before + 2);
    expect(await clicks(instagram.postId)).toBe(otherBefore + 1);
  });
});

describe('AC 19: speed and freshness', () => {
  it('the handler itself takes well under 300 ms (p95 of 20 runs, mock database)', async () => {
    await call(withDest.postCode); // warm up the connection and module caches
    const times: number[] = [];
    for (let i = 0; i < 20; i++) {
      const t = performance.now();
      const res = await call(withDest.postCode, { ua: `${CHROME} run-${i}` });
      times.push(performance.now() - t);
      expect(res.status).toBe(302);
    }
    times.sort((a, b) => a - b);
    const p95 = times[Math.ceil(times.length * 0.95) - 1];
    console.log(`[AC19] redirect handler, 20 runs: min ${times[0].toFixed(1)} ms, median ${times[10].toFixed(1)} ms, p95 ${p95.toFixed(1)} ms, max ${times[19].toFixed(1)} ms`);
    expect(p95).toBeLessThan(300);
    pending.length = 0;
  });

  it('a click is on the dashboard query as soon as after() has run (needs far less than 1 minute)', async () => {
    const p = await seedLinkBrand(db, { name: 'Fresh', websiteUrl: 'https://bakery.example/' });
    const t0 = new Date();
    const range = { from: new Date(t0.getTime() - 60_000), to: new Date(t0.getTime() + 60_000) };
    expect(await clicksByPost(p.userId, p.brandId, range)).toEqual([]);
    await call(p.postCode);
    await flush();
    expect(await clicksByPost(p.userId, p.brandId, range)).toEqual([{ postId: p.postId, clicks: 1 }]);
    expect(Date.now() - t0.getTime()).toBeLessThan(60_000);
  });
});

describe('public card', () => {
  const render = async (code: string) => renderToStaticMarkup(await CardPage({ params: Promise.resolve({ code }) }));

  it('shows the business, city and contact facts as links, and nothing private', async () => {
    const html = await render(neither.postCode);
    expect(html).toContain('Corner Cards');
    expect(html).toContain('Leeds');
    expect(html).toContain('href="tel:+441134960000"');
    expect(html).toContain('href="mailto:hello@cornercards.example"');
    expect(html).toContain('https://www.google.com/maps/search/?api=1&amp;query=12%20High%20Street%2C%20Leeds%20LS1%201AA');
    expect(html).toContain('Mon to Sat 9am to 5pm');
    // Prices, inactive facts and ids stay off the page.
    expect(html).not.toContain('secret-price');
    expect(html).not.toContain('999 000 1111');
    expect(html).not.toContain(neither.brandId);
    expect(html).not.toContain(neither.userId);
  });

  it('is a 404 for an unknown code', async () => {
    await expect(render('zzzzzzz')).rejects.toMatchObject({ digest: expect.stringContaining('404') });
  });
});
