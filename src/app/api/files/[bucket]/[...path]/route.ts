import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { serveFile } from "@/lib/storage/serve";

export async function GET(
  _req: NextRequest,
  ctx: RouteContext<"/api/files/[bucket]/[...path]">,
) {
  const { bucket, path } = await ctx.params;
  const user = await getCurrentUser();
  return serveFile({ userId: user?.id ?? null, bucket, segments: path });
}
