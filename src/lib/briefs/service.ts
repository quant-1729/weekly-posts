/**
 * Post briefs (PRD v3 B-1 to B-8, changes C-06 and C-11): create, update, get and list.
 *
 * Runs as the signed-in user (row-level security) after a membership check. On save:
 * - the chosen USPs are frozen into `usp_snapshot` (primary first, then up to 2 secondary), so a
 *   later edit of the library does not change a made post. A USP already in the brief keeps its
 *   frozen copy on later saves; a newly chosen one is frozen from the library; pass
 *   `refreshUsps: true` to re-freeze all of them from the library;
 * - `qr` is checked with `qrSpecSchema`; a payment QR must name an ACTIVE payment ID of the same
 *   brand (the payment flow itself is elsewhere), and a link QR must be a public https URL;
 * - `blocks` default from the brand's default contact points when not given on create;
 * - the time zone is the brand's, and the end date must not be before today there (checked on
 *   create and whenever the end date changes);
 * - status "ready" needs a complete brief (`checkCompleteness`).
 */
import { requireBrandMember } from '@/lib/brand/current';
import { normalizeUrl } from '@/lib/contacts/normalize';
import { getDb, type Tx } from '@/lib/db';
import { checkCompleteness } from './completeness';
import { checkDateRange } from './dates';
import { BriefIncompleteError, BriefNotFoundError, BriefValidationError } from './errors';
import {
  BLOCK_KEYS,
  CTA_KINDS,
  POST_TYPES,
  qrSpecSchema,
  type Blocks,
  type Brief,
  type CtaKind,
  type PostType,
  type QrSpec,
  type UspSnapshot,
} from './types';
import type { UspKind } from '@/lib/usps/types';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BCP47_RE = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;
export const BRIEF_CHANNELS = ['instagram', 'facebook', 'whatsapp', 'youtube', 'linkedin', 'gbp'] as const;
export const NOTES_MAX = 2000;

/** What a caller may set. On update, a key that is absent keeps its current value. */
export interface BriefInput {
  postType?: PostType;
  primaryUspId?: string | null;
  secondaryUspIds?: string[];
  cta?: CtaKind | null;
  blocks?: Blocks;
  qr?: unknown;
  photoId?: string | null;
  language?: string | null;
  startsOn?: string | null;
  endsOn?: string | null;
  /** The offer runs with no end date. True clears `endsOn`; setting an `endsOn` clears it again. */
  openEnded?: boolean;
  channels?: string[];
  notes?: string | null;
  status?: 'draft' | 'ready';
}

export interface SaveOptions {
  /** For tests: the clock. */
  now?: Date;
  /** Re-freeze every chosen USP from the library instead of keeping the frozen copies. */
  refreshUsps?: boolean;
}

interface Row {
  id: string;
  brand_id: string;
  post_type: PostType;
  primary_usp_id: string | null;
  secondary_usp_ids: string[];
  usp_snapshot: UspSnapshot[];
  cta: CtaKind | null;
  blocks: Blocks;
  qr: QrSpec | null;
  photo_id: string | null;
  language: string | null;
  starts_on: string | null;
  ends_on: string | null;
  open_ended: boolean;
  timezone: string | null;
  channels: string[];
  notes: string | null;
  status: 'draft' | 'ready';
}

const COLUMNS = `id, brand_id, post_type::text as post_type, primary_usp_id, secondary_usp_ids, usp_snapshot, cta::text as cta, blocks, qr,
  photo_id, language, to_char(starts_on, 'YYYY-MM-DD') as starts_on, to_char(ends_on, 'YYYY-MM-DD') as ends_on, open_ended, timezone,
  channels::text[] as channels, notes, status`;

