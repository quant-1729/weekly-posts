import { describe, expect, it } from 'vitest';
import { WEEKLY_SYSTEM } from '@/lib/ai/prompts/v2-weekly';
import { DEFAULT_POST_POSE, postPoseOrDefault, rigPoseFor, TWEEN_POST_POSES } from '@/lib/mascot/poses';
import { TWEEN_POSES } from '@/lib/mascot/tween';
import { fitBubble, validPose } from '@/lib/weekly/normalize';

describe('post poses', () => {
  it('are the seven the weekly prompt asks for', () => {
    expect(TWEEN_POST_POSES).toEqual(['wave', 'talk', 'point', 'think', 'celebrate', 'present', 'idle']);
    const named = /pose, one of: ([a-z, ]+) \(/.exec(WEEKLY_SYSTEM)?.[1].split(', ');
    expect(named).toEqual([...TWEEN_POST_POSES]);
  });

  it('an unknown, old or empty pose is wave', () => {
    expect(DEFAULT_POST_POSE).toBe('wave');
    for (const bad of ['', 'dancing', 'namaste', 'thumbs_up', 'Wave', undefined, null, 7]) expect(postPoseOrDefault(bad)).toBe('wave');
    for (const p of TWEEN_POST_POSES) expect(postPoseOrDefault(p)).toBe(p);
    expect(validPose('point')).toBe('point');
    expect(validPose('excited')).toBe('');
  });

  it('every post pose maps to a rig pose', () => {
    for (const side of ['left', 'right'] as const) for (const p of TWEEN_POST_POSES) expect(TWEEN_POSES).toContain(rigPoseFor(p, side));
  });

  it('point turns toward the text: a mascot on the right points left, one on the left points right', () => {
    expect(rigPoseFor('point', 'right')).toBe('point-left');
    expect(rigPoseFor('point', 'left')).toBe('point-right');
    expect(rigPoseFor('wave', 'right')).toBe('wave');
    expect(rigPoseFor('nonsense', 'left')).toBe('wave');
  });

  it('the bubble stays short', () => {
    expect(Array.from(fitBubble('x'.repeat(80))).length).toBeLessThanOrEqual(30);
  });
});
