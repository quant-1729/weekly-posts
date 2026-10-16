// Loads what the Face card shows (F-4): the brand's faces with their pose images, the options being picked, the consent
// state, and whether the background-removal service exists. Runs as the signed-in user.

import { getDb } from '@/lib/db';
import { loadGuardrailContext } from '@/lib/guardrail';
import type { CardConsent, CardFace, FaceCardData } from './card-types';
import { consentStatus } from './consent';
import { checkPasses } from './generate/check';
import { FACE_OPTIONS, type FacePoseImage } from './types';
import { mattingConfigured } from './generate/cutout';
import { FACE_BUCKET, relOfStored } from './paths';
import { faceOptionRel, faceSheetDraftRel } from './generate/paths';
import { getFaceState, listPoses } from './service';
import type { BrandFace } from './types';

const fileUrl = (rel: string, v?: string) => `/api/files/${FACE_BUCKET}/${rel}${v ? `?v=${encodeURIComponent(v)}` : ''}`;
const storedUrl = (stored: string | null, v?: string) => {
  const rel = stored ? relOfStored(stored) : null;
  return rel ? fileUrl(rel, v) : null;
};

interface ProvenanceTimes {
  options: (string | null)[];
  sheetDraft: string | null;
}

/** When each option and the draft sheet were made, from the face's provenance (a cache-buster for their URLs). */
function timesOf(provenance: Record<string, unknown>): ProvenanceTimes {
  const options = Array.isArray(provenance.options) ? (provenance.options as unknown[]) : [];
  const at = (e: unknown) => (e && typeof e === 'object' && typeof (e as { createdAt?: unknown }).createdAt === 'string' ? (e as { createdAt: string }).createdAt : null);
  return { options: Array.from({ length: FACE_OPTIONS }, (_, i) => at(options[i])), sheetDraft: at(provenance.sheetDraft) };
}

function toCardFace(face: BrandFace, poses: FacePoseImage[], consent: CardConsent | null, stamp: string): CardFace {
  const times = timesOf(face.provenance);
  return {
    id: face.id,
    kind: face.kind,
    name: face.name,
    description: face.description,
    style: face.style,
    character: face.character,
    status: face.status,
    neverSay: face.neverSay,
    postTypes: face.postTypes,
    placement: face.placement,
    spentUsd: face.createdCostUsd,
    consent,
    poses: poses.map((p) => ({
      pose: p.pose,
      url: storedUrl(p.storagePath, stamp) ?? '',
      approved: p.approvedAt !== null,
      passed: checkPasses(p.checks),
      notes: p.checks.notes?.trim() ?? '',
    })),
    optionUrls: times.options.map((t, i) => (t ? fileUrl(faceOptionRel(face.brandId, face.id, i), t) : null)),
    masterUrl: face.masterPath ? storedUrl(face.masterPath, stamp) : null,
    sheetDraftUrl: times.sheetDraft ? fileUrl(faceSheetDraftRel(face.brandId, face.id), times.sheetDraft) : null,
    sheetUrl: face.sheetPath ? storedUrl(face.sheetPath, stamp) : null,
  };
}

export async function loadFaceCard(userId: string, brandId: string, now: Date = new Date()): Promise<FaceCardData> {
  const [state, ctx] = await Promise.all([getFaceState(userId, brandId), loadGuardrailContext(brandId, userId)]);
  const stamp = String(now.getTime());
  const rawConsent = await getDb().withUser(userId, (tx) =>
    tx.query<{ id: string; consent: Parameters<typeof consentStatus>[0] }>(`select id::text as id, consent from public.brand_faces where brand_id = $1 and kind = 'owner_photo'`, [brandId]),
  );
  const consentOf = new Map(rawConsent.map((r) => [r.id, consentStatus(r.consent, now)]));
  const faces: CardFace[] = [];
  for (const f of state.faces) {
    const poses = f.kind === 'mascot' ? [] : await listPoses(userId, brandId, f.id);
    faces.push(toCardFace(f, poses, f.kind === 'owner_photo' ? (consentOf.get(f.id) ?? { asked: false, confirmed: false, expired: false }) : null, stamp));
  }
  return { regulated: ctx.regulated, faces, activeFaceId: state.activeFaceId, inPosts: state.inPosts, cutoutConfigured: mattingConfigured() };
}

