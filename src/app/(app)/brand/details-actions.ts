"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { BrandAccessError } from "@/lib/brand/current";
import { ContactDuplicateError, ContactLimitError, ContactNotFoundError, ContactValidationError } from "@/lib/contacts/errors";
import { createContact, deleteContact, setContactDefault, updateContact, verifyContact } from "@/lib/contacts/service";
import { LINK_KINDS, type ContactPoint } from "@/lib/contacts/types";
import { s } from "@/lib/i18n/strings";
import { describeMemoryError, type MemoryFailure } from "@/lib/memory/errors";
import { UspLimitError, UspNotFoundError, UspValidationError } from "@/lib/usps/errors";
import { createUsp, reorderUsps, setUspActive, setUspConfirmed, updateUsp } from "@/lib/usps/service";
import type { Usp } from "@/lib/usps/types";

/**
 * Server actions for the "Your selling points" and "How customers reach you" sections of the
 * brand page. Each checks the signed-in user first; the library functions then check brand
 * membership and validate every field again.
 */

export type DetailsResult<T = object> = ({ ok: true } & T) | MemoryFailure;

const signedOut: MemoryFailure = { ok: false, code: "generic", message: s.errors.signedOut };
const str = (v: unknown) => (typeof v === "string" ? v : "");

/** Rule messages from the USP details schema are sentences already; short codes map to text. */
function uspText(code: string): string {
  const t = s.usps.errors as Record<string, string>;
  return t[code] ?? (code.includes(" ") ? code : t.invalid);
}

function describe(e: unknown): MemoryFailure {
  const u = s.usps.errors;
  const c = s.contacts.errors as Record<string, string>;
  if (e instanceof UspValidationError) {
    return { ok: false, code: "validation", message: u.invalid, fieldErrors: Object.fromEntries(Object.entries(e.fieldErrors).map(([k, v]) => [k, uspText(v)])) };
  }
  if (e instanceof UspNotFoundError) return { ok: false, code: "not_found", message: u.not_found };
  if (e instanceof UspLimitError) return { ok: false, code: "validation", message: u.limit };
  if (e instanceof ContactValidationError) {
    return { ok: false, code: "validation", message: c.invalid, fieldErrors: Object.fromEntries(Object.entries(e.fieldErrors).map(([k, v]) => [k, c[v] ?? c.invalid])) };
  }
  if (e instanceof ContactDuplicateError) return { ok: false, code: "validation", message: e.single ? c.duplicate_single : c.duplicate };
  if (e instanceof ContactNotFoundError) return { ok: false, code: "not_found", message: c.not_found };
  if (e instanceof ContactLimitError) return { ok: false, code: "validation", message: c.limit };
  if (e instanceof BrandAccessError) return { ok: false, code: "not_found", message: s.brandV2.notFound };
  return describeMemoryError(e);
}

async function run<T extends object>(fn: (userId: string) => Promise<T>): Promise<DetailsResult<T>> {
  const user = await getCurrentUser();
  if (!user) return signedOut;
  try {
    const done = await fn(user.id);
    revalidatePath("/brand");
    return { ok: true, ...done };
  } catch (e) {
    return describe(e);
  }
}

// --- Selling points ---------------------------------------------------------

export async function createUspAction(brandId: string, input: unknown): Promise<DetailsResult<{ usp: Usp }>> {
  return run(async (userId) => ({ usp: await createUsp(userId, str(brandId), input) }));
}

export async function updateUspAction(brandId: string, id: string, input: unknown): Promise<DetailsResult<{ usp: Usp }>> {
  return run(async (userId) => ({ usp: await updateUsp(userId, str(brandId), str(id), input) }));
}

/** "Remove": the point stops being used and stays out of the list; it is not suggested again. */
export async function removeUspAction(brandId: string, id: string): Promise<DetailsResult> {
  return run(async (userId) => {
    await setUspActive(userId, str(brandId), str(id), false);
    return {};
  });
}

export async function reorderUspsAction(brandId: string, orderedIds: string[]): Promise<DetailsResult> {
  return run(async (userId) => {
    await reorderUsps(userId, str(brandId), Array.isArray(orderedIds) ? orderedIds.map(str) : []);
    return {};
  });
}

/** The owner ticks "I confirm this is true". The only way a point becomes confirmed. */
export async function confirmUspAction(brandId: string, id: string, confirmed: boolean): Promise<DetailsResult<{ usp: Usp }>> {
  return run(async (userId) => ({ usp: await setUspConfirmed(userId, str(brandId), str(id), confirmed === true) }));
}

// --- Contacts ---------------------------------------------------------------

/** Checks a new or changed link after the response is sent, so saving never waits for the other site. */
function verifyLater(userId: string, brandId: string, c: ContactPoint): void {
  if (!LINK_KINDS.has(c.kind)) return;
  after(async () => {
    try {
      await verifyContact(userId, brandId, c.id);
    } catch {
      // The badge simply stays "not checked".
    }
  });
}

export async function createContactAction(brandId: string, input: unknown): Promise<DetailsResult<{ contact: ContactPoint }>> {
  return run(async (userId) => {
    const contact = await createContact(userId, str(brandId), input);
    verifyLater(userId, str(brandId), contact);
    return { contact };
  });
}

export async function updateContactAction(brandId: string, id: string, input: unknown): Promise<DetailsResult<{ contact: ContactPoint }>> {
  return run(async (userId) => {
    const contact = await updateContact(userId, str(brandId), str(id), input);
    if (!contact.verifiedAt) verifyLater(userId, str(brandId), contact);
    return { contact };
  });
}

export async function setContactDefaultAction(brandId: string, id: string, isDefault: boolean): Promise<DetailsResult<{ contact: ContactPoint }>> {
  return run(async (userId) => ({ contact: await setContactDefault(userId, str(brandId), str(id), isDefault === true) }));
}

export async function removeContactAction(brandId: string, id: string): Promise<DetailsResult> {
  return run(async (userId) => {
    if (!(await deleteContact(userId, str(brandId), str(id)))) throw new ContactNotFoundError();
    return {};
  });
}

/** The "Check link" button: waits for the answer (a few seconds at most). */
export async function checkContactLinkAction(brandId: string, id: string): Promise<DetailsResult<{ reachable: boolean }>> {
  return run(async (userId) => {
    const r = await verifyContact(userId, str(brandId), str(id));
    return { reachable: r?.reachable === true };
  });
}
