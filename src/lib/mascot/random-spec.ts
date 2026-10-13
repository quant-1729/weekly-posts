// Seeded random valid specs over the whole parts catalogue. For tests and the
// visual review script only; the app never draws a random mascot.

import { RIG } from '@/lib/ai/prompts/mascot';
import type { MascotSpec } from '@/lib/ai/schemas';
import { hasExcludedCombination } from './concepts';

/** Small deterministic PRNG (mulberry32): same seed, same sequence. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T,>(rng: () => number, list: readonly T[]): T => list[Math.floor(rng() * list.length)];

const NICE = ['#E4572E', '#F2A93B', '#1B998B', '#3A86FF', '#8338EC', '#C8283A', '#2A9D8F', '#F7931E', '#6A994E', '#FF6B9A', '#264653', '#1D3557'];
const DARKS = ['#3A2A1A', '#2B2D42', '#4A2511', '#1F3B2E'];

function hex(rng: () => number): string {
  return '#' + Math.floor(rng() * 0xffffff).toString(16).padStart(6, '0');
}

/** `wild` uses any hex colour (to stress the contrast checks); otherwise a friendly palette. */
export function randomSpec(rng: () => number, opts: { wild?: boolean } = {}): MascotSpec {
  const color = () => (opts.wild ? hex(rng) : pick(rng, NICE));
  for (;;) {
    const spec: MascotSpec = {
      body: {
        shape: pick(rng, RIG.shape),
        color: color(),
        pattern: pick(rng, RIG.pattern),
        pattern_color: color(),
      },
      face: {
        eyes: pick(rng, RIG.eyes),
        brows: rng() < 0.7,
        cheeks: rng() < 0.7,
        mustache: pick(rng, RIG.mustache),
      },
      limbs: { style: pick(rng, RIG.limbs), color: opts.wild ? hex(rng) : pick(rng, DARKS) },
      head: pick(rng, RIG.head),
      neck: pick(rng, RIG.neck),
      extra: pick(rng, RIG.extra),
      accent_color: color(),
    };
    if (!hasExcludedCombination(spec)) return spec;
  }
}
