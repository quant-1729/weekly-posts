// Server side of Brand Face (F-1): the brand's faces, the active face and its pose images. Everything runs as the
// signed-in user, so row-level security keeps one brand's faces from another. No AI call is made here: making a face
// (F-4, F-5) and the owner's own photos (F-6) add faces and poses through these functions.

import { computeEligibility } from '@/lib/mascot/eligibility';
import sharp, { type Metadata } from 'sharp';
import type { PostType } from '@/lib/briefs/types';
import { BrandAccessError, requireBrandMember } from '@/lib/brand/current';
import { CHARACTER_LABELS, type CharacterId } from '@/lib/characters/types';
import { getDb, type Tx } from '@/lib/db';
import { loadGuardrailContext } from '@/lib/guardrail';
import { getStorage, type Storage } from '@/lib/storage';
import { TWEEN_FACE_NAME } from './active';
import { FaceError } from './errors';
import { FACE_BUCKET, faceFolder, facePoseRel, facePoseStored } from './paths';
import { cleanCharacter, cleanFaceName, cleanNeverSay, cleanPlacement, cleanPostTypes, validateFaceInput, type FaceInputRaw } from './rules';
import {
  FACE_POSES,
  faceKindAllowed,
  type BrandFace,
  type FaceCheck,
  type FaceConsent,
  type FaceKind,
  type FacePlacement,
  type FacePose,
  type FacePoseImage,
  type FaceStatus,
  type FaceStyle,
} from './types';

// ---------------------------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------------------------

interface FaceRow {
  id: string;
  brand_id: string;
  kind: FaceKind;
  name: string;
  description: string | null;
  style: FaceStyle | null;
  character: CharacterId | null;
  status: FaceStatus;
  master_path: string | null;
  sheet_path: string | null;
  provenance: Record<string, unknown> | null;
  consent: { user_id?: string; at?: string; text_version?: string; email_confirmed_at?: string } | null;
  never_say: string[] | null;
  post_types: PostType[] | null;
  placement: FacePlacement | null;
  created_cost_usd: string | number;
}

const FACE_COLUMNS = `id::text as id, brand_id::text as brand_id, kind, name, description, style, character, status, master_path, sheet_path,
  provenance, consent, never_say, post_types::text[] as post_types, placement, created_cost_usd`;

function toFace(r: FaceRow): BrandFace {
  const c = r.consent;
  const consent: FaceConsent | null = c
    ? { userId: c.user_id ?? '', at: c.at ?? '', textVersion: c.text_version ?? '', ...(c.email_confirmed_at ? { emailConfirmedAt: c.email_confirmed_at } : {}) }
    : null;
  return {
    id: r.id,
    brandId: r.brand_id,
    kind: r.kind,
    name: r.name,
    description: r.description,
    style: r.style,
    // A mascot made before characters existed (null) is Tween.
    character: r.kind === 'mascot' ? (r.character ?? 'tween') : null,
    status: r.status,
    masterPath: r.master_path,
    sheetPath: r.sheet_path,
    provenance: r.provenance ?? {},
    consent,
    neverSay: r.never_say ?? [],
    postTypes: r.post_types && r.post_types.length > 0 ? r.post_types : null,
    placement: r.placement ?? {},
    createdCostUsd: Number(r.created_cost_usd),
  };
}

interface PoseRow {
  id: string;
  face_id: string;
  pose: FacePose;
  storage_path: string;
  width: number;
  height: number;
  checks: FaceCheck | null;
  approved_at: string | Date | null;
}

const POSE_COLUMNS = 'id::text as id, face_id::text as face_id, pose, storage_path, width, height, checks, approved_at';

function toPose(r: PoseRow): FacePoseImage {
  return {
    id: r.id,
    faceId: r.face_id,
    pose: r.pose,
    storagePath: r.storage_path,
    width: r.width,
    height: r.height,
    checks: r.checks ?? {},
    approvedAt: r.approved_at ? new Date(r.approved_at).toISOString() : null,
  };
}

