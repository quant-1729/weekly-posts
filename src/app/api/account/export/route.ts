import { buildExport, exportFileName } from "@/lib/account/export";
import { getCurrentUser } from "@/lib/auth";
import { s } from "@/lib/i18n/strings";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET: the signed-in owner's data as a ZIP (Req 22). Streamed file by file; every row is read
 * as the user, so only their own data can be in it.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json({ ok: false, code: "signed_out", message: s.errors.signedOut }, { status: 401 });
  }
  const now = new Date();
  let stream: ReadableStream<Uint8Array>;
  try {
    stream = await buildExport(user.id, { now });
  } catch (e) {
    console.error("[account] export failed", e);
    return Response.json({ ok: false, code: "generic", message: s.errors.generic }, { status: 500 });
  }
  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${exportFileName(now)}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
