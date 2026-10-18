// Higher AI limits for the demo account (docs/15-demo-login.md "AI budget"). The scheduled jobs have no session,
// so this is decided by who owns the brand, not by the current session.

import { getDb } from "@/lib/db";
import { getEnv } from "@/lib/env";

/** The caps that replace the normal ones for a demo brand. Each is undefined when its setting is empty. */
export interface DemoCaps {
  weeklyUsd: number | undefined;
  dailyCalls: number | undefined;
}

/**
 * The demo caps for this brand, or null when no demo cap is set or the brand does not belong to the user named by
 * DEMO_LOGIN_EMAIL (matched on the owner's profile email, case-insensitive). With no demo settings it makes no
 * query at all, so normal use pays nothing.
 */
export async function demoCapsFor(brandId: string): Promise<DemoCaps | null> {
  const { email, weeklyUsdCap, dailyCallCap } = getEnv().demo;
  if (!email || (weeklyUsdCap === undefined && dailyCallCap === undefined)) return null;
  const rows = await getDb().withService((tx) =>
    tx.query(
      `select 1 from public.brand_members bm join public.profiles p on p.id = bm.user_id
        where bm.brand_id = $1 and bm.role = 'owner' and lower(p.email) = $2`,
      [brandId, email],
    ),
  );
  return rows.length > 0 ? { weeklyUsd: weeklyUsdCap, dailyCalls: dailyCallCap } : null;
}
