import type { NextRequest } from "next/server";
import { handleDeauthorize, parseSignedRequest } from "@/lib/connections/deletion";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Meta's deauthorize callback: the person removed our app. Verifies `signed_request`, then marks their connections
 * revoked and deletes their tokens. Public path: the signature is the proof.
 */
export async function POST(req: NextRequest) {
  let signed: string | null = null;
  try {
    const form = await req.formData();
    const v = form.get("signed_request");
    signed = typeof v === "string" ? v : null;
  } catch {
    signed = null;
  }
  const parsed = parseSignedRequest(signed);
  if (!parsed) return Response.json({ error: "invalid_signed_request" }, { status: 400 });
  const affected = await handleDeauthorize(parsed);
  return Response.json({ ok: true, affected });
}
