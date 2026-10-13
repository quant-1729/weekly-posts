import type { NextRequest } from "next/server";
import { serveEmailImage } from "@/lib/links/image";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Post image for an email. The signed token in the URL is the credential (see src/lib/links/image.ts). */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  return serveEmailImage({ token });
}
