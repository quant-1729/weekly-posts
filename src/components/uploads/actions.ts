"use server";

import { revalidatePath } from "next/cache";
import { AiError } from "@/lib/ai/client";
import { getCurrentUser } from "@/lib/auth";
import { s } from "@/lib/i18n/strings";
import { scheduleVoiceRefresh } from "@/lib/uploads/background";
import { describeUploadError, UploadError, type UploadFailure } from "@/lib/uploads/errors";
import { addPastPostText, removePastPost, updatePastPostText, type PastPostView } from "@/lib/uploads/past-posts";
import { removePhoto, setHasPeople } from "@/lib/uploads/photos";
import { addWordToAvoid, dismissAvoidSuggestion, refreshVoice, updateVoice, type VoiceEdit } from "@/lib/uploads/voice";

export type ActionResult<T = object> = ({ ok: true } & T) | ({ ok: false } & UploadFailure);

const signedOut: UploadFailure = { code: "signed_out", message: s.errors.signedOut };

async function run<T extends object>(fn: (userId: string) => Promise<T>): Promise<ActionResult<T>> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, ...signedOut };
  try {
    return { ok: true, ...(await fn(user.id)) };
  } catch (e) {
    return { ok: false, ...describeUploadError(e) };
  }
}

const str = (v: unknown) => (typeof v === "string" ? v : "");

export async function removePhotoAction(brandId: string, photoId: string): Promise<ActionResult> {
  return run(async (userId) => {
    if (!(await removePhoto({ userId, brandId: str(brandId), photoId: str(photoId) }))) throw new UploadError("not_found");
    return {};
  });
}

export async function setHasPeopleAction(brandId: string, photoId: string, hasPeople: boolean): Promise<ActionResult> {
  return run(async (userId) => {
    if (!(await setHasPeople({ userId, brandId: str(brandId), photoId: str(photoId), hasPeople: hasPeople === true }))) {
      throw new UploadError("not_found");
    }
    return {};
  });
}

export async function addPastPostTextAction(brandId: string, text: string): Promise<ActionResult<{ post: PastPostView }>> {
  return run(async (userId) => {
    const post = await addPastPostText({ userId, brandId: str(brandId), text: str(text) });
    scheduleVoiceRefresh(userId, str(brandId));
    revalidatePath("/brand");
    return { post };
  });
}

export async function updatePastPostTextAction(
  brandId: string,
  postId: string,
  text: string,
): Promise<ActionResult<{ post: PastPostView }>> {
  return run(async (userId) => {
    const post = await updatePastPostText({ userId, brandId: str(brandId), postId: str(postId), text: str(text) });
    scheduleVoiceRefresh(userId, str(brandId));
    revalidatePath("/brand");
    return { post };
  });
}

export async function removePastPostAction(brandId: string, postId: string): Promise<ActionResult> {
  return run(async (userId) => {
    if (!(await removePastPost({ userId, brandId: str(brandId), postId: str(postId) }))) throw new UploadError("not_found");
    scheduleVoiceRefresh(userId, str(brandId));
    revalidatePath("/brand");
    return {};
  });
}

export async function addWordToAvoidAction(brandId: string, word: string): Promise<ActionResult<{ wordsToAvoid: string[] }>> {
  return run(async (userId) => {
    const wordsToAvoid = await addWordToAvoid({ userId, brandId: str(brandId), word: str(word) });
    revalidatePath("/brand");
    return { wordsToAvoid };
  });
}

export async function dismissAvoidSuggestionAction(brandId: string, word: string): Promise<ActionResult<{ avoidSuggestions: string[] }>> {
  return run(async (userId) => {
    const avoidSuggestions = await dismissAvoidSuggestion({ userId, brandId: str(brandId), word: str(word) });
    revalidatePath("/brand");
    return { avoidSuggestions };
  });
}

export async function updateVoiceAction(brandId: string, edit: VoiceEdit): Promise<ActionResult> {
  return run(async (userId) => {
    const clean: VoiceEdit = {};
    if (typeof edit?.voiceDescription === "string") clean.voiceDescription = edit.voiceDescription;
    if (Array.isArray(edit?.examplePhrases)) clean.examplePhrases = edit.examplePhrases.map(String);
    if (Array.isArray(edit?.wordsToAvoid)) clean.wordsToAvoid = edit.wordsToAvoid.map(String);
    await updateVoice({ userId, brandId: str(brandId), edit: clean });
    revalidatePath("/brand");
    return {};
  });
}

/** The "Update from my posts" button: runs now (no debounce) and returns the new suggestions. */
export async function refreshVoiceNowAction(brandId: string): Promise<ActionResult<{ avoidSuggestions: string[] }>> {
  return run(async (userId) => {
    const r = await refreshVoice({ userId, brandId: str(brandId), debounceMs: 0 });
    if (r.status === "failed") throw new AiError("call_failed", "voice refresh failed");
    revalidatePath("/brand");
    return { avoidSuggestions: r.status === "updated" ? r.avoidSuggestions : [] };
  });
}
