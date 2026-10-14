import { findPhoneNumbersInText, type CountryCode } from "libphonenumber-js/max";
import { getCurrentBrand, requireBrandMember } from "@/lib/brand/current";
import { listContacts, createContact, deleteContact, importContactsFromFacts } from "@/lib/contacts/service";
import { ContactDuplicateError } from "@/lib/contacts/errors";
import { parseHours } from "@/lib/contacts/hours";
import { normalizeContact, normalizeEmail, normalizePhone } from "@/lib/contacts/normalize";
import { DAY_KEYS, type ContactInput, type ContactKind, type HoursDays } from "@/lib/contacts/types";
import { getDb } from "@/lib/db";
import { getInstagramState, type InstagramStatus } from "@/lib/instagram/import";
import { parseUsp } from "@/lib/usps/schema";
import { seedUspsFromFacts } from "@/lib/usps/service";
import { USP_TITLE_MAX } from "@/lib/usps/types";
import { parseDraft, serializeDraft, MAX_LIKES, type DraftAnswers, type SetupDraft } from "./draft";
import { isIsoCountry } from "./countries";
import { isValidRegion } from "./regions";
import { fieldError } from "./schema";
import { isValidTimezone } from "./timezones";
import { getWebsiteReadSummary, type WebsiteReadSummary } from "./website";

/**
 * What the setup screens save as they go (PRD v3 D-3, change C-01): location, contact points, opening
 * hours, the owner's own selling points, and the draft that lets a reload resume. All of it runs as the
 * signed-in user (row-level security), after a membership check. Nothing here calls the network.
 */

/** One or more answers did not pass; `fieldErrors` is keyed by the answer (phone, email, hours, likes ...), valued with a short code. */
export class SetupDetailsError extends Error {
  constructor(public readonly fieldErrors: Record<string, string>) {
    super("Setup answers are invalid");
    this.name = "SetupDetailsError";
  }
}

// ---------------------------------------------------------------------------
// Draft: the screen and the answers, so a reload resumes (H-16)
// ---------------------------------------------------------------------------

export async function readSetupDraft(userId: string, brandId: string): Promise<SetupDraft | null> {
  await requireBrandMember(userId, brandId);
  const [row] = await getDb().withUser(userId, (tx) =>
    tx.query<{ setup_transcript: string | null }>(
      "select setup_transcript from public.brand_memory where brand_id = $1 and setup_completed_at is null",
      [brandId],
    ),
  );
  return parseDraft(row?.setup_transcript);
}

/** Saves the draft. A brand whose setup is finished is left alone. */
export async function writeSetupDraft(userId: string, brandId: string, draft: SetupDraft): Promise<void> {
  await requireBrandMember(userId, brandId);
  await getDb().withUser(userId, (tx) =>
    tx.query("update public.brand_memory set setup_transcript = $2 where brand_id = $1 and setup_completed_at is null", [
      brandId,
      serializeDraft(draft),
    ]),
  );
}

export interface SetupResume {
  brandId: string;
  draft: SetupDraft | null;
  logoPath: string | null;
}

/** The unfinished brand and its draft for the setup page, or null for a new owner (or one who has finished). */
export async function loadSetupResume(userId: string): Promise<SetupResume | null> {
  const brand = await getCurrentBrand(userId);
  if (!brand || brand.setupCompleted) return null;
  const draft = await readSetupDraft(userId, brand.id);
  const [m] = await getDb().withUser(userId, (tx) =>
    tx.query<{ logo_path: string | null }>("select logo_path from public.brand_memory where brand_id = $1", [brand.id]),
  );
  return { brandId: brand.id, draft, logoPath: m?.logo_path ?? null };
}

// ---------------------------------------------------------------------------
// Where you are
// ---------------------------------------------------------------------------

/** Saves country, region, city and time zone now, because phone numbers are read in the brand's country. */
export async function saveSetupLocation(userId: string, brandId: string, a: DraftAnswers): Promise<void> {
  await requireBrandMember(userId, brandId);
  const errors: Record<string, string> = {};
  const countryErr = fieldError("country", a.country);
  if (countryErr) errors.country = countryErr;
  const zoneErr = !isValidTimezone(a.timezone) ? "invalid_timezone" : null;
  if (zoneErr) errors.timezone = zoneErr;
  const region = a.region.trim();
  if (region !== "" && (!isIsoCountry(a.country) || !isValidRegion(a.country, region))) errors.region = "invalid_region";
  const city = a.city.trim();
  if (city.length > 100) errors.city = "too_long";
  if (Object.keys(errors).length > 0) throw new SetupDetailsError(errors);
  await getDb().withUser(userId, (tx) =>
    tx.query("update public.brand_memory set country = $2, region = $3, city = $4, timezone = $5 where brand_id = $1", [
      brandId,
      a.country,
      region === "" ? null : region,
      city === "" ? null : city,
      a.timezone,
    ]),
  );
}

