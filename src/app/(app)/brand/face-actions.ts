"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { getCurrentBrand } from "@/lib/brand/current";
import { characterPoses } from "@/lib/faces/character-preview";
import { chooseMascotCharacter } from "@/lib/faces/character";
import { loadFaceCard } from "@/lib/faces/card";
import type { FaceCardData } from "@/lib/faces/card-types";
import { requestFaceConsent } from "@/lib/faces/consent";
import { describeFaceError, type FaceFailure } from "@/lib/faces/describe";
import { cleanCharacter } from "@/lib/faces/rules";
import { approveSheet, makeOptions, makePoses, makeSheet, setMaster, type PosesResult } from "@/lib/faces/generate";
import {
  approveFace,
  approvePose,
  createDraftFace,
  getFaceState,
  retireFace,
  setActiveFace,
  setFaceInPosts,
  updateFaceSettings,
  type FaceSettingsPatch,
  type FaceState,
} from "@/lib/faces/service";
import { FACE_POSES, type BrandFace, type FacePose } from "@/lib/faces/types";
import { s } from "@/lib/i18n/strings";
import { getMascotCard } from "@/lib/mascot/service";

// Server actions of the Brand Face card (F-4). Each one acts for the signed-in user on their current
// brand; the service checks brand membership again and row-level security is the last line.

export type FaceActionResult<T = object> = ({ ok: true } & T) | ({ ok: false } & FaceFailure);

const signedOut: FaceFailure = { code: "generic", message: s.errors.signedOut };

async function run<T extends object>(fn: (ctx: { userId: string; brandId: string }) => Promise<T>): Promise<FaceActionResult<T>> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, ...signedOut };
  try {
    const brand = await getCurrentBrand(user.id);
    if (!brand) return { ok: false, ...signedOut };
    const out = await fn({ userId: user.id, brandId: brand.id });
    revalidatePath("/brand");
    return { ok: true, ...out };
  } catch (e) {
    return { ok: false, ...describeFaceError(e) };
  }
}

const str = (v: unknown) => (typeof v === "string" ? v : "");

export async function loadFacesAction(): Promise<FaceActionResult<{ state: FaceState }>> {
  return run(async ({ userId, brandId }) => ({ state: await getFaceState(userId, brandId) }));
}

/** Starts a draft face. The input is checked on the server (kind, name, description, style, settings). */
export async function createFaceAction(input: {
  kind: string;
  name?: string;
  description?: string;
  style?: string;
  placement?: unknown;
  neverSay?: unknown;
  postTypes?: unknown;
}): Promise<FaceActionResult<{ face: BrandFace }>> {
  return run(async ({ userId, brandId }) => ({
    face: await createDraftFace(userId, brandId, {
      kind: input?.kind,
      name: input?.name,
      description: input?.description,
      style: input?.style,
      placement: input?.placement,
      neverSay: input?.neverSay,
      postTypes: input?.postTypes,
    }),
  }));
}

export async function updateFaceSettingsAction(faceId: string, patch: FaceSettingsPatch): Promise<FaceActionResult<{ face: BrandFace }>> {
  return run(async ({ userId, brandId }) => ({
    face: await updateFaceSettings(userId, brandId, str(faceId), {
      name: patch?.name,
      placement: patch?.placement,
      neverSay: patch?.neverSay,
      postTypes: patch?.postTypes,
    }),
  }));
}

export async function approvePoseAction(faceId: string, pose: string): Promise<FaceActionResult> {
  return run(async ({ userId, brandId }) => {
    if (!(FACE_POSES as readonly string[]).includes(pose)) throw new Error("pose");
    await approvePose(userId, brandId, str(faceId), pose as FacePose);
    return {};
  });
}

/** Approves a draft face: all 7 poses approved (a mascot needs none), and the owner's own face needs the confirmed consent. */
export async function approveFaceAction(faceId: string): Promise<FaceActionResult<{ face: BrandFace }>> {
  return run(async ({ userId, brandId }) => ({ face: await approveFace(userId, brandId, str(faceId)) }));
}

/** Makes an approved face the brand's face in posts (`faceId: null` clears it). */
export async function setActiveFaceAction(faceId: string | null, inPosts?: boolean): Promise<FaceActionResult<{ state: FaceState }>> {
  return run(async ({ userId, brandId }) => ({
    state: await setActiveFace({ userId, brandId, faceId: faceId === null ? null : str(faceId), inPosts: inPosts !== false }),
  }));
}

export async function setFaceInPostsAction(on: boolean): Promise<FaceActionResult<{ state: FaceState }>> {
  return run(async ({ userId, brandId }) => ({ state: await setFaceInPosts(userId, brandId, on === true) }));
}

