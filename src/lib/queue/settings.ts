// Queue settings (PRD v3 S-1, S-4, S-6; change C-24, C-28): one row per brand, read and written as the
// signed-in user so row-level security applies. No row means the defaults.

import { requireBrandMember } from '@/lib/brand/current';
import { getDb, type Tx } from '@/lib/db';
import { QueueError } from './errors';
import { DEFAULT_QUEUE_SETTINGS, QUEUE_CHANNELS, queueSettingsSchema, type QueueSettings } from './types';

interface Row {
  posts_per_week: number;
  days: number[];
  times: Record<string, string> | null;
  auto_approve: Record<string, boolean> | null;
  deliver_email: boolean;
  paused: boolean;
}

/** Only known channels, only valid values: a stored object with strange keys never reaches the app. */
function cleanRecord<V>(raw: unknown, ok: (v: unknown) => v is V): Partial<Record<(typeof QUEUE_CHANNELS)[number], V>> {
  const out: Partial<Record<(typeof QUEUE_CHANNELS)[number], V>> = {};
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const c of QUEUE_CHANNELS) {
      const v = (raw as Record<string, unknown>)[c];
      if (ok(v)) out[c] = v;
    }
  }
  return out;
}

const isTime = (v: unknown): v is string => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
const isBool = (v: unknown): v is boolean => typeof v === 'boolean';

export function fromRow(r: Row | undefined): QueueSettings {
  if (!r) return { ...DEFAULT_QUEUE_SETTINGS, days: [...DEFAULT_QUEUE_SETTINGS.days], times: {}, autoApprove: {} };
  return {
    postsPerWeek: r.posts_per_week,
    days: [...new Set(r.days.map(Number))].sort((a, b) => a - b),
    times: cleanRecord(r.times, isTime),
    autoApprove: cleanRecord(r.auto_approve, isBool),
    deliverEmail: r.deliver_email,
    paused: r.paused,
  };
}

const SELECT = 'select posts_per_week, days::int[] as days, times, auto_approve, deliver_email, paused from public.queue_settings where brand_id = $1';

/** The brand's queue settings (defaults when none were saved). */
export async function getQueueSettings(userId: string, brandId: string): Promise<QueueSettings> {
  await requireBrandMember(userId, brandId);
  const [row] = await getDb().withUser(userId, (tx) => tx.query<Row>(SELECT, [brandId]));
  return fromRow(row);
}

/** The settings of a brand, read inside a transaction the caller already opened (service role, after its own checks). */
export async function readQueueSettings(tx: Tx, brandId: string): Promise<QueueSettings> {
  const [row] = await tx.query<Row>(SELECT, [brandId]);
  return fromRow(row);
}

/**
 * Saves the settings: the given fields are merged over the saved ones, validated, and written. Days are
 * sorted and de-duplicated; times and auto-approve keep only known channels.
 * Throws QueueError('invalid_settings') with a plain sentence.
 */
export async function saveQueueSettings(userId: string, brandId: string, patch: Partial<QueueSettings>): Promise<QueueSettings> {
  const current = await getQueueSettings(userId, brandId);
  const merged = {
    ...current,
    ...patch,
    times: patch.times === undefined ? current.times : { ...patch.times },
    autoApprove: patch.autoApprove === undefined ? current.autoApprove : { ...patch.autoApprove },
  };
  if (Array.isArray(merged.days)) merged.days = [...new Set(merged.days)].sort((a, b) => a - b);
  const parsed = queueSettingsSchema.safeParse(merged);
  if (!parsed.success) throw new QueueError('invalid_settings');
  const v = parsed.data;
  // Unknown channel keys are rejected by the schema's enum record; drop empty values rather than store them.
  const times = Object.fromEntries(Object.entries(v.times).filter(([, t]) => typeof t === 'string'));
  const autoApprove = Object.fromEntries(Object.entries(v.autoApprove).filter(([, on]) => on === true));
  await getDb().withUser(userId, (tx) =>
    tx.query(
      `insert into public.queue_settings (brand_id, posts_per_week, days, times, auto_approve, deliver_email, paused, updated_at)
       values ($1, $2, $3::smallint[], $4::jsonb, $5::jsonb, $6, $7, now())
       on conflict (brand_id) do update set posts_per_week = excluded.posts_per_week, days = excluded.days, times = excluded.times,
         auto_approve = excluded.auto_approve, deliver_email = excluded.deliver_email, paused = excluded.paused, updated_at = now()`,
      [brandId, v.postsPerWeek, v.days, JSON.stringify(times), JSON.stringify(autoApprove), v.deliverEmail, v.paused],
    ),
  );
  return getQueueSettings(userId, brandId);
}
