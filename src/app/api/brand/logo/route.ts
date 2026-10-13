import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { describeError } from "@/lib/brand/errors";
import { LOGO_MAX_BYTES } from "@/lib/brand/logo";
import { clearBrandLogo, setBrandLogo } from "@/lib/brand/profile";
import { s } from "@/lib/i18n/strings";

export const dynamic = "force-dynamic";

const signedOut = () =>
  Response.json({ ok: false, code: "signed_out", message: s.errors.signedOut }, { status: 401 });

function errorResponse(e: unknown) {
  const err = describeError(e);
  const status = err.code === "not_found" ? 404 : err.code === "generic" ? 500 : 400;
  return Response.json({ ok: false, ...err }, { status });
}

/** POST multipart: brand_id, file (png/jpg/webp, max 2 MB). Saves the logo and suggests a palette from it. */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return signedOut();

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return errorResponse(new Error("bad form"));
  }
  const brandId = form.get("brand_id");
  const file = form.get("file");
  if (typeof brandId !== "string" || !(file instanceof File)) {
    return Response.json({ ok: false, code: "logo", message: s.errors.logoEmpty }, { status: 400 });
  }
  if (file.size > LOGO_MAX_BYTES) {
    return Response.json({ ok: false, code: "logo", message: s.errors.logoTooLarge }, { status: 413 });
  }

  try {
    const logo = await setBrandLogo({
      userId: user.id,
      brandId,
      bytes: new Uint8Array(await file.arrayBuffer()),
      declaredType: file.type,
    });
    return Response.json({ ok: true, logoPath: logo.logoPath, palette: logo.palette });
  } catch (e) {
    return errorResponse(e);
  }
}

/** DELETE ?brand_id=...: removes the logo. */
export async function DELETE(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return signedOut();
  const brandId = req.nextUrl.searchParams.get("brand_id");
  if (!brandId) return Response.json({ ok: false, code: "not_found", message: s.brand.noBrand }, { status: 400 });
  try {
    await clearBrandLogo({ userId: user.id, brandId });
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
