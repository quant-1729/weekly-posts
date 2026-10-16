// UX-1: the owner's photo is the hero of a photo design. Root cause of the bug report ("the photo was literally behind the
// design"): photo layouts cover-cropped the photo to the whole canvas and then drew an opaque card, or a 76% black scrim,
// over 60-95% of it, centred on the subject, so only a sliver at the top (or the edges, in landscape and banners) showed and
// the logo, mascot bubble and QR tile sat on the rest. The fix frames the photo where nothing covers it, puts its subject in
// the free area, and darkens only the ground under text.
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { renderDesignDetailed, THEME_IDS, type DesignFormat } from '@/lib/design';
import { sampleLogo, SAMPLE_MASCOT_SVG } from '@/lib/render/fixtures';
import { content, input } from './fixtures';
import { pixelContrastIssues } from './helpers';
import { realisticPhoto } from './photo-fixture';

const FORMATS: DesignFormat[] = ['square', 'portrait', 'vertical', 'landscape', 'thumbnail', 'banner'];
const flat = (hex: string) => sharp({ create: { width: 1600, height: 1200, channels: 3, background: hex } }).jpeg({ quality: 95 }).toBuffer();

/** Share of the canvas whose pixels are (nearly) `rgb`. */
async function shareOf(png: Buffer, rgb: [number, number, number], tol = 10): Promise<number> {
  const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let n = 0;
  for (let i = 0; i < data.length; i += 3) if (Math.abs(data[i] - rgb[0]) <= tol && Math.abs(data[i + 1] - rgb[1]) <= tol && Math.abs(data[i + 2] - rgb[2]) <= tol) n++;
  return n / (info.width * info.height);
}

describe('photo designs show the photo', () => {
  it('shows the photo itself (not a sliver of it) in every theme and format', async () => {
    const green = await flat('#20a040'); // a flat photo: any pixel that is still this colour is the photo, unscrimmed and uncovered
    const mascot = { svg: SAMPLE_MASCOT_SVG };
    const worst: string[] = [];
    for (const themeId of THEME_IDS) {
      for (const format of FORMATS) {
        const r = await renderDesignDetailed(input({ format, themeId, photo: green, mascot: format === 'landscape' || format === 'thumbnail' || format === 'banner' ? null : mascot, content: content({ secondary: content().secondary.slice(0, 1) }) }));
        expect(r.layoutId, `${themeId} ${format}`).toMatch(/photo/);
        const share = await shareOf(r.png, [0x20, 0xa0, 0x40], 14);
        // The old layouts showed 5% to 35% of the photo; every layout now leaves at least 15% of the canvas as clear photo (landscape with a QR is the tightest: the code needs 400 px).
        if (share < 0.15) worst.push(`${themeId} ${format} ${(share * 100).toFixed(0)}%`);
      }
    }
    expect(worst).toEqual([]);
  }, 180000);

  it('puts the photo on the background and the panels, text and codes on the photo (layer order)', async () => {
    const photo = await realisticPhoto();
    for (const themeId of ['clean', 'minimal_dark', 'festive'] as const) {
      const r = await renderDesignDetailed(input({ format: 'square', themeId, photo, background: await flat('#6a4aa8') }));
      const svg = r.svg;
      const iPhoto = svg.indexOf('image/jpeg');
      const iText = svg.indexOf('<path', svg.lastIndexOf('image/jpeg'));
      expect(iPhoto, themeId).toBeGreaterThan(-1);
      expect(iText, themeId).toBeGreaterThan(iPhoto);
    }
  });

  it('keeps the photo subject out from under the card: the bun of the sample photo stays visible', async () => {
    const photo = await realisticPhoto();
    const bunInPhoto = async (themeId: 'clean' | 'festive' | 'fresh' | 'minimal_dark') => {
      const r = await renderDesignDetailed(input({ format: 'portrait', themeId, photo, content: content({ blocks: [], qr: null, secondary: [] }) }));
      // The plate is near white, the bun orange-brown: both must show somewhere above the text.
      const bun = await shareOf(r.png, [0xb8, 0x6a, 0x2a], 28);
      return { layout: r.layoutId, bun };
    };
    for (const t of ['clean', 'festive', 'fresh', 'minimal_dark'] as const) {
      const { layout, bun } = await bunInPhoto(t);
      expect(layout).toMatch(/photo/);
      expect(bun, `${t} ${layout}`).toBeGreaterThan(0.003);
    }
  });
});

describe('photo designs stay readable and scannable', () => {
  it('passes text contrast (report and pixels) and decodes the QR, on a busy photo and on a pure white one', async () => {
    const busy = await realisticPhoto();
    const white = await flat('#ffffff');
    const logo = await sampleLogo();
    const problems: string[] = [];
    for (const [name, photo] of [['busy', busy], ['white', white]] as const) {
      for (const themeId of THEME_IDS) {
        for (const format of ['square', 'portrait', 'vertical', 'landscape', 'thumbnail'] as const) {
          const r = await renderDesignDetailed(input({ format, themeId, photo, logo, mascot: format === 'thumbnail' || format === 'landscape' ? null : { svg: SAMPLE_MASCOT_SVG }, content: content({ secondary: content().secondary.slice(0, 1) }) }));
          const tag = `${name} ${themeId} ${format} ${r.layoutId}`;
          if (r.report.contrast.length) problems.push(`${tag} contrast ${JSON.stringify(r.report.contrast)}`);
          if (r.report.overflow.length) problems.push(`${tag} overflow ${r.report.overflow.join(',')}`);
          if (r.report.safeZone.length) problems.push(`${tag} safe ${r.report.safeZone.join(',')}`);
          if (format !== 'thumbnail' && !(r.report.qr?.ok)) problems.push(`${tag} qr ${r.report.qr?.decoded}`);
          const px = await pixelContrastIssues(r);
          if (px.length) problems.push(`${tag} pixels ${JSON.stringify(px.slice(0, 2))}`);
        }
      }
    }
    expect(problems).toEqual([]);
  }, 300000);

  it('draws a right-to-left photo design as a mirror (photo and fade on the other side)', async () => {
    const photo = await flat('#20a040');
    const ltr = await renderDesignDetailed(input({ format: 'thumbnail', themeId: 'minimal_dark', layoutId: 'dark-photo-full', photo, dir: 'ltr' }));
    const rtl = await renderDesignDetailed(input({ format: 'thumbnail', themeId: 'minimal_dark', layoutId: 'dark-photo-full', photo, dir: 'rtl' }));
    const { data: a, info } = await sharp(ltr.png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const { data: b } = await sharp(rtl.png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const greenAt = (d: Buffer, x: number, y: number) => {
      const i = (y * info.width + x) * 3;
      return Math.abs(d[i] - 0x20) < 14 && Math.abs(d[i + 1] - 0xa0) < 14 && Math.abs(d[i + 2] - 0x40) < 14;
    };
    expect(greenAt(a, info.width - 30, 300)).toBe(true);
    expect(greenAt(a, 30, 300)).toBe(false);
    expect(greenAt(b, 30, 300)).toBe(true);
    expect(greenAt(b, info.width - 30, 300)).toBe(false);
  });
});

describe('without a photo nothing changes', () => {
  it('draws no photo, blur or mask layers and is deterministic', async () => {
    for (const themeId of THEME_IDS) {
      const a = await renderDesignDetailed(input({ format: 'square', themeId }));
      const b = await renderDesignDetailed(input({ format: 'square', themeId }));
      expect(a.layoutId).not.toMatch(/photo/);
      expect(a.svg).not.toContain('<mask');
      expect(a.png.equals(b.png)).toBe(true);
    }
  });
});
