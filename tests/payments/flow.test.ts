import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, POST } from '@/app/p/[token]/route';
import { isPublicPath } from '@/lib/auth/public-paths';
import { resetRateLimits } from '@/lib/auth/rate-limit';
import { createMockDb, setMockDbForTests, type MockDb } from '@/lib/db/mock';
import { listOutbox } from '@/lib/email/outbox';
import {
  CONFIRM_TTL_MS,
  PaymentError,
  addPaymentId,
  confirmPaymentId,
  getActivePaymentId,
  listPaymentIds,
  peekConfirmation,
  retirePaymentId,
} from '@/lib/payments';
import { PAYMENT_CSRF_COOKIE, paymentNonce } from '@/lib/payments/confirm-link';
import { count, seedWeeklyBrand } from '../weekly/helpers';

let db: MockDb;
let owner: { userId: string; brandId: string };
let other: { userId: string; brandId: string };
let editor: string;

const BASE = 'http://localhost:3000';
const sha = (v: string) => createHash('sha256').update(v).digest('hex');

beforeAll(async () => {
  db = await createMockDb();
  setMockDbForTests(db);
  owner = await seedWeeklyBrand(db, { name: 'Ravi Sweets', country: 'IN', city: 'Pune', timezone: 'Asia/Kolkata' });
  other = await seedWeeklyBrand(db, { name: 'Other Shop', country: 'IN' });
  // An editor (not owner) on the first brand.
  editor = await db.withAdmin(async (tx) => {
    const [u] = await tx.query<{ id: string }>("insert into auth.users (email) values ('editor@example.com') returning id");
    await tx.query("insert into public.profiles (id, email, consent_at) values ($1, 'editor@example.com', now())", [u.id]);
    await tx.query("insert into public.brand_members (brand_id, user_id, role) values ($1, $2, 'editor')", [owner.brandId, u.id]);
    return u.id;
  });
});
afterAll(async () => {
  setMockDbForTests(null);
  await db.close();
});
beforeEach(() => resetRateLimits());

const add = (address: string, payeeName = 'Ravi Kumar', o: { userId?: string; brandId?: string; now?: Date } = {}) =>
  addPaymentId({ userId: o.userId ?? owner.userId, brandId: o.brandId ?? owner.brandId, scheme: 'upi', address, payeeName, now: o.now });

