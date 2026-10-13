// Shared by the two upload route handlers: sign-in check, form parsing, error replies.

import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { s } from "@/lib/i18n/strings";
import { describeUploadError, failureStatus, UploadError, type UploadFailure } from "./errors";
import { PHOTO_MAX_BYTES } from "./limits";

/** Vercel rejects request bodies over 4.5 MB before our code runs; stop a little earlier ourselves. */
const MAX_BODY_BYTES = 4.5 * 1024 * 1024;

export function failureResponse(f: UploadFailure): Response {
  return Response.json({ ok: false, code: f.code, message: f.message }, { status: failureStatus(f) });
}

export async function handleUpload<T extends object>(
  req: NextRequest,
  run: (args: { userId: string; brandId: string; bytes: Uint8Array; mimeType: string }) => Promise<T>,
): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return failureResponse({ code: "signed_out", message: s.errors.signedOut });

  const length = Number(req.headers.get("content-length") ?? 0);
  if (length > MAX_BODY_BYTES) return failureResponse(describeUploadError(new UploadError("too_large")));

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return failureResponse(describeUploadError(new UploadError("empty")));
  }
  const brandId = form.get("brand_id");
  const file = form.get("file");
  if (typeof brandId !== "string" || !(file instanceof File)) {
    return failureResponse(describeUploadError(new UploadError("empty")));
  }
  if (file.size > PHOTO_MAX_BYTES) return failureResponse(describeUploadError(new UploadError("too_large")));

  try {
    const result = await run({ userId: user.id, brandId, bytes: new Uint8Array(await file.arrayBuffer()), mimeType: file.type });
    return Response.json({ ok: true, ...result });
  } catch (e) {
    return failureResponse(describeUploadError(e));
  }
}
