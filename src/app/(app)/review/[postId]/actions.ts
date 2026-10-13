"use server";

import { getCurrentUser } from "@/lib/auth";
import { CONTENT_LANGUAGES, type ContentLanguage } from "@/lib/ai/schemas";
import { s } from "@/lib/i18n/strings";
import type { ReviewOutput } from "@/lib/posts/review";
import { switchOutputLanguage } from "@/lib/posts/switch-language";

export type SwitchLanguageResult =
  | { ok: true; changed: boolean; output: ReviewOutput }
  | { ok: false; message: string };

/** One tap on the language switch of one output card (R5). Runs as the signed-in user. */
export async function switchLanguageAction(outputId: string, to: string): Promise<SwitchLanguageResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, message: s.errors.signedOut };
  if (!(CONTENT_LANGUAGES as readonly string[]).includes(to)) {
    return { ok: false, message: s.review.switch.invalidLanguage };
  }
  const res = await switchOutputLanguage({ userId: user.id, outputId: String(outputId), to: to as ContentLanguage });
  if (!res.ok) return { ok: false, message: res.message };
  return { ok: true, changed: res.changed, output: res.output };
}