async function faceById(tx: Tx, brandId: string, faceId: string): Promise<BrandFace> {
  const [r] = await tx.query<FaceRow>(`select ${FACE_COLUMNS} from public.brand_faces where id = $1::uuid and brand_id = $2`, [faceId, brandId]);
  if (!r) throw new FaceError('not_found');
  return toFace(r);
}

/** A Postgres array literal: values are quoted, so commas, quotes and braces in a phrase are safe. */
export function pgArray(values: readonly string[]): string {
  const quote = (v: string) => `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  return `{${values.map(quote).join(',')}}`;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function requireFaceId(faceId: string): void {
  if (!UUID_RE.test(faceId)) throw new FaceError('not_found');
}

async function brandRules(userId: string, brandId: string): Promise<{ regulated: string; businessName: string }> {
  const ctx = await loadGuardrailContext(brandId, userId);
  const [m] = await getDb().withUser(userId, (tx) =>
    tx.query<{ name: string }>(
      `select coalesce(nullif(trim(m.business_name), ''), b.name) as name from public.brands b left join public.brand_memory m on m.brand_id = b.id where b.id = $1`,
      [brandId],
    ),
  );
  if (!m) throw new BrandAccessError();
  return { regulated: ctx.regulated, businessName: m.name };
}

/** Tween is not offered to a regulated business (a cartoon could make a promise it should not), as before. */
async function mascotAllowed(tx: Tx, brandId: string): Promise<boolean> {
  const [m] = await tx.query<{ category: string | null; tone: string | null; regulated: string | null }>(
    'select category, tone, regulated::text as regulated from public.brand_memory where brand_id = $1',
    [brandId],
  );
  if (!m) return false;
  return computeEligibility({ category: m.category, tone: m.tone, regulated: m.regulated as never }).reason !== 'regulated';
}

// ---------------------------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------------------------

/** The brand's faces that are not retired, oldest first. */
export async function listFaces(userId: string, brandId: string): Promise<BrandFace[]> {
  const rows = await getDb().withUser(userId, (tx) =>
    tx.query<FaceRow>(`select ${FACE_COLUMNS} from public.brand_faces where brand_id = $1 and status <> 'retired' order by created_at, id`, [brandId]),
  );
  return rows.map(toFace);
}

export async function getFace(userId: string, brandId: string, faceId: string): Promise<BrandFace> {
  requireFaceId(faceId);
  return getDb().withUser(userId, (tx) => faceById(tx, brandId, faceId));
}

export async function listPoses(userId: string, brandId: string, faceId: string): Promise<FacePoseImage[]> {
  requireFaceId(faceId);
  const rows = await getDb().withUser(userId, (tx) =>
    tx.query<PoseRow>(`select ${POSE_COLUMNS} from public.brand_face_poses where face_id = $1::uuid and brand_id = $2 order by created_at, id`, [faceId, brandId]),
  );
  const order = new Map(FACE_POSES.map((p, i) => [p, i]));
  return rows.map(toPose).sort((a, b) => order.get(a.pose)! - order.get(b.pose)!);
}

export interface FaceState {
  faces: BrandFace[];
  /** The face brand_memory points at (may be null). */
  activeFaceId: string | null;
  /** Whether the active face is on in posts. */
  inPosts: boolean;
}

export async function getFaceState(userId: string, brandId: string): Promise<FaceState> {
  const [faces, mem] = await Promise.all([
    listFaces(userId, brandId),
    getDb().withUser(userId, (tx) =>
      tx.query<{ active: string | null; on: boolean }>('select active_face_id::text as active, face_in_posts as on from public.brand_memory where brand_id = $1', [brandId]),
    ),
  ]);
  if (!mem[0]) throw new BrandAccessError();
  return { faces, activeFaceId: mem[0].active, inPosts: mem[0].on };
}

// ---------------------------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------------------------

/**
 * Starts a draft face. Throws FaceError (bad_kind, kind_not_allowed, bad_name, blocked_name, real_person,
 * bad_description, bad_style, bad_settings) or BrandAccessError. Nothing is generated here and nothing costs money.
 * A mascot names its kit character (`character`, Tween when absent; bad_character for an unknown one) and is named after the
 * character's object ("Tween", "Paper slip"...) when the owner gives no name.
 */
export async function createDraftFace(userId: string, brandId: string, input: FaceInputRaw): Promise<BrandFace> {
  await requireBrandMember(userId, brandId);
  const rules = await brandRules(userId, brandId);
  const raw = input.kind === 'mascot' && !input.name ? { ...input, name: CHARACTER_LABELS[cleanCharacter(input.character)] } : input;
  const v = validateFaceInput(raw, rules);
  return getDb().withUser(userId, async (tx) => {
    if (v.kind === 'mascot' && !(await mascotAllowed(tx, brandId))) throw new FaceError('kind_not_allowed');
    const [row] = await tx.query<FaceRow>(
      `insert into public.brand_faces (brand_id, kind, name, description, style, character, never_say, post_types, placement, created_by)
       values ($1, $2, $3, $4, $5, $10, $6::text[], $7::public.post_type[], $8::jsonb, $9) returning ${FACE_COLUMNS}`,
      [brandId, v.kind, v.name, v.description, v.style, pgArray(v.neverSay), v.postTypes ? pgArray(v.postTypes) : null, JSON.stringify(v.placement), userId, v.character],
    );
    return toFace(row);
  });
}

export interface FaceSettingsPatch {
  name?: unknown;
  placement?: unknown;
  neverSay?: unknown;
  postTypes?: unknown;
}

/** Changes the settings of a face that is not retired: name, side and size, phrases it never says, post types. */
export async function updateFaceSettings(userId: string, brandId: string, faceId: string, patch: FaceSettingsPatch): Promise<BrandFace> {
  await requireBrandMember(userId, brandId);
  requireFaceId(faceId);
  const rules = await brandRules(userId, brandId);
  return getDb().withUser(userId, async (tx) => {
    const cur = await faceById(tx, brandId, faceId);
    if (cur.status === 'retired') throw new FaceError('bad_status');
    // The name goes through the same checks as a new face.
    const name = patch.name === undefined ? cur.name : validateFaceInput({ kind: cur.kind, name: patch.name, description: cur.description ?? undefined, style: cur.style ?? undefined }, rules).name;
    const placement = patch.placement === undefined ? cur.placement : cleanPlacement(patch.placement);
    const neverSay = patch.neverSay === undefined ? cur.neverSay : cleanNeverSay(patch.neverSay);
    const postTypes = patch.postTypes === undefined ? cur.postTypes : cleanPostTypes(patch.postTypes);
    const [row] = await tx.query<FaceRow>(
      `update public.brand_faces set name = $3, placement = $4::jsonb, never_say = $5::text[], post_types = $6::public.post_type[], updated_at = now()
        where id = $1::uuid and brand_id = $2 returning ${FACE_COLUMNS}`,
      [faceId, brandId, name, JSON.stringify(placement), pgArray(neverSay), postTypes ? pgArray(postTypes) : null],
    );
    return toFace(row);
  });
}

// --- Pose images ------------------------------------------------------------------------------

export const POSE_MIN_PX = 256;
export const POSE_MAX_PX = 4096;
const POSE_MAX_BYTES = 8 * 1024 * 1024;

/**
 * Stores a pose image (a transparent PNG) for a draft face; the owner has not approved it yet. Used by the pose-set
 * generation (F-5) and the owner's own photos (F-6). Throws FaceError (bad_pose, bad_status, not_found).
 */
export async function savePoseImage(args: {
  userId: string;
  brandId: string;
  faceId: string;
  pose: FacePose;
  png: Buffer;
  checks?: FaceCheck;
  storage?: Storage;
}): Promise<FacePoseImage> {
  const { userId, brandId, faceId, pose } = args;
  await requireBrandMember(userId, brandId);
  requireFaceId(faceId);
  if (!(FACE_POSES as readonly string[]).includes(pose)) throw new FaceError('bad_pose', 'pose');
  if (args.png.length === 0 || args.png.length > POSE_MAX_BYTES) throw new FaceError('bad_pose', 'size');
  let meta: Metadata;
  try {
    meta = await sharp(args.png).metadata();
  } catch {
    throw new FaceError('bad_pose', 'not an image');
  }
  if (meta.format !== 'png' || !meta.hasAlpha) throw new FaceError('bad_pose', 'a transparent PNG is needed');
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  if (w < POSE_MIN_PX || h < POSE_MIN_PX || w > POSE_MAX_PX || h > POSE_MAX_PX) throw new FaceError('bad_pose', 'dimensions');

  const storage = args.storage ?? getStorage();
  const face = await getFace(userId, brandId, faceId);
  if (face.status !== 'draft' || face.kind === 'mascot') throw new FaceError('bad_status');
  await storage.put(FACE_BUCKET, facePoseRel(brandId, faceId, pose), args.png, 'image/png');
  return getDb().withUser(userId, async (tx) => {
    const [row] = await tx.query<PoseRow>(
      `insert into public.brand_face_poses (brand_id, face_id, pose, storage_path, width, height, checks)
       values ($1, $2::uuid, $3, $4, $5, $6, $7::jsonb)
       on conflict (face_id, pose) do update set storage_path = excluded.storage_path, width = excluded.width, height = excluded.height,
                                                 checks = excluded.checks, approved_at = null
       returning ${POSE_COLUMNS}`,
      [brandId, faceId, pose, facePoseStored(brandId, faceId, pose), w, h, JSON.stringify(args.checks ?? {})],
    );
    return toPose(row);
  });
}

/** The owner approves one pose of a draft face. */
export async function approvePose(userId: string, brandId: string, faceId: string, pose: FacePose): Promise<FacePoseImage> {
  await requireBrandMember(userId, brandId);
  requireFaceId(faceId);
  return getDb().withUser(userId, async (tx) => {
    const face = await faceById(tx, brandId, faceId);
    if (face.status !== 'draft') throw new FaceError('bad_status');
    const [row] = await tx.query<PoseRow>(
      `update public.brand_face_poses set approved_at = now() where face_id = $1::uuid and brand_id = $2 and pose = $3 returning ${POSE_COLUMNS}`,
      [faceId, brandId, pose],
    );
    if (!row) throw new FaceError('bad_pose', 'no such pose');
    return toPose(row);
  });
}

// --- Approving, using, retiring ---------------------------------------------------------------

/**
 * Approves a draft face. A mascot (Tween's rig) needs nothing more. Every other face needs all 7 poses, each approved
 * by the owner; the owner's own face also needs the confirmed consent (the database checks that too); a realistic AI
 * person is refused for a health, finance, legal or alcohol brand.
 * Throws FaceError (bad_status, needs_poses, needs_consent, kind_not_allowed, not_found).
 */
export async function approveFace(userId: string, brandId: string, faceId: string): Promise<BrandFace> {
  await requireBrandMember(userId, brandId);
  requireFaceId(faceId);
  const { regulated } = await brandRules(userId, brandId);
  return getDb().withUser(userId, async (tx) => {
    const face = await faceById(tx, brandId, faceId);
    if (face.status !== 'draft') throw new FaceError('bad_status');
    if (!faceKindAllowed(face.kind, regulated)) throw new FaceError('kind_not_allowed');
    if (face.kind === 'mascot' && !(await mascotAllowed(tx, brandId))) throw new FaceError('kind_not_allowed');
    if (face.kind !== 'mascot') {
      const poses = await tx.query<{ pose: FacePose; approved_at: string | null }>(
        'select pose, approved_at from public.brand_face_poses where face_id = $1::uuid and brand_id = $2',
        [faceId, brandId],
      );
      const ok = new Set(poses.filter((p) => p.approved_at).map((p) => p.pose));
      if (!FACE_POSES.every((p) => ok.has(p))) throw new FaceError('needs_poses');
    }
    if (face.kind === 'owner_photo' && !face.consent?.emailConfirmedAt) throw new FaceError('needs_consent');
    const [row] = await tx.query<FaceRow>(
      `update public.brand_faces set status = 'approved', updated_at = now() where id = $1::uuid and brand_id = $2 returning ${FACE_COLUMNS}`,
      [faceId, brandId],
    );
    return toFace(row);
  });
}

/** Keeps brand_memory.mascot_in_posts true exactly when the active face is a mascot and on, so older code keeps working. */
async function writeActive(tx: Tx, brandId: string, faceId: string | null, kind: FaceKind | null, on: boolean): Promise<void> {
  const isOn = faceId !== null && on;
  await tx.query(
    'update public.brand_memory set active_face_id = $2::uuid, face_in_posts = $3, mascot_in_posts = $4 where brand_id = $1',
    [brandId, faceId, isOn, isOn && kind === 'mascot'],
  );
}

/**
 * Makes an approved face the brand's face in posts (`inPosts` defaults to on), or clears it with `faceId: null`.
 * For a mascot face, `character` (and the owner's own `name` for it) is saved first; both are refused for any other kind.
 * Throws FaceError (not_found, bad_status, kind_not_allowed, bad_character, bad_name, blocked_name).
 */
export async function setActiveFace(args: {
  userId: string;
  brandId: string;
  faceId: string | null;
  inPosts?: boolean;
  character?: unknown;
  name?: unknown;
}): Promise<FaceState> {
  const { userId, brandId } = args;
  await requireBrandMember(userId, brandId);
  const { regulated, businessName } = await brandRules(userId, brandId);
  const wantsCharacter = args.character !== undefined || args.name !== undefined;
  const character = args.character === undefined ? undefined : cleanCharacter(args.character);
  await getDb().withUser(userId, async (tx) => {
    if (args.faceId === null) return writeActive(tx, brandId, null, null, false);
    requireFaceId(args.faceId);
    const face = await faceById(tx, brandId, args.faceId);
    if (face.status !== 'approved') throw new FaceError('bad_status');
    if (!faceKindAllowed(face.kind, regulated)) throw new FaceError('kind_not_allowed');
    if (face.kind === 'mascot' && !(await mascotAllowed(tx, brandId))) throw new FaceError('kind_not_allowed');
    if (wantsCharacter) {
      if (face.kind !== 'mascot') throw new FaceError('bad_character');
      // The owner's name for it; empty = the character's object name (the label, never a working name).
      const chosen = character ?? face.character ?? 'tween';
      let own: string | null;
      if (typeof args.name === 'string' && args.name.trim()) own = cleanFaceName(args.name, businessName);
      else if (args.name === undefined) own = face.name === CHARACTER_LABELS[face.character ?? 'tween'] ? null : face.name; // keep the owner's own name
      else own = null;
      const name = own ?? CHARACTER_LABELS[chosen];
      await tx.query('update public.brand_faces set character = $3, name = $4, updated_at = now() where id = $1::uuid and brand_id = $2', [face.id, brandId, chosen, name]);
    }
    await writeActive(tx, brandId, face.id, face.kind, args.inPosts ?? true);
  });
  return getFaceState(userId, brandId);
}

/** Turns the active face on or off in posts without changing which face it is. */
export async function setFaceInPosts(userId: string, brandId: string, on: boolean): Promise<FaceState> {
  await requireBrandMember(userId, brandId);
  await getDb().withUser(userId, async (tx) => {
    const [m] = await tx.query<{ id: string | null; kind: FaceKind | null }>(
      `select f.id::text as id, f.kind from public.brand_memory m left join public.brand_faces f on f.id = m.active_face_id where m.brand_id = $1`,
      [brandId],
    );
    if (!m) throw new BrandAccessError();
    if (!m.id) throw new FaceError('bad_status', 'no active face');
    await writeActive(tx, brandId, m.id, m.kind, on);
  });
  return getFaceState(userId, brandId);
}

/**
 * Retires a face for good: it stops being the brand's face, its pose rows and image files are deleted (the owner's own
 * photos do not stay behind), and it can no longer be chosen. Old pictures keep the images they were made with.
 */
export async function retireFace(userId: string, brandId: string, faceId: string, opts: { storage?: Storage } = {}): Promise<void> {
  await requireBrandMember(userId, brandId);
  requireFaceId(faceId);
  const storage = opts.storage ?? getStorage();
  await getDb().withUser(userId, async (tx) => {
    const face = await faceById(tx, brandId, faceId);
    if (face.status === 'retired') return;
    await tx.query('update public.brand_memory set active_face_id = null, face_in_posts = false, mascot_in_posts = false where brand_id = $1 and active_face_id = $2::uuid', [
      brandId,
      faceId,
    ]);
    await tx.query('delete from public.brand_face_poses where face_id = $1::uuid and brand_id = $2', [faceId, brandId]);
    await tx.query(`update public.brand_faces set status = 'retired', master_path = null, sheet_path = null, updated_at = now() where id = $1::uuid and brand_id = $2`, [faceId, brandId]);
  });
  await storage.removePrefix(FACE_BUCKET, faceFolder(brandId, faceId));
}

// ---------------------------------------------------------------------------------------------
// The older mascot switch (src/lib/mascot/service.ts, src/lib/memory/settings.ts) keeps the faces in step
// ---------------------------------------------------------------------------------------------

/**
 * "Use the mascot in my posts" on or off (the older switch), inside the caller's transaction. On: Tween's face (made if
 * the brand has none) becomes the active face. Off: a mascot face goes off; another kind of face is left as it is.
 */
export async function syncMascotSwitch(tx: Tx, brandId: string, userId: string, on: boolean): Promise<void> {
  if (on) {
    let [face] = await tx.query<{ id: string }>(
      `select id::text as id from public.brand_faces where brand_id = $1 and kind = 'mascot' and status = 'approved' order by created_at limit 1`,
      [brandId],
    );
    if (!face) {
      [face] = await tx.query<{ id: string }>(
        `insert into public.brand_faces (brand_id, kind, name, status, created_by) values ($1, 'mascot', $2, 'approved', $3) returning id::text as id`,
        [brandId, TWEEN_FACE_NAME, userId],
      );
    }
    await writeActive(tx, brandId, face.id, 'mascot', true);
    return;
  }
  await tx.query(
    `update public.brand_memory m set mascot_in_posts = false,
            face_in_posts = case when m.active_face_id is null or exists (select 1 from public.brand_faces f where f.id = m.active_face_id and f.kind = 'mascot')
                                 then false else m.face_in_posts end
      where m.brand_id = $1`,
    [brandId],
  );
}

/**
 * Called when the brand's regulated choice or category changes, inside the caller's transaction: a mascot that is no
 * longer allowed and a realistic AI person for a health, finance, legal or alcohol brand go off in posts.
 */
export async function enforceFaceRules(tx: Tx, brandId: string, regulated: string, mascotStillAllowed: boolean): Promise<void> {
  const [m] = await tx.query<{ kind: FaceKind | null }>(
    `select f.kind from public.brand_memory m left join public.brand_faces f on f.id = m.active_face_id where m.brand_id = $1`,
    [brandId],
  );
  if (!m?.kind) return;
  if ((m.kind === 'mascot' && !mascotStillAllowed) || !faceKindAllowed(m.kind, regulated)) {
    await tx.query('update public.brand_memory set face_in_posts = false, mascot_in_posts = false where brand_id = $1', [brandId]);
  }
}
