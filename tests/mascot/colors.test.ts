import { describe, expect, it } from 'vitest';
import { contrast } from '@/lib/render/color';
import { DEFAULT_TWEEN_COLORS, MIN_SCARF_CONTRAST, pickScarf, scarfShades, scarfSwatches, tweenColorsFor, TWEEN_BLUE, TWEEN_INK } from '@/lib/mascot/colors';
import { parseTweenSpec } from '@/lib/mascot/spec';

describe('Tween colours for a brand', () => {
  it('with no brand colours is exactly the Tween palette', () => {
    expect(tweenColorsFor(null)).toEqual(DEFAULT_TWEEN_COLORS);
    expect(tweenColorsFor({})).toEqual(DEFAULT_TWEEN_COLORS);
    expect(tweenColorsFor({ primary: 'not a colour', secondary: '', accent: null })).toEqual(DEFAULT_TWEEN_COLORS);
    expect(DEFAULT_TWEEN_COLORS).toMatchObject({ ink: '#0B1C30', scarf: '#2B4CFF', scarfDark: '#203CD9', scarfLight: '#5B78FF', coral: '#FF6B4A', eye: '#FFFFFF' });
  });

  it('puts the primary colour on the scarf, with a darker and a lighter shade, and the accent on the props', () => {
    const c = tweenColorsFor({ primary: '#C8283A', secondary: '#f6e7c8', accent: '#1B998B' });
    expect(c.scarf).toBe('#c8283a');
    expect(c.coral).toBe('#1b998b');
    expect(c.ink).toBe(TWEEN_INK);
    expect(c.eye).toBe('#FFFFFF');
    expect(contrast(c.scarfDark, '#000000')).toBeLessThan(contrast(c.scarf, '#000000'));
    expect(contrast(c.scarfLight, '#ffffff')).toBeLessThan(contrast(c.scarf, '#ffffff'));
  });

  it('shades are in the same proportions as the Tween cobalt', () => {
    const s = scarfShades('#2b4cff');
    const near = (a: string, b: string) => [1, 3, 5].every((i) => Math.abs(parseInt(a.slice(i, i + 2), 16) - parseInt(b.slice(i, i + 2), 16)) <= 12);
    expect(near(s.scarfDark, '#203CD9')).toBe(true);
    expect(near(s.scarfLight, '#5B78FF')).toBe(true);
  });

  it('skips a primary that does not stand out from the navy body, and tries the secondary, then the accent, then Tween blue', () => {
    expect(contrast('#0b2545', TWEEN_INK)).toBeLessThan(MIN_SCARF_CONTRAST);
    expect(pickScarf({ primary: '#0b2545', secondary: '#e07a1f', accent: '#1b998b' })).toBe('#e07a1f');
    expect(pickScarf({ primary: '#0b2545', secondary: '#101820', accent: '#1b998b' })).toBe('#1b998b');
    expect(pickScarf({ primary: '#0b2545', secondary: '#101820', accent: '#0a0a0a' })).toBe(TWEEN_BLUE);
  });

  it('treats a near-white primary as unusable too', () => {
    expect(pickScarf({ primary: '#fafafa', secondary: '#c8283a' })).toBe('#c8283a');
    expect(pickScarf({ primary: '#ffffff' })).toBe(TWEEN_BLUE);
  });

  it("the owner's choice wins, even over the contrast rule, and null goes back to the brand", () => {
    const brand = { primary: '#c8283a', accent: '#f2b100' };
    expect(tweenColorsFor(brand, '#0b2545').scarf).toBe('#0b2545');
    expect(tweenColorsFor(brand, null).scarf).toBe('#c8283a');
    expect(tweenColorsFor(brand, 'rubbish').scarf).toBe('#c8283a');
  });

  it('offers the brand palette and Tween blue as swatches, without duplicates', () => {
    expect(scarfSwatches({ primary: '#C8283A', secondary: '#c8283a', accent: '#f2b100' })).toEqual([
      { hex: '#c8283a', kind: 'primary' },
      { hex: '#f2b100', kind: 'accent' },
      { hex: '#2b4cff', kind: 'tween' },
    ]);
    expect(scarfSwatches(null)).toEqual([{ hex: '#2b4cff', kind: 'tween' }]);
  });
});

describe('the stored spec', () => {
  it('reads { v: 2, base: tween, scarf }', () => {
    expect(parseTweenSpec({ v: 2, base: 'tween', scarf: '#C8283A' })).toEqual({ v: 2, base: 'tween', scarf: '#c8283a' });
    expect(parseTweenSpec({ v: 2, base: 'tween', scarf: null })).toEqual({ v: 2, base: 'tween', scarf: null });
  });

  it('draws an old v1 row (or junk) as Tween with the defaults', () => {
    const v1 = { body: { shape: 'round', color: '#F2A93B', pattern: 'dots', pattern_color: '#FFD98A' }, head: 'chef_hat', neck: 'none', extra: 'none', accent_color: '#B5121B' };
    expect(parseTweenSpec(v1)).toEqual({ v: 2, base: 'tween', scarf: null });
    expect(parseTweenSpec({})).toEqual({ v: 2, base: 'tween', scarf: null });
    expect(parseTweenSpec(null)).toEqual({ v: 2, base: 'tween', scarf: null });
    expect(parseTweenSpec({ v: 2, base: 'tween', scarf: 'red' })).toEqual({ v: 2, base: 'tween', scarf: null });
  });
});
