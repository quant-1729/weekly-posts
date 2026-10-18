import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import sharp from "sharp";
import { getCurrentUser } from "@/lib/auth";
import { requireBrandMember } from "@/lib/brand/current";
import { getStorage } from "@/lib/storage";

export const dynamic = "force-dynamic";

const MAX_BYTES = 4 * 1024 * 1024;

/**
 * POST multipart: brand_id, file (PNG, max 4 MB): a picture the Design Studio made in the browser (a cut-out). It is re-encoded
 * by sharp (so only a real PNG is stored) under inputs/{brand_id}/studio/. Replies { ok, src }.
 */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ ok: false, message: "Please sign in again." }, { status: 401 });
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ ok: false, message: "That upload could not be read." }, { status: 400 });
  }
  const brandId = String(form.get("brand_id") ?? "");
  const file = form.get("file");
  try {
    await requireBrandMember(user.id, brandId);
  } catch {
    return Response.json({ ok: false, message: "Not found." }, { status: 404 });
  }
  if (!(file instanceof File) || file.size === 0 || file.size > MAX_BYTES) return Response.json({ ok: false, message: "The picture is too large (4 MB at most)." }, { status: 400 });
  let png: Buffer;
  try {
    png = await sharp(Buffer.from(await file.arrayBuffer()), { limitInputPixels: 4096 * 4096 }).png().toBuffer();
  } catch {
    return Response.json({ ok: false, message: "That is not a picture we can use." }, { status: 400 });
  }
  const path = `${brandId}/studio/${randomUUID()}.png`;
  await getStorage().put("inputs", path, png, "image/png");
  return Response.json({ ok: true, src: `/api/files/inputs/${path}` });
}
