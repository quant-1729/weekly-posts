import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { getEnv } from "@/lib/env";
import { runResearchSweep } from "@/lib/ideas/sweep";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

// Schedule (vercel.json and scripts/gcp/scheduler.sh): Mondays 06:00 UTC. Runs weekly trend research (R-7) for the
// brands that have it on and have finished setup, a few at a time, at most one weekly run per brand per week
// (a repeated or late call skips brands that already ran). Each run is capped and costed by the research budget.
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
  const { items, ...summary } = await runResearchSweep();
  return Response.json({ ok: true, ...summary, items: items.map((i) => ({ outcome: i.outcome, detail: i.detail, ms: i.ms })) });
}
