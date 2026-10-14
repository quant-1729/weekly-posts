"use server";

import { after } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { describeError } from "@/lib/brand/errors";
import { getCurrentBrand } from "@/lib/brand/current";
import { s } from "@/lib/i18n/strings";
import { SetupAlreadyCompletedError } from "@/lib/brand/profile";
import { runInstagramImport, saveInstagramHandle } from "@/lib/instagram/import";
import { normalizeInstagramHandle } from "@/lib/instagram/handle";
import {
  applySetupContacts,
  applySetupHours,
  applySetupUsps,
  checkSetupContacts,
  getSetupFindings,
  saveSetupLocation,
  SetupDetailsError,
  websiteContactSuggestions,
  writeSetupDraft,
  type ContactSuggestions,
  type SetupFindings,
} from "@/lib/setup/details";
import { isSetupStep, parseAnswers, type DraftAnswers } from "@/lib/setup/draft";
import { completeSetupV2, ensureSetupBrandV2, SetupValidationError } from "@/lib/setup/save";
import { fieldError, GOALS, TONES, urlField, type SetupFieldErrors } from "@/lib/setup/schema";
import type { SetupStep } from "@/lib/setup/steps";
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
 * Setup v2 (kept for the tests and the Brand page): the owner entered a website. Creates the brand if needed, saves the address and
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

/** The last screen: validates every answer and saves everything. Starts the website read if step 8 did not. */
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

// ---------------------------------------------------------------------------
// Setup v3 (C-01): every screen saves as it goes, so a reload resumes
// ---------------------------------------------------------------------------

/** A screen that could not be saved. `fieldErrors` is keyed by the answer (phone, email, hours, likes ...) with a short code. */
export type StepFailure = { ok: false; message: string; fieldErrors?: Record<string, string> };

function stepFailure(e: unknown): StepFailure {
  if (e instanceof SetupDetailsError) return { ok: false, message: s.setupV2.errors.saveFailed, fieldErrors: e.fieldErrors };
  const f = failure(e);
  return { ok: false, message: f.message };
}

/** The first problem with the answers of a screen that has required ones, as `{ answer: code }`. */
function requiredErrors(step: SetupStep, a: DraftAnswers): Record<string, string> {
  const errors: Record<string, string> = {};
  const check = (field: string, code: string | null) => {
    if (code) errors[field] = code;
  };
  if (step === "business") {
    check("name", fieldError("business_name", a.name));
    check("sell", fieldError("what_sell", a.sell));
  } else if (step === "customers") {
    check("customers", fieldError("customers", a.customers));
  } else if (step === "goal") {
    check("goal", (GOALS as readonly string[]).includes(a.goal) ? null : "required");
  } else if (step === "style") {
    check("tone", (TONES as readonly string[]).includes(a.tone) ? null : "required");
    check("language", fieldError("post_language", a.language));
  } else if (step === "minutes") {
    check("minutes", fieldError("minutes_per_post", a.minutes === "" ? undefined : Number(a.minutes)));
  }
  return errors;
}

/** The website and Instagram name of the "addresses" screen: saved, and the reads started in the background. */
async function startOnlineReads(userId: string, brandId: string, a: DraftAnswers): Promise<void> {
  const websiteWanted = a.online.includes("website") && a.website.trim() !== "";
  const site = websiteWanted ? urlField.safeParse(a.website) : null;
  if (site && !site.success) throw new SetupDetailsError({ website: "invalid_url" });
  const url = site?.success ? site.data : "";

  const igWanted = a.online.includes("instagram") && a.instagram.trim() !== "";
  const handle = igWanted ? normalizeInstagramHandle(a.instagram) : null;
  if (igWanted && !handle) throw new SetupDetailsError({ instagram: "invalid_handle" });

  // Check every address before anything is saved or started.
  await checkSetupContacts(userId, brandId, a, "addresses");

  if (handle) {
    const saved = await saveInstagramHandle({ userId, brandId, handle, source: "owner" });
    if (saved.changed) void runInstagramImport({ userId, brandId, handle, source: "owner" });
  }
  if (await prepareWebsiteRead(userId, brandId, url) && url) {
    keepAlive(runWebsiteRead({ userId, brandId, url }));
  }
  await applySetupContacts(userId, brandId, a, "addresses");
}

/**
 * Saves one finished screen and moves the draft on to `next`. The first call creates the (unfinished) brand.
 * Nothing is saved when an answer is invalid: the screen stays and the answer's error code comes back.
 * The reads of the website and Instagram start on the "addresses" screen and never block it.
 */
export async function saveStepAction(input: {
  step: string;
  next: string;
  answers: unknown;
}): Promise<{ ok: true; brandId: string } | StepFailure> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, message: s.errors.signedOut };
  const step = input?.step;
  const next = input?.next;
  if (!isSetupStep(step) || !isSetupStep(next) || step === "done" || step === "schedule") {
    return { ok: false, message: s.setupV2.errors.saveFailed };
  }
  const a = parseAnswers(input.answers);
  const required = requiredErrors(step, a);
  if (Object.keys(required).length > 0) return { ok: false, message: s.setupV2.errors.saveFailed, fieldErrors: required };

  try {
    const brandId = await ensureSetupBrandV2(user.id, a.name);
    switch (step) {
      case "online":
        // Going back to change the choice: the addresses are asked again on the next screen, so drop the old ones.
        await applySetupContacts(user.id, brandId, { ...a, online: [] }, "addresses");
        break;
      case "addresses":
        await startOnlineReads(user.id, brandId, a);
        break;
      case "location":
        await saveSetupLocation(user.id, brandId, a);
        break;
      case "reach":
        await applySetupContacts(user.id, brandId, a, "reach");
        break;
      case "hours":
        await applySetupHours(user.id, brandId, a);
        break;
      case "likes":
        await applySetupUsps(user.id, brandId, a.likes);
        break;
      default:
        break; // business, logo, customers, goal, style, minutes: kept in the draft
    }
    await writeSetupDraft(user.id, brandId, { step: next, answers: a });
    return { ok: true, brandId };
  } catch (e) {
    return stepFailure(e);
  }
}

/** The phone number and email the website read has found so far (Path A), for the "reach" screen. Never waits for the read. */
export async function contactSuggestionsAction(): Promise<{ ok: true; suggestions: ContactSuggestions } | StepFailure> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, message: s.errors.signedOut };
  try {
    const brand = await getCurrentBrand(user.id);
    if (!brand) return { ok: false, message: s.brand.noBrand };
    return { ok: true, suggestions: await websiteContactSuggestions(user.id, brand.id) };
  } catch (e) {
    return stepFailure(e);
  }
}

/** The Done screen asks this every 2 seconds: what the website read and the Instagram import have found so far. */
export async function setupFindingsAction(): Promise<{ ok: true; findings: SetupFindings } | StepFailure> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, message: s.errors.signedOut };
  try {
    const brand = await getCurrentBrand(user.id);
    if (!brand || !brand.setupCompleted) return { ok: false, message: s.brand.noBrand };
    return { ok: true, findings: await getSetupFindings(user.id, brand.id) };
  } catch (e) {
    return stepFailure(e);
  }
}
