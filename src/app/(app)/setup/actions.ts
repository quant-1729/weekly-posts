"use server";

import { after } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { describeError } from "@/lib/brand/errors";
import { getCurrentBrand } from "@/lib/brand/current";
import { s } from "@/lib/i18n/strings";
import { SetupAlreadyCompletedError } from "@/lib/brand/profile";
import { completeSetupV2, ensureSetupBrandV2, SetupValidationError } from "@/lib/setup/save";
import { urlField, type SetupFieldErrors } from "@/lib/setup/schema";
import {
  getWebsiteReadSummary,
  prepareWebsiteRead,
  runWebsiteRead,
  type WebsiteReadSummary,
} from "@/lib/setup/website";

/** Server actions for setup v2. Each one checks the signed-in user first. */

export type SetupFailure = { ok: false; message: string; fieldErrors?: SetupFieldErrors };

const signedOut: SetupFailure = { ok: false, message: s.errors.signedOut };

function failure(e: unknown): SetupFailure {
  if (e instanceof SetupValidationError) {
    return { ok: false, message: s.setupV2.errors.saveFailed, fieldErrors: e.fieldErrors };
  }
  if (e instanceof SetupAlreadyCompletedError) return { ok: false, message: s.setupV2.errors.already_done };
  const d = describeError(e);
  return { ok: false, message: d.message };
}

/** Keeps the background work alive after the response on Vercel. Outside a request (tests) it just runs. */
function keepAlive(work: Promise<void>): void {
  try {
    after(work);
  } catch {
    // Not in a request scope: the promise is already running.
  }
}

/**
 * Step 8: the owner entered a website. Creates the brand if needed, saves the address and
 * starts reading it in the background. Returns as soon as the read has started; the
 * owner carries on with the next steps (Req 6: setup never waits for it).
 */
export async function startWebsiteReadAction(input: {
  businessName: string;
  url: string;
}): Promise<{ ok: true } | SetupFailure> {
  const user = await getCurrentUser();
  if (!user) return signedOut;
  const url = urlField.safeParse(input.url);
  if (!url.success || url.data === "") {
    return { ok: false, message: s.setupV2.errors.invalid_url, fieldErrors: { website_url: "invalid_url" } };
  }
  try {
    const brandId = await ensureSetupBrandV2(user.id, String(input.businessName ?? ""));
    if (await prepareWebsiteRead(user.id, brandId, url.data)) {
      keepAlive(runWebsiteRead({ userId: user.id, brandId, url: url.data }));
    }
    return { ok: true };
  } catch (e) {
    return failure(e);
  }
}

export interface SetupDone {
  ok: true;
  brandId: string;
  hasWebsite: boolean;
}

/** Step 10: validates every answer and saves everything. Starts the website read if step 8 did not. */
export async function completeSetupAction(answers: unknown): Promise<SetupDone | SetupFailure> {
  const user = await getCurrentUser();
  if (!user) return signedOut;
  try {
    const done = await completeSetupV2(user.id, answers);
    if (done.readNeeded && done.websiteUrl) {
      keepAlive(runWebsiteRead({ userId: user.id, brandId: done.brandId, url: done.websiteUrl }));
    }
    return { ok: true, brandId: done.brandId, hasWebsite: done.websiteUrl !== null };
  } catch (e) {
    return failure(e);
  }
}

/** The Done screen asks this every 2 seconds while the website is being read. */
export async function websiteStatusAction(): Promise<{ ok: true; summary: WebsiteReadSummary } | SetupFailure> {
  const user = await getCurrentUser();
  if (!user) return signedOut;
  try {
    const brand = await getCurrentBrand(user.id);
    const summary = brand ? await getWebsiteReadSummary(user.id, brand.id) : null;
    if (!summary) return { ok: false, message: s.brand.noBrand };
    return { ok: true, summary };
  } catch (e) {
    return failure(e);
  }
}
