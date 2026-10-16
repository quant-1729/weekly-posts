// The brand as the post pipeline needs it: name, language, voice, contacts, regulated group, the
// brand face (Brand Face; Tween is the mascot kind) and the brand's active facts. Runs as the signed-in user (row-level security).

import { BrandAccessError, requireBrandMember } from '@/lib/brand/current';
import { listContacts } from '@/lib/contacts/service';
import { getDb } from '@/lib/db';
import { readActiveFace } from '@/lib/faces/active';
import { loadGuardrailContext } from '@/lib/guardrail';
import type { CreateBrand } from './types';

export async function loadCreateBrand(userId: string, brandId: string): Promise<CreateBrand> {
  await requireBrandMember(userId, brandId);
  const [m] = await getDb().withUser(userId, (tx) =>
    tx.query<{
      name: string;
      category: string | null;
      country: string | null;
      timezone: string | null;
      post_language: string | null;
      tone: string | null;
      voice_description: string | null;
      logo_path: string | null;
    }>(
      `select coalesce(nullif(trim(m.business_name), ''), b.name) as name, m.category, m.country, m.timezone, m.post_language, m.tone,
              m.voice_description, m.logo_path
         from public.brands b left join public.brand_memory m on m.brand_id = b.id where b.id = $1`,
      [brandId],
    ),
  );
  if (!m) throw new BrandAccessError();
  const [contacts, ctx] = await Promise.all([listContacts(userId, brandId), loadGuardrailContext(brandId, userId)]);
  // The brand's face in posts (Brand Face): the active face when it is on, else null; Tween is the mascot kind.
  const face = await getDb().withUser(userId, (tx) => readActiveFace(tx, brandId, ctx.regulated));
  return {
    id: brandId,
    name: m.name,
    sells: m.category ?? '',
    country: m.country,
    timezone: m.timezone ?? 'UTC',
    language: m.post_language ?? 'en',
    voice: (m.voice_description ?? '').trim() || (m.tone ?? '').trim(),
    wordsToAvoid: ctx.wordsToAvoid,
    regulated: ctx.regulated,
    contacts,
    hasLogo: !!m.logo_path,
    logoPath: m.logo_path,
    face,
    mascotOn: face?.kind === 'mascot',
    facts: ctx.facts,
  };
}
