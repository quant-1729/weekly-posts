// A payment QR that does not decode to exactly the confirmed string must be reported (it blocks the post).
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/qr/decode', async (orig) => {
  const real = await orig<typeof import('@/lib/qr/decode')>();
  return { ...real, verifyRendered: async () => ({ ok: false, decoded: 'upi://pay?pa=someone.else@okbank&pn=X&cu=INR' }) };
});

import { renderDesign } from '@/lib/design';
import { PAY_QR, content, input } from './fixtures';

describe('payment mismatch', () => {
  it('is carried into report.qr as not ok', async () => {
    const r = await renderDesign(input({ format: 'square', themeId: 'clean', content: content({ qr: PAY_QR }) }));
    expect(r.report.qr).toEqual({ ok: false, decoded: 'upi://pay?pa=someone.else@okbank&pn=X&cu=INR' });
  });
});
