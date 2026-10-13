import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { findRepeats } from '@/lib/guardrail/repetition';
import { factsOf } from './helpers';

interface Case {
  id: string;
  brand_id: string;
  history: Array<{ week_start: string; caption: string }>;
  candidate: string;
  week_start: string;
  repeats: boolean;
  repeated_phrase: string;
}
const cases: Case[] = JSON.parse(readFileSync('test-data/v2/guardrail/repetition.json', 'utf8'));
const norm = (s: string) => s.normalize('NFC').toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ').trim();

describe('repetition.json (AC 13)', () => {
  it('has the 20 cases', () => expect(cases).toHaveLength(20));

  it.each(cases.map((c) => [c.id, c] as const))('%s', (_id, c) => {
    const found = findRepeats({
      candidate: c.candidate,
      history: c.history.map((h) => ({ caption: h.caption, weekStart: h.week_start })),
      batchOthers: [],
      facts: factsOf(c.brand_id),
      weekStart: c.week_start,
    });
    expect(found.length > 0).toBe(c.repeats);
    if (c.repeats) {
      // The phrase the data names is inside what we report, in the candidate's own words.
      const reported = found.map(norm).join(' | ');
      expect(reported).toContain(norm(c.repeated_phrase));
      for (const f of found) expect(c.candidate.normalize('NFC')).toContain(f);
    }
  });

  it('scores 20 of 20', () => {
    const ok = cases.filter((c) => {
      const found = findRepeats({
        candidate: c.candidate,
        history: c.history.map((h) => ({ caption: h.caption, weekStart: h.week_start })),
        batchOthers: [],
        facts: factsOf(c.brand_id),
        weekStart: c.week_start,
      });
      return found.length > 0 === c.repeats;
    });
    expect(ok).toHaveLength(20);
  });
});

describe('findRepeats', () => {
  const none = { history: [], batchOthers: [], facts: [] };

  it('catches a repeat from another post of the same batch', () => {
    const found = findRepeats({
      ...none,
      candidate: 'We bake every loaf by hand on site, so come early.',
      batchOthers: ['Sourdough is great because we bake every loaf by hand on site daily.'],
    });
    expect(found).toEqual(['We bake every loaf by hand on site']);
  });

  it('needs 6 words: five in a row is fine', () => {
    expect(
      findRepeats({ ...none, candidate: 'fresh cinnamon buns come out of the oven warm', history: [{ caption: 'Fresh croissants come out of the oven at seven' }] }),
    ).toEqual([]);
  });

  it('ignores history older than 28 days when dates are given, keeps 28 days exactly', () => {
    const caption = 'every bike gets a full check of brakes and gears';
    const candidate = 'every bike gets a full check of brakes today';
    expect(findRepeats({ ...none, candidate, history: [{ caption, weekStart: '2026-09-21' }], weekStart: '2026-10-19' })).not.toEqual([]);
    expect(findRepeats({ ...none, candidate, history: [{ caption, weekStart: '2026-09-20' }], weekStart: '2026-10-19' })).toEqual([]);
  });

  it('removes fact values before comparing, case-insensitively', () => {
    const facts = [{ value: 'Suite 410, 120 Wellesley Street, Toronto, ON M4Y 1J4' }];
    expect(
      findRepeats({
        candidate: 'Find us at SUITE 410, 120 wellesley street, toronto, on m4y 1j4.',
        history: [{ caption: 'Visit us at Suite 410, 120 Wellesley Street, Toronto, ON M4Y 1J4 this week' }],
        batchOthers: [],
        facts,
      }),
    ).toEqual([]);
  });

  it('keeps Devanagari vowel signs and virama inside words', () => {
    const found = findRepeats({
      ...none,
      candidate: 'हम हर ग्राहक की पसंद को ध्यान से सुनते हैं।',
      history: [{ caption: 'वे हर ग्राहक की पसंद को ध्यान से सुनते हैं और काम करते हैं' }],
    });
    expect(found).toEqual(['हर ग्राहक की पसंद को ध्यान से सुनते हैं']);
  });

  it('is not fooled by NFC vs NFD', () => {
    const nfd = 'café au lait served every single day at the corner'.normalize('NFD');
    const found = findRepeats({ ...none, candidate: 'café au lait served every single day', history: [{ caption: nfd }] });
    expect(found).toHaveLength(1);
  });

  it('returns nothing when there is no history', () => {
    expect(findRepeats({ ...none, candidate: 'one two three four five six seven' })).toEqual([]);
  });
});