// ---------------------------------------------------------------------------
// Contact points
// ---------------------------------------------------------------------------

const SCOPES = {
  /** The "online" addresses. */
  addresses: ["website", "instagram", "youtube"],
  /** How customers reach you. */
  reach: ["phone", "whatsapp", "email"],
} as const satisfies Record<string, readonly ContactKind[]>;

export type ContactScope = keyof typeof SCOPES;

interface Wanted {
  field: string;
  input: ContactInput;
}

/** The contact points an answer set asks for in one scope. Empty answers ask for nothing. */
export function wantedContacts(a: DraftAnswers, scope: ContactScope): Wanted[] {
  const out: Wanted[] = [];
  const add = (field: string, kind: ContactKind, value: string) => {
    if (value.trim() !== "") out.push({ field, input: { kind, value: value.trim() } });
  };
  if (scope === "addresses") {
    if (a.online.includes("website")) add("website", "website", a.website);
    if (a.online.includes("instagram")) add("instagram", "instagram", a.instagram);
    if (a.online.includes("youtube")) add("youtube", "youtube", a.youtube);
  } else {
    add("phone", "phone", a.phone);
    // "Same number for WhatsApp": one number, saved twice (as a phone and as a WhatsApp contact).
    if (a.sameWhatsapp) add("phone", "whatsapp", a.phone);
    else add("whatsapp", "whatsapp", a.whatsapp);
    add("email", "email", a.email);
  }
  return out;
}

async function brandCountry(userId: string, brandId: string): Promise<string | null> {
  const [m] = await getDb().withUser(userId, (tx) =>
    tx.query<{ country: string | null }>("select country from public.brand_memory where brand_id = $1", [brandId]),
  );
  return m?.country ?? null;
}

/**
 * Checks what the owner typed for one scope without saving anything: numbers are read in the brand's
 * country, links must be public https addresses, handles must look like handles. Throws SetupDetailsError
 * (keyed by answer: phone, whatsapp, email, website, instagram, youtube) when any is invalid.
 */
export async function checkSetupContacts(userId: string, brandId: string, a: DraftAnswers, scope: ContactScope): Promise<void> {
  await requireBrandMember(userId, brandId);
  const country = await brandCountry(userId, brandId);
  const errors: Record<string, string> = {};
  for (const w of wantedContacts(a, scope)) {
    const n = normalizeContact(w.input, { country });
    if (!n.ok && !(w.field in errors)) errors[w.field] = n.fieldErrors.value ?? Object.values(n.fieldErrors)[0] ?? "invalid";
  }
  if (Object.keys(errors).length > 0) throw new SetupDetailsError(errors);
}

/**
 * Makes the brand's contact points of this scope match the answers: numbers in E.164 (read in the
 * brand's country), links as https, handles without "@". Nothing is written when any answer is invalid
 * (SetupDetailsError). Contacts of other kinds, and anything the owner added elsewhere, are untouched.
 */
export async function applySetupContacts(userId: string, brandId: string, a: DraftAnswers, scope: ContactScope): Promise<void> {
  await checkSetupContacts(userId, brandId, a, scope);
  const country = await brandCountry(userId, brandId);
  const wanted = wantedContacts(a, scope);
  const keep = new Set<string>();
  for (const w of wanted) {
    const n = normalizeContact(w.input, { country });
    if (n.ok) keep.add(`${n.kind}|${n.value}`);
  }

  const kinds = new Set<ContactKind>(SCOPES[scope]);
  const existing = (await listContacts(userId, brandId)).filter((c) => kinds.has(c.kind));
  const have = new Set<string>();
  for (const c of existing) {
    const key = `${c.kind}|${c.value}`;
    if (keep.has(key) && !have.has(key)) have.add(key);
    else await deleteContact(userId, brandId, c.id);
  }
  for (const w of wanted) {
    const n = normalizeContact(w.input, { country });
    if (!n.ok || have.has(`${n.kind}|${n.value}`)) continue;
    try {
      await createContact(userId, brandId, { ...w.input, source: "setup" });
      have.add(`${n.kind}|${n.value}`);
    } catch (e) {
      if (!(e instanceof ContactDuplicateError)) throw e;
    }
  }
}

// ---------------------------------------------------------------------------
// Opening hours
// ---------------------------------------------------------------------------

