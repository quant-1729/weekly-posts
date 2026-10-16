// CH-1: Tween as a brand character. Its own poses are the existing rig's output, untouched, inside one fitting group;
// the actions it lacks map to its nearest pose; and the roster is the 13 characters (no Laltain).

import { describe, expect, it } from 'vitest';
import { CHARACTER_IDS, drawCharacter } from '@/lib/characters';
import { BODIES } from '@/lib/characters/bodies';
import { TWEEN_FIT, TWEEN_MAP, tweenColorsFromCharacter } from '@/lib/characters/tween';
import { DEFAULT_TWEEN_COLORS } from '@/lib/mascot/colors';
import { tweenParts, TWEEN_POSES } from '@/lib/mascot/tween';
import { ACTIONS, COLORS, OTHER } from './helpers';

const wrap = (parts: string) => `<g transform="translate(${TWEEN_FIT.tx} ${TWEEN_FIT.ty}) scale(${TWEEN_FIT.scale})">${parts}</g>`;

describe('Tween as a brand character', () => {
  it("Tween's own 18 poses are the existing rig's output, unchanged", () => {
    for (const pose of TWEEN_POSES) {
      for (const colors of [COLORS, OTHER]) {
        const d = drawCharacter('tween', pose, colors).body;
        expect(d, pose).toBe(wrap(tweenParts({ pose, colors: tweenColorsFromCharacter(colors) })));
      }
    }
  });

  it("with Tween's own colours the output is the existing rig's default drawing", () => {
    const own = { accent: DEFAULT_TWEEN_COLORS.scarf, accentDark: DEFAULT_TWEEN_COLORS.scarfDark };
    for (const pose of TWEEN_POSES) expect(drawCharacter('tween', pose, own).body.toLowerCase(), pose).toBe(wrap(tweenParts({ pose })).toLowerCase());
  });

  it('every kit action maps to a Tween pose; mapped actions draw that pose (hold-sign adds a placard)', () => {
    expect(Object.keys(TWEEN_MAP).sort()).toEqual([...ACTIONS].sort());
    for (const a of ACTIONS) {
      const m = TWEEN_MAP[a];
      expect((TWEEN_POSES as readonly string[]).includes(m.pose), a).toBe(true);
      const d = drawCharacter('tween', a, COLORS).body;
      expect(d, a).toContain(tweenParts({ pose: m.pose, colors: tweenColorsFromCharacter(COLORS), tweak: m.tweak }));
      expect(d.includes('rx="16"'), a).toBe(!!m.sign);
    }
    expect(TWEEN_MAP['hold-sign'].sign).toBe(true);
  });

  it('the roster is the 13 characters, every one drawable, and Laltain is not among them', () => {
    expect(CHARACTER_IDS).toHaveLength(13);
    expect(new Set(CHARACTER_IDS).size).toBe(13);
    expect(CHARACTER_IDS).toContain('tween');
    expect(Object.keys(BODIES).sort()).toEqual(CHARACTER_IDS.filter((i) => i !== 'tween').sort());
    expect((CHARACTER_IDS as readonly string[]).includes('laltain')).toBe(false);
    expect(Object.keys(BODIES)).not.toContain('laltain');
    expect(() => drawCharacter('laltain' as never, 'idle', COLORS)).toThrow();
  });

  it('no drawing mentions Laltain or contains words', () => {
    for (const id of CHARACTER_IDS) {
      const m = drawCharacter(id, 'hold-sign', COLORS).body.toLowerCase();
      expect(m).not.toContain('laltain');
      expect(m).not.toContain('<text');
    }
  });
});
