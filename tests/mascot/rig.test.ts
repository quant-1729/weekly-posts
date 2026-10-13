import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { RIG } from '@/lib/ai/prompts/mascot';
import { mascotSpecSchema, type MascotSpec } from '@/lib/ai/schemas';
import { contrast } from '@/lib/render/color';
import { FIXTURE_SPECS } from '@/lib/mascot/fixtures';
import { hasExcludedCombination } from '@/lib/mascot/concepts';
import { randomSpec, seededRandom } from '@/lib/mascot/random-spec';
import { MASCOT_POSES, drawMascot, drawMascotDocument, drawMascotParts, mascotPalette } from '@/lib/mascot/rig';
import { renderPosePng } from '@/lib/mascot/sheet';

/** A small well-formedness check: balanced tags, quoted attributes. Throws on anything else. */
function assertWellFormed(xml: string): void {
  const stack: string[] = [];
  const tag = /<(\/?)([A-Za-z][\w:-]*)((?:\s+[\w:-]+="[^"]*")*)\s*(\/?)>/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = tag.exec(xml))) {
    const between = xml.slice(last, m.index);
    if (/[<>]/.test(between)) throw new Error(`stray angle bracket near ${m.index}`);
    last = tag.lastIndex;
    const [, closing, name, , selfClosing] = m;
    if (closing) {
      if (stack.pop() !== name) throw new Error(`unbalanced </${name}>`);
    } else if (!selfClosing) stack.push(name);
  }
  if (/[<>]/.test(xml.slice(last))) throw new Error('trailing garbage');
  if (stack.length) throw new Error(`unclosed <${stack.join('>, <')}>`);
}

const RANDOM_SPECS = (() => {
  const rng = seededRandom(20261013);
  return Array.from({ length: 30 }, () => randomSpec(rng));
})();

