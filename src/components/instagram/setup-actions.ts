"use server";

import { getCurrentUser } from "@/lib/auth";
import { normalizeInstagramHandle } from "@/lib/instagram/handle";
import { runInstagramImport, saveInstagramHandle } from "@/lib/instagram/import";
import { ensureSetupBrandV2 } from "@/lib/setup/save";

/**
 * Setup, website step: the owner typed an Instagram @name. Saves it (source: owner) and starts the import in the
 * background. Returns as soon as the name is saved; setup never waits for the import and never fails because of it.
 */
export async function startInstagramImportAction(input: { businessName: string; handle: string }): Promise<{ ok: boolean }> {
  try {
    const user = await getCurrentUser();
    const handle = normalizeInstagramHandle(input?.handle);
    if (!user || !handle) return { ok: false };
    const brandId = await ensureSetupBrandV2(user.id, String(input.businessName ?? ""));
    await saveInstagramHandle({ userId: user.id, brandId, handle, source: "owner" });
    void runInstagramImport({ userId: user.id, brandId, handle, source: "owner" });
    return { ok: true };
  } catch (e) {
    console.warn("[instagram] setup could not save the Instagram name", e instanceof Error ? e.name : "error");
    return { ok: false };
  }
}
