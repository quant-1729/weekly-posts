// Shared types of Brand Face (docs/10-plan-research-and-brand-face.md §2). Orchestrator-owned: the database
// shape is supabase/migrations/0021_ideas_and_faces.sql. Pure; safe in the browser.

import type { PostType } from '@/lib/briefs/types';
import type { CharacterId } from '@/lib/characters/types';

export const FACE_KINDS = ['mascot', 'illustrated', 'owner_photo', 'photoreal'] as const;
export type FaceKind = (typeof FACE_KINDS)[number];

/** The same poses as Tween's post rig, so the design engine treats every face alike. */
export const FACE_POSES = ['wave', 'talk', 'point', 'think', 'celebrate', 'present', 'idle'] as const;
export type FacePose = (typeof FACE_POSES)[number];

export const FACE_STYLES = ['flat', '3d_cartoon', 'line_art', 'photo'] as const;
export type FaceStyle = (typeof FACE_STYLES)[number];

export type FaceStatus = 'draft' | 'approved' | 'retired';

/** Options shown when a face is first made; the owner keeps one. */
export const FACE_OPTIONS = 4;
/** Tries per pose; the vision check picks the best, the owner approves. */
export const TRIES_PER_POSE = 2;
/** Image model for faces (Imagen 3 subject customization is discontinued; see docs/12). */
export const FACE_IMAGE_MODEL = 'gemini-3.1-flash-image';
/** Rough price per image in USD, for the estimate shown before the owner approves. Re-checked against Vertex pricing. */
export const FACE_IMAGE_USD = 0.067;

/** Kinds made by AI images (they need the owner's approval of the price first). */
export const AI_FACE_KINDS: ReadonlySet<FaceKind> = new Set(['illustrated', 'photoreal']);
/** Brands in these regulated areas never get a realistic AI person (Meta health/finance ad rules). */
export const NO_PHOTOREAL_REGULATED = new Set(['health', 'finance', 'legal', 'alcohol']);

/** The owner's consent to use their own face (owner_photo), confirmed by email like a payment ID. */
export interface FaceConsent {
  userId: string;
  at: string;
  textVersion: string;
  emailConfirmedAt?: string;
}

export interface FacePlacement {
  side?: 'left' | 'right' | 'auto';
  size?: 'small' | 'medium' | 'large';
}

export interface BrandFace {
  id: string;
  brandId: string;
  kind: FaceKind;
  name: string;
  description: string | null;
  style: FaceStyle | null;
  /** The kit character a mascot face uses ('tween' when none was saved); null for every other kind. */
  character: CharacterId | null;
  status: FaceStatus;
  masterPath: string | null;
  sheetPath: string | null;
  /** Model, version, prompt hash, C2PA/SynthID flags. */
  provenance: Record<string, unknown>;
  consent: FaceConsent | null;
  neverSay: string[];
  /** Null = every post type. */
  postTypes: PostType[] | null;
  placement: FacePlacement;
  createdCostUsd: number;
}

export interface FacePoseImage {
  id: string;
  faceId: string;
  pose: FacePose;
  storagePath: string;
  width: number;
  height: number;
  checks: FaceCheck;
  approvedAt: string | null;
}

/** What the vision check says about one pose image. */
export interface FaceCheck {
  sameCharacter?: boolean;
  hasText?: boolean;
  hasLogo?: boolean;
  showsProductOrPremises?: boolean;
  credentialCues?: boolean; // white coat, stethoscope, scrubs, judge/banker look
  extraLimbs?: boolean;
  notes?: string;
}

/** Rough cost of one vision check of a pose try, in USD. */
export const FACE_CHECK_USD = 0.003;

/** The estimate the owner approves before an AI face is made (CLAUDE.md: > $0.50 needs approval), checks included. */
export function faceCreateEstimateUsd(): number {
  const images = FACE_OPTIONS + 1 /* sheet */ + FACE_POSES.length * TRIES_PER_POSE;
  const checks = FACE_POSES.length * TRIES_PER_POSE;
  return Math.ceil((images * FACE_IMAGE_USD + checks * FACE_CHECK_USD) * 100) / 100;
}

/** Whether a kind may be used by this brand. */
export function faceKindAllowed(kind: FaceKind, regulated: string): boolean {
  return !(kind === 'photoreal' && NO_PHOTOREAL_REGULATED.has(regulated));
}