/** The hours as the contacts library takes them: closed days are empty lists. */
function daysFromDraft(a: DraftAnswers): Record<string, Array<{ open: string; close: string }>> {
  const days: Record<string, Array<{ open: string; close: string }>> = {};
  for (const d of DAY_KEYS) days[d] = a.hours[d].on ? [{ open: a.hours[d].open, close: a.hours[d].close }] : [];
  return days;
}

const ALWAYS_OPEN_TEXT = "Open 24 hours, 7 days";
const APPOINTMENT_TEXT = "By appointment";

async function insertHoursText(userId: string, brandId: string, text: string, details: Record<string, unknown>): Promise<void> {
  await getDb().withUser(userId, (tx) =>
    tx.query(
      `insert into public.contact_points (brand_id, kind, value, display, details, is_default, source, created_by)
       values ($1, 'hours', $2, $2, $3::jsonb, true, 'setup', $4)
       on conflict (brand_id, kind, value) do nothing`,
      [brandId, text, JSON.stringify(details), userId],
    ),
  );
}

/**
 * Saves the brand's one opening-hours contact: per-day hours, "always open" or "by appointment". An empty
 * choice removes it. Invalid hours throw SetupDetailsError({ hours: code }) and change nothing.
 */
export async function applySetupHours(userId: string, brandId: string, a: DraftAnswers): Promise<void> {
  await requireBrandMember(userId, brandId);
  let days: HoursDays | null = null;
  if (a.hoursMode === "days") {
    const parsed = parseHours(daysFromDraft(a));
    if (!parsed.ok) throw new SetupDetailsError({ hours: parsed.error });
    days = parsed.days;
  }
  const existing = (await listContacts(userId, brandId)).filter((c) => c.kind === "hours");
  for (const c of existing) await deleteContact(userId, brandId, c.id);

  if (a.hoursMode === "days" && days) {
    await createContact(userId, brandId, { kind: "hours", days, source: "setup" });
  } else if (a.hoursMode === "always") {
    const allDay = Object.fromEntries(DAY_KEYS.map((d) => [d, [{ open: "00:00", close: "24:00" }]]));
    await insertHoursText(userId, brandId, ALWAYS_OPEN_TEXT, { text: ALWAYS_OPEN_TEXT, mode: "always", days: allDay });
  } else if (a.hoursMode === "appointment") {
    await insertHoursText(userId, brandId, APPOINTMENT_TEXT, { text: APPOINTMENT_TEXT, mode: "appointment" });
  }
}

// ---------------------------------------------------------------------------
// The owner's own selling points
// ---------------------------------------------------------------------------

const LIKE_REF = "setup:like:";

/** The lines to save: trimmed, one space between words, no empty or repeated lines, at most three. */
export function cleanLikes(lines: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of lines) {
    const line = raw.trim().replace(/\s+/g, " ");
    if (line === "" || seen.has(line.toLowerCase())) continue;
    seen.add(line.toLowerCase());
    out.push(line);
  }
  return out.slice(0, MAX_LIKES);
}

/**
 * Saves what customers like as "custom" selling points: source "setup", confirmed (they are the owner's
 * own words), and never touched by AI. Running it again replaces the earlier setup lines, so going back
 * and forth never duplicates them. A line over 60 characters throws SetupDetailsError({ likes: "too_long" }).
 */
export async function applySetupUsps(userId: string, brandId: string, lines: readonly string[]): Promise<void> {
  await requireBrandMember(userId, brandId);
  const titles = cleanLikes(lines);
  for (const title of titles) {
    const ok = parseUsp({ kind: "custom", title, details: {} });
    if (!ok.ok) throw new SetupDetailsError({ likes: title.length > USP_TITLE_MAX ? "too_long" : "invalid" });
  }
  await getDb().withUser(userId, async (tx) => {
    const old = await tx.query<{ id: string; title: string }>(
      "select id, title from public.usps where brand_id = $1 and source_ref like $2 order by source_ref asc",
      [brandId, `${LIKE_REF}%`],
    );
    if (old.length === titles.length && old.every((o, i) => o.title === titles[i])) return;
    await tx.query("delete from public.usps where brand_id = $1 and source_ref like $2", [brandId, `${LIKE_REF}%`]);
    const [next] = await tx.query<{ n: number }>("select coalesce(max(sort), -1)::int + 1 as n from public.usps where brand_id = $1", [brandId]);
    let sort = next?.n ?? 0;
    for (const [i, title] of titles.entries()) {
      await tx.query(
        `insert into public.usps (brand_id, kind, title, details, source, source_ref, confirmed, sort, created_by)
         values ($1, 'custom', $2, '{}'::jsonb, 'setup', $3, true, $4, $5)`,
        [brandId, title, `${LIKE_REF}${i + 1}`, sort, userId],
      );
      sort += 1;
    }
  });
}

