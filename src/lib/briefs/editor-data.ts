/**
 * Everything the brief editor page needs from the server in one call (PRD v3 B-1 to B-8): the
 * brand's selling points, contact set, photos, the active payment ID (if any) and the starting
 * defaults (blocks from `defaultBlocks`, the brand's language, channels). Runs as the signed-in
 * user. Safe to call on every page view: seeding the USPs and contacts happens once per brand.
 */
import { requireBrandMember } from '@/lib/brand/current';
import { ensureContactsImported, listContacts } from '@/lib/contacts/service';
import type { ContactPoint } from '@/lib/contacts/types';
import { getDb } from '@/lib/db';
import { listPaymentIds } from '@/lib/payments';
import { listPhotos, type PhotoView } from '@/lib/uploads/photos';
import { ensureUspsSeeded, listUsps } from '@/lib/usps/service';
import type { Usp } from '@/lib/usps/types';
import { todayIn } from './dates';
import { defaultChannels } from './editor-state';
import { defaultBlocks } from './service';
import type { Blocks } from './types';

export interface PaymentChoice {
  id: string;
  address: string;
  payeeName: string;
}

export interface EditorData {
  brandId: string;
  brandName: string;
  country: string | null;
  timezone: string;
  /** Today's date (YYYY-MM-DD) in the brand's time zone. */
  today: string;
  usps: Usp[];
  contacts: ContactPoint[];
  photos: PhotoView[];
  hasLogo: boolean;
  /** The brand's confirmed payment ID, or null: a payment QR is offered only when there is one. */
  payment: PaymentChoice | null;
  defaults: { blocks: Blocks; language: string; channels: string[] };
}

export async function loadEditorData(userId: string, brandId: string, opts: { now?: Date } = {}): Promise<EditorData> {
  await requireBrandMember(userId, brandId);
  try {
    await ensureUspsSeeded(userId, brandId);
    await ensureContactsImported(userId, brandId);
  } catch (e) {
    console.error('[create] could not fill the selling points or contacts', e);
  }
  const [m] = await getDb().withUser(userId, (tx) =>
    tx.query<{ name: string; country: string | null; timezone: string | null; post_language: string | null; has_logo: boolean }>(
      `select coalesce(nullif(trim(m.business_name), ''), b.name) as name, m.country, m.timezone, m.post_language, (m.logo_path is not null) as has_logo
         from public.brands b left join public.brand_memory m on m.brand_id = b.id where b.id = $1`,
      [brandId],
    ),
  );
  const timezone = m?.timezone ?? 'UTC';
  const [usps, contacts, photos, payments, blocks] = await Promise.all([
    listUsps(userId, brandId),
    listContacts(userId, brandId),
    listPhotos(userId, brandId),
    listPaymentIds(userId, brandId),
    defaultBlocks(userId, brandId),
  ]);
  const active = payments.find((p) => p.status === 'active');
  return {
    brandId,
    brandName: m?.name ?? '',
    country: m?.country ?? null,
    timezone,
    today: todayIn(opts.now ?? new Date(), timezone),
    usps,
    contacts,
    photos,
    hasLogo: m?.has_logo === true,
    payment: active ? { id: active.id, address: active.address, payeeName: active.payeeName } : null,
    defaults: { blocks, language: m?.post_language ?? 'en', channels: defaultChannels(contacts) },
  };
}
