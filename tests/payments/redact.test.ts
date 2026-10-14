import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createMockDb, setMockDbForTests, type MockDb } from '@/lib/db/mock';
import { generateJson } from '@/lib/ai/client';
import {
  REDACTED_PAYMENT_ID,
  containsPaymentId,
  findPaymentIds,
  foreignPaymentIds,
  redactDeep,
  redactForBrand,
  redactPaymentIds,
} from '@/lib/payments';
import { qrContentFor, QrContentError, verifyQrOnPost } from '@/lib/qr/content';
import { qrPng } from '@/lib/qr/encode';
import { seedWeeklyBrand } from '../weekly/helpers';
import { addPaymentId, confirmPaymentId } from '@/lib/payments';
import { listOutbox } from '@/lib/email/outbox';

describe('redactPaymentIds', () => {
  it('removes UPI-like addresses and upi:// links, keeps the rest of the sentence', () => {
    expect(redactPaymentIds('Pay at ravi.kumar@okhdfcbank today')).toBe(`Pay at ${REDACTED_PAYMENT_ID} today`);
    expect(redactPaymentIds('UPI: 9876543210@ybl.')).toBe(`UPI: ${REDACTED_PAYMENT_ID}.`);
    expect(redactPaymentIds('ab@ok and b-c@paytm')).toBe(`${REDACTED_PAYMENT_ID} and ${REDACTED_PAYMENT_ID}`);
    expect(redactPaymentIds('scan upi://pay?pa=shop@okaxis&pn=Shop%20X&cu=INR now')).toBe(`scan ${REDACTED_PAYMENT_ID} now`);
    expect(redactPaymentIds('UPI://PAY?pa=shop@okaxis')).toBe(REDACTED_PAYMENT_ID);
  });

  it('leaves email addresses, @handles, URLs and ordinary text alone', () => {
    for (const t of ['Write to hello@bakery.example.com', 'jo@example.co.uk', 'Follow @cornerbakery', 'https://bakery.example/menu', 'Fresh bread at 7am. 50% off.', 'user@host.io']) {
      expect(redactPaymentIds(t)).toBe(t);
    }
  });

  it('removes known addresses of any shape, case-insensitively', () => {
    expect(redactPaymentIds('send to PIX-key-123 please', { known: ['pix-key-123'] })).toBe(`send to ${REDACTED_PAYMENT_ID} please`);
    expect(redactPaymentIds('x SHOP.One@OkAxis y', { known: ['shop.one@okaxis'] })).toBe(`x ${REDACTED_PAYMENT_ID} y`);
  });

  it('finds, detects and filters', () => {
    expect(findPaymentIds('a shop@okaxis b upi://pay?pa=other%40ybl&pn=x')).toEqual(['other@ybl', 'shop@okaxis']);
    expect(containsPaymentId('nothing here')).toBe(false);
    expect(containsPaymentId('hi shop@okaxis')).toBe(true);
    expect(containsPaymentId('hi PIXKEY', ['pixkey'])).toBe(true);
    expect(foreignPaymentIds('pay shop@okaxis or evil@ybl', ['SHOP@okaxis'])).toEqual(['evil@ybl']);
  });

  it('redactDeep walks objects and arrays and leaves other values', () => {
    const out = redactDeep({ note: 'pay a.b@ybl', list: ['x c.d@okaxis', 3, null], nested: { n: 'ok' }, flag: true });
    expect(out).toEqual({ note: `pay ${REDACTED_PAYMENT_ID}`, list: [`x ${REDACTED_PAYMENT_ID}`, 3, null], nested: { n: 'ok' }, flag: true });
  });
});

