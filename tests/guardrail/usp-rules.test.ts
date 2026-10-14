import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { UspKind } from '@/lib/usps/types';
import { checkUspRules, runGuardrail, type UspRuleContext, type UspRuleUsp } from '@/lib/guardrail';
import type { RegulatedKind } from '@/lib/guardrail/types';
import { createMockDb, setMockDbForTests, type MockDb } from '@/lib/db/mock';
import { post, seedBrand } from './helpers';

let n = 0;
const usp = (kind: UspKind, title: string, details: Record<string, unknown> = {}, o: { confirmed?: boolean; role?: 'primary' | 'secondary' } = {}): UspRuleUsp => ({
  uspId: `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
  kind,
  title,
  details,
  role: o.role ?? 'primary',
  confirmed: o.confirmed,
});

interface P {
  headline?: string;
  subline?: string;
  caption?: string;
  cta?: string;
  bubble?: string;
}
function run(p: P, ctx: Partial<UspRuleContext> & { usps?: UspRuleUsp[]; regulated?: RegulatedKind } = {}) {
  return checkUspRules({
    usps: ctx.usps ?? [],
    qr: ctx.qr,
    activePaymentAddresses: ctx.activePaymentAddresses,
    today: ctx.today ?? '2026-10-14',
    regulated: ctx.regulated,
    post: { caption: p.caption ?? '', cta: p.cta ?? '', image_text: { headline: p.headline ?? '', subline: p.subline ?? '', bubble: p.bubble } },
  });
}
const texts = (flags: ReturnType<typeof run>) => flags.map((f) => f.text);

const GOOGLE_4_8 = usp('reviews', '4.8 on Google', { rating: 4.8, count: 1200, platform: 'Google' }, { confirmed: true });

describe('flag shape', () => {
  it('returns the existing Flag shape: open, code layer, highlighted when the text is in the field', () => {
    const [f] = run({ headline: 'The best bread' });
    expect(f).toMatchObject({ text: 'best', kind: 'claim', field: 'image_text.headline', layer: 'code', regulated: false, highlight: true, status: 'open', decided_at: null });
    expect(f.id).toMatch(/^f_[0-9a-f]{8}$/);
  });
  it('no USPs and plain text give no flags', () => {
    expect(run({ headline: 'Fresh bread', caption: 'Open 7am to 6pm. Come and visit.', cta: 'Visit us' })).toEqual([]);
  });
});

describe('ratings', () => {
  it('flags a rating shown without the platform or the review count', () => {
    const noPlatform = run({ headline: '4.8 stars, 1,200 reviews' }, { usps: [GOOGLE_4_8] });
    expect(texts(noPlatform)).toEqual(['4.8 stars']);
    const noCount = run({ caption: 'Rated 4.8/5 on Google' }, { usps: [GOOGLE_4_8] });
    expect(noCount).toHaveLength(1);
    expect(noCount[0].text).toMatch(/4\.8/);
    const none = run({ headline: '4.8 stars' }, { usps: [GOOGLE_4_8] });
    expect(none).toHaveLength(1);
  });

  it('passes a rating with platform and count that match the USP', () => {
    expect(run({ headline: '4.8 stars on Google', subline: '1,200 reviews' }, { usps: [GOOGLE_4_8] })).toEqual([]);
    expect(run({ caption: 'Rated 4.8/5 by 1200 customers: 1200 reviews on Google' }, { usps: [GOOGLE_4_8] })).toEqual([]);
    expect(run({ headline: '4,8 Sterne', subline: 'Google, 1.200 Bewertungen' }, { usps: [GOOGLE_4_8] })).toEqual([]);
  });

  it('flags a rating that differs from the USP', () => {
    const f = run({ headline: '4.9 stars on Google', subline: '1200 reviews' }, { usps: [GOOGLE_4_8] });
    expect(texts(f)).toEqual(['4.9 stars']);
    expect(run({ headline: '5-star service on Google, 1200 reviews' }, { usps: [GOOGLE_4_8] })).toHaveLength(1);
  });

  it('flags a review count that differs from the USP, but allows "N+" up to the real count', () => {
    expect(texts(run({ headline: '4.8 stars on Google', subline: '2,500 reviews' }, { usps: [GOOGLE_4_8] }))).toContain('2,500 reviews');
    expect(run({ headline: '4.8 stars on Google', subline: '1000+ reviews' }, { usps: [GOOGLE_4_8] })).toEqual([]);
    expect(texts(run({ headline: '4.8 stars on Google', subline: '1500+ reviews' }, { usps: [GOOGLE_4_8] }))).toContain('1500+ reviews');
  });

  it('flags any rating when the brief has no reviews USP, including star glyphs', () => {
    expect(texts(run({ headline: 'Rated 4.5 stars' }))).toEqual(['Rated 4.5']);
    expect(run({ headline: '★★★★★ service' })).toHaveLength(1);
    expect(run({ caption: 'We have 3 locations and 12 reviews of our menu' }, { usps: [GOOGLE_4_8] }).map((f) => f.text)).toEqual(['12 reviews']);
  });

  it('does not mistake dates, prices or "5 de 5" inside longer numbers for ratings', () => {
    expect(run({ caption: 'Open 15/5 to 20/5, loaf £4.50' })).toEqual([]);
  });
});

describe('"up to"', () => {
  const tenOff = usp('discount', '20% off cakes', { percent: 20, on: 'cakes', upTo: false });
  it('flags "up to" when the owner did not say up to', () => {
    expect(texts(run({ headline: 'Up to 20% off cakes' }, { usps: [tenOff] }))).toEqual(['Up to 20%']);
    expect(texts(run({ headline: 'Save up to £50' }))).toEqual(['up to £50']);
    expect(run({ caption: 'hasta 30% de descuento' })).toHaveLength(1);
    expect(run({ caption: "jusqu'à 30 % de remise" })).toHaveLength(1);
    expect(run({ caption: 'bis zu 30 Prozent' })).toHaveLength(1);
    expect(run({ caption: 'até 30% off' })).toHaveLength(1);
    expect(run({ caption: '50% तक की छूट' }).length).toBeGreaterThan(0);
  });
  it('allows "up to" when the discount USP has upTo set', () => {
    const upTo = usp('discount', 'Up to 20% off cakes', { percent: 20, on: 'cakes', upTo: true });
    expect(run({ headline: 'Up to 20% off cakes' }, { usps: [upTo] })).toEqual([]);
  });
  it('leaves "up to" without a figure alone ("keeping up to date")', () => {
    expect(run({ caption: 'We keep up to date with trends. Up to you!' })).toEqual([]);
  });
});

describe('discounts', () => {
  const pct = usp('discount', '20% off cakes', { percent: 20, on: 'cakes', upTo: false, validTo: '2026-10-31' });
  const amt = usp('discount', '£5 off your first order', { amountOff: { amount: 5, currency: 'GBP' }, on: 'first order', upTo: false });

  it('passes the percentage and amount the owner gave', () => {
    expect(run({ headline: '20% off cakes' }, { usps: [pct] })).toEqual([]);
    expect(run({ headline: '£5 off your first order' }, { usps: [amt] })).toEqual([]);
    expect(run({ headline: '20.0% off', subline: 'save £5.00' }, { usps: [pct, amt] }).length).toBe(0);
  });

  it('flags a percentage that is not the USP', () => {
    expect(texts(run({ headline: '25% off cakes' }, { usps: [pct] }))).toEqual(['25%']);
    expect(texts(run({ caption: 'Save 30% this week' }))).toEqual(['30%']); // no discount USP at all
  });

  it('flags an amount off that is not the USP', () => {
    expect(texts(run({ headline: '£10 off your first order' }, { usps: [amt] }))).toEqual(['£10']);
    expect(texts(run({ headline: 'Rs 500 off' }))).toEqual(['Rs 500']);
  });

  it('ignores percentages that are not discounts ("100% organic"), and amounts that are the owner price', () => {
    const organic = usp('quality', '100% organic flour', { claim: '100% organic flour' }, { confirmed: true });
    expect(run({ headline: '100% organic flour' }, { usps: [organic, pct] })).toEqual([]);
    expect(run({ caption: 'Cotton: 100% natural' })).toEqual([]);
    const price = usp('price', 'Loaf £4.50', { item: 'Loaf', price: { amount: 4.5, currency: 'GBP' } });
    expect(run({ caption: '£4.50 off the usual price' }, { usps: [price] })).toEqual([]);
  });

  it('flags a discount after its end date, using the brand time zone for today', () => {
    const f = run({ headline: '20% off cakes' }, { usps: [pct], today: '2026-11-01' });
    expect(texts(f)).toEqual(['20% off cakes']);
    expect(run({ headline: '20% off cakes' }, { usps: [pct], today: '2026-10-31' })).toEqual([]); // last day still valid
    // The date comes from `timezone` when `today` is not given.
    const expired = usp('discount', 'Old sale', { percent: 10, on: 'x', upTo: false, validTo: '2026-10-14' });
    const late = checkUspRules({ usps: [expired], timezone: 'Pacific/Auckland', now: new Date('2026-10-14T20:00:00Z'), post: { caption: 'Old sale', cta: '', image_text: { headline: '', subline: '' } } });
    expect(late.map((f) => f.text)).toContain('Old sale'); // already the 15th in Auckland
    const same = checkUspRules({ usps: [expired], timezone: 'America/Los_Angeles', now: new Date('2026-10-14T20:00:00Z'), post: { caption: 'Old sale', cta: '', image_text: { headline: '', subline: '' } } });
    expect(same).toEqual([]);
  });

  it('a discount past its date not shown by title still gets a flag', () => {
    const f = run({ headline: 'Big sale' }, { usps: [pct], today: '2027-01-01' });
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ field: 'caption', highlight: false });
    expect(f[0].text).toContain('2026-10-31');
  });
});

describe('superlatives', () => {
  it.each([
    ['The best bread in town', 'best'],
    ['No.1 bakery', 'No.1'],
    ['No. 1 bakery', 'No. 1'],
    ['Number one choice', 'Number one'],
    ['#1 in Leeds', '#1'],
    ['Cheapest cakes around', 'Cheapest'],
    ['Guaranteed fresh', 'Guaranteed'],
    ['Our lowest price ever', 'lowest price'],
    ['El mejor pan', 'mejor'],
    ['Número uno en Madrid', 'Número uno'],
    ['El más barato', 'más barato'],
    ['Pan garantizado', 'garantizado'],
    ['Le meilleur pain', 'meilleur'],
    ['Numéro un à Lyon', 'Numéro un'],
    ['Le moins cher', 'Le moins cher'],
    ['Prix le plus bas', 'Prix le plus bas'],
    ['Pain garanti', 'garanti'],
    ['Das beste Brot', 'beste'],
    ['Nummer eins in Berlin', 'Nummer eins'],
    ['Die günstigste Bäckerei', 'günstigste'],
    ['Garantiert frisch', 'Garantiert'],
    ['O melhor pão', 'melhor'],
    ['Número um em Lisboa', 'Número um'],
    ['Mais barato da cidade', 'Mais barato'],
    ['Menor preço', 'Menor preço'],
    ['सबसे अच्छा खाना', 'सबसे अच्छा'],
    ['नंबर 1 दुकान', 'नंबर 1'],
    ['सबसे सस्ता', 'सबसे सस्ता'],
    ['100% गारंटी', 'गारंटी'],
  ])('flags %s', (headline, expected) => {
    const flags = run({ headline });
    expect(flags.map((f) => f.text)).toContain(expected);
    expect(flags.find((f) => f.text === expected)).toMatchObject({ kind: 'claim', highlight: true });
  });

  it('does not flag words that merely contain them', () => {
    expect(run({ headline: 'Bestow a gift. Besties welcome. Mejorana. Arbeit' })).toEqual([]);
    expect(run({ caption: 'Open to the public, no 10 tables left' })).toEqual([]);
  });

  it('is allowed when the USP that carries the word is confirmed, flagged when it is not', () => {
    const confirmed = usp('quality', 'Best sourdough in Leeds', { claim: 'Best sourdough in Leeds' }, { confirmed: true });
    const unconfirmed = usp('quality', 'Best sourdough in Leeds', { claim: 'Best sourdough in Leeds' }, { confirmed: false });
    expect(run({ headline: 'Best sourdough in Leeds' }, { usps: [confirmed] })).toEqual([]);
    const f = run({ headline: 'Best sourdough in Leeds' }, { usps: [unconfirmed] });
    expect(f).toHaveLength(1); // the superlative and "not confirmed" are one flag on the same span
    expect(f[0].field).toBe('image_text.headline');
    // A different superlative than the confirmed USP carries is still flagged.
    expect(texts(run({ headline: 'Best and cheapest' }, { usps: [confirmed] }))).toEqual(['cheapest']);
  });

  it('guarantee words stay flagged for regulated brands even when confirmed', () => {
    const g = usp('guarantee', 'Guaranteed results', { length: '30 days' }, { confirmed: true });
    expect(run({ headline: 'Guaranteed results' }, { usps: [g], regulated: 'none' })).toEqual([]);
    const f = run({ headline: 'Guaranteed results' }, { usps: [g], regulated: 'health' });
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ text: 'Guaranteed', regulated: true });
    // A plain superlative can still be confirmed by a regulated brand.
    const best = usp('quality', 'Best clinic parking', { claim: 'x' }, { confirmed: true });
    expect(run({ headline: 'Best clinic parking' }, { usps: [best], regulated: 'health' })).toEqual([]);
  });
});

describe('USPs that need the owner to confirm', () => {
  it.each<UspKind>(['quality', 'reviews', 'experience'])('flags an unconfirmed %s USP in the brief', (kind) => {
    const details = kind === 'reviews' ? { rating: 4.7, count: 80, platform: 'Yelp' } : kind === 'experience' ? { years: 20 } : { claim: 'Hand made' };
    const u = usp(kind, 'Twenty years of baking', details, { confirmed: false });
    const f = run({ subline: 'Twenty years of baking' }, { usps: [u] });
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ text: 'Twenty years of baking', field: 'image_text.subline', highlight: true });
    expect(run({ subline: 'Twenty years of baking' }, { usps: [{ ...u, confirmed: true }] })).toEqual([]);
  });
  it('does not ask for confirmation of kinds that do not need it', () => {
    for (const kind of ['discount', 'price', 'delivery', 'guarantee', 'free_extra', 'custom'] as UspKind[]) {
      expect(run({ subline: 'Free delivery' }, { usps: [usp(kind, 'Free delivery', kind === 'discount' ? { percent: 5, on: 'x', upTo: false } : {})] })).toEqual([]);
    }
  });
});

describe('payment IDs in post text', () => {
  it('flags any UPI-like address, and never lets even the active one appear in text', () => {
    const f = run({ caption: 'Pay to evil@okaxis today', cta: 'upi://pay?pa=scam@ybl&pn=x' }, { activePaymentAddresses: ['ravi@okhdfcbank'] });
    expect(f.map((x) => x.text).sort()).toEqual(['evil@okaxis', 'scam@ybl']);
    expect(f.find((x) => x.text === 'evil@okaxis')).toMatchObject({ field: 'caption', highlight: true });
    const own = run({ subline: 'UPI: ravi@okhdfcbank' }, { activePaymentAddresses: ['ravi@okhdfcbank'] });
    expect(own).toHaveLength(1);
    expect(own[0]).toMatchObject({ field: 'image_text.subline', text: 'ravi@okhdfcbank' });
  });
  it('also catches an active address that is not UPI-shaped, and the mascot bubble', () => {
    expect(texts(run({ bubble: 'send to MyKey-99' }, { activePaymentAddresses: ['mykey-99'] }))).toEqual(['MyKey-99']);
  });
  it('leaves email addresses alone', () => {
    expect(run({ caption: 'Email hello@bakery.example.com' })).toEqual([]);
  });
});

describe('QR code and its label', () => {
  it('flags a QR without a label, with a wrong-kind label, or a payment QR without the payee line', () => {
    expect(run({}, { qr: { kind: 'link', label: null } })).toHaveLength(1);
    expect(run({}, { qr: { kind: 'link', label: '  ' } })).toHaveLength(1);
    expect(run({}, { qr: { kind: 'link', label: 'Scan to pay' } })).toHaveLength(1);
    expect(run({}, { qr: { kind: 'payment', label: 'Scan to visit', payeeShown: true } })).toHaveLength(1);
    expect(run({}, { qr: { kind: 'payment', label: 'Scan to pay', payeeShown: false } })).toHaveLength(1);
    expect(run({}, { qr: { kind: 'payment', label: null } }).length).toBe(2);
    expect(run({}, { qr: { kind: 'link', label: null } })[0]).toMatchObject({ kind: 'claim', highlight: false, field: 'caption' });
  });
  it('passes a QR with its label', () => {
    expect(run({}, { qr: { kind: 'link', label: 'Scan to visit' } })).toEqual([]);
    expect(run({}, { qr: { kind: 'payment', label: 'Scan to pay', payeeShown: true } })).toEqual([]);
  });
  it('flags "scan" text when the post has no QR', () => {
    expect(texts(run({ cta: 'Scan to pay' }))).toEqual(['Scan to pay']);
    expect(texts(run({ caption: 'Scan the QR for the menu' }))).toEqual(['Scan the QR']);
    expect(run({ cta: 'Scan to pay' }, { qr: { kind: 'payment', label: 'Scan to pay', payeeShown: true } })).toEqual([]);
  });
});

describe('integration with runGuardrail', () => {
  let db: MockDb;
  beforeAll(async () => {
    db = await createMockDb();
    setMockDbForTests(db);
  });
  afterAll(async () => {
    setMockDbForTests(null);
    await db.close();
  });

  it('adds the USP flags to the post, loads the active payment addresses, and leaves the other layers alone', async () => {
    const { userId, brandId } = await seedBrand(db, { facts: [{ kind: 'price', label: 'Loaf', value: '£4.50' }] });
    await db.withAdmin((tx) =>
      tx.query("insert into public.payment_ids (brand_id, scheme, address, payee_name, status, confirmed_at) values ($1, 'upi', 'shop@okaxis', 'Shop', 'active', now())", [brandId]),
    );
    const p = post({ caption: 'Best loaf £4.50. Pay shop@okaxis', headline: 'Fresh' });
    const withRules = await runGuardrail({
      userId,
      brandId,
      posts: [p],
      uspRules: [{ usps: [], qr: null }],
      aiFixture: { facts: [] },
    });
    expect(withRules[0].flags.map((f) => f.text).sort()).toEqual(['Best', 'shop@okaxis'].sort());
    expect(withRules[0].blocking).toBe(true);
    const without = await runGuardrail({ userId, brandId, posts: [p], aiFixture: { facts: [] } });
    expect(without[0].flags).toEqual([]); // nothing changes for posts without a brief
  });
});

describe('superlatives inside everyday phrases', () => {
  it('does not flag "look your best", "all the best" or "best wishes", but still flags claims', () => {
    const post = (caption: string) => ({ caption, cta: '', image_text: { headline: '', subline: '', bubble: '' } });
    const flagged = (caption: string) => checkUspRules({ usps: [], post: post(caption) }).filter((f) => /best/i.test(f.text)).length;
    expect(flagged("Whether you need a new suit or a fitting, we're here to help you look your best.")).toBe(0);
    expect(flagged('All the best for the festive season!')).toBe(0);
    expect(flagged('Best wishes from all of us.')).toBe(0);
    expect(flagged('Feel your best this Diwali.')).toBe(0);
    expect(flagged('The best tailor in town.')).toBe(1);
    expect(flagged('Our best prices ever, and we help you look your best.')).toBe(1);
  });
});
