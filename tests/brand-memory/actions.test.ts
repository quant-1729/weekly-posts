import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const jar = vi.hoisted(() => {
  const store = new Map<string, string>();
  return {
    store,
    api: {
      get: (name: string) => (store.has(name) ? { name, value: store.get(name)! } : undefined),
      set: (name: string, value: string) => void store.set(name, value),
      delete: (name: string) => void store.delete(name),
    },
  };
});
vi.mock("next/headers", () => ({ cookies: async () => jar.api, headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

import {
  addFactAction,
  addOwnerDateAction,
  applyWebsiteLogoAction,
  editFactAction,
  removeFactAction,
  removeOwnerDateAction,
  rereadWebsiteAction,
  saveColorsAction,
  saveSettingsAction,
} from "@/app/(app)/brand/actions";
import { SESSION_COOKIE } from "@/lib/auth/session";
import { signSession } from "../helpers/session";
import type { MockDb } from "@/lib/db/mock";
import { s } from "@/lib/i18n/strings";
import { listFacts } from "@/lib/memory/facts";
import { getSettings } from "@/lib/memory/settings";
import { listOwnerDates } from "@/lib/occasions/owner-dates";
import { closeTestDb, createBrandFor, createUser, openTestDb } from "../brand/helpers";

let db: MockDb;
let owner: string;
let outsider: string;
let brand: string;

async function signIn(userId: string | null) {
  if (userId === null) jar.store.delete(SESSION_COOKIE);
  else jar.store.set(SESSION_COOKIE, await signSession({ id: userId, email: `${userId.slice(0, 6)}@example.com` }));
}

beforeAll(async () => {
  db = await openTestDb();
  owner = (await createUser(db)).id;
  outsider = (await createUser(db)).id;
  brand = await createBrandFor(db, owner, "Corner Bakery");
});
afterAll(async () => {
  await closeTestDb(db);
});
beforeEach(async () => {
  await db.withAdmin((tx) => tx.query("delete from public.brand_facts where brand_id = $1", [brand]));
  await signIn(owner);
});

const FORM = {
  business_name: "Corner Bakery",
  what_sell: "Bread",
  customers: "Locals",
  country: "GB",
  region: "",
  city: "",
  timezone: "Europe/London",
  goal: "awareness",
  tone: "friendly",
  post_language: "en-GB",
  minutes_per_post: "20",
  schedule_weekday: 1,
  schedule_time: "08:00",
  link_destination: "",
  regulated: "",
};

describe("the owner can do everything through the actions", () => {
  it("adds, edits and removes a fact, and the changes persist", async () => {
    const add = await addFactAction(brand, { kind: "offer", label: "", value: "Free coffee" });
    expect(add.ok).toBe(true);
    const id = add.ok ? add.fact.id : "";
    expect((await editFactAction(brand, id, { kind: "offer", label: "Friday", value: "Free coffee on Fridays" })).ok).toBe(true);
    expect((await listFacts(owner, brand)).map((f) => f.value)).toEqual(["Free coffee on Fridays"]);
    expect((await removeFactAction(brand, id)).ok).toBe(true);
    expect(await listFacts(owner, brand)).toEqual([]);
    expect(await removeFactAction(brand, id)).toMatchObject({ ok: false, code: "not_found" });
  });

  it("says what is wrong with a fact", async () => {
    expect(await addFactAction(brand, { kind: "offer", label: "", value: "" })).toMatchObject({ ok: false, code: "validation", fieldErrors: { value: "value_required" } });
  });

  it("saves colours, owner dates and settings", async () => {
    expect((await saveColorsAction(brand, { primary: "#112233", secondary: "#EEF0F2", accent: "#FF8800" })).ok).toBe(true);
    expect(await saveColorsAction(brand, { primary: "nope" })).toMatchObject({ ok: false, code: "validation" });

    const d = await addOwnerDateAction(brand, { date: "2026-11-12", name: "Anniversary", yearly: true });
    expect(d.ok).toBe(true);
    expect(await addOwnerDateAction(brand, { date: "2026-11-31", name: "Bad", yearly: true })).toMatchObject({ ok: false, message: s.brandV2.dates.errors.date });
    expect((await listOwnerDates(owner, brand)).map((x) => x.name)).toEqual(["Anniversary"]);
    expect((await removeOwnerDateAction(brand, d.ok ? d.date.id : "")).ok).toBe(true);

    expect((await saveSettingsAction(brand, { ...FORM, goal: "footfall", regulated: "finance" })).ok).toBe(true);
    const v = await getSettings(owner, brand);
    expect(v.form).toMatchObject({ goal: "footfall", regulated: "finance" });
    expect(await saveSettingsAction(brand, { ...FORM, timezone: "Nowhere/Land" })).toMatchObject({ ok: false, code: "validation", fieldErrors: { timezone: "invalid_timezone" } });
  });

  it("reads the website through the action and reports a bad address in plain words", async () => {
    expect(await rereadWebsiteAction(brand, "ftp://nope.example")).toMatchObject({ ok: false, message: s.brandV2.facts.reread.invalidUrl });
    const removed = await rereadWebsiteAction(brand, "");
    expect(removed.ok && removed.outcome).toMatchObject({ status: "none", websiteUrl: null });
    expect(await applyWebsiteLogoAction(brand)).toMatchObject({ ok: false, message: s.brandV2.look.offerFailed });
  });
});

describe("members only, for every action", () => {
  it("a signed-out visitor is refused", async () => {
    await signIn(null);
    const refused = { ok: false, message: s.errors.signedOut };
    expect(await addFactAction(brand, { kind: "other", label: "", value: "x" })).toMatchObject(refused);
    expect(await editFactAction(brand, "x", {})).toMatchObject(refused);
    expect(await removeFactAction(brand, "x")).toMatchObject(refused);
    expect(await rereadWebsiteAction(brand, "https://a.example")).toMatchObject(refused);
    expect(await applyWebsiteLogoAction(brand)).toMatchObject(refused);
    expect(await saveColorsAction(brand, {})).toMatchObject(refused);
    expect(await addOwnerDateAction(brand, { date: "2026-11-12", name: "x", yearly: true })).toMatchObject(refused);
    expect(await removeOwnerDateAction(brand, "x")).toMatchObject(refused);
    expect(await saveSettingsAction(brand, FORM)).toMatchObject(refused);
  });

  it("a signed-in user outside the brand is refused and nothing changes", async () => {
    const fact = await addFactAction(brand, { kind: "other", label: "", value: "Private" });
    const factId = fact.ok ? fact.fact.id : "";
    await signIn(outsider);
    const refused = { ok: false, code: "not_found" };
    expect(await addFactAction(brand, { kind: "other", label: "", value: "x" })).toMatchObject(refused);
    expect(await editFactAction(brand, factId, { kind: "other", label: "", value: "Hijacked" })).toMatchObject(refused);
    expect(await removeFactAction(brand, factId)).toMatchObject(refused);
    expect(await rereadWebsiteAction(brand, "https://a.example")).toMatchObject(refused);
    expect(await applyWebsiteLogoAction(brand)).toMatchObject(refused);
    expect(await saveColorsAction(brand, { primary: "#112233", secondary: "#EEF0F2", accent: "#FF8800" })).toMatchObject(refused);
    expect(await addOwnerDateAction(brand, { date: "2026-11-12", name: "x", yearly: true })).toMatchObject(refused);
    expect(await removeOwnerDateAction(brand, "11111111-1111-4111-8111-111111111111")).toMatchObject(refused);
    expect(await saveSettingsAction(brand, { ...FORM, business_name: "Hijacked" })).toMatchObject(refused);

    await signIn(owner);
    expect((await listFacts(owner, brand)).map((f) => f.value)).toEqual(["Private"]);
    expect((await getSettings(owner, brand)).form.business_name).not.toBe("Hijacked");
  });
});
