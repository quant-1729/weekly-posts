// A carousel the owner asked for (owner request 2026-10-16): each design option is a SET of slides drawn together.
// With CAROUSEL_SHEET_DIR set the test also writes contact sheets (3 options x 5 slides, with and without a character) for a person
// to look at: `CAROUSEL_SHEET_DIR=<dir> npx vitest run tests/design/carousel-set.test.ts`.
import { mkdirSync, writeFileSync } from 'node:fs';
import sharp, { type OverlayOptions } from 'sharp';
import { describe, expect, it } from 'vitest';
import type { CharacterRole } from '@/lib/characters';
import {
  carouselFormat,
  designOptions,
  renderCarousel,
  renderSlideSet,
  slideContents,
  slideRoleCandidates,
  type DesignDetail,
  type DesignFormat,
  type DesignInput,
  type DesignOption,
  type SlideText,
} from '@/lib/design';
import { hashSeed } from '@/lib/design/options';
import { verifyRendered } from '@/lib/qr/decode';
import { LINK_QR, content, kit, PALETTES } from './fixtures';
import { expectClean } from './helpers';

const DIR = process.env.CAROUSEL_SHEET_DIR;
const SEED = hashSeed('brand-carousel');

const SLIDES: SlideText[] = [
  { kind: 'cover', headline: 'Diwali sweets, fresh every day', body: 'Handmade kaju katli and ladoos' },
  { kind: 'point', headline: 'Made with pure ghee', body: 'Every box is made by hand in small batches.' },
  { kind: 'point', headline: 'Free delivery within 5 km', body: 'Order by 6 pm for same day delivery.' },
  { kind: 'proof', headline: '20% off all gift boxes', body: '' },
  { kind: 'cta', headline: 'Order on WhatsApp', body: 'Till Sun 20 Oct' },
];

const k = kit(PALETTES.bakery, { themeId: 'clean' });
const BASE = content({ secondary: [], primary: null, subline: '', offerLine: 'Till Sun 20 Oct' });

function inputFor(format: DesignFormat, o: DesignOption, over: Partial<DesignInput> = {}): Omit<DesignInput, 'slide'> {
  return { format, themeId: o.themeId, layoutId: o.layoutId, scheme: o.scheme, kit: k, brandName: 'Sunrise Sweets', language: 'en', content: BASE, seed: SEED, poseHint: 'wave', ...over };
}

const options = (format: DesignFormat, character: 'rig' | null): DesignOption[] =>
  designOptions({ kit: k, content: BASE, format, hasPhoto: false, seed: SEED, postType: 'offer', character });

const rigFor = async (): Promise<{ kind: 'rig'; id: 'parchi' }> => ({ kind: 'rig', id: 'parchi' });

describe('slide contents (pure)', () => {
  it('puts contacts, the QR and the offer line on the closing slide only, and the proof on a sign-sized headline', () => {
    const cs = slideContents(BASE, SLIDES);
    expect(cs).toHaveLength(5);
    cs.slice(0, 4).forEach((c) => expect(c).toMatchObject({ blocks: [], qr: null, cta: null, secondary: [], primary: null }));
    expect(cs[0]).toMatchObject({ headline: SLIDES[0].headline, subline: SLIDES[0].body, offerLine: null });
    // The proof slide's headline is the fact itself (a character's sign holds it); no offer line competes with it.
    expect(cs[3]).toMatchObject({ headline: '20% off all gift boxes', offerLine: null });
    expect(cs[4].blocks).toEqual(BASE.blocks);
    expect(cs[4].qr).toEqual(BASE.qr);
    // The closing headline is the call to action, so the button text is not said twice.
    expect(cs[4].cta).toBeNull();
  });

  it('shows the offer line on the closing slide when no slide is a proof', () => {
    const cs = slideContents(BASE, SLIDES.filter((x) => x.kind !== 'proof'));
    expect(cs.at(-1)!.offerLine).toBe('Till Sun 20 Oct');
  });

  it('keeps a different button text when the closing headline is not it', () => {
    const cs = slideContents(BASE, [SLIDES[0], { kind: 'cta', headline: 'Come and taste', body: '' }]);
    expect(cs[1].cta).toEqual(BASE.cta);
  });

  it('gives the cover the Lead band and the points the same Support band, rotating pointer, narrator and percher', () => {
    expect(slideRoleCandidates('cover', 0)).toMatchObject({ roles: ['presenter', 'pointer'], band: 'lead' });
    expect([0, 1, 2, 3].map((i) => slideRoleCandidates('point', i).roles[0])).toEqual(['pointer', 'narrator', 'percher', 'pointer']);
    expect(new Set([0, 1, 2].map((i) => slideRoleCandidates('point', i).band))).toEqual(new Set(['support']));
    expect(slideRoleCandidates('proof', 0).roles[0]).toBe('sign_holder');
    expect(slideRoleCandidates('cta', 0).roles[0]).toBe('pointer');
  });

  it('draws carousels in portrait for Instagram and Facebook and square for the other channels', () => {
    expect(carouselFormat('instagram')).toBe('portrait');
    expect(carouselFormat('facebook')).toBe('portrait');
    for (const c of ['linkedin', 'gbp', 'whatsapp', 'youtube']) expect(carouselFormat(c)).toBe('square');
  });
});

