"use server";

import { getCurrentUser } from "@/lib/auth";
import { BrandAccessError, switchBrand } from "@/lib/brand/current";
import { getReviewData } from "@/lib/posts/review";

export type SwitchBrandResult = { ok: true; redirectTo: string | null } | { ok: false };

const REVIEW_PATH = /^\/review\/([^/]+)\/?$/;

/**
 * Brand switcher (R14). Updates the user's current brand, then says where the
 * page should go: `/history` when the open page is a post that is not in the
 * new brand, else null (stay on the page and reload it).
 */
export async function switchBrandAction(brandId: string, pathname: string): Promise<SwitchBrandResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false };
  try {
    await switchBrand(user.id, brandId);
  } catch (e) {
    if (!(e instanceof BrandAccessError)) console.error("[brand] switch failed", e);
    return { ok: false };
  }
  const match = typeof pathname === "string" ? REVIEW_PATH.exec(pathname) : null;
  if (match) {
    const post = await getReviewData(user.id, match[1]);
    if (!post || post.brandId !== brandId) return { ok: true, redirectTo: "/history" };
  }
  return { ok: true, redirectTo: null };
}
