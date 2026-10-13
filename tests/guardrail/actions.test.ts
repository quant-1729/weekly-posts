import { describe, expect, it } from 'vitest';
import { GuardrailActionError, confirmFlag, hasBlockingFlags, removeFlagText, resolveRemovedSpans, type EditablePost } from '@/lib/guardrail/actions';
import type { Flag } from '@/lib/guardrail/types';

const flag = (o: Partial<Flag> & { text: string }): Flag => ({
  id: `f_${o.text.length}${o.kind ?? 'price'}`,
  kind: 'price',
  field: 'caption',
  layer: 'code',
  regulated: false,
  highlight: true,
  status: 'open',
  decided_at: null,
  ...o,
});
const P = (caption: string, extra: Partial<EditablePost> = {}): EditablePost => ({ caption, cta: '', image_text: { headline: '', subline: '' }, ...extra });
const NOW = new Date('2026-10-19T08:00:00Z');

describe('hasBlockingFlags', () => {
  it('is true for any open flag except the regulated reminder', () => {
    expect(hasBlockingFlags([])).toBe(false);
    expect(hasBlockingFlags([flag({ text: 'x' })])).toBe(true);
    for (const kind of ['price', 'offer', 'hours', 'date', 'phone', 'quantity', 'claim', 'avoid', 'repeat'] as const) {
      expect(hasBlockingFlags([flag({ text: 'x', kind })]), kind).toBe(true);
    }
    expect(hasBlockingFlags([flag({ text: Reminder, kind: 'regulated_reminder', highlight: false })])).toBe(false);
  });
  it('ignores confirmed and removed flags', () => {
    expect(hasBlockingFlags([flag({ text: 'a', status: 'confirmed' }), flag({ text: 'bb', status: 'removed' })])).toBe(false);
    expect(hasBlockingFlags([flag({ text: 'a', status: 'confirmed' }), flag({ text: 'bb' }), flag({ text: Reminder, kind: 'regulated_reminder' })])).toBe(true);
  });
});
const Reminder = 'Check your local advertising rules before posting.';

describe('confirmFlag', () => {
  it('confirms an open flag and stamps the time, leaving the others alone', () => {
    const flags = [flag({ text: '£3.90' }), flag({ text: 'award-winning', kind: 'claim' })];
    const out = confirmFlag(flags, flags[0].id, { now: NOW });
    expect(out[0]).toMatchObject({ status: 'confirmed', decided_at: '2026-10-19T08:00:00.000Z' });
    expect(out[1]).toEqual(flags[1]);
    expect(flags[0].status).toBe('open'); // input untouched
    expect(hasBlockingFlags(confirmFlag(flags.slice(0, 1), flags[0].id))).toBe(false);
  });

  it('a regulated flag needs the extra acknowledgement', () => {
    const f = flag({ text: 'Pain-free dentistry guaranteed', kind: 'claim', regulated: true });
    expect(() => confirmFlag([f], f.id)).toThrow(GuardrailActionError);
    expect(() => confirmFlag([f], f.id, { regulatedAck: false })).toThrowError(expect.objectContaining({ code: 'ack_required' }));
    expect(confirmFlag([f], f.id, { regulatedAck: true })[0].status).toBe('confirmed');
  });

  it('a word to avoid must be edited, not confirmed; the reminder is not confirmable', () => {
    const a = flag({ text: 'cheap', kind: 'avoid' });
    const r = flag({ text: Reminder, kind: 'regulated_reminder', highlight: false });
    expect(() => confirmFlag([a], a.id)).toThrowError(expect.objectContaining({ code: 'must_edit' }));
    expect(() => confirmFlag([r], r.id, { regulatedAck: true })).toThrowError(expect.objectContaining({ code: 'must_edit' }));
  });

  it('unknown and already decided flags are errors', () => {
    const f = flag({ text: 'x', status: 'removed' });
    expect(() => confirmFlag([f], 'nope')).toThrowError(expect.objectContaining({ code: 'not_found' }));
    expect(() => confirmFlag([f], f.id)).toThrowError(expect.objectContaining({ code: 'not_open' }));
  });

  it('can confirm a flag that cannot be highlighted', () => {
    const f = flag({ text: 'open until late', kind: 'hours', highlight: false });
    expect(confirmFlag([f], f.id)[0].status).toBe('confirmed');
  });
});

