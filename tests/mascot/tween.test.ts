import { Resvg } from '@resvg/resvg-js';
import { describe, expect, it } from 'vitest';
import { DEFAULT_TWEEN_COLORS, tweenColorsFor } from '@/lib/mascot/colors';
import { TWEEN_POST_POSES, rigPoseFor } from '@/lib/mascot/poses';
import { tweenSlotSvg } from '@/lib/mascot/slot';
import { renderTween, TWEEN_POSES, TWEEN_VIEWBOX } from '@/lib/mascot/tween';

describe('the static Tween renderer', () => {
  it('is a plain SVG on the kit canvas: no CSS variables, classes, styles, animation or text', () => {
    for (const pose of TWEEN_POSES) {
      const svg = renderTween({ pose });
      expect(svg, pose).toContain(`viewBox="${TWEEN_VIEWBOX}"`);
      expect(svg, pose).toContain('width="550" height="550"');
      for (const bad of ['var(', 'class=', '<style', 'animate', 'animation', '<text', '<image', 'transition']) expect(svg, `${pose}: ${bad}`).not.toContain(bad);
    }
    expect(renderTween({ pose: 'idle', size: 220 })).toContain('width="220" height="220"');
  });

  it('is deterministic, and every post pose looks different', () => {
    expect(renderTween({ pose: 'wave' })).toBe(renderTween({ pose: 'wave' }));
    const all = TWEEN_POST_POSES.map((p) => renderTween({ pose: rigPoseFor(p, 'left') }));
    expect(new Set(all).size).toBe(TWEEN_POST_POSES.length);
  });

  it('uses the exact Tween palette by default', () => {
    const svg = renderTween({ pose: 'wave' });
    for (const hex of ['#0B1C30', '#2B4CFF', '#203CD9', '#5B78FF', '#119C9A', '#F3B63A', '#FFFFFF']) expect(svg).toContain(hex);
  });

  it('takes the scarf and accent colours from the brand', () => {
    const colors = tweenColorsFor({ primary: '#12ab34', accent: '#f2b100' });
    const svg = renderTween({ pose: 'celebrate', colors });
    expect(svg).toContain('#12ab34');
    expect(svg).toContain('#f2b100'); // confetti squares
    expect(svg).not.toContain('#2B4CFF');
    expect(svg).not.toContain('#FF6B4A');
    expect(svg).toContain('#0B1C30'); // the body ink never changes
    expect(svg).toContain('#119C9A'); // nor the feather
  });

  it('shows the face and props each pose needs', () => {
    expect(renderTween({ pose: 'celebrate' })).toContain('M130 200 Q156 160 182 200'); // joy eyes
    expect(renderTween({ pose: 'celebrate' })).toContain('l6 14 l14 6'); // confetti star
    expect(renderTween({ pose: 'think' })).toContain('M134 140 L178 133'); // raised brow
    expect(renderTween({ pose: 'think' })).toContain('cx="42" cy="22" r="13"'); // thought dots
    expect(renderTween({ pose: 'shrug' })).toContain('M132 148 L180 134'); // worried brows
    expect(renderTween({ pose: 'present' })).toContain('M-23 17 L0 34 L23 17'); // the letter
    expect(renderTween({ pose: 'wave' })).not.toContain('M-23 17 L0 34 L23 17');
    expect(renderTween({ pose: 'wave' })).toContain('M172 248 Q200 282 228 248 Z'); // happy mouth
    expect(renderTween({ pose: 'idle' })).toContain('M181 252 Q200 268 219 252'); // neutral smile
    expect(renderTween({ pose: 'point-right' })).toContain('rx="4.4"'); // the extended finger
    expect(renderTween({ pose: 'idle' })).not.toContain('rx="4.4"');
  });

  it('turns pose angles into transforms with the rig pivots', () => {
    const svg = renderTween({ pose: 'wave' });
    expect(svg).toContain('translate(292 256)'); // right shoulder
    expect(svg).toContain('rotate(-150)'); // upper arm
    expect(svg).toContain('translate(0 54) rotate(-20)'); // elbow
    expect(svg).toContain('rotate(-3 200 200)'); // face tilt about the face centre
    expect(renderTween({ pose: 'celebrate' })).toContain('translate(172 340)'); // hips
    expect(renderTween({ pose: 'point-left' })).toContain('rotate(-2 200 440)'); // lean about the body base
    expect(renderTween({ pose: 'peek' })).toContain('scale(-1 1)'); // mirrored
  });
});

describe('the halo (a thin white glow so navy reads on a dark background)', () => {
  const DARK = '#0b1c30';
  // A pixel just outside the left edge of the body, beside the face (rig x 96 is canvas px 171).
  const probe = (halo: boolean) => {
    const svg = renderTween({ pose: 'idle', halo }).replace('<title>', `<rect x="-75" y="-80" width="550" height="550" fill="${DARK}"/><title>`);
    const r = new Resvg(svg, { fitTo: { mode: 'width', value: 550 } }).render();
    const at = (x: number, y: number) => {
      const i = (y * r.width + x) * 4;
      return Math.round((r.pixels[i] + r.pixels[i + 1] + r.pixels[i + 2]) / 3);
    };
    return { outside: at(170, 250), far: at(30, 250), body: at(200, 300) };
  };

  it('is drawn by resvg when asked for: a light ring around the body on a dark background', () => {
    const on = probe(true);
    const off = probe(false);
    expect(off.outside).toBeLessThan(40); // just the dark background
    expect(on.outside).toBeGreaterThan(off.outside + 80); // the glow
    expect(on.far).toBeLessThan(40); // not everywhere
    expect(on.body).toBeLessThan(40); // the body itself is still navy
  });

  it('is off by default', () => {
    expect(renderTween({ pose: 'idle' })).not.toContain('filter');
    expect(renderTween({ pose: 'idle', halo: true })).toContain('filter=');
  });

  it('works in the post slot too', () => {
    const plain = tweenSlotSvg({ pose: 'wave', colors: DEFAULT_TWEEN_COLORS });
    const glow = tweenSlotSvg({ pose: 'wave', colors: DEFAULT_TWEEN_COLORS, halo: true });
    expect(plain).not.toContain('filter');
    expect(glow).toContain('filter=');
    const out = new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400"><rect width="400" height="400" fill="${DARK}"/>${glow}</svg>`).render();
    expect(out.width).toBe(400);
  });
});
