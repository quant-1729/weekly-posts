"use server";

import { AccountRequestError, requestAccountDeletion } from "@/lib/account/request-delete";
import { getCurrentUser } from "@/lib/auth";

export type DeleteRequestResult =
  | { ok: true; email: string }
  | { ok: false; error: "signed_out" | "no_email" | "rate_limited" | "email_failed" | "generic" };

/** "Delete my account": emails the signed-in owner a confirmation link. Deletes nothing yet. */
export async function requestAccountDeletionAction(): Promise<DeleteRequestResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "signed_out" };
  try {
    return { ok: true, ...(await requestAccountDeletion({ id: user.id, email: user.email })) };
  } catch (e) {
    if (e instanceof AccountRequestError) return { ok: false, error: e.code };
    console.error("[account] delete request failed", e);
    return { ok: false, error: "generic" };
  }
}