function toBrief(r: Row): Brief {
  return {
    id: r.id,
    brandId: r.brand_id,
    postType: r.post_type,
    primaryUspId: r.primary_usp_id,
    secondaryUspIds: r.secondary_usp_ids ?? [],
    uspSnapshot: r.usp_snapshot ?? [],
    cta: r.cta,
    blocks: r.blocks ?? {},
    qr: r.qr,
    photoId: r.photo_id,
    language: r.language,
    startsOn: r.starts_on,
    endsOn: r.ends_on,
    openEnded: r.open_ended === true,
    timezone: r.timezone,
    channels: r.channels ?? [],
    notes: r.notes,
    status: r.status,
  };
}

interface BrandContext {
  timezone: string;
  postLanguage: string;
  hasLogo: boolean;
}

async function brandContext(tx: Tx, brandId: string): Promise<BrandContext> {
  const [m] = await tx.query<{ timezone: string; post_language: string; logo_path: string | null }>(
    'select timezone, post_language, logo_path from public.brand_memory where brand_id = $1',
    [brandId],
  );
  return { timezone: m?.timezone ?? 'UTC', postLanguage: m?.post_language ?? 'en', hasLogo: !!m?.logo_path };
}

const CONTACT_BLOCKS = ['phone', 'whatsapp', 'website', 'email', 'address', 'hours', 'instagram', 'youtube', 'facebook'] as const;

async function defaultBlocksIn(tx: Tx, brandId: string, ctx: BrandContext, hasDates: boolean): Promise<Blocks> {
  const rows = await tx.query<{ kind: string }>('select distinct kind from public.contact_points where brand_id = $1 and is_default', [brandId]);
  const kinds = new Set(rows.map((r) => r.kind));
  const blocks: Blocks = {};
  if (ctx.hasLogo) blocks.logo = true;
  for (const k of CONTACT_BLOCKS) if (kinds.has(k)) blocks[k] = true;
  if (hasDates) blocks.dates = true;
  return blocks;
}

/** The blocks a new brief starts with: the logo if there is one, a block for each kind of default contact, and dates if given. */
export async function defaultBlocks(userId: string, brandId: string, opts: { hasDates?: boolean } = {}): Promise<Blocks> {
  await requireBrandMember(userId, brandId);
  return getDb().withUser(userId, async (tx) => defaultBlocksIn(tx, brandId, await brandContext(tx, brandId), opts.hasDates === true));
}

function cleanBlocks(raw: unknown): Blocks | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out: Blocks = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!(BLOCK_KEYS as readonly string[]).includes(k) || typeof v !== 'boolean') return null;
    out[k as keyof Blocks] = v;
  }
  return out;
}

async function loadUsps(tx: Tx, brandId: string, ids: string[]) {
  if (ids.length === 0) return new Map<string, { id: string; kind: UspKind; title: string; details: Record<string, unknown>; active: boolean; confirmed: boolean }>();
  const rows = await tx.query<{ id: string; kind: UspKind; title: string; details: Record<string, unknown>; active: boolean; confirmed: boolean }>(
    'select id, kind::text as kind, title, details, active, confirmed from public.usps where brand_id = $1 and id = any($2::uuid[])',
    [brandId, ids],
  );
  return new Map(rows.map((r) => [r.id, r]));
}

