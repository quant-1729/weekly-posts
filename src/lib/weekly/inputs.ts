// Everything one weekly generation reads (service role): brand memory, photos, owner dates,
// recent captions, what performed, the owner's voice feedback. The facts, regulated group and
// words to avoid come from the guardrail's own loader so generation and checking agree.

import type { WeeklyFact, WeeklyOccasion, WeeklyPhoto } from '@/lib/ai/prompts/v2-weekly';
import { getDb } from '@/lib/db';
import { loadGuardrailContext, type RegulatedKind } from '@/lib/guardrail';
import { loadUsableMascot, type PostMascot } from '@/lib/mascot/posts';
import { addDaysIso } from '@/lib/occasions/dates';
import { getOccasions } from '@/lib/occasions';

export const MAX_PROMPT_PHOTOS = 20;
export const RECENT_DAYS = 28;

export interface PhotoRow {
  id: string;
  storagePath: string;
  description: string;
}

export interface WeekInputs {
  brand: {
    name: string;
    whatTheySell: string;
    customers: string;
    city: string;
    region: string;
    country: string;
    timezone: string;
    goal: 'enquiries' | 'footfall' | 'awareness';
    postLanguage: string;
    colors: { primary?: string; secondary?: string; accent?: string };
    logoPath: string | null;
  };
  voice: { description: string; examplePhrases: string[]; wordsToAvoid: string[]; feedback: string[] };
  facts: WeeklyFact[];
  regulated: RegulatedKind;
  /** Usable photos, newest first. Prompt id p{n} is index n-1. */
  photos: PhotoRow[];
  promptPhotos: WeeklyPhoto[];
  occasions: WeeklyOccasion[];
  recentPosts: string[];
  performance: string[];
  /** A member of the brand to act as in the guardrail (owner first). */
  ownerUserId: string;
  /** The brand's active mascot, only when "use my mascot in posts" is on (V-25) and the brand may have one. */
  mascot: PostMascot | null;
}

interface MemoryRow {
  business_name: string | null;
  brand_name: string;
  category: string | null;
  audience: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  timezone: string;
  goal: 'enquiries' | 'footfall' | 'awareness';
  post_language: string;
  tone: string | null;
  voice_description: string | null;
  example_phrases: string[] | null;
  colors: { primary?: string; secondary?: string; accent?: string } | null;
  logo_path: string | null;
  mascot_in_posts: boolean;
}

export async function loadWeekInputs(brandId: string, weekStart: string, now: Date): Promise<WeekInputs> {
  const ctx = await loadGuardrailContext(brandId);
  const since = new Date(now.getTime() - RECENT_DAYS * 86_400_000).toISOString();
  const data = await getDb().withService(async (tx) => {
    const [mem] = await tx.query<MemoryRow>(
      `select m.business_name, b.name as brand_name, m.category, m.audience, m.city, m.region, m.country, m.timezone,
              m.goal::text as goal, m.post_language, m.tone, m.voice_description, m.example_phrases, m.colors, m.logo_path, m.mascot_in_posts
         from public.brand_memory m join public.brands b on b.id = m.brand_id
        where m.brand_id = $1`,
      [brandId],
    );
    if (!mem) throw new Error('Brand not found');
    const photos = await tx.query<{ id: string; storage_path: string; description: string | null }>(
      `select id::text as id, storage_path, description from public.photos
        where brand_id = $1 and kind = 'photo' and storage_path is not null and usable is not false
        order by created_at desc, id desc limit ${MAX_PROMPT_PHOTOS}`,
      [brandId],
    );
    const ownerDates = await tx.query<{ date: string; name: string; yearly: boolean }>(
      `select to_char(date, 'YYYY-MM-DD') as date, name, yearly from public.owner_dates where brand_id = $1 order by date, created_at`,
      [brandId],
    );
    const recent = await tx.query<{ caption: string }>(
      `select p.caption from public.posts p
         join public.weekly_batches b on b.id = p.batch_id and b.brand_id = p.brand_id
        where p.brand_id = $1 and p.caption is not null and p.status <> 'skipped'
          and b.week_start >= $2::date and b.week_start < $3::date
        order by b.week_start desc, p.suggested_day desc limit 30`,
      [brandId, addDaysIso(weekStart, -RECENT_DAYS), weekStart],
    );
    const perf = await tx.query<{ topic: string; channel: string; n: number }>(
      `select coalesce(nullif(p.original->>'topic', ''), left(p.caption, 40)) as topic, p.channel::text as channel, count(c.id)::int as n
         from public.posts p join public.clicks c on c.post_id = p.id and c.brand_id = p.brand_id
        where p.brand_id = $1 and p.batch_id is not null and c.clicked_at >= $2::timestamptz
        group by p.id order by n desc, p.id limit 5`,
      [brandId, since],
    );
    const feedback = await tx.query<{ instruction: string }>(
      'select instruction from public.voice_feedback where brand_id = $1 order by created_at desc, id desc limit 5',
      [brandId],
    );
    const [owner] = await tx.query<{ user_id: string }>(
      `select user_id::text as user_id from public.brand_members where brand_id = $1
        order by (role = 'owner') desc, created_at asc limit 1`,
      [brandId],
    );
    return { mem, photos, ownerDates, recent, perf, feedback, owner };
  });
  if (!data.owner) throw new Error('Brand has no members');

  const m = data.mem;
  const country = (m.country ?? '').trim();
  let occasions: WeeklyOccasion[] = [];
  try {
    occasions = getOccasions({
      country,
      region: m.region,
      weekStart,
      timezone: m.timezone,
      ownerDates: data.ownerDates,
      category: ctx.regulated !== 'none' ? ctx.regulated : m.category,
    });
  } catch (e) {
    console.warn(`[weekly] occasions failed for ${brandId}: ${e instanceof Error ? e.message : String(e)}`);
  }

  const mascot = m.mascot_in_posts ? await loadUsableMascot(brandId) : null;
  const photos: PhotoRow[] = data.photos.map((p) => ({ id: p.id, storagePath: p.storage_path, description: (p.description ?? '').trim() }));
  return {
    brand: {
      name: (m.business_name ?? '').trim() || m.brand_name,
      whatTheySell: m.category ?? '',
      customers: m.audience ?? '',
      city: m.city ?? '',
      region: m.region ?? '',
      country,
      timezone: m.timezone,
      goal: m.goal,
      postLanguage: m.post_language,
      colors: m.colors ?? {},
      logoPath: m.logo_path,
    },
    voice: {
      description: (m.voice_description ?? '').trim() || (m.tone ?? '').trim(),
      examplePhrases: m.example_phrases ?? [],
      wordsToAvoid: ctx.wordsToAvoid,
      feedback: data.feedback.map((f) => f.instruction),
    },
    facts: ctx.facts,
    regulated: ctx.regulated,
    photos,
    promptPhotos: photos.map((p, i) => ({ id: `p${i + 1}`, description: p.description || 'a photo' })),
    occasions,
    recentPosts: data.recent.map((r) => r.caption),
    performance: data.perf.map((p) => `${p.topic} (${p.channel}): ${p.n} click${p.n === 1 ? '' : 's'}`),
    ownerUserId: data.owner.user_id,
    mascot,
  };
}