describe('payment IDs never reach the AI client', () => {
  let db: MockDb;
  let brand: { userId: string; brandId: string };
  const ACTIVE = 'ravi.sweets@okhdfcbank';
  const PENDING = 'new.account@oksbi';

  beforeAll(async () => {
    db = await createMockDb();
    setMockDbForTests(db);
    brand = await seedWeeklyBrand(db, { name: 'Ravi Sweets', country: 'IN' });
    await addPaymentId({ userId: brand.userId, brandId: brand.brandId, scheme: 'upi', address: ACTIVE, payeeName: 'Ravi Sweets' });
    const token = /\/p\/([A-Za-z0-9_-]{43})/.exec((await listOutbox())[0].text)![1];
    expect((await confirmPaymentId(token)).state).toBe('confirmed');
    await addPaymentId({ userId: brand.userId, brandId: brand.brandId, scheme: 'upi', address: PENDING, payeeName: 'Ravi Sweets' });
  });
  afterAll(async () => {
    setMockDbForTests(null);
    await db.close();
  });

  it('redactForBrand removes the active, the pending and any pattern match', async () => {
    const note = `Diwali box 500 rupees. Pay to ${ACTIVE} or ${PENDING.toUpperCase()} or friend@ybl`;
    const clean = await redactForBrand(brand.brandId, note);
    for (const secret of [ACTIVE, PENDING, 'friend@ybl']) expect(clean.toLowerCase()).not.toContain(secret.toLowerCase());
    expect(clean).toContain('Diwali box 500 rupees.');
  });

  it('a brief-from-note call built with redactForBrand hands the AI client no payment address', async () => {
    // The brief-from-text prompt (B-7) is phase 2. This is the contract it must follow: build the
    // prompt from redactForBrand(note) and everything the client receives is free of the address.
    const seen: Array<{ system: string; user: string }> = [];
    const spy = vi.fn(async (args: Parameters<typeof generateJson>[0]) => {
      seen.push({ system: args.system, user: args.user });
      return generateJson(args);
    });
    const note = `Offer: 20% off sweets till Sunday. Pay ${ACTIVE} (also upi://pay?pa=${ACTIVE}&pn=Ravi) or ${PENDING}`;
    const user = `Owner note:\n${await redactForBrand(brand.brandId, note)}`;
    const res = await spy({ system: 'Fill the brief from the note.', user, zodSchema: z.object({ ok: z.boolean() }), jsonSchema: {}, fixture: { ok: true } });
    expect(res.data).toEqual({ ok: true });
    expect(spy).toHaveBeenCalledTimes(1);
    const everything = seen.map((s) => `${s.system}\n${s.user}`).join('\n').toLowerCase();
    expect(everything).not.toContain(ACTIVE.toLowerCase());
    expect(everything).not.toContain(PENDING.toLowerCase());
    expect(everything).not.toContain('upi://');
    expect(everything).toContain('20% off sweets');
  });

  it('qrContentFor builds the exact UPI string for an active ID and refuses pending, retired or foreign IDs', async () => {
    const ids = await db.withAdmin((tx) => tx.query<{ id: string; status: string }>('select id, status from public.payment_ids where brand_id = $1', [brand.brandId]));
    const active = ids.find((i) => i.status === 'active')!;
    const pending = ids.find((i) => i.status === 'pending')!;
    const content = await qrContentFor({ kind: 'payment', paymentId: active.id, amount: 120 }, { brandId: brand.brandId });
    expect(content.text).toBe(`upi://pay?pa=${ACTIVE}&pn=Ravi%20Sweets&cu=INR&am=120.00`);
    expect(content).toMatchObject({ kind: 'payment', label: 'pay', payment: { address: ACTIVE, payeeName: 'Ravi Sweets' } });
    await expect(qrContentFor({ kind: 'payment', paymentId: pending.id }, { brandId: brand.brandId })).rejects.toThrow(QrContentError);
    const otherBrand = await seedWeeklyBrand(db, { name: 'Other', country: 'IN' });
    await expect(qrContentFor({ kind: 'payment', paymentId: active.id }, { brandId: otherBrand.brandId })).rejects.toMatchObject({ reason: 'payment_not_active' });

    // The post is blocked when the rendered picture does not decode to exactly that string.
    expect((await verifyQrOnPost(await qrPng(content.text, { scale: 6 }), content)).ok).toBe(true);
    const tampered = await qrPng(content.text.replace('ravi.sweets', 'ravi.sweet5'), { scale: 6 });
    const bad = await verifyQrOnPost(tampered, content);
    expect(bad.ok).toBe(false);
    expect(bad.decoded).toContain('ravi.sweet5');
  });
});