async function save(
  userId: string,
  brandId: string,
  existingId: string | null,
  input: BriefInput | unknown,
  opts: SaveOptions,
): Promise<Brief> {
  await requireBrandMember(userId, brandId);
  if (existingId !== null && !UUID_RE.test(String(existingId))) throw new BriefNotFoundError();
  const inp = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const now = opts.now ?? new Date();

  return getDb().withUser(userId, async (tx) => {
    let cur: Brief | null = null;
    if (existingId !== null) {
      const [row] = await tx.query<Row>(`select ${COLUMNS} from public.post_briefs where id = $1 and brand_id = $2 for update`, [existingId, brandId]);
      if (!row) throw new BriefNotFoundError();
      cur = toBrief(row);
    }
    const ctx = await brandContext(tx, brandId);
    const errors: Record<string, string> = {};
    const has = (k: string) => inp[k] !== undefined;

    // Post type
    const postType = (has('postType') ? inp.postType : cur?.postType) as PostType | undefined;
    if (!postType || !(POST_TYPES as readonly string[]).includes(postType)) errors.postType = 'invalid';

    // CTA
    let cta: CtaKind | null = cur?.cta ?? null;
    if (has('cta')) {
      if (inp.cta === null) cta = null;
      else if (typeof inp.cta === 'string' && (CTA_KINDS as readonly string[]).includes(inp.cta)) cta = inp.cta as CtaKind;
      else errors.cta = 'invalid';
    }

    // USPs
    let primaryUspId: string | null = cur?.primaryUspId ?? null;
    let secondaryUspIds: string[] = cur?.secondaryUspIds ?? [];
    if (has('primaryUspId')) {
      if (inp.primaryUspId === null) primaryUspId = null;
      else if (typeof inp.primaryUspId === 'string' && UUID_RE.test(inp.primaryUspId)) primaryUspId = inp.primaryUspId;
      else errors.primaryUspId = 'usp_unknown';
    }
    if (has('secondaryUspIds')) {
      const v = inp.secondaryUspIds;
      if (Array.isArray(v) && v.every((x) => typeof x === 'string' && UUID_RE.test(x))) secondaryUspIds = v as string[];
      else errors.secondaryUspIds = 'usp_unknown';
    }
    if (!errors.primaryUspId && !errors.secondaryUspIds) {
      if (secondaryUspIds.length > 2) errors.secondaryUspIds = 'too_many_secondary';
      else if (!primaryUspId && secondaryUspIds.length > 0) errors.secondaryUspIds = 'usp_secondary_without_primary';
      else if (new Set([...(primaryUspId ? [primaryUspId] : []), ...secondaryUspIds]).size !== (primaryUspId ? 1 : 0) + secondaryUspIds.length) {
        errors.secondaryUspIds = 'usp_duplicate';
      }
    }
    let uspSnapshot: UspSnapshot[] = cur?.uspSnapshot ?? [];
    if (!errors.primaryUspId && !errors.secondaryUspIds) {
      const ordered = [...(primaryUspId ? [{ id: primaryUspId, role: 'primary' as const }] : []), ...secondaryUspIds.map((id) => ({ id, role: 'secondary' as const }))];
      const frozen = new Map((cur?.uspSnapshot ?? []).map((u) => [u.uspId, u]));
      // Load every chosen USP: new ones are frozen from the library; kept ones keep their frozen
      // wording but take the owner's latest confirmation (confirming doesn't change the claim).
      const library = await loadUsps(tx, brandId, ordered.map((o) => o.id));
      const snap: UspSnapshot[] = [];
      for (const o of ordered) {
        const keep = opts.refreshUsps ? undefined : frozen.get(o.id);
        if (keep) {
          snap.push({ ...keep, confirmed: library.get(o.id)?.confirmed ?? keep.confirmed ?? false, role: o.role });
          continue;
        }
        const u = library.get(o.id);
        if (!u || !u.active) {
          errors[o.role === 'primary' ? 'primaryUspId' : 'secondaryUspIds'] = 'usp_unknown';
          break;
        }
        snap.push({ uspId: u.id, kind: u.kind, title: u.title, details: u.details, confirmed: u.confirmed, role: o.role });
      }
      uspSnapshot = snap;
    }

    // Blocks
    let blocks: Blocks | null = cur?.blocks ?? null;
    if (has('blocks')) {
      blocks = cleanBlocks(inp.blocks);
      if (!blocks) errors.blocks = 'invalid_blocks';
    }

    // QR
    let qr: QrSpec | null = cur?.qr ?? null;
    if (has('qr')) {
      if (inp.qr === null) qr = null;
      else {
        const parsed = qrSpecSchema.safeParse(inp.qr);
        if (!parsed.success) errors.qr = 'invalid_qr';
        else if (parsed.data.kind === 'link') {
          const u = normalizeUrl(parsed.data.url);
          if (!u.ok) errors.qr = 'invalid_url';
          else qr = { ...parsed.data, url: u.url };
        } else {
          const [pay] = await tx.query<{ id: string }>(
            "select id from public.payment_ids where id = $1 and brand_id = $2 and status = 'active'",
            [parsed.data.paymentId, brandId],
          );
          if (!pay) errors.qr = 'payment_not_active';
          else qr = parsed.data;
        }
      }
    }

    // Photo
    let photoId: string | null = cur?.photoId ?? null;
    if (has('photoId')) {
      if (inp.photoId === null) photoId = null;
      else if (typeof inp.photoId === 'string' && UUID_RE.test(inp.photoId)) {
        const [p] = await tx.query<{ id: string }>("select id from public.photos where id = $1 and brand_id = $2 and kind = 'photo'", [inp.photoId, brandId]);
        if (!p) errors.photoId = 'photo_unknown';
        else photoId = inp.photoId;
      } else errors.photoId = 'photo_unknown';
    }

    // Language (default from the profile on create)
    let language: string | null = cur ? cur.language : ctx.postLanguage;
    if (has('language')) {
      if (inp.language === null || inp.language === '') language = null;
      else if (typeof inp.language === 'string' && BCP47_RE.test(inp.language.trim())) language = inp.language.trim();
      else errors.language = 'invalid_language';
    }

    // Dates
    let startsOn = cur?.startsOn ?? null;
    let endsOn = cur?.endsOn ?? null;
    if (has('startsOn')) startsOn = inp.startsOn === null || inp.startsOn === '' ? null : (inp.startsOn as string);
    if (has('endsOn')) endsOn = inp.endsOn === null || inp.endsOn === '' ? null : (inp.endsOn as string);
    // "No end date": chosen on purpose, so it can't be mixed with an end date.
    let openEnded = cur?.openEnded ?? false;
    if (has('openEnded')) {
      if (typeof inp.openEnded === 'boolean') openEnded = inp.openEnded;
      else errors.openEnded = 'invalid';
    } else if (has('endsOn') && endsOn) openEnded = false;
    if (openEnded) endsOn = null;
    const dateError = checkDateRange(
      { startsOn: typeof startsOn === 'string' || startsOn === null ? startsOn : 'x', endsOn: typeof endsOn === 'string' || endsOn === null ? endsOn : 'x' },
      { timezone: ctx.timezone, now, requireEndNotPast: cur === null || endsOn !== cur.endsOn },
    );
    if (dateError) errors[dateError === 'dates_order' ? 'startsOn' : dateError === 'end_in_past' ? 'endsOn' : has('endsOn') ? 'endsOn' : 'startsOn'] = dateError;

    // Channels
    let channels: string[] = cur?.channels ?? [];
    if (has('channels')) {
      const v = inp.channels;
      if (Array.isArray(v) && v.every((c) => (BRIEF_CHANNELS as readonly string[]).includes(c as string))) channels = [...new Set(v as string[])];
      else errors.channels = 'invalid_channel';
    }

    // Notes
    let notes: string | null = cur?.notes ?? null;
    if (has('notes')) {
      if (inp.notes === null) notes = null;
      else if (typeof inp.notes === 'string') {
        const t = inp.notes.trim();
        if (t.length > NOTES_MAX) errors.notes = 'notes_too_long';
        else notes = t === '' ? null : t;
      } else errors.notes = 'invalid';
    }

    // Status
    let status: 'draft' | 'ready' = cur?.status ?? 'draft';
    if (has('status')) {
      if (inp.status === 'draft' || inp.status === 'ready') status = inp.status;
      else errors.status = 'invalid';
    }

    if (Object.keys(errors).length > 0) throw new BriefValidationError(errors);

    if (blocks === null) blocks = await defaultBlocksIn(tx, brandId, ctx, !!(startsOn || endsOn));

    const draft: Brief = {
      id: cur?.id ?? '',
      brandId,
      postType: postType as PostType,
      primaryUspId,
      secondaryUspIds,
      uspSnapshot,
      cta,
      blocks,
      qr,
      photoId,
      language,
      startsOn,
      endsOn,
      openEnded,
      timezone: ctx.timezone,
      channels,
      notes,
      status,
    };
    if (status === 'ready') {
      const missing = checkCompleteness(draft);
      if (missing.length > 0) throw new BriefIncompleteError(missing);
    }

    const params = [
      draft.postType,
      primaryUspId,
      secondaryUspIds,
      JSON.stringify(uspSnapshot),
      cta,
      JSON.stringify(blocks),
      qr === null ? null : JSON.stringify(qr),
      photoId,
      language,
      startsOn,
      endsOn,
      ctx.timezone,
      channels,
      notes,
      status,
    ];
    if (cur === null) {
      const [row] = await tx.query<Row>(
        `insert into public.post_briefs (brand_id, post_type, primary_usp_id, secondary_usp_ids, usp_snapshot, cta, blocks, qr, photo_id,
                                         language, starts_on, ends_on, timezone, channels, notes, status, created_by, open_ended)
         values ($16, $1::public.post_type, $2, $3::uuid[], $4::jsonb, $5::public.cta_kind, $6::jsonb, $7::jsonb, $8, $9, $10::date, $11::date,
                 $12, $13::text[]::public.post_channel[], $14, $15, $17, $18)
         returning ${COLUMNS}`,
        [...params, brandId, userId, openEnded],
      );
      return toBrief(row);
    }
    const [row] = await tx.query<Row>(
      `update public.post_briefs
          set post_type = $1::public.post_type, primary_usp_id = $2, secondary_usp_ids = $3::uuid[], usp_snapshot = $4::jsonb,
              cta = $5::public.cta_kind, blocks = $6::jsonb, qr = $7::jsonb, photo_id = $8, language = $9,
              starts_on = $10::date, ends_on = $11::date, timezone = $12, channels = $13::text[]::public.post_channel[],
              notes = $14, status = $15, open_ended = $18, updated_at = now()
        where id = $16 and brand_id = $17 returning ${COLUMNS}`,
      [...params, cur.id, brandId, openEnded],
    );
    return toBrief(row);
  });
}

