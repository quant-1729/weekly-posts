import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import type { MascotConcepts, MascotSpec } from '@/lib/ai/schemas';
import type { MockDb } from '@/lib/db/mock';
import { FIXTURE_CONCEPTS } from '@/lib/mascot/fixtures';
import { mascotPalette } from '@/lib/mascot/rig';
import { generateMascotConcepts, pickMascot, setMascotInPosts } from '@/lib/mascot/service';
import type { Storage } from '@/lib/storage';
import { seedWeeklyBrand, type WeeklyBrandOpts } from '../weekly/helpers';

export type Concept = MascotConcepts['concepts'][number];

/** A concept with a valid spec and the given name (everything else from the first fixture concept). */
export const concept = (name: string, over: Partial<Concept> = {}): Concept => ({ ...FIXTURE_CONCEPTS.concepts[0], name, name_local: name, ...over });

export const answer = (...concepts: Concept[]): MascotConcepts => ({ refused: false, refusal_reason: '', concepts });

/** A spec whose body colour does not appear in any brand palette, so tests can find the mascot by colour. */
export const GREEN_SPEC: MascotSpec = {
  body: { shape: 'round', color: '#12AB34', pattern: 'none', pattern_color: '#FFFFFF' },
  face: { eyes: 'shine', brows: true, cheeks: false, mustache: 'none' },
  limbs: { style: 'mitten', color: '#1B1B1B' },
  head: 'chef_hat',
  neck: 'none',
  extra: 'none',
  accent_color: '#B5121B',
};

/** Pixels of the exact body colour in a PNG. */
export async function bodyPixels(png: Buffer, spec: MascotSpec = GREEN_SPEC): Promise<number> {
  const hex = mascotPalette(spec).body.replace('#', '');
  const want = [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let n = 0;
  for (let i = 0; i < data.length; i += info.channels) {
    if (data[i] === want[0] && data[i + 1] === want[1] && data[i + 2] === want[2]) n++;
  }
  return n;
}

/** Inserts an active mascot row directly (no AI, no files). Returns its id. */
export async function insertActiveMascot(db: MockDb, brandId: string, spec: MascotSpec = GREEN_SPEC, name = 'Pip'): Promise<string> {
  const id = randomUUID();
  await db.withAdmin((tx) =>
    tx.query(
      `insert into public.mascots (id, brand_id, status, name, concept, spec) values ($1, $2, 'active', $3, $4::jsonb, $5::jsonb)`,
      [id, brandId, name, JSON.stringify({ name, name_local: name, personality: 'Cheerful and kind.', why_it_fits: 'It fits.' }), JSON.stringify(spec)],
    ),
  );
  return id;
}

/** A weekly brand (finished setup, photos) that has an active mascot and "use my mascot in posts" switched on. */
export async function seedMascotBrand(db: MockDb, storage: Storage, opts: WeeklyBrandOpts = {}) {
  const base = await seedWeeklyBrand(db, { photos: 2, storage, ...opts });
  const mascotId = await insertActiveMascot(db, base.brandId);
  await db.withAdmin((tx) => tx.query('update public.brand_memory set mascot_in_posts = true where brand_id = $1', [base.brandId]));
  return { ...base, mascotId };
}

/** Makes concepts and picks the first one, through the real service. */
export async function makeAndPick(db: MockDb, args: { userId: string; brandId: string; storage: Storage; pickIndex?: number; fixture?: () => MascotConcepts }) {
  const res = await generateMascotConcepts({ userId: args.userId, brandId: args.brandId }, { fixture: args.fixture });
  const picked = await pickMascot({ userId: args.userId, brandId: args.brandId, mascotId: res.concepts[args.pickIndex ?? 0].id, storage: args.storage });
  return { res, picked };
}

export { setMascotInPosts };
