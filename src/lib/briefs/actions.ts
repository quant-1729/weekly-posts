'use server';

// Server actions for post briefs. Phase 2 builds the editor on top of these. Each one checks the
// signed-in user; the library functions then check brand membership and validate every field.

import { getCurrentUser } from '@/lib/auth';
import { s } from '@/lib/i18n/strings';
import { checkCompleteness, uspLimitWarnings, type FormatFamily, type MissingItem, type UspLimitWarning } from './completeness';
import { describeBriefError, type BriefFailure } from './messages';
import { createBrief, getBrief, listBriefs, updateBrief } from './service';
import { daysLeft, isExpired } from './dates';
import type { Brief } from './types';

export type BriefResult<T = object> = ({ ok: true } & T) | BriefFailure;

const signedOut: BriefFailure = { ok: false, code: 'generic', message: s.errors.signedOut };
const str = (v: unknown) => (typeof v === 'string' ? v : '');

async function run<T extends object>(fn: (userId: string) => Promise<T>): Promise<BriefResult<T>> {
  const user = await getCurrentUser();
  if (!user) return signedOut;
  try {
    return { ok: true, ...(await fn(user.id)) };
  } catch (e) {
    return describeBriefError(e);
  }
}

export async function createBriefAction(brandId: string, input: unknown): Promise<BriefResult<{ brief: Brief }>> {
  return run(async (userId) => ({ brief: await createBrief(userId, str(brandId), input) }));
}

export async function updateBriefAction(brandId: string, briefId: string, input: unknown, refreshUsps = false): Promise<BriefResult<{ brief: Brief }>> {
  return run(async (userId) => ({ brief: await updateBrief(userId, str(brandId), str(briefId), input, { refreshUsps: refreshUsps === true }) }));
}

export async function getBriefAction(brandId: string, briefId: string): Promise<BriefResult<{ brief: Brief | null; daysLeft: number | null; expired: boolean }>> {
  return run(async (userId) => {
    const brief = await getBrief(userId, str(brandId), str(briefId));
    return { brief, daysLeft: brief ? daysLeft(brief) : null, expired: brief ? isExpired(brief) : false };
  });
}

export async function listBriefsAction(brandId: string): Promise<BriefResult<{ briefs: Brief[] }>> {
  return run(async (userId) => ({ briefs: await listBriefs(userId, str(brandId)) }));
}

/** What is missing before design, and which formats would be too crowded. Does not save anything. */
export async function checkBriefAction(
  brandId: string,
  briefId: string,
  formats: FormatFamily[] = ['square'],
): Promise<BriefResult<{ missing: MissingItem[]; warnings: UspLimitWarning[] }>> {
  return run(async (userId) => {
    const brief = await getBrief(userId, str(brandId), str(briefId));
    if (!brief) return { missing: [], warnings: [] };
    return { missing: checkCompleteness(brief), warnings: uspLimitWarnings(brief, Array.isArray(formats) ? formats : ['square']) };
  });
}