/** Creates a brief. `postType` is required; everything else is optional. Throws BriefValidationError / BriefIncompleteError. */
export function createBrief(userId: string, brandId: string, input: BriefInput | unknown, opts: SaveOptions = {}): Promise<Brief> {
  return save(userId, brandId, null, input, opts);
}

/** Updates the keys given; the rest stay. Throws BriefNotFoundError, BriefValidationError or BriefIncompleteError. */
export function updateBrief(userId: string, brandId: string, id: string, input: BriefInput | unknown, opts: SaveOptions = {}): Promise<Brief> {
  return save(userId, brandId, id, input, opts);
}

export async function getBrief(userId: string, brandId: string, id: string): Promise<Brief | null> {
  await requireBrandMember(userId, brandId);
  if (!UUID_RE.test(String(id))) return null;
  const [row] = await getDb().withUser(userId, (tx) =>
    tx.query<Row>(`select ${COLUMNS} from public.post_briefs where id = $1 and brand_id = $2`, [id, brandId]),
  );
  return row ? toBrief(row) : null;
}

/** The brand's briefs, newest first. */
export async function listBriefs(userId: string, brandId: string, opts: { status?: 'draft' | 'ready'; limit?: number } = {}): Promise<Brief[]> {
  await requireBrandMember(userId, brandId);
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const rows = await getDb().withUser(userId, (tx) =>
    tx.query<Row>(
      `select ${COLUMNS} from public.post_briefs where brand_id = $1 ${opts.status ? 'and status = $3' : ''}
        order by created_at desc, id desc limit $2`,
      opts.status ? [brandId, limit, opts.status] : [brandId, limit],
    ),
  );
  return rows.map(toBrief);
}