export async function retireFaceAction(faceId: string): Promise<FaceActionResult> {
  return run(async ({ userId, brandId }) => {
    await retireFace(userId, brandId, str(faceId));
    return {};
  });
}

// ---------------------------------------------------------------------------------------------
// The mascot's character (CH-3): choose one of the kit characters and name it, and see how it acts.
// ---------------------------------------------------------------------------------------------

/** Uses this character as the brand's mascot in posts. `name` is the owner's own name for it (empty = the character's object name). */
export async function chooseMascotCharacterAction(character: string, name?: string, tryAnyway?: boolean): Promise<FaceActionResult<{ state: FaceState }>> {
  return run(async ({ userId, brandId }) => ({
    state: await chooseMascotCharacter({ userId, brandId, character: str(character), name: str(name), tryAnyway: tryAnyway === true }),
  }));
}

/** The four pose previews (SVG markup drawn by code, no AI) of one character in the brand's colours. */
export async function characterPosesAction(character: string): Promise<FaceActionResult<{ poses: { action: string; svg: string }[] }>> {
  return run(async ({ userId, brandId }) => {
    const id = cleanCharacter(str(character));
    const { colors } = await getMascotCard(userId, brandId);
    return { poses: characterPoses(id, colors) };
  });
}

// ---------------------------------------------------------------------------------------------
// The Face card (F-4, F-6): what it shows, the owner's consent, and the AI steps.
// Every generating action takes the price the owner saw and approved (`approvedEstimateUsd`); the generation code
// refuses a missing or too-low figure and a face that would pass its $2.00 limit, so a call that skips the approval fails.
// ---------------------------------------------------------------------------------------------

export async function loadFaceCardAction(): Promise<FaceActionResult<{ data: FaceCardData }>> {
  return run(async ({ userId, brandId }) => ({ data: await loadFaceCard(userId, brandId) }));
}

/** Saves the ticked consent on the owner's own face and emails the confirmation link. */
export async function requestFaceConsentAction(faceId: string, agreed: boolean): Promise<FaceActionResult<{ expiresAt: string }>> {
  return run(async ({ userId, brandId }) => requestFaceConsent({ userId, brandId, faceId: str(faceId), agreed: agreed === true }));
}

/** Step a: the master options (FACE_OPTIONS pictures). */
export async function makeFaceOptionsAction(faceId: string, approvedEstimateUsd: number): Promise<FaceActionResult<{ made: number; failed: number }>> {
  return run(async ({ userId, brandId }) => {
    const r = await makeOptions({ userId, brandId, faceId: str(faceId), approvedEstimateUsd });
    return { made: r.options.length, failed: r.failed };
  });
}

/** The owner keeps option number `index` as the look. Free. */
export async function pickFaceOptionAction(faceId: string, index: number): Promise<FaceActionResult> {
  return run(async ({ userId, brandId }) => {
    await setMaster({ userId, brandId, faceId: str(faceId), optionIndex: index });
    return {};
  });
}

/** Step b: the character sheet. */
export async function makeFaceSheetAction(faceId: string, approvedEstimateUsd: number): Promise<FaceActionResult> {
  return run(async ({ userId, brandId }) => {
    await makeSheet({ userId, brandId, faceId: str(faceId), approvedEstimateUsd });
    return {};
  });
}

/** The owner approves the made sheet. Free. */
export async function approveFaceSheetAction(faceId: string): Promise<FaceActionResult> {
  return run(async ({ userId, brandId }) => {
    await approveSheet({ userId, brandId, faceId: str(faceId) });
    return {};
  });
}

/**
 * Step c: the poses in `poses` (one pose is a redo). The card calls this a few poses at a time so every call stays short,
 * each with the price of just those poses.
 */
export async function makeFacePosesAction(
  faceId: string,
  poses: string[],
  approvedEstimateUsd: number,
): Promise<FaceActionResult<{ saved: { pose: FacePose; passed: boolean }[]; failed: PosesResult['failed'] }>> {
  return run(async ({ userId, brandId }) => {
    const wanted = Array.isArray(poses) ? poses.filter((p): p is FacePose => (FACE_POSES as readonly string[]).includes(p)) : [];
    const r = await makePoses({ userId, brandId, faceId: str(faceId), poses: wanted, approvedEstimateUsd });
    return { saved: r.saved.map((o) => ({ pose: o.pose, passed: o.passed })), failed: r.failed };
  });
}

/** "Use this face": approves the face (all poses approved first) and makes it the brand's face in posts. */
export async function adoptFaceAction(faceId: string): Promise<FaceActionResult<{ face: BrandFace }>> {
  return run(async ({ userId, brandId }) => {
    const face = await approveFace(userId, brandId, str(faceId));
    await setActiveFace({ userId, brandId, faceId: face.id, inPosts: true });
    return { face };
  });
}
