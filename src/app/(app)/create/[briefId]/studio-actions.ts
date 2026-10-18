"use server";

import { getCurrentUser } from "@/lib/auth";
import { getCurrentBrand } from "@/lib/brand/current";
import { describeCreateError } from "@/lib/create";
import { s } from "@/lib/i18n/strings";
import { finishStudio, loadStudioPage, saveStudioState } from "@/lib/studio/service";
import { smartFit } from "@/lib/studio/smart-fit";
import type { StudioState } from "@/lib/studio/types";

/** Server actions of the Design Studio (single post). Each checks the signed-in user and their current brand. */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function who() {
  const user = await getCurrentUser();
  if (!user) return null;
  const brand = await getCurrentBrand(user.id);
  if (!brand) return null;
  return { userId: user.id, brandId: brand.id };
}

export async function saveStudioAction(briefId: string, state: StudioState): Promise<{ ok: boolean; message?: string }> {
  const w = await who();
  if (!w || !UUID_RE.test(briefId)) return { ok: false, message: s.errors.signedOut };
  try {
    return { ok: await saveStudioState({ ...w, briefId, state }) };
  } catch (e) {
    console.error("[studio] save failed", e);
    return { ok: false };
  }
}

export async function finishStudioAction(briefId: string, state: StudioState): Promise<{ ok: boolean; message?: string; href?: string }> {
  const w = await who();
  if (!w || !UUID_RE.test(briefId)) return { ok: false, message: s.errors.signedOut };
  try {
    const page = await loadStudioPage({ ...w, briefId });
    if (!page) return { ok: false, message: s.create.design.errors.generic };
    const r = await finishStudio({ ...w, briefId, state, input: page.input });
    if (!r.ok) return r;
    return { ok: true, href: `/create/${briefId}/review` };
  } catch (e) {
    const known = describeCreateError(e);
    if (known && known.state !== "not_ready") return { ok: false, message: known.message };
    console.error("[studio] finish failed", e);
    return { ok: false, message: s.create.design.errors.generic };
  }
}

export async function smartFitAction(args: { photoId?: string; colors: string[]; plainBackground: boolean; focus: { x: number; y: number }; busy: number }) {
  const w = await who();
  if (!w) return { ok: false };
  const colors = Array.isArray(args.colors) ? args.colors.filter((c) => typeof c === "string" && /^#[0-9a-fA-F]{6}$/.test(c)).slice(0, 6) : [];
  const focus = { x: Math.min(1, Math.max(0, Number(args.focus?.x) || 0.5)), y: Math.min(1, Math.max(0, Number(args.focus?.y) || 0.5)) };
  const r = await smartFit({ ...w, photoId: typeof args.photoId === "string" && UUID_RE.test(args.photoId) ? args.photoId : undefined, hints: { colors, plainBackground: !!args.plainBackground, focus, busy: Number(args.busy) || 0.5 } });
  return { ok: true, ...r };
}