describe('the rig draws 30 seeded random specs in all 8 poses', () => {
  it('has 8 poses and valid specs', () => {
    expect(MASCOT_POSES).toHaveLength(8);
    for (const spec of RANDOM_SPECS) {
      expect(mascotSpecSchema.safeParse(spec).success).toBe(true);
      expect(hasExcludedCombination(spec)).toBe(false);
    }
  });

  it.each(RANDOM_SPECS.map((spec, i) => [i, spec] as const))('spec %i: every pose is a clean, transparent, 400x400 SVG', (_i, spec) => {
    for (const pose of MASCOT_POSES) {
      const svg = drawMascotDocument(spec, pose);
      assertWellFormed(svg);
      expect(svg).toMatch(/^<svg [^>]*viewBox="0 0 400 400"/);
      expect(svg).not.toMatch(/<text[\s>]/i);
      expect(svg).not.toMatch(/<image[\s>]/i);
      expect(svg.replace(/xmlns="[^"]*"/, '')).not.toMatch(/href=|https?:|data:/i); // nothing external, no embedded raster
      expect(svg).not.toMatch(/<rect[^>]*width="400"[^>]*height="400"/); // no background rectangle
    }
  });

  it.each(RANDOM_SPECS.map((spec, i) => [i, spec] as const))('spec %i: the body group is byte-identical in all 8 poses', (_i, spec) => {
    const bodies = MASCOT_POSES.map((pose) => drawMascotParts(spec, pose).body);
    expect(new Set(bodies).size).toBe(1);
    // ...and that body is inside every pose's drawing exactly as is.
    for (const pose of MASCOT_POSES) expect(drawMascot(spec, pose)).toContain(`<g data-part="body">${bodies[0]}</g>`);
    // The poses do differ from each other (arms, eyes, mouth, props).
    expect(new Set(MASCOT_POSES.map((pose) => drawMascot(spec, pose))).size).toBe(8);
  });

  it('the PNG of a pose is transparent at the corners and drawn in the middle', async () => {
    for (const [i, pose] of MASCOT_POSES.entries()) {
      const spec = RANDOM_SPECS[i];
      const png = renderPosePng(spec, pose);
      const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      expect([info.width, info.height]).toEqual([800, 800]);
      const alpha = (x: number, y: number) => data[(y * info.width + x) * 4 + 3];
      for (const [x, y] of [[0, 0], [799, 0], [0, 799], [799, 799]]) expect(alpha(x, y)).toBe(0);
      expect(alpha(400, 560)).toBe(255); // inside the body
    }
  });
});

describe('the whole parts catalogue', () => {
  const base = FIXTURE_SPECS[0];
  const variants: Array<[string, MascotSpec]> = [];
  for (const shape of RIG.shape) variants.push([`shape ${shape}`, { ...base, body: { ...base.body, shape } }]);
  for (const pattern of RIG.pattern) variants.push([`pattern ${pattern}`, { ...base, body: { ...base.body, pattern } }]);
  for (const eyes of RIG.eyes) variants.push([`eyes ${eyes}`, { ...base, face: { ...base.face, eyes } }]);
  for (const mustache of RIG.mustache) variants.push([`mustache ${mustache}`, { ...base, face: { ...base.face, mustache } }]);
  for (const brows of [true, false]) variants.push([`brows ${brows}`, { ...base, face: { ...base.face, brows } }]);
  for (const cheeks of [true, false]) variants.push([`cheeks ${cheeks}`, { ...base, face: { ...base.face, cheeks } }]);
  for (const style of RIG.limbs) variants.push([`limbs ${style}`, { ...base, limbs: { ...base.limbs, style } }]);
  for (const head of RIG.head) variants.push([`head ${head}`, { ...base, head }]);
  for (const neck of RIG.neck) variants.push([`neck ${neck}`, { ...base, neck }]);
  for (const extra of RIG.extra) variants.push([`extra ${extra}`, { ...base, extra }]);

  it.each(variants)('%s draws in all 8 poses and rasterises', (_name, spec) => {
    for (const pose of MASCOT_POSES) {
      const svg = drawMascotDocument(spec, pose);
      assertWellFormed(svg);
      expect(svg).not.toMatch(/<text[\s>]|<image[\s>]/i);
    }
    expect(renderPosePng(spec, 'wave', 200).length).toBeGreaterThan(500);
  });

  it('every option of every part is covered above', () => {
    expect(variants.length).toBe(RIG.shape.length + RIG.pattern.length + RIG.eyes.length + RIG.mustache.length + 2 + 2 + RIG.limbs.length + RIG.head.length + RIG.neck.length + RIG.extra.length);
  });

  it('the three fixture concepts are different characters that keep their own colours across poses', () => {
    expect(new Set(FIXTURE_SPECS.map((s) => drawMascot(s, 'wave'))).size).toBe(3);
    for (const spec of FIXTURE_SPECS) {
      const body = mascotPalette(spec).body;
      for (const pose of MASCOT_POSES) expect(drawMascot(spec, pose).toLowerCase()).toContain(`fill="${body.toLowerCase()}"`);
    }
  });
});

describe('contrast checks', () => {
  it('eyes, limbs, accent and pattern stay readable on any body colour', () => {
    const rng = seededRandom(7);
    for (let i = 0; i < 300; i++) {
      const spec = randomSpec(rng, { wild: true });
      const p = mascotPalette(spec);
      expect(contrast(p.limb, p.body)).toBeGreaterThanOrEqual(1.8);
      expect(contrast(p.accent, p.body)).toBeGreaterThanOrEqual(1.5);
      expect(contrast(p.pattern, p.body)).toBeGreaterThanOrEqual(1.35);
      // Face ink is the darker or lighter of two inks, whichever shows on the body.
      expect(contrast(p.faceInk, p.body)).toBeGreaterThanOrEqual(Math.min(contrast('#2B1A12', p.body), contrast('#FFF4E0', p.body)));
    }
  });

  it('a body that is the same colour as the limbs still gets visible limbs', () => {
    const spec: MascotSpec = { ...FIXTURE_SPECS[0], body: { ...FIXTURE_SPECS[0].body, color: '#222222' }, limbs: { style: 'stick', color: '#222222' } };
    const p = mascotPalette(spec);
    expect(p.limb).not.toBe(p.body);
    expect(contrast(p.limb, p.body)).toBeGreaterThanOrEqual(1.8);
  });
});
