import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { getEnv } from "@/lib/env";
import { sendPostingReminders } from "@/lib/reminders/posting";

export const runtime = "nodejs";
export const maxDuration = 120;
export const dynamic = "force-dynamic";

// Intended schedule (added to vercel.json at deployment, not now): hourly, so a reminder goes out
// within an hour of the 3-day mark, and a failed send is retried the next hour (up to 3 times).
//
//   { "crons": [{ "path": "/api/cron/reminders", "schedule": "30 * * * *" }] }
//
// Vercel sends `Authorization: Bearer ${CRON_SECRET}` when the CRON_SECRET environment variable is set.
// The path is public in src/lib/auth/public-paths.ts (/api/cron/); this route checks the secret itself.

function authorised(req: NextRequest): boolean {
  const secret = getEnv().cronSecret;
  if (!secret) return false;
  const given = Buffer.from(req.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  return given.length === want.length && timingSafeEqual(given, want);
}

/** Sends the "you have posts ready to share" reminder (Req 25) to every brand that is due. Returns a summary. */
export async function GET(req: NextRequest) {
  if (!authorised(req)) return Response.json({ ok: false, code: "unauthorized" }, { status: 401 });
  const summary = await sendPostingReminders();
  return Response.json({ ok: true, ...summary });
}
