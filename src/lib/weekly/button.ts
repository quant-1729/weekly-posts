// The "Generate now" button (the 2-week fallback to the cron): works in the signed-in user's
// current brand, for the current local week while it is still Monday to Wednesday, else next week.

import { BrandAccessError, getCurrentBrand } from '@/lib/brand/current';
import { startGeneration, type GenerateDeps, type GenerateResult, type SkipReason } from './generate';
import { brandTimezone, buttonWeekStart } from './schedule';

export type StartNowResult =
  | { ok: true; brandId: string; weekStart: string; batchId: string; run: () => Promise<GenerateResult> }
  | { ok: false; code: 'no_brand' | 'not_member' | SkipReason; weekStart?: string };

/**
 * Claims the week for the user's current brand and returns the work to run after the response.
 * The claim is made before this returns, so a screen polling the batch sees `generating` at once.
 */
export async function startGenerateNow(userId: string, deps: GenerateDeps = {}): Promise<StartNowResult> {
  const brand = await getCurrentBrand(userId);
  if (!brand || !brand.setupCompleted) return { ok: false, code: 'no_brand' };
  const timezone = (await brandTimezone(brand.id)) ?? 'UTC';
  const weekStart = buttonWeekStart(deps.now ?? new Date(), timezone);
  try {
    const started = await startGeneration({ brandId: brand.id, weekStart, trigger: 'button', userId }, deps);
    if (!started.started) return { ok: false, code: started.reason, weekStart };
    return { ok: true, brandId: brand.id, weekStart, batchId: started.batchId, run: started.run };
  } catch (e) {
    if (e instanceof BrandAccessError) return { ok: false, code: 'not_member' };
    throw e;
  }
}
