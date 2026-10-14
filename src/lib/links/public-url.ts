// Absolute URLs for redirects. Behind a proxy (Cloud Run, Vercel) a request's own URL can carry the
// server's internal host (e.g. https://0.0.0.0:8080), so redirects start from the public app address
// (NEXT_PUBLIC_APP_URL) and keep only the request's path and query. Without an app address (local
// development without the setting) the request's own URL is used.

import type { NextRequest } from "next/server";
import { getEnv } from "@/lib/env";

export function publicUrl(request: NextRequest): URL {
  const base = getEnv().appUrl;
  if (!base) return request.nextUrl.clone();
  return new URL(`${request.nextUrl.pathname}${request.nextUrl.search}`, base);
}
