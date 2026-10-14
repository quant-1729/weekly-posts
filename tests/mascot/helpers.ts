import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import type { MockDb } from '@/lib/db/mock';
import { setMascotInPosts } from '@/lib/mascot/service';
import type { Storage } from '@/lib/storage';
import { seedWeeklyBrand, type WeeklyBrandOpts } from '../weekly/helpers';

/** A scarf colour that does not appear in any brand palette, so tests can find Tween by colour. */
export const GREEN = '#12ab34';

/** Pixels of the exact colour in a PNG (the scarf band is drawn in the scarf colour with no blending). */
export async function colorPixels(png: Buffer, hex: string = GREEN): Promise<number> {
  const h = hex.replace('#', '');
  const want = [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let n = 0;
  for (let i = 0; i < data.length; i += info.channels) {
    if (data[i] === want[0] && data[i + 1] === want[1] && data[i + 2] === want[2]) n++;
  }
  return n;
}

/** Inserts an active mascot row directly (no files). Returns its id. `spec` defaults to a Tween with the green scarf. */
export async function insertActiveMascot(db: MockDb, brandId: string, opts: { spec?: unknown; name?: string } = {}): Promise<string> {
  const id = randomUUID();
  const spec = opts.spec === undefined ? { v: 2, base: 'tween', scarf: GREEN } : opts.spec;
  await db.withAdmin((tx) =>
    tx.query(`insert into public.mascots (id, brand_id, status, name, concept, spec) values ($1, $2, 'active', $3, '{}'::jsonb, $4::jsonb)`, [
      id,
      brandId,
      opts.name ?? 'Pip',
      JSON.stringify(spec),
    ]),
  );
  return id;
}

/** A weekly brand (finished setup, photos) that has an active Tween with the green scarf and "use the mascot in posts" switched on. */
export async function seedMascotBrand(db: MockDb, storage: Storage, opts: WeeklyBrandOpts = {}) {
  const base = await seedWeeklyBrand(db, { photos: 2, storage, ...opts });
  const mascotId = await insertActiveMascot(db, base.brandId);
  await db.withAdmin((tx) => tx.query('update public.brand_memory set mascot_in_posts = true where brand_id = $1', [base.brandId]));
  return { ...base, mascotId };
}

export { setMascotInPosts };
