import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { getEnv } from "@/lib/env";
import { runWeeklySweep } from "@/lib/weekly/sweep";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

// Schedule (in vercel.json): hourly, so each brand's
// weekly run starts within an hour of its chosen local time.
//
//   { "crons": [{ "path": "/api/cron/weekly", "schedule": "0 * * * *" }] }
//
// Vercel sends `Authorization: Bearer ${CRON_SECRET}` when the CRON_SECRET environment variable is set.

function authorised(req: NextRequest): boolean {
  const secret = getEnv().cronSecret;
  if (!secret) return false;
  const given = Buffer.from(req.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  return given.length === want.length && timingSafeEqual(given, want);
}

/** Generates the week for every brand whose local schedule has come. Returns a summary. */
export async function GET(req: NextRequest) {
  if (!authorised(req)) return Response.json({ ok: false, code: "unauthorized" }, { status: 401 });
  const summary = await runWeeklySweep();
  return Response.json({ ok: true, ...summary });
}
