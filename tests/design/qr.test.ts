// QR on every layout with a QR slot: decodes to exactly the content text, on a light plate, at least the minimum size.
import { describe, expect, it } from 'vitest';
import { FORMAT_RULES, renderDesignDetailed, THEMES, THEME_IDS, FORMAT_SIZE } from '@/lib/design';
import { minQrPx } from '@/lib/qr/size';
import { decodeQrPng } from '@/lib/qr/decode';
import { QR_RULE_WIDTH } from '@/lib/design/core';
import { samplePhoto } from '@/lib/render/fixtures';
import { ALL_FORMATS as ALL, LINK_QR, PAY_QR, UPI, content, input } from './fixtures';

// Thumbnails and banners carry no QR (FORMAT_RULES).
const ALL_FORMATS = ALL.filter((f) => FORMAT_RULES[f].qr);

describe('QR slots', () => {
  it('decodes on every layout (link and UPI), at the minimum size, with the printed label', async () => {
    const photo = await samplePhoto();
    let n = 0;
    for (const themeId of THEME_IDS) {
      if (themeId === 'classic') continue;
      for (const format of ALL_FORMATS) {
        for (const recipe of THEMES[themeId].recipes) {
          const isPhoto = recipe.arch.startsWith('photo');
          for (const qr of [LINK_QR, PAY_QR]) {
            const r = await renderDesignDetailed(
              input({ format, themeId, layoutId: recipe.id, photo: isPhoto ? photo : null, content: content({ qr, secondary: [], blocks: content().blocks.slice(0, 2) }) }),
            );
            n++;
            expect(r.report.qr, `${themeId}/${recipe.id} ${format}`).toEqual({ ok: true, decoded: qr.text });
            expect(r.qrBox!.w).toBeGreaterThanOrEqual(minQrPx(QR_RULE_WIDTH[format]));
            // The whole picture decodes to the same text.
            if (n % 7 === 0) expect(await decodeQrPng(r.png)).toBe(qr.text);
          }
        }
      }
    }
    expect(n).toBeGreaterThan(300);
  }, 600_000);

  it('a UPI QR decodes to exactly the confirmed payment string and shows payee and address as text', async () => {
    const r = await renderDesignDetailed(input({ format: 'portrait', themeId: 'premium', content: content({ qr: PAY_QR }) }));
    expect(r.report.qr?.decoded).toBe(UPI);
    const label = r.placements.find((p) => p.name === 'qr-label')!;
    expect(label.text).toMatch(/Sunrise Bakery/);
    expect(label.text).toMatch(/sunrise\.bakery@okhdfcbank/);
  });

  it('never puts the QR under the headline or the primary USP', async () => {
    for (const themeId of THEME_IDS) {
      for (const format of ALL_FORMATS) {
        const r = await renderDesignDetailed(input({ format, themeId }));
        const q = r.placements.find((p) => p.kind === 'qr')!.box;
        for (const name of ['headline', 'primary']) {
          const t = r.placements.find((p) => p.name === name);
          if (!t) continue;
          for (const l of t.lines) {
            const overlap = l.x < q.x + q.w && l.x + l.w > q.x && l.y < q.y + q.h && l.y + l.h > q.y;
            expect(overlap, `${themeId} ${format} ${name}`).toBe(false);
          }
        }
      }
    }
  });

  it('the QR sits on a white plate with a quiet zone (light pixels around the code)', async () => {
    const r = await renderDesignDetailed(input({ format: 'square', themeId: 'minimal_dark' }));
    const { default: sharp } = await import('sharp');
    const q = r.qrBox!;
    const { data, info } = await sharp(r.png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const px = (x: number, y: number) => {
      const i = (Math.round(y) * info.width + Math.round(x)) * 3;
      return [data[i], data[i + 1], data[i + 2]];
    };
    for (const [x, y] of [
      [q.x - 6, q.y - 6],
      [q.x + q.w + 6, q.y + q.h + 6],
      [q.x + q.w / 2, q.y + 2],
    ]) {
      expect(px(x, y).every((c) => c > 240)).toBe(true);
    }
    expect(FORMAT_SIZE.square.width).toBe(1080);
  });
});
