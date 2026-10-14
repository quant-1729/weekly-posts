// Balanced headline wrapping: no one-word last line (3+ words), even lines, same rules for rtl and Devanagari.
import { beforeAll, describe, expect, it } from 'vitest';
import { fitText, initShaping, measureText } from '@/lib/render';
import { renderDesignDetailed, THEME_IDS } from '@/lib/design';
import { ARABIC, HINDI, arabicContent, content, hindiContent, input, mixedContent } from './fixtures';

beforeAll(async () => {
  await initShaping();
});

const words = (s: string) => s.split(' ');

/** Does any split of `ws` into exactly n lines, each within boxW, end with a multi-word last line? */
function orphanAvoidable(ws: string[], n: number, boxW: number, size: number, dir: 'ltr' | 'rtl'): boolean {
  const w = (i: number, j: number) => measureText(ws.slice(i, j).join(' '), 800, size, dir);
  const rec = (start: number, k: number): boolean => {
    if (k === 1) return ws.length - start >= 2 && w(start, ws.length) <= boxW;
    for (let j = start + 1; j <= ws.length - 1; j++) if (w(start, j) <= boxW && rec(j, k - 1)) return true;
    return false;
  };
  return rec(0, n);
}

describe('fitText balance', () => {
  it('turns "Diwali sweets, fresh every / day" into "Diwali sweets, / fresh every day"', () => {
    const text = 'Diwali sweets, fresh every day';
    let found = 0;
    for (let boxW = 300; boxW < 900; boxW += 5) {
      const plain = fitText(text, { weight: 800, boxW, boxH: 1e5, maxSize: 50, minSize: 50, maxLines: 2 });
      if (plain.truncated || plain.lines.length !== 2 || plain.lines[1].text !== 'day') continue;
      const bal = fitText(text, { weight: 800, boxW, boxH: 1e5, maxSize: 50, minSize: 50, maxLines: 2, balance: true });
      expect(bal.lines.map((l) => l.text)).toEqual(['Diwali sweets,', 'fresh every day']);
      expect(Math.max(...bal.lines.map((l) => l.width))).toBeLessThanOrEqual(boxW);
      found++;
    }
    expect(found).toBeGreaterThan(0);
  });

  it('does not change the default behaviour', () => {
    const a = fitText('Diwali sweets, fresh every day', { weight: 800, boxW: 700, boxH: 1e5, maxSize: 100, minSize: 40, maxLines: 3 });
    const b = fitText('Diwali sweets, fresh every day', { weight: 800, boxW: 700, boxH: 1e5, maxSize: 100, minSize: 40, maxLines: 3, balance: false });
    expect(a).toEqual(b);
  });

  const cases: { name: string; text: string; dir: 'ltr' | 'rtl' }[] = [
    { name: 'English', text: 'Fresh sourdough baked every single morning for you', dir: 'ltr' },
    { name: 'Devanagari', text: HINDI.headline + ' ' + HINDI.secondary, dir: 'ltr' },
    { name: 'Arabic', text: ARABIC.headline + ' ' + ARABIC.secondary, dir: 'rtl' },
    { name: 'mixed', text: 'Diwali मिठाई 2026 fresh हर दिन ताज़ा', dir: 'ltr' },
  ];
  it.each(cases)('$name: same line count and order, never wider than the box, orphan only when unavoidable', ({ text, dir }) => {
    for (const size of [60, 90]) {
      for (let boxW = 420; boxW <= 1000; boxW += 23) {
        const opts = { weight: 800 as const, boxW, boxH: 1e5, maxSize: size, minSize: size, maxLines: 4, dir };
        const plain = fitText(text, opts);
        const bal = fitText(text, { ...opts, balance: true });
        if (plain.truncated) continue;
        expect(bal.lines.length).toBe(plain.lines.length);
        expect(bal.lines.map((l) => l.text).join(' ')).toBe(plain.lines.map((l) => l.text).join(' '));
        for (const l of bal.lines) expect(l.width).toBeLessThanOrEqual(boxW + 0.01);
        const n = bal.lines.length;
        const ws = words(text);
        if (n >= 2 && ws.length >= 3) {
          const last = words(bal.lines[n - 1].text);
          if (last.length === 1) expect(orphanAvoidable(ws, n, boxW, size, dir), `${text} @${boxW}/${size}`).toBe(false);
        }
      }
    }
  });
});

describe('designs', () => {
  it('headline and primary lines of every theme have no tiny last line (English, Hindi, Arabic, mixed)', async () => {
    const sets = [
      { c: content({ headline: 'Diwali sweets, fresh every day' }), dir: 'ltr' as const },
      { c: hindiContent(), dir: 'ltr' as const },
      { c: arabicContent(), dir: 'rtl' as const },
      { c: mixedContent(), dir: 'ltr' as const },
    ];
    for (const themeId of THEME_IDS) {
      for (const { c, dir } of sets) {
        for (const format of ['square', 'vertical', 'landscape'] as const) {
          const r = await renderDesignDetailed(input({ format, themeId, content: c, dir }));
          for (const name of ['headline', 'primary']) {
            const p = r.placements.find((x) => x.name === name);
            if (!p || p.lines.length < 2 || words(p.text ?? '').length < 3) continue;
            const widest = Math.max(...p.lines.map((l) => l.w));
            expect(p.lines[p.lines.length - 1].w, `${themeId} ${format} ${name} ${dir}`).toBeGreaterThan(widest * 0.3);
          }
        }
      }
    }
  });
});
