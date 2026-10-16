// CH-1: brand colours recolour the accent parts only. Outlines and limbs stay ink navy, identity colours stay, and a
// character with no brand-coloured part for `body` ignores it.

import { describe, expect, it } from 'vitest';
import { drawCharacter } from '@/lib/characters';
import { buildPalette } from '@/lib/characters/body';
import { BODIES } from '@/lib/characters/bodies';
import type { CharacterColors, CharacterId } from '@/lib/characters';
import { ACTIONS, COLORS, IDS, OTHER } from './helpers';

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Replaces the accent colours (and the shades derived from them) with tokens, so two recolourings can be compared. */
function normalised(markup: string, c: CharacterColors, id: Exclude<CharacterId, 'tween'>): string {
  const P = buildPalette(c, BODIES[id].defaults);
  return markup
    .replace(new RegExp(esc(P.accentLight), 'gi'), '@L')
    .replace(new RegExp(esc(P.accentDark), 'gi'), '@D')
    .replace(new RegExp(esc(P.accent), 'gi'), '@A');
}

const CODE_DRAWN = IDS.filter((i): i is Exclude<CharacterId, 'tween'> => i !== 'tween');
const SAMPLE = ['idle', 'hold-sign', 'celebrate', 'check-off', 'stamp', 'think', 'present', 'phone', 'send', 'remind', 'search', 'heart'] as const;

describe('recolouring', () => {
  for (const id of CODE_DRAWN) {
    it(`${id}: a different accent changes accent fills only`, () => {
      let changed = 0;
      for (const action of SAMPLE) {
        const a = drawCharacter(id, action, COLORS).body;
        const b = drawCharacter(id, action, OTHER).body;
        if (a !== b) changed++;
        // Same drawing once the accent colours are swapped for tokens: only accent fills moved.
        expect(normalised(b, OTHER, id), `${id}/${action}`).toBe(normalised(a, COLORS, id));
        // No kit teal is hard-coded where the brand accent should be.
        expect(b.toLowerCase(), `${id}/${action} kit teal left`).not.toContain(COLORS.accent.toLowerCase());
        expect(b.toLowerCase(), `${id}/${action} kit dark teal left`).not.toContain(COLORS.accentDark.toLowerCase());
        // Outlines and limbs stay ink navy.
        expect(b.toLowerCase(), `${id}/${action} ink`).toContain('#17253b');
      }
      expect(changed, `${id} takes the accent colour`).toBeGreaterThan(0);
    });
  }

  it('the body colour recolours the characters whose body is a colour, and only those', () => {
    const body = '#b0306a';
    const takesBody = new Set<string>(['nudge', 'baton', 'yaadu', 'mynu', 'dabba']);
    for (const id of CODE_DRAWN) {
      const plain = drawCharacter(id, 'idle', COLORS).body;
      const tinted = drawCharacter(id, 'idle', { ...COLORS, body }).body;
      if (takesBody.has(id)) {
        expect(tinted, id).not.toBe(plain);
        expect(tinted.toLowerCase(), id).toContain(body);
      } else {
        expect(tinted, `${id} keeps its identity colours`).toBe(plain);
      }
    }
  });

  it('paper stays paper: the slip and the letter keep their off-white body whatever the brand colours are', () => {
    for (const id of ['parchi', 'chitthi'] as const) {
      const m = drawCharacter(id, 'idle', { accent: '#222222', accentDark: '#111111', body: '#ff0000' }).body.toLowerCase();
      expect(m).not.toContain('#ff0000');
      expect(m).toContain(id === 'parchi' ? '#fffdf6' : '#ffffff');
    }
  });

  it('Tween takes the accent for its scarf and keeps its navy body', () => {
    const a = drawCharacter('tween', 'idle', COLORS).body.toLowerCase();
    expect(a).toContain(COLORS.accent.toLowerCase());
    expect(a).toContain('#0b1c30');
    expect(drawCharacter('tween', 'idle', OTHER).body.toLowerCase()).toContain(OTHER.accent.toLowerCase());
  });

  it('hostile colour strings cannot inject markup', () => {
    for (const id of IDS) {
      const m = drawCharacter(id, 'idle', { accent: '"/><script>x</script>', accentDark: 'red"onload="x' , body: '"><b>' }).body;
      expect(m, id).not.toMatch(/<script|<b>|onload/);
    }
  });

  it('every action is drawn in both colourings for every character without error', () => {
    for (const id of IDS) for (const a of ACTIONS) expect(() => drawCharacter(id, a, OTHER)).not.toThrow();
  });
});