/** The confirmation token from the newest email in the outbox. */
async function lastEmail() {
  const e = (await listOutbox())[0];
  const link = /https?:\/\/[^\s"'<>]+\/p\/([A-Za-z0-9_-]{43})/.exec(e.text)!;
  return { entry: e, token: link[1], url: link[0] };
}
const statusOf = async (id: string) => (await db.withAdmin((tx) => tx.query<{ status: string }>('select status from public.payment_ids where id = $1', [id])))[0].status;

function open(token: string, cookie?: string) {
  return GET(new NextRequest(`${BASE}/p/${token}`, { headers: cookie ? { cookie } : {} }), { params: Promise.resolve({ token }) });
}
function press(token: string, fields: { nonce?: string }, cookie?: string) {
  const body = new URLSearchParams();
  if (fields.nonce !== undefined) body.set('nonce', fields.nonce);
  return POST(
    new NextRequest(`${BASE}/p/${token}`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', ...(cookie ? { cookie } : {}) }, body }),
    { params: Promise.resolve({ token }) },
  );
}
/** Opens the link as the owner's browser does, returns what the form needs to POST. */
async function browser(token: string) {
  const res = await open(token);
  const html = await res.text();
  const secret = res.cookies.get(PAYMENT_CSRF_COOKIE)?.value;
  return { res, html, cookie: secret ? `${PAYMENT_CSRF_COOKIE}=${secret}` : undefined, nonce: /name="nonce" value="([^"]+)"/.exec(html)?.[1] };
}

describe('adding a payment ID', () => {
  it('saves it as pending with only the token hash, and emails the owner a confirmation link', async () => {
    const t0 = new Date();
    const p = await add('ravi.kumar@okhdfcbank', 'Ravi Kumar', { now: t0 });
    expect(p).toMatchObject({ status: 'pending', address: 'ravi.kumar@okhdfcbank', payeeName: 'Ravi Kumar', confirmedAt: null, scheme: 'upi' });
    expect(new Date(p.expiresAt!).getTime() - t0.getTime()).toBe(CONFIRM_TTL_MS);

    const { entry, token, url } = await lastEmail();
    expect(entry.kind).toBe('payment_confirm');
    expect(entry.to).toMatch(/^owner\d+@example\.com$/);
    expect(entry.text).toContain('Confirm the UPI ID for your payment QR codes: ravi.kumar@okhdfcbank (Ravi Kumar).');
    expect(entry.text).toContain("If this wasn't you, ignore this email; nothing changes.");
    expect(entry.html).toContain(url);
    const [row] = await db.withAdmin((tx) => tx.query<{ confirm_token_hash: string }>('select confirm_token_hash from public.payment_ids where id = $1', [p.id]));
    expect(row.confirm_token_hash).toBe(sha(token));
    expect(JSON.stringify(row)).not.toContain(token);
    expect(await getActivePaymentId(owner.brandId, 'upi')).toBeNull(); // not usable yet
    expect(await count(db, "select 1 from public.email_log where kind = 'payment_confirm' and brand_id = $1", [owner.brandId])).toBeGreaterThanOrEqual(1);
  });

  it('rejects bad input before anything is saved or sent', async () => {
    const sent = (await listOutbox()).length;
    await expect(add('not-an-id')).rejects.toMatchObject({ code: 'address' });
    await expect(add('name@bank.com')).rejects.toMatchObject({ code: 'address' });
    await expect(add('name@bank', '   ')).rejects.toMatchObject({ code: 'payeeName' });
    await expect(add('name@bank', 'x'.repeat(61))).rejects.toMatchObject({ code: 'payeeName' });
    await expect(addPaymentId({ userId: owner.userId, brandId: owner.brandId, scheme: 'pix', address: 'a@b', payeeName: 'X' })).rejects.toMatchObject({ code: 'scheme' });
    expect((await listOutbox()).length).toBe(sent);
  });

  it('only the brand owner can add: another business owner and an editor are refused', async () => {
    const sent = (await listOutbox()).length;
    await expect(add('evil@okaxis', 'Evil', { userId: other.userId })).rejects.toMatchObject({ code: 'not_owner' });
    await expect(add('evil@okaxis', 'Evil', { userId: editor })).rejects.toMatchObject({ code: 'not_owner' });
    expect((await listOutbox()).length).toBe(sent);
    expect(await count(db, "select 1 from public.payment_ids where address = 'evil@okaxis'")).toBe(0);
  });

  it('is limited to a few confirmation emails per hour per business', async () => {
    const b = await seedWeeklyBrand(db, { name: 'Busy', country: 'IN' });
    for (let i = 0; i < 5; i++) await add(`busy${i}@okaxis`, 'Busy', { userId: b.userId, brandId: b.brandId });
    await expect(add('busy9@okaxis', 'Busy', { userId: b.userId, brandId: b.brandId })).rejects.toBeInstanceOf(PaymentError);
  });
});

describe('the confirmation link', () => {
  it('GET shows the ID and a Confirm button and changes nothing, however often it is opened', async () => {
    const p = await add('first@okaxis', 'First Name');
    const { token } = await lastEmail();
    for (let i = 0; i < 3; i++) {
      const { res, html } = await browser(token); // a mail scanner opening the link
      expect(res.status).toBe(200);
      expect(html).toContain('first@okaxis');
      expect(html).toContain('First Name');
      expect(html).toContain('Confirm this ID');
      expect(html).toContain(`action="/p/${token}"`);
      expect(res.headers.get('cache-control')).toBe('no-store');
    }
    expect(await statusOf(p.id)).toBe('pending');
    expect(await getActivePaymentId(owner.brandId, 'upi')).toBeNull();
  });

  it('POST without the cookie and nonce does nothing', async () => {
    const p = await add('second@okaxis', 'Second');
    const { token } = await lastEmail();
    const noCookie = await press(token, { nonce: 'x' });
    expect(noCookie.status).toBe(403);
    const { cookie } = await browser(token);
    expect((await press(token, { nonce: 'wrong' }, cookie)).status).toBe(403);
    expect((await press(token, {}, cookie)).status).toBe(403);
    // A nonce made for another token does not work either.
    const secret = cookie!.split('=')[1];
    expect((await press(token, { nonce: paymentNonce('A'.repeat(43), secret) }, cookie)).status).toBe(403);
    expect(await statusOf(p.id)).toBe('pending');
  });

  it('POST with the nonce activates it (as the service role), once', async () => {
    const p = await add('active1@okaxis', 'Active One');
    const { token } = await lastEmail();
    const b = await browser(token);
    const res = await press(token, { nonce: b.nonce }, b.cookie);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('Payment ID confirmed');
    const active = await getActivePaymentId(owner.brandId, 'upi');
    expect(active).toMatchObject({ id: p.id, status: 'active', address: 'active1@okaxis', payeeName: 'Active One' });
    expect(active!.confirmedAt).not.toBeNull();

    // Reusing the link (a second press, or opening it later) changes nothing and says so.
    const again = await press(token, { nonce: b.nonce }, b.cookie);
    expect(again.status).toBe(410);
    expect(await again.text()).toContain('already used');
    const view = await open(token);
    expect(view.status).toBe(410);
    expect(await getActivePaymentId(owner.brandId, 'upi')).toMatchObject({ id: p.id });
  });

  it('a second ID retires the first when it is confirmed, and not before', async () => {
    const first = (await getActivePaymentId(owner.brandId, 'upi'))!;
    const second = await add('active2@okaxis', 'Active Two');
    const { token } = await lastEmail();
    expect(await getActivePaymentId(owner.brandId, 'upi')).toMatchObject({ id: first.id }); // old one keeps working meanwhile
    const b = await browser(token);
    expect((await b.html)).toContain('This replaces your current ID');
    await press(token, { nonce: b.nonce }, b.cookie);
    expect(await statusOf(first.id)).toBe('retired');
    expect(await statusOf(second.id)).toBe('active');
    expect(await count(db, "select 1 from public.payment_ids where brand_id = $1 and status = 'active'", [owner.brandId])).toBe(1);
    expect((await getActivePaymentId(owner.brandId, 'upi'))!.id).toBe(second.id);
  });

  it('an expired token is refused on GET and POST, and the ID stays pending', async () => {
    const old = new Date(Date.now() - 2 * 3600_000);
    const p = await add('late@okaxis', 'Late', { now: old });
    const { token } = await lastEmail();
    const res = await open(token);
    expect(res.status).toBe(410);
    expect(await res.text()).toContain('expired');
    // Even with a perfectly valid nonce and cookie.
    const secret = 'S'.repeat(43);
    const posted = await press(token, { nonce: paymentNonce(token, secret) }, `${PAYMENT_CSRF_COOKIE}=${secret}`);
    expect(posted.status).toBe(410);
    expect(await statusOf(p.id)).toBe('pending');
    expect(await confirmPaymentId(token)).toEqual({ state: 'expired' });
    // Just inside the hour still works at the library level.
    expect(await peekConfirmation(token, new Date(old.getTime() + CONFIRM_TTL_MS - 1))).toMatchObject({ state: 'ready' });
    expect(await peekConfirmation(token, new Date(old.getTime() + CONFIRM_TTL_MS))).toEqual({ state: 'expired' });
  });

  it('a newer request cancels an older pending link', async () => {
    const a = await add('older@okaxis', 'Older');
    const aTok = (await lastEmail()).token;
    const b = await add('newer@okaxis', 'Newer');
    const bTok = (await lastEmail()).token;
    expect(await statusOf(a.id)).toBe('retired');
    const res = await open(aTok);
    expect(res.status).toBe(410);
    expect(await res.text()).toContain('replaced');
    expect(await confirmPaymentId(aTok)).toEqual({ state: 'replaced' });
    expect((await peekConfirmation(bTok)).state).toBe('ready');
    expect(await statusOf(b.id)).toBe('pending');
  });

  it('invalid, malformed and foreign tokens show a plain page', async () => {
    for (const token of ['x', 'A'.repeat(43), 'not-a-token!', '%00']) {
      const res = await open(token);
      expect(res.status).toBe(404);
      expect(await res.text()).toContain('not valid');
    }
    expect(await confirmPaymentId('A'.repeat(43))).toEqual({ state: 'invalid' });
  });

  it('/p/ needs no sign-in', () => {
    expect(isPublicPath('/p/abc')).toBe(true);
    expect(isPublicPath('/p')).toBe(false);
  });
});

describe('retire, list, active', () => {
  it('lists newest first for members, never exposes the token hash, and hides it from other businesses', async () => {
    const mine = await listPaymentIds(owner.userId, owner.brandId);
    expect(mine.length).toBeGreaterThan(3);
    expect(JSON.stringify(mine)).not.toMatch(/token|hash/i);
    expect(mine[0].createdAt >= mine[mine.length - 1].createdAt).toBe(true);
    expect((await listPaymentIds(editor, owner.brandId)).length).toBe(mine.length); // members can read
    expect(await listPaymentIds(other.userId, owner.brandId)).toEqual([]);
    expect(await listPaymentIds(owner.userId, 'not-a-uuid')).toEqual([]);
  });

  it('the owner can retire an active ID; an editor and another owner cannot', async () => {
    const active = (await getActivePaymentId(owner.brandId, 'upi'))!;
    await expect(retirePaymentId({ userId: editor, brandId: owner.brandId, id: active.id })).rejects.toMatchObject({ code: 'not_owner' });
    await expect(retirePaymentId({ userId: other.userId, brandId: owner.brandId, id: active.id })).rejects.toMatchObject({ code: 'not_owner' });
    expect(await statusOf(active.id)).toBe('active');
    expect(await retirePaymentId({ userId: owner.userId, brandId: owner.brandId, id: active.id })).toBe(true);
    expect(await getActivePaymentId(owner.brandId, 'upi')).toBeNull();
    expect(await retirePaymentId({ userId: owner.userId, brandId: owner.brandId, id: active.id })).toBe(false); // already retired
    expect(await retirePaymentId({ userId: owner.userId, brandId: owner.brandId, id: randomUUID() })).toBe(false);
  });

  it('refuses to add the ID that is already active under the same name', async () => {
    await add('keep@okaxis', 'Keep');
    const { token } = await lastEmail();
    const b = await browser(token);
    await press(token, { nonce: b.nonce }, b.cookie);
    await expect(add('KEEP@okaxis', 'keep')).rejects.toMatchObject({ code: 'already_active' });
    // Same ID with another payee name is a change and needs a confirmation again.
    await expect(add('keep@okaxis', 'Keep Foods')).resolves.toMatchObject({ status: 'pending' });
  });
});

describe('row-level security on payment_ids', () => {
  const insert = (userId: string, brandId: string, status: string, extra = '') =>
    db.withUser(userId, (tx) =>
      tx.query(
        `insert into public.payment_ids (brand_id, scheme, address, payee_name, status${extra ? ', confirmed_at' : ''}) values ($1, 'upi', $2, 'X', $3${extra ? ', now()' : ''})`,
        [brandId, `rls${Math.random().toString(36).slice(2, 8)}@okaxis`, status],
      ),
    );

  it('a signed-in owner cannot create an active ID', async () => {
    await expect(insert(owner.userId, owner.brandId, 'active', 'confirmed')).rejects.toThrow();
    await expect(insert(owner.userId, owner.brandId, 'pending', 'confirmed')).rejects.toThrow(); // confirmed_at must be null
    await expect(insert(owner.userId, owner.brandId, 'active')).rejects.toThrow(); // check: active needs confirmed_at
  });

  it('a signed-in owner cannot activate a pending ID by updating it', async () => {
    const p = await add('sneaky@okaxis', 'Sneaky');
    await expect(db.withUser(owner.userId, (tx) => tx.query("update public.payment_ids set status = 'active', confirmed_at = now() where id = $1", [p.id]))).rejects.toThrow();
    expect(await statusOf(p.id)).toBe('pending');
    // Retiring is allowed.
    await db.withUser(owner.userId, (tx) => tx.query("update public.payment_ids set status = 'retired' where id = $1", [p.id]));
    expect(await statusOf(p.id)).toBe('retired');
  });

  it('an editor and another business cannot insert or update; a direct insert of a bad UPI ID fails the check', async () => {
    await expect(insert(editor, owner.brandId, 'pending')).rejects.toThrow();
    await expect(insert(other.userId, owner.brandId, 'pending')).rejects.toThrow();
    const [active] = await db.withAdmin((tx) => tx.query<{ id: string }>("select id from public.payment_ids where brand_id = $1 and status = 'active'", [owner.brandId]));
    const changed = await db.withUser(other.userId, (tx) => tx.query("update public.payment_ids set payee_name = 'Hijack' where id = $1 returning id", [active.id]));
    expect(changed).toEqual([]);
    await expect(
      db.withUser(owner.userId, (tx) => tx.query("insert into public.payment_ids (brand_id, scheme, address, payee_name) values ($1, 'upi', 'no-at-sign', 'X')", [owner.brandId])),
    ).rejects.toThrow();
  });

  it('only one active ID per business and scheme, even for the service role', async () => {
    const [a] = await db.withAdmin((tx) => tx.query<{ id: string }>("select id from public.payment_ids where brand_id = $1 and status = 'active'", [owner.brandId]));
    expect(a).toBeTruthy();
    await expect(
      db.withAdmin((tx) => tx.query("insert into public.payment_ids (brand_id, scheme, address, payee_name, status, confirmed_at) values ($1, 'upi', 'dup@okaxis', 'D', 'active', now())", [owner.brandId])),
    ).rejects.toThrow();
  });
});