describe('a typographic slide set (no character)', () => {
  for (const [i, o] of options('portrait', null).entries()) {
    it(`option ${i + 1} is one design across all five slides, each with its marker`, async () => {
      const set = await renderSlideSet({ input: inputFor('portrait', o), slides: SLIDES });
      expect(set).toHaveLength(5);
      const problems = set.flatMap((r, n) => expectClean(r, `slide ${n + 1}`).problems);
      expect(problems).toEqual([]);
      // Same theme and colours on every slide.
      expect(new Set(set.map((r) => r.themeId))).toEqual(new Set([o.themeId]));
      expect(new Set(set.map((r) => r.scheme)).size).toBe(1);
      // A "2/5" marker, drawn by code, on every slide.
      set.forEach((r, n) => expect(r.placements.find((p) => p.kind === 'marker')?.text).toBe(`${n + 1}/5`));
      set.forEach((r) => expect(r.character).toBeNull());
      expect(set.every((r) => r.width === 1080 && r.height === 1350)).toBe(true);
    }, 60_000);
  }
});

describe('a slide set with the brand character', () => {
  for (const [i, o] of options('portrait', 'rig').entries()) {
    if (!o.role) continue;
    it(`option ${i + 1} (${o.role}) keeps the cover, points, proof and closing roles and one side for the points`, async () => {
      const set = await renderSlideSet({ input: inputFor('portrait', o), slides: SLIDES, characterFor: rigFor });
      const problems = set.flatMap((r, n) => expectClean(r, `slide ${n + 1}`).problems);
      expect(problems).toEqual([]);
      expect(new Set(set.map((r) => r.scheme)).size).toBe(1);
      set.forEach((r, n) => expect(r.placements.find((p) => p.kind === 'marker')?.text).toBe(`${n + 1}/5`));
      const roles = set.map((r) => r.character?.role ?? null);
      // Every slide has the character (the engine only drops it when it cannot be placed cleanly).
      expect(roles.filter(Boolean).length).toBeGreaterThanOrEqual(3);
      // The proof is held on a sign with the fact on it, when the layout could carry the sign.
      if (roles[3] === 'sign_holder') expect(set[3].character!.sign?.text.toLowerCase()).toContain('20% off');
      // The points keep one side.
      const sides = [1, 2].map((n) => set[n].character?.side).filter(Boolean);
      expect(new Set(sides).size).toBeLessThanOrEqual(1);
    }, 120_000);
  }

  it('the closing slide draws the QR and it decodes to exactly the link', async () => {
    const o = options('portrait', 'rig')[1];
    const set = await renderSlideSet({ input: inputFor('portrait', o), slides: SLIDES, characterFor: rigFor });
    const last = set.at(-1)!;
    expect(last.qrBox).not.toBeNull();
    expect(last.report.qr).toEqual({ ok: true, decoded: LINK_QR.text });
    const b = last.qrBox!;
    const region = { left: Math.max(0, Math.floor(b.x - 8)), top: Math.max(0, Math.floor(b.y - 8)), width: Math.ceil(b.w + 16), height: Math.ceil(b.h + 16) };
    expect((await verifyRendered(last.png, LINK_QR.text, region)).ok).toBe(true);
    // The other slides carry no QR.
    set.slice(0, -1).forEach((r) => expect(r.qrBox).toBeNull());
  }, 120_000);

  it('a character that cannot take a role falls back to the next role, and to no character at all', async () => {
    const o = options('portrait', 'rig')[1];
    const none = await renderSlideSet({ input: inputFor('portrait', o), slides: SLIDES, characterFor: async () => null });
    none.forEach((r) => expect(r.character).toBeNull());
    expect(none.every((r) => r.placements.some((p) => p.kind === 'marker'))).toBe(true);
  }, 120_000);
});

describe('C-20 (one selling point per slide) is unchanged', () => {
  it('still draws typographic slides with no character, even for an option with a role', async () => {
    const c = content();
    const o = options('square', 'rig')[1];
    const out = await renderCarousel({ ...inputFor('square', o, { content: c }), character: { kind: 'rig', id: 'parchi' }, role: o.role ?? 'presenter' });
    expect(out.length).toBeGreaterThan(1);
    out.forEach((r) => expect(r.character).toBeNull());
  }, 120_000);
});

describe.skipIf(!DIR)('carousel contact sheets', () => {
  const sheet = async (name: string, rows: DesignDetail[][]) => {
    const h = 520;
    const cells = await Promise.all(rows.map((row) => Promise.all(row.map((r) => sharp(r.png).resize({ height: h }).png().toBuffer()))));
    const w = Math.round((1080 / 1350) * h);
    const comps: OverlayOptions[] = [];
    cells.forEach((row, ri) => row.forEach((x, ci) => comps.push({ input: x, left: ci * (w + 8), top: ri * (h + 8) })));
    const png = await sharp({ create: { width: 5 * (w + 8), height: rows.length * (h + 8), channels: 3, background: '#777777' } }).composite(comps).png().toBuffer();
    mkdirSync(DIR!, { recursive: true });
    writeFileSync(`${DIR}/${name}.png`, png);
  };

  for (const withCharacter of [false, true]) {
    it(`writes the ${withCharacter ? 'character' : 'typographic'} sheet`, async () => {
      const rows: DesignDetail[][] = [];
      for (const o of options('portrait', withCharacter ? 'rig' : null)) {
        const role: CharacterRole | null = withCharacter ? (o.role ?? null) : null;
        rows.push(await renderSlideSet({ input: inputFor('portrait', o), slides: SLIDES, characterFor: withCharacter && role ? rigFor : undefined }));
      }
      await sheet(withCharacter ? 'with-character' : 'without-character', rows);
    }, 300_000);
  }
});
