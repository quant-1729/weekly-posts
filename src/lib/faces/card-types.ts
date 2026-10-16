// What the Face card on the Brand page needs, as plain JSON (no secrets: no storage paths other than the file URLs the
// owner may see, no consent token). Pure; safe in the browser.

import type { PostType } from '@/lib/briefs/types';
import type { CharacterId } from '@/lib/characters/types';
import type { FaceKind, FacePlacement, FacePose, FaceStyle, FaceStatus } from './types';

export interface CardPose {
  pose: FacePose;
  url: string;
  approved: boolean;
  /** The vision check found nothing wrong (generated kinds). */
  passed: boolean;
  /** What the check noticed, when it did not pass. */
  notes: string;
}

export interface CardConsent {
  asked: boolean;
  confirmed: boolean;
  expired: boolean;
}

export interface CardFace {
  id: string;
  kind: FaceKind;
  name: string;
  description: string | null;
  style: FaceStyle | null;
  /** A mascot's kit character ('tween' when none was saved); null for every other kind. */
  character: CharacterId | null;
  status: FaceStatus;
  neverSay: string[];
  postTypes: PostType[] | null;
  placement: FacePlacement;
  spentUsd: number;
  consent: CardConsent | null;
  poses: CardPose[];
  /** The 4 options made (null where one is missing), as file URLs. */
  optionUrls: (string | null)[];
  masterUrl: string | null;
  /** A made sheet the owner has not approved yet. */
  sheetDraftUrl: string | null;
  /** The approved sheet. */
  sheetUrl: string | null;
}

export interface FaceCardData {
  /** The brand's regulated area ('none' when it has none). */
  regulated: string;
  faces: CardFace[];
  activeFaceId: string | null;
  inPosts: boolean;
  /** The background-removal service is set up (real photos can be cut out). */
  cutoutConfigured: boolean;
}

/** The unfinished face being made, if any: the newest draft that is not a mascot. */
export const draftOf = (data: FaceCardData): CardFace | null => [...data.faces].reverse().find((f) => f.status === 'draft' && f.kind !== 'mascot') ?? null;

export const activeOf = (data: FaceCardData): CardFace | null => data.faces.find((f) => f.id === data.activeFaceId && f.status === 'approved') ?? null;
