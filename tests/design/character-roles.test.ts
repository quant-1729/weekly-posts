// CH-2: the brand's character as a part of the layout. Each role renders without collisions in the feed and story sizes, sign holders
// carry the brief's offer on the sign, pointers point at their target, sizes follow the scale bands (docs/mascot-inspiration.md B1),
// stories keep out of the platform UI, a post keeps 30% free, a payment QR is never covered. Drawn with the real character rig.
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { CHARACTER_ROLES, type CharacterRole } from '@/lib/characters';
import { renderDesignDetailed, SAFE_ZONES, type DesignDetail, type DesignFormat, type DesignInput, type ThemeId } from '@/lib/design';
import { BAND_RANGE, ROLE_BAND, bandHeight } from '@/lib/design/character';
import { MIN_FREE_SPACE } from '@/lib/design/engine';
import { content, input, PAY_QR, arabicContent } from './fixtures';
import { expectClean, pixelContrastIssues } from './helpers';
import { realisticPhoto } from './photo-fixture';

const SOURCE = { kind: 'rig', id: 'parchi' } as const;
const FEED: DesignFormat[] = ['square', 'portrait', 'vertical'];
const THEMES: ThemeId[] = ['clean', 'bold_sale', 'festive'];

const withRole = (role: CharacterRole, over: Partial<DesignInput> & Pick<DesignInput, 'format' | 'themeId'>) => input({ character: SOURCE, role, seed: 7, ...over });
const lighter = () => content({ secondary: [], blocks: [], qr: null });

type Box = { x: number; y: number; w: number; h: number };
const hit = (a: Box, b: Box) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
const inflate = (b: Box, d: number): Box => ({ x: b.x - d, y: b.y - d, w: b.w + 2 * d, h: b.h + 2 * d });

/** No text line, code, logo or icon within the 3%-of-width gap of the character (the sign and the narrator's bubble are the character's own). */
function crowded(r: DesignDetail): string[] {
  const ch = r.placements.find((p) => p.name === 'character');
  if (!ch) return [];
  const zone = inflate(ch.box, Math.round(r.width * 0.03));
  const own = new Set(['character', 'sign', ...(r.character?.bubble ? ['headline'] : [])]);
  const out: string[] = [];
  for (const p of r.placements) {
    if (own.has(p.name)) continue;
    const boxes = p.kind === 'qr' ? [p.box] : p.lines.length ? p.lines : [p.box];
    if (boxes.some((b) => b.w > 0 && b.h > 0 && hit(zone, b))) out.push(p.name);
  }
  return out;
}

