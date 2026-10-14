import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { refreshConnections } from "@/lib/connections/refresh";
import { getEnv } from "@/lib/env";

export const runtime = "nodejs";
export const maxDuration = 120;
export const dynamic = "force-dynamic";

// Daily (vercel.json / scripts/gcp/scheduler.sh): renews Instagram tokens that are over 24 hours old and end within
// 10 days; a refusal marks the connection expired and emails the owner once. Bearer CRON_SECRET, like the other cron routes.

function authorised(req: NextRequest): boolean {
  const secret = getEnv().cronSecret;
  if (!secret) return false;
  const given = Buffer.from(req.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  return given.length === want.length && timingSafeEqual(given, want);
}

export async function GET(req: NextRequest) {
  if (!authorised(req)) return Response.json({ ok: false, code: "unauthorized" }, { status: 401 });
  const summary = await refreshConnections();
  return Response.json({ ok: true, ...summary });
}
