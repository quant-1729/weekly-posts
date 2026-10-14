// G-1: the five font roles map to shipped OFL fonts; non-Latin text falls back to Noto.
import { existsSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { initShaping } from '@/lib/render';
import { measureText, shapeText } from '@/lib/render/shape';
import { FONT_CHOICES } from '@/lib/design';

describe('font roles', () => {
  it('each role has its own face with different metrics', async () => {
    await initShaping();
    const widths = FONT_CHOICES.map((f) => measureText('Fresh Sourdough 20% off', 700, 100, 'ltr', f));
    expect(new Set(widths.map((w) => Math.round(w))).size).toBe(FONT_CHOICES.length);
    for (const f of FONT_CHOICES) expect(shapeText('Fresh', 700, 'ltr', f).missing).toBe(0);
  });

  it('non-Latin text falls back to the matching Noto family in every role', async () => {
    await initShaping();
    for (const f of FONT_CHOICES) {
      expect(shapeText('दीवाली स्पेशल', 700, 'ltr', f).missing).toBe(0);
      expect(shapeText('قهوة طازجة', 700, 'rtl', f).missing).toBe(0);
      expect(shapeText('₹880 / किलो', 500, 'ltr', f).missing).toBe(0);
    }
    // Same widths as plain Noto Sans for the non-Latin runs.
    expect(measureText('दीवाली', 700, 100, 'ltr', 'serif')).toBeCloseTo(measureText('दीवाली', 700, 100, 'ltr', 'sans'), 3);
  });

  it('ships a licence file for every non-Noto family', () => {
    const files = readdirSync('assets/fonts');
    for (const l of ['OFL-Nunito.txt', 'OFL-Oswald.txt', 'OFL-PlayfairDisplay.txt', 'OFL-ArchivoBlack.txt']) expect(files).toContain(l);
    for (const f of ['Nunito_700Bold.ttf', 'Oswald_700Bold.ttf', 'PlayfairDisplay_700Bold.ttf', 'ArchivoBlack_400Regular.ttf']) expect(existsSync(`assets/fonts/${f}`)).toBe(true);
  });
});