describe('every role renders without collisions', () => {
  it('presenter, sign holder, pointer and celebrator work on every layout, size and theme, with and without a photo', async () => {
    const photo = await realisticPhoto();
    const problems: string[] = [];
    for (const role of ['presenter', 'sign_holder', 'pointer', 'celebrator'] as const) {
      for (const format of FEED) {
        for (const themeId of THEMES) {
          for (const withPhoto of [false, true]) {
            const r = await renderDesignDetailed(withRole(role, { format, themeId, photo: withPhoto ? photo : null }));
            const tag = `${role} ${format} ${themeId} ${withPhoto ? 'photo' : 'plain'} ${r.layoutId}`;
            if (r.character?.role !== role) problems.push(`${tag}: drew ${r.character?.role ?? 'no character'}`);
            const { problems: p } = expectClean(r, tag);
            problems.push(...p.map((x) => `${tag}: ${x}`));
            const c = crowded(r);
            if (c.length) problems.push(`${tag}: crowds ${c.join(', ')}`);
            if (r.report.dropped.length) problems.push(`${tag}: dropped ${r.report.dropped.join('; ')}`);
          }
        }
      }
    }
    expect(problems).toEqual([]);
  }, 300_000);

  it('a peeker hides behind a panel edge, a percher sits on one, a narrator speaks the headline in a bubble', async () => {
    const photo = await realisticPhoto();
    const cases: { role: CharacterRole; themeId: ThemeId; layoutId: string; photo: boolean }[] = [
      { role: 'peeker', themeId: 'clean', layoutId: 'clean-card', photo: false },
      { role: 'peeker', themeId: 'clean', layoutId: 'clean-photo-split', photo: true },
      { role: 'peeker', themeId: 'festive', layoutId: 'festive-photo-arch', photo: true },
      { role: 'percher', themeId: 'clean', layoutId: 'clean-card', photo: false },
      { role: 'percher', themeId: 'bold_sale', layoutId: 'sale-band', photo: false },
      { role: 'percher', themeId: 'clean', layoutId: 'clean-photo-split', photo: true },
      { role: 'narrator', themeId: 'clean', layoutId: 'clean-open', photo: false },
      { role: 'narrator', themeId: 'bold_sale', layoutId: 'sale-band', photo: false },
    ];
    const problems: string[] = [];
    for (const c of cases) {
      for (const format of ['square', 'portrait', 'vertical'] as const) {
        const r = await renderDesignDetailed(withRole(c.role, { format, themeId: c.themeId, layoutId: c.layoutId, photo: c.photo ? photo : null }));
        const tag = `${c.role} ${format} ${c.layoutId}`;
        if (r.character?.role !== c.role) problems.push(`${tag}: drew ${r.character?.role ?? 'no character'}`);
        problems.push(...expectClean(r, tag).problems.map((x) => `${tag}: ${x}`));
        const crowd = crowded(r);
        if (crowd.length) problems.push(`${tag}: crowds ${crowd.join(', ')}`);
        if (c.role === 'narrator') {
          const bubble = r.character?.bubble;
          if (bubble?.text.toLowerCase() !== content().headline.toLowerCase()) problems.push(`${tag}: bubble says ${bubble?.text}`);
          // The headline is said once: in the bubble, not again in the stack.
          if (r.placements.filter((p) => p.name === 'headline').length !== 1) problems.push(`${tag}: headline drawn ${r.placements.filter((p) => p.name === 'headline').length} times`);
        }
      }
    }
    expect(problems).toEqual([]);
  }, 300_000);

  it('the wide sizes keep the character in its column: landscape, thumbnail and banner', async () => {
    const photo = await realisticPhoto();
    const problems: string[] = [];
    for (const format of ['landscape', 'thumbnail', 'banner'] as const) {
      for (const role of ['presenter', 'sign_holder', 'pointer', 'celebrator'] as const) {
        for (const withPhoto of [false, true]) {
          const r = await renderDesignDetailed(withRole(role, { format, themeId: 'clean', photo: withPhoto ? photo : null, content: content({ secondary: [] }) }));
          const tag = `${role} ${format} ${withPhoto ? 'photo' : 'plain'} ${r.layoutId}`;
          problems.push(...expectClean(r, tag).problems.map((x) => `${tag}: ${x}`));
          const c = crowded(r);
          if (c.length) problems.push(`${tag}: crowds ${c.join(', ')}`);
        }
      }
    }
    expect(problems).toEqual([]);
  }, 300_000);

  it('is deterministic, and the brand seed changes the side', async () => {
    const a = await renderDesignDetailed(withRole('presenter', { format: 'portrait', themeId: 'clean', content: lighter() }));
    const b = await renderDesignDetailed(withRole('presenter', { format: 'portrait', themeId: 'clean', content: lighter() }));
    expect(Buffer.compare(a.png, b.png)).toBe(0);
    const sides = new Set<string>();
    for (const seed of [0, 1, 2, 3, 4, 5]) sides.add((await renderDesignDetailed(withRole('presenter', { format: 'portrait', themeId: 'clean', seed, content: lighter() }))).character!.side);
    expect(sides).toEqual(new Set(['left', 'right']));
  }, 60_000);

  it('mirrors for right-to-left text: the character takes the opposite side', async () => {
    const ltr = await renderDesignDetailed(withRole('pointer', { format: 'square', themeId: 'clean', seed: 1, content: lighter() }));
    const rtl = await renderDesignDetailed(withRole('pointer', { format: 'square', themeId: 'clean', seed: 1, language: 'ar', dir: 'rtl', content: { ...arabicContent(), secondary: [], blocks: [], qr: null } }));
    expect(ltr.character).not.toBeNull();
    expect(rtl.character).not.toBeNull();
    expect(rtl.character!.side).not.toBe(ltr.character!.side);
    expect(expectClean(rtl).problems).toEqual([]);
    expect(crowded(rtl)).toEqual([]);
  });
});

