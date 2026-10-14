import type { NextRequest } from "next/server";
import { handleDataDeletion, parseSignedRequest } from "@/lib/connections/deletion";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Meta's data-deletion callback (required by Meta, C-25). Meta POSTs a form with `signed_request`; we verify its
 * HMAC with the app secret, delete the person's connections and tokens, and answer
 * { url, confirmation_code } as Meta requires. The URL is a public status page. Public path: the signature is the proof.
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
  const out = await handleDataDeletion(parsed);
  return Response.json(out);
}
