import { readFile } from "node:fs/promises";
import path from "node:path";
import type { NextRequest } from "next/server";
import { fontsFolder, isSafeFontFile } from "@/lib/kit/fonts";

export const dynamic = "force-dynamic";

const TYPES: Record<string, string> = { ttf: "font/ttf", otf: "font/otf", woff: "font/woff", woff2: "font/woff2" };

/** GET /api/fonts/NotoSerif_700Bold.ttf: the shipped open-licence font files, for the Look section's samples. */
export async function GET(_req: NextRequest, ctx: RouteContext<"/api/fonts/[file]">) {
  const { file } = await ctx.params;
  if (!isSafeFontFile(file)) return new Response("Not found", { status: 404 });
  try {
    const bytes = await readFile(path.join(fontsFolder(), file));
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": TYPES[file.split(".").pop()!.toLowerCase()] ?? "application/octet-stream",
        "Cache-Control": "public, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