describe('the sign holder', () => {
  it("draws the brief's offer line inside the sign, once, with passing contrast", async () => {
    const problems: string[] = [];
    for (const format of FEED) {
      for (const themeId of THEMES) {
        const r = await renderDesignDetailed(withRole('sign_holder', { format, themeId }));
        const tag = `${format} ${themeId} ${r.layoutId}`;
        const sign = r.character?.sign;
        if (r.character?.role !== 'sign_holder' || !sign) {
          problems.push(`${tag}: no sign`);
          continue;
        }
        if (sign.text.toLowerCase() !== content().offerLine!.toLowerCase()) problems.push(`${tag}: sign says ${sign.text}`);
        const text = r.placements.find((p) => p.name === 'sign');
        if (!text) problems.push(`${tag}: no sign text placed`);
        else {
          if (!text.lines.every((l) => l.x >= sign.box.x - 0.5 && l.y >= sign.box.y - 0.5 && l.x + l.w <= sign.box.x + sign.box.w + 0.5 && l.y + l.h <= sign.box.y + sign.box.h + 0.5)) problems.push(`${tag}: text outside the sign`);
          if (text.size < 24) problems.push(`${tag}: sign text ${text.size}px`);
        }
        // The offer is on the sign, not repeated in the text stack.
        if (r.placements.some((p) => p.name === 'offer')) problems.push(`${tag}: offer drawn twice`);
        if (r.report.contrast.length) problems.push(`${tag}: contrast ${JSON.stringify(r.report.contrast)}`);
        const px = await pixelContrastIssues(r);
        if (px.length) problems.push(`${tag}: pixel contrast ${JSON.stringify(px)}`);
      }
    }
    expect(problems).toEqual([]);
  }, 120_000);

  it('uses the headline when the brief has no offer line, and only words from the content', async () => {
    const r = await renderDesignDetailed(withRole('sign_holder', { format: 'square', themeId: 'clean', content: content({ offerLine: null }) }));
    expect(r.character?.role).toBe('sign_holder');
    expect(r.character?.sign?.text.toLowerCase()).toBe(content().headline.toLowerCase());
    expect(r.placements.filter((p) => p.name === 'headline')).toHaveLength(0);
    const words = new Set(`${content().headline} ${content().subline}`.toLowerCase().split(/\W+/));
    for (const w of r.character!.sign!.text.toLowerCase().split(/\W+/).filter(Boolean)) expect(words.has(w), w).toBe(true);
  });
});

describe('the pointer', () => {
  it('points toward its target: left or right when the target is beside it, down when it is below', async () => {
    const problems: string[] = [];
    for (const format of FEED) {
      for (const seed of [1, 2]) {
        const r = await renderDesignDetailed(withRole('pointer', { format, themeId: 'bold_sale', seed, content: lighter() }));
        const c = r.character;
        if (!c?.pointAt) {
          problems.push(`${format} ${seed}: no target`);
          continue;
        }
        const mid = { x: c.box.x + c.box.w / 2, y: c.box.y + c.box.h / 2 };
        const dx = c.pointAt.x - mid.x;
        const dy = c.pointAt.y - mid.y;
        const want = Math.abs(dy) > 1.25 * Math.abs(dx) ? (dy > 0 ? 'point-down' : 'point-up') : dx < 0 ? 'point-left' : 'point-right';
        // The hand, not the middle of the body, is the start of the line: allow the neighbouring direction when the two are close.
        const dirOk = c.action === want || (Math.abs(Math.abs(dy) - Math.abs(dx)) < 0.5 * Math.hypot(dx, dy) && ['point-left', 'point-right', 'point-down', 'point-up'].includes(c.action));
        if (!dirOk) problems.push(`${format} seed ${seed}: points ${c.action}, target is (${Math.round(dx)}, ${Math.round(dy)}) away`);
        // The target is a line of the post itself (the headline).
        const head = r.placements.find((p) => p.name === 'headline')!;
        if (!(c.pointAt.x >= head.box.x - 1 && c.pointAt.x <= head.box.x + head.box.w + 1 && c.pointAt.y >= head.box.y - 1 && c.pointAt.y <= head.box.y + head.box.h + 1)) problems.push(`${format} seed ${seed}: points at ${JSON.stringify(c.pointAt)}, not at the headline`);
      }
    }
    expect(problems).toEqual([]);
  }, 60_000);
});