describe('removeFlagText: English', () => {
  it('removes the span and the space around it', () => {
    const out = removeFlagText(P('Our loaf is £3.90 today.'), flag({ text: '£3.90' }));
    expect(out.caption).toBe('Our loaf is today.');
  });
  it('drops a separator that the removal leaves doubled', () => {
    expect(removeFlagText(P('Only £3.90, straight from the oven.'), flag({ text: '£3.90' })).caption).toBe('Only, straight from the oven.');
    expect(removeFlagText(P('Fresh, award-winning, warm'), flag({ text: 'award-winning', kind: 'claim' })).caption).toBe('Fresh, warm');
  });
  it('pulls punctuation back to the word before', () => {
    expect(removeFlagText(P('Cakes from £5.'), flag({ text: '£5' })).caption).toBe('Cakes from.');
    expect(removeFlagText(P('Is it £5?'), flag({ text: '£5' })).caption).toBe('Is it?');
  });
  it('removes a trailing label separator and empty brackets', () => {
    expect(removeFlagText(P('Sourdough loaf: £3.90'), flag({ text: '£3.90' })).caption).toBe('Sourdough loaf');
    expect(removeFlagText(P('Sourdough (£3.90) and rye'), flag({ text: '£3.90' })).caption).toBe('Sourdough and rye');
  });
  it('removes every occurrence, and keeps lines', () => {
    expect(removeFlagText(P('£3.90 loaf\nBuy at £3.90\nBye'), flag({ text: '£3.90' })).caption).toBe('loaf\nBuy at\nBye');
  });
  it('works on cta and image text and leaves the other fields alone', () => {
    const post = P('Fresh bread', { cta: 'Call 020 7946 0999 now', image_text: { headline: 'Only £3', subline: 'since 1990' } });
    expect(removeFlagText(post, flag({ text: '020 7946 0999', kind: 'phone', field: 'cta' }))).toEqual({ ...post, cta: 'Call now' });
    expect(removeFlagText(post, flag({ text: '1990', kind: 'quantity', field: 'image_text.subline' })).image_text).toEqual({ headline: 'Only £3', subline: 'since' });
    expect(removeFlagText(post, flag({ text: '£3', field: 'image_text.headline' })).image_text.headline).toBe('Only');
  });
  it('is not allowed when the flag has no highlight', () => {
    expect(() => removeFlagText(P('Open late'), flag({ text: 'open until late', highlight: false }))).toThrowError(expect.objectContaining({ code: 'cannot_remove' }));
  });
  it('leaves the post alone when the text is not there', () => {
    const post = P('Fresh bread');
    expect(removeFlagText(post, flag({ text: '£9' })).caption).toBe('Fresh bread');
  });
});

describe('removeFlagText: Hindi', () => {
  it('removes a price and tidies around the danda', () => {
    expect(removeFlagText(P('काजू कतली ₹600 किलो में।'), flag({ text: '₹600' })).caption).toBe('काजू कतली किलो में।');
    expect(removeFlagText(P('आज ही आइए, ₹600।'), flag({ text: '₹600' })).caption).toBe('आज ही आइए।');
  });
  it('removes a phrase and the comma after it', () => {
    expect(removeFlagText(P('सबसे सस्ता, सबसे ताज़ा मिठाई'), flag({ text: 'सबसे सस्ता', kind: 'claim' })).caption).toBe('सबसे ताज़ा मिठाई');
  });
});

describe('removeFlagText: Arabic', () => {
  it('removes a price with its currency and fixes the full stop', () => {
    expect(removeFlagText(P('باقة الورد بسعر 199 درهم فقط.'), flag({ text: '199 درهم' })).caption).toBe('باقة الورد بسعر فقط.');
    expect(removeFlagText(P('باقة الورد، 199 درهم.'), flag({ text: '199 درهم' })).caption).toBe('باقة الورد.');
  });
  it('handles the Arabic comma after a removed span', () => {
    expect(removeFlagText(P('أفضل ورد، وأجمل باقات'), flag({ text: 'أفضل ورد', kind: 'claim' })).caption).toBe('وأجمل باقات');
  });
});

describe('resolveRemovedSpans', () => {
  it('turns open flags whose text is gone into removed, keeps the others', () => {
    const flags = [flag({ text: '£3.90' }), flag({ text: 'award-winning', kind: 'claim' }), flag({ text: 'open until late', kind: 'hours', highlight: false })];
    const out = resolveRemovedSpans(P('Our loaf is fresh, award-winning'), flags, NOW);
    expect(out.map((f) => f.status)).toEqual(['removed', 'open', 'open']);
    expect(out[0].decided_at).toBe('2026-10-19T08:00:00.000Z');
  });
  it('checks the right field', () => {
    const flags = [flag({ text: '020 7946 0999', kind: 'phone', field: 'cta' })];
    expect(resolveRemovedSpans(P('Call 020 7946 0999', { cta: 'Visit us' }), flags)[0].status).toBe('removed');
    expect(resolveRemovedSpans(P('Fresh', { cta: 'Call 020 7946 0999' }), flags)[0].status).toBe('open');
  });
  it('does not touch confirmed or removed flags, or the reminder', () => {
    const flags = [flag({ text: 'a', status: 'confirmed' }), flag({ text: 'bb', status: 'removed', decided_at: 'x' }), flag({ text: Reminder, kind: 'regulated_reminder', highlight: false })];
    expect(resolveRemovedSpans(P(''), flags)).toEqual(flags);
  });
  it('works in Hindi and Arabic', () => {
    const hi = [flag({ text: '₹600' })];
    expect(resolveRemovedSpans(P('काजू कतली ₹600'), hi)[0].status).toBe('open');
    expect(resolveRemovedSpans(P('काजू कतली'), hi)[0].status).toBe('removed');
    const ar = [flag({ text: '199 درهم' })];
    expect(resolveRemovedSpans(P('باقة بسعر 199 درهم'), ar)[0].status).toBe('open');
    expect(resolveRemovedSpans(P('باقة بسعر 299 درهم'), ar)[0].status).toBe('removed');
  });
  it('a word to avoid stays open if only its case changed, and closes when the whole word is gone', () => {
    const flags = [flag({ text: 'Cheap', kind: 'avoid' })];
    expect(resolveRemovedSpans(P('so cheap!'), flags)[0].status).toBe('open');
    expect(resolveRemovedSpans(P('on Cheapside'), flags)[0].status).toBe('removed');
    expect(resolveRemovedSpans(P('affordable'), flags)[0].status).toBe('removed');
  });
  it('a removal followed by resolve clears the flag', () => {
    const f = flag({ text: '£3.90' });
    const post = removeFlagText(P('Loaf £3.90 today'), f);
    const out = resolveRemovedSpans(post, [f]);
    expect(out[0].status).toBe('removed');
    expect(hasBlockingFlags(out)).toBe(false);
  });
});
