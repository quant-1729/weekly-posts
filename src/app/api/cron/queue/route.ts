import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { getEnv } from "@/lib/env";
import { runQueueSweep } from "@/lib/queue/sweep";

export const runtime = "nodejs";
export const maxDuration = 120;
export const dynamic = "force-dynamic";

// Schedule (vercel.json and scripts/gcp/scheduler.sh): hourly at minute 15, so a post is sent within the hour
// of its slot and a retry happens on the next run.
//
//   { "crons": [{ "path": "/api/cron/queue", "schedule": "15 * * * *" }] }
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

/** Publishes or delivers every queue item whose slot has come (S-2, S-3, S-5, S-6). Returns a summary. */
export async function GET(req: NextRequest) {
  if (!authorised(req)) return Response.json({ ok: false, code: "unauthorized" }, { status: 401 });
  const summary = await runQueueSweep();
  return Response.json({ ok: true, ...summary });
}