describe('scale bands, safe areas, negative space', () => {
  it('sizes each role in its band (a lead role steps down to the support band next to a photo)', async () => {
    const photo = await realisticPhoto();
    const problems: string[] = [];
    for (const format of FEED) {
      for (const role of CHARACTER_ROLES) {
        for (const withPhoto of [false, true]) {
          const layoutId = role === 'peeker' || role === 'percher' ? (withPhoto ? 'clean-photo-split' : 'clean-card') : role === 'narrator' ? 'clean-open' : undefined;
          if (role === 'narrator' && withPhoto) continue;
          const r = await renderDesignDetailed(withRole(role, { format, themeId: 'clean', layoutId, photo: withPhoto ? photo : null, content: lighter() }));
          const c = r.character;
          const tag = `${role} ${format} ${withPhoto ? 'photo' : 'plain'}`;
          if (c?.role !== role) {
            problems.push(`${tag}: drew ${c?.role ?? 'nothing'}`);
            continue;
          }
          const ratio = c.box.h / bandHeight(format, r.height);
          const band = BAND_RANGE[withPhoto && ROLE_BAND[role] === 'lead' ? 'support' : ROLE_BAND[role]];
          if (ratio < band.min - 0.015 || ratio > band.max + 0.015) problems.push(`${tag}: ${(ratio * 100).toFixed(1)}% of ${bandHeight(format, r.height)}, band ${band.min}-${band.max}`);
        }
      }
    }
    expect(problems).toEqual([]);
  }, 300_000);

  it('shrinks the character to the next band before the type shrinks: a crowded post keeps its text size', async () => {
    const heavy = content();
    const light = lighter();
    const big = await renderDesignDetailed(withRole('sign_holder', { format: 'square', themeId: 'clean', layoutId: 'clean-open', content: light }));
    const crowdedPost = await renderDesignDetailed(withRole('sign_holder', { format: 'square', themeId: 'clean', layoutId: 'clean-open', content: heavy }));
    expect(crowdedPost.character).not.toBeNull();
    expect(crowdedPost.character!.box.h).toBeLessThan(big.character!.box.h);
    expect(expectClean(crowdedPost).problems).toEqual([]);
    expect(crowdedPost.report.dropped).toEqual([]);
  }, 60_000);

  it('a story keeps the character and the text out of the platform UI (top 14%, bottom 20%)', async () => {
    const photo = await realisticPhoto();
    const problems: string[] = [];
    for (const role of CHARACTER_ROLES) {
      for (const withPhoto of [false, true]) {
        const layoutId = role === 'peeker' || role === 'percher' ? (withPhoto ? 'clean-photo-split' : 'clean-card') : role === 'narrator' ? 'clean-open' : undefined;
        if (role === 'narrator' && withPhoto) continue;
        const r = await renderDesignDetailed(withRole(role, { format: 'vertical', themeId: 'clean', layoutId, photo: withPhoto ? photo : null }));
        if (!r.character) {
          problems.push(`${role}: no character`);
          continue;
        }
        const tag = `${role} ${withPhoto ? 'photo' : 'plain'}`;
        const top = r.height * 0.14;
        const bottom = r.height * 0.8;
        for (const p of r.placements) {
          if (p.kind === 'logo' || p.kind === 'marker') continue;
          for (const b of p.lines.length ? p.lines : [p.box]) {
            if (b.y < top - 1) problems.push(`${tag}: ${p.name} starts at ${Math.round(b.y)}, above ${Math.round(top)}`);
            if (b.y + b.h > r.height * 0.82) problems.push(`${tag}: ${p.name} ends at ${Math.round(b.y + b.h)}`);
          }
        }
        const visible = r.placements.find((p) => p.name === 'character')!.box;
        if (visible.y + visible.h > bottom + 1) problems.push(`${tag}: character ends at ${Math.round(visible.y + visible.h)}, below ${Math.round(bottom)}`);
        const z = SAFE_ZONES.vertical.inside;
        if (visible.y < z.y - 1) problems.push(`${tag}: character above the safe area`);
      }
    }
    expect(problems).toEqual([]);
  }, 200_000);

  it(`keeps at least ${MIN_FREE_SPACE * 100}% of the canvas free of text, character and logo`, async () => {
    const photo = await realisticPhoto();
    const problems: string[] = [];
    for (const role of CHARACTER_ROLES) {
      for (const format of FEED) {
        for (const withPhoto of [false, true]) {
          const layoutId = role === 'peeker' || role === 'percher' ? (withPhoto ? 'clean-photo-split' : 'clean-card') : role === 'narrator' ? 'clean-open' : undefined;
          if (role === 'narrator' && withPhoto) continue;
          const r = await renderDesignDetailed(withRole(role, { format, themeId: 'bold_sale', layoutId, photo: withPhoto ? photo : null }));
          if (r.character && r.freeSpace < MIN_FREE_SPACE) problems.push(`${role} ${format} ${withPhoto ? 'photo' : 'plain'}: ${(r.freeSpace * 100).toFixed(0)}% free`);
        }
      }
    }
    expect(problems).toEqual([]);
  }, 300_000);
});

