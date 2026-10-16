import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { getEnv } from "@/lib/env";
import { sweepInsights } from "@/lib/insights/sweep";

export const runtime = "nodejs";
export const maxDuration = 120;
export const dynamic = "force-dynamic";

// Schedule (vercel.json and scripts/gcp/scheduler.sh): hourly at minute 45. Measures published Instagram and Facebook
// posts at about 24 h, 72 h and 7 days (R-8); work already done is skipped, so a repeated or late call is harmless.
//
// Vercel and Cloud Scheduler send `Authorization: Bearer ${CRON_SECRET}`. The path is public in
// src/lib/auth/public-paths.ts (/api/cron/); this route checks the secret itself.

function authorised(req: NextRequest): boolean {
  const secret = getEnv().cronSecret;
  if (!secret) return false;
  const given = Buffer.from(req.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  return given.length === want.length && timingSafeEqual(given, want);
}

export async function GET(req: NextRequest) {
  if (!authorised(req)) return Response.json({ ok: false, code: "unauthorized" }, { status: 401 });
  const { items: _items, ...summary } = await sweepInsights();
  return Response.json({ ok: true, ...summary, measured: _items.length });
}
