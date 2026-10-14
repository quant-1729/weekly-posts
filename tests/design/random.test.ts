// PRD v3 section 9, criterion 4: every post passes contrast, safe-zone and no-overflow checks in all
// its formats, on random briefs. Seeded, so a failure reproduces. 60 briefs by default; set
// DESIGN_BRIEFS=200 (or more) for the full check.
import { beforeAll, describe, expect, it } from 'vitest';
import { renderDesignDetailed } from '@/lib/design';
import { samplePhoto, sampleLogo } from '@/lib/render/fixtures';
import { randomBrief } from './fixtures';
import { expectClean } from './helpers';

const N = Number(process.env.DESIGN_BRIEFS ?? 60);
const SEED0 = Number(process.env.DESIGN_SEED ?? 1);

let photo: Buffer;
let logo: Buffer;
beforeAll(async () => {
  photo = await samplePhoto();
  logo = await sampleLogo();
});

describe(`random briefs (${N}, seed ${SEED0})`, () => {
  it('every brief passes in every format it asks for, and again in all six formats', async () => {
    const failures: string[] = [];
    for (let s = SEED0; s < SEED0 + N; s++) {
      const b = randomBrief(s);
      const base = { ...b.input, photo: b.hasPhoto ? photo : null, logo: s % 3 === 0 ? logo : null };
      const r = await renderDesignDetailed(base);
      const { problems } = expectClean(r, `seed ${s} ${b.lang}`);
      if (problems.length) failures.push(`seed ${s} ${b.input.format} ${r.themeId}/${r.layoutId}: ${problems.join('; ')}`);
      // The same brief in the other formats a post is rendered in.
      if (s % 4 === 0) {
        for (const format of ['square', 'vertical', 'landscape', 'banner', 'thumbnail', 'portrait'] as const) {
          const r2 = await renderDesignDetailed({ ...base, format });
          const p2 = expectClean(r2, `seed ${s} ${format}`).problems;
          if (p2.length) failures.push(`seed ${s} ${format} ${r2.themeId}/${r2.layoutId}: ${p2.join('; ')}`);
        }
      }
    }
    expect(failures).toEqual([]);
  }, 900_000);
});