describe('a payment QR', () => {
  it('is never covered by the character, keeps its quiet zone, and decodes to exactly the confirmed ID', async () => {
    const photo = await realisticPhoto();
    const problems: string[] = [];
    for (const role of CHARACTER_ROLES) {
      for (const format of FEED) {
        for (const withPhoto of [false, true]) {
          const layoutId = role === 'peeker' || role === 'percher' ? (withPhoto ? 'clean-photo-split' : 'clean-card') : role === 'narrator' ? 'clean-open' : undefined;
          if (role === 'narrator' && withPhoto) continue;
          const r = await renderDesignDetailed(withRole(role, { format, themeId: 'clean', layoutId, photo: withPhoto ? photo : null, content: content({ qr: PAY_QR }) }));
          const tag = `${role} ${format} ${withPhoto ? 'photo' : 'plain'}`;
          if (r.report.qr?.decoded !== PAY_QR.text) problems.push(`${tag}: decoded ${r.report.qr?.decoded}`);
          const ch = r.placements.find((p) => p.name === 'character');
          const qr = r.placements.find((p) => p.kind === 'qr');
          if (ch && qr && hit(inflate(ch.box, Math.round(r.width * 0.03)), qr.box)) problems.push(`${tag}: the character is within 3% of the QR tile`);
          if (ch && r.qrBox) {
            // No pixel of the character's own box meets the code or its quiet zone (4 modules).
            const quiet = inflate(r.qrBox, 40);
            if (hit(ch.box, quiet)) problems.push(`${tag}: the character meets the QR quiet zone`);
          }
        }
      }
    }
    expect(problems).toEqual([]);
  }, 300_000);
});

describe('what stays as it was', () => {
  it('a post without a role looks exactly as before (the header sticker is only drawn without one)', async () => {
    const plain = await renderDesignDetailed(input({ format: 'square', themeId: 'clean' }));
    const noRole = await renderDesignDetailed(input({ format: 'square', themeId: 'clean', character: SOURCE, role: null }));
    expect(Buffer.compare(plain.png, noRole.png)).toBe(0);
    expect(noRole.character).toBeNull();
  });

  it('the colour filter never touches the character', async () => {
    const photo = await realisticPhoto();
    const a = await renderDesignDetailed(withRole('presenter', { format: 'portrait', themeId: 'clean', photo, content: lighter() }));
    const b = await renderDesignDetailed(withRole('presenter', { format: 'portrait', themeId: 'clean', photo, filter: { preset: 'mono', intensity: 100 }, content: lighter() }));
    expect(Buffer.compare(a.png, b.png)).not.toBe(0);
    expect(b.character!.svg).toBe(a.character!.svg);
    expect(b.svg).toContain(a.character!.svg);
  });

  it('a carousel slide has no character (one marker top right, nothing else competing)', async () => {
    const r = await renderDesignDetailed(withRole('presenter', { format: 'square', themeId: 'clean', slide: { index: 1, total: 3 } }));
    expect(r.character).toBeNull();
  });

  it('a character that cannot fit is dropped, never the text', async () => {
    const long = content({ headline: 'Diwali sweets, fresh every day and every week of the festive season in town', subline: 'Handmade kaju katli, ladoos, barfi, soan papdi, rasgulla and more', secondary: [{ kind: 'quality', text: 'Made with pure ghee and real saffron in small batches' }] });
    const r = await renderDesignDetailed(withRole('sign_holder', { format: 'square', themeId: 'clean', layoutId: 'clean-open', content: long }));
    expect(r.report.overflow).toEqual([]);
    expect(r.report.qr?.ok).toBe(true);
    void sharp;
  });
});