// ---------------------------------------------------------------------------
// Prefill from the website read (Path A)
// ---------------------------------------------------------------------------

export interface ContactSuggestions {
  /** International format, ready to show in the phone field; "" when the read has found none. */
  phone: string;
  email: string;
  /** True while the website read is still running (more may arrive). */
  reading: boolean;
}

function phoneFromText(value: string, country: string | null): string {
  const whole = normalizePhone(value, country);
  if (whole.ok) return whole.international;
  try {
    const found = findPhoneNumbersInText(value, (/^[A-Z]{2}$/.test(country ?? "") ? country : undefined) as CountryCode | undefined);
    if (found.length === 1 && found[0].number.isValid()) {
      const p = normalizePhone(found[0].number.number, country);
      if (p.ok) return p.international;
    }
  } catch {
    // no suggestion
  }
  return "";
}

/** The first phone number and email the website read has found so far. Reads the database only; never waits for the read. */
export async function websiteContactSuggestions(userId: string, brandId: string): Promise<ContactSuggestions> {
  await requireBrandMember(userId, brandId);
  const country = await brandCountry(userId, brandId);
  const facts = await getDb().withUser(userId, (tx) =>
    tx.query<{ kind: "phone" | "email"; value: string }>(
      `select kind::text as kind, value from public.brand_facts
        where brand_id = $1 and active and source_type = 'website' and kind in ('phone', 'email')
        order by created_at asc, id asc`,
      [brandId],
    ),
  );
  let phone = "";
  let email = "";
  for (const f of facts) {
    const text = f.value.trim().replace(/\s+/g, " ");
    if (f.kind === "phone" && phone === "") phone = phoneFromText(text, country);
    if (f.kind === "email" && email === "") {
      const inText = text.match(/[^\s@<>()]+@[^\s@<>()]+\.[^\s@<>().,;]+/g) ?? [];
      email = normalizeEmail(text) ?? (inText.length === 1 ? (normalizeEmail(inText[0]) ?? "") : "");
    }
  }
  const summary = await getWebsiteReadSummary(userId, brandId);
  return { phone, email, reading: summary?.state === "reading" };
}

// ---------------------------------------------------------------------------
// The Done screen: what the reads have found so far
// ---------------------------------------------------------------------------

export interface SetupFindings {
  website: WebsiteReadSummary | null;
  instagram: { handle: string; status: InstagramStatus | null; importedPosts: number; available: boolean } | null;
  /** Contact points found by reading the website. */
  contactsFound: number;
  /** Selling points suggested from the website (not yet confirmed by the owner). */
  uspsSuggested: number;
  /** True when every read the owner asked for has ended, so the screen can stop asking. */
  finished: boolean;
}

/**
 * What the website read and the Instagram import have found so far. When the website read has ended with
 * facts it also files them as suggestions (selling points and contact points, each marked with its source
 * and never confirmed for the owner), once: running it again adds nothing. Never waits for a read.
 */
export async function getSetupFindings(userId: string, brandId: string): Promise<SetupFindings> {
  await requireBrandMember(userId, brandId);
  const website = await getWebsiteReadSummary(userId, brandId);
  const websiteAsked = website !== null && website.state !== "none";
  if (website && (website.state === "ok" || website.state === "partial") && website.facts > 0) {
    await seedUspsFromFacts(brandId, userId);
    await importContactsFromFacts(brandId, userId);
  }
  const ig = await getInstagramState(userId, brandId);
  const [counts] = await getDb().withUser(userId, (tx) =>
    tx.query<{ contacts: number; usps: number }>(
      `select (select count(*)::int from public.contact_points where brand_id = $1 and source = 'website') as contacts,
              (select count(*)::int from public.usps where brand_id = $1 and source = 'website' and active) as usps`,
      [brandId],
    ),
  );
  const igAsked = ig.handle !== null;
  const igRunning = igAsked && ig.status === null;
  const finished = !(websiteAsked && website?.state === "reading") && !igRunning;
  return {
    website: websiteAsked ? website : null,
    instagram: igAsked ? { handle: ig.handle as string, status: ig.status, importedPosts: ig.importedPosts, available: ig.available } : null,
    contactsFound: counts?.contacts ?? 0,
    uspsSuggested: counts?.usps ?? 0,
    finished,
  };
}
