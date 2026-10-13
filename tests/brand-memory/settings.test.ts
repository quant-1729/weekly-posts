import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined, push: () => undefined }) }));
vi.mock("@/app/(app)/brand/actions", () => ({ saveSettingsAction: vi.fn() }));

import { EmailStatus, SettingsPanel } from "@/components/brand/settings-section";
import { BrandAccessError } from "@/lib/brand/current";
import type { MockDb } from "@/lib/db/mock";
import { fill, s } from "@/lib/i18n/strings";
import { isRegulatedBrand, parseSettings, REGULATED_CHOICES, settingsFromForm } from "@/lib/memory/schema";
import { getSettings, regulatedGroupLabel, saveSettings, SettingsValidationError, validateSettings } from "@/lib/memory/settings";
import { countryOptions } from "@/lib/setup/countries";
import { languageOptions } from "@/lib/setup/languages";
import { regionsByCountry, timezonesByCountry } from "@/lib/setup/regions";
import { SETUP_FACT_KEYS } from "@/lib/setup/save";
import { closeTestDb, createBrandFor, createUser, openTestDb } from "../brand/helpers";

let db: MockDb;
let owner: string;
let outsider: string;
let brand: string;

beforeAll(async () => {
  db = await openTestDb();
  owner = (await createUser(db)).id;
  outsider = (await createUser(db)).id;
});
afterAll(async () => {
  await closeTestDb(db);
});

const FORM = {
  business_name: "Corner Bakery",
  what_sell: "Sourdough bread, cakes and coffee",
  customers: "Families and office workers nearby",
  country: "GB",
  region: "GB-ENG",
  city: "London",
  timezone: "Europe/London",
  goal: "enquiries",
  tone: "friendly",
  post_language: "en-GB",
  minutes_per_post: "30",
  schedule_weekday: 1,
  schedule_time: "08:00",
  link_destination: "",
  regulated: "",
};

beforeEach(async () => {
  brand = await createBrandFor(db, owner, "Placeholder");
  // The state after setup: the answers plus the two setup facts.
  await saveSettings(owner, brand, FORM);
  await db.withAdmin(async (tx) => {
    await tx.query("delete from public.brand_facts where brand_id = $1", [brand]);
    await tx.query(
      `insert into public.brand_facts (brand_id, kind, label, value, source_type, source_ref, source_quote) values
         ($1, 'product', 'What we sell', $2, 'setup', 'what_sell', $2),
         ($1, 'other', 'Our customers', $3, 'setup', 'customers', $3)`,
      [brand, FORM.what_sell, FORM.customers],
    );
  });
});

const row = async () =>
  (
    await db.withAdmin((tx) =>
      tx.query<Record<string, unknown>>(
        `select business_name, category, audience, country, region, city, timezone, goal::text as goal, tone, post_language, minutes_per_post,
                schedule_weekday, to_char(schedule_time, 'HH24:MI') as schedule_time, link_destination, regulated::text as regulated,
                (select name from public.brands where id = $1) as brand_name
           from public.brand_memory where brand_id = $1`,
        [brand],
      ),
    )
  )[0];
const factRows = () =>
  db.withAdmin((tx) =>
    tx.query<{ value: string; source_type: string; source_ref: string | null; active: boolean }>(
      "select value, source_type::text, source_ref, active from public.brand_facts where brand_id = $1 order by created_at, id",
      [brand],
    ),
  );

describe("settings save and read back", () => {
  it("reads the saved settings as a form", async () => {
    const v = await getSettings(owner, brand);
    expect(v.form).toEqual({ ...FORM, minutes_per_post: "30", regulated: "" });
    expect(v.detected).toBe("none");
    expect(v.email).toEqual({ pausedUntil: null, unsubscribedAt: null });
  });

  it("saves every setting, including where links go, and renames the business", async () => {
    await saveSettings(owner, brand, {
      ...FORM,
      business_name: "Corner Bakery & Cafe",
      what_sell: "Bread and coffee",
      customers: "Students",
      country: "US",
      region: "US-OR",
      city: "Portland",
      timezone: "America/Los_Angeles",
      goal: "footfall",
      tone: "like_past_posts",
      post_language: "en-US",
      minutes_per_post: "45",
      schedule_weekday: "5",
      schedule_time: "17:30",
      link_destination: "www.cornerbakery.example/book",
    });
    expect(await row()).toMatchObject({
      business_name: "Corner Bakery & Cafe",
      brand_name: "Corner Bakery & Cafe",
      category: "Bread and coffee",
      audience: "Students",
      country: "US",
      region: "US-OR",
      city: "Portland",
      timezone: "America/Los_Angeles",
      goal: "footfall",
      tone: "like_past_posts",
      post_language: "en-US",
      minutes_per_post: 45,
      schedule_weekday: 5,
      schedule_time: "17:30",
      link_destination: "https://www.cornerbakery.example/book",
      regulated: null,
    });
    // an empty link destination goes back to "use the website"
    await saveSettings(owner, brand, { ...FORM, link_destination: "  " });
    expect((await row()).link_destination).toBeNull();
  });

  it("validates with the setup rules and writes nothing when something is wrong", async () => {
    const before = await row();
    const bad = async (over: Record<string, unknown>) => {
      const e = (await saveSettings(owner, brand, { ...FORM, ...over }).catch((x) => x)) as SettingsValidationError;
      expect(e).toBeInstanceOf(SettingsValidationError);
      return e.fieldErrors;
    };
    expect(await bad({ business_name: "   " })).toEqual({ business_name: "required" });
    expect(await bad({ business_name: "x".repeat(101) })).toEqual({ business_name: "too_long" });
    expect(await bad({ what_sell: "" })).toEqual({ what_sell: "required" });
    expect(await bad({ country: "ZZ" })).toMatchObject({ country: "invalid_country" });
    expect(await bad({ region: "GB-XXX" })).toEqual({ region: "invalid_region" });
    expect(await bad({ country: "US", region: "GB-ENG" })).toEqual({ region: "invalid_region" });
    expect(await bad({ timezone: "Mars/Olympus" })).toEqual({ timezone: "invalid_timezone" });
    expect(await bad({ goal: "fame" })).toMatchObject({ goal: expect.any(String) });
    expect(await bad({ post_language: "English!" })).toEqual({ post_language: "invalid_language" });
    expect(await bad({ minutes_per_post: "0" })).toEqual({ minutes_per_post: "invalid_minutes" });
    expect(await bad({ minutes_per_post: "601" })).toEqual({ minutes_per_post: "invalid_minutes" });
    expect(await bad({ minutes_per_post: "" })).toMatchObject({ minutes_per_post: expect.any(String) });
    expect(await bad({ schedule_weekday: 8 })).toEqual({ schedule_weekday: "invalid_weekday" });
    expect(await bad({ schedule_time: "25:00" })).toEqual({ schedule_time: "invalid_time" });
    expect(await bad({ link_destination: "javascript:alert(1)" })).toEqual({ link_destination: "invalid_url" });
    expect(await bad({ link_destination: "ftp://files.example.com" })).toEqual({ link_destination: "invalid_url" });
    expect(await bad({ regulated: "tobacco" })).toMatchObject({ regulated: expect.any(String) });
    expect(await row()).toEqual(before);
  });

  it("the form and the server use the same checks", () => {
    expect(parseSettings(settingsFromForm({ ...FORM, minutes_per_post: "0" })).ok).toBe(false);
    expect(validateSettings({ ...FORM, minutes_per_post: "0" }).ok).toBe(false);
    expect(validateSettings(FORM).ok).toBe(true);
  });

  it("is members only", async () => {
    await expect(getSettings(outsider, brand)).rejects.toBeInstanceOf(BrandAccessError);
    await expect(saveSettings(outsider, brand, { ...FORM, business_name: "Hijacked" })).rejects.toBeInstanceOf(BrandAccessError);
    expect((await row()).business_name).toBe("Corner Bakery");
  });
});

describe("what you sell also updates the setup-sourced fact", () => {
  it("replaces the setup fact when the answer changes, keeping the old row", async () => {
    await saveSettings(owner, brand, { ...FORM, what_sell: "Bread, cakes and wedding cakes", customers: "Brides" });
    const facts = await factRows();
    const sell = facts.filter((f) => f.source_ref === SETUP_FACT_KEYS.whatSell);
    expect(sell.map((f) => [f.value, f.active])).toEqual([
      [FORM.what_sell, false],
      ["Bread, cakes and wedding cakes", true],
    ]);
    expect(sell.every((f) => f.source_type === "setup")).toBe(true);
    const cust = facts.filter((f) => f.source_ref === SETUP_FACT_KEYS.customers);
    expect(cust.map((f) => [f.value, f.active])).toEqual([
      [FORM.customers, false],
      ["Brides", true],
    ]);
  });

  it("writes no new facts when nothing changed", async () => {
    await saveSettings(owner, brand, { ...FORM, city: "Leeds" });
    expect(await factRows()).toHaveLength(2);
  });

  it("an owner's edit of the setup fact stops being used when the answer changes in settings", async () => {
    const [setupFact] = await db.withAdmin((tx) => tx.query<{ id: string }>("select id from public.brand_facts where brand_id = $1 and source_ref = 'what_sell'", [brand]));
    await db.withAdmin(async (tx) => {
      await tx.query("update public.brand_facts set active = false where id = $1", [setupFact.id]);
      await tx.query(
        "insert into public.brand_facts (brand_id, kind, label, value, source_type, source_ref) values ($2, 'product', 'What we sell', 'My edit', 'owner', $1)",
        [setupFact.id, brand],
      );
    });
    await saveSettings(owner, brand, { ...FORM, what_sell: "Pastries" });
    const active = (await factRows()).filter((f) => f.active && (f.source_ref === "what_sell" || f.value === "My edit" || f.value === "Pastries"));
    expect(active.map((f) => f.value)).toEqual(["Pastries"]);
  });
});

describe("regulated category", () => {
  it("shows the detected group, and automatic is the default", async () => {
    await saveSettings(owner, brand, { ...FORM, what_sell: "Dental clinic and orthodontics" });
    const v = await getSettings(owner, brand);
    expect(v.detected).toBe("health");
    expect(v.form.regulated).toBe("");
    expect((await row()).regulated).toBeNull();
    expect(regulatedGroupLabel(v.detected)).toBe("Health");
    expect(fill(s.brandV2.settings.regulatedDetected, { group: regulatedGroupLabel(v.detected) })).toBe("We think: Health");

    const html = renderPanel(v.form, v.detected);
    expect(html).toContain("We think: Health");
    expect(html).toContain(`${s.brandV2.settings.regulatedAutomatic} (We think: Health)`);
  });

  it("saves the owner's choice for every option, and goes back to automatic with null", async () => {
    await saveSettings(owner, brand, { ...FORM, what_sell: "Dental clinic" });
    for (const choice of REGULATED_CHOICES) {
      await saveSettings(owner, brand, { ...FORM, what_sell: "Dental clinic", regulated: choice });
      expect((await row()).regulated).toBe(choice);
      expect((await getSettings(owner, brand)).form.regulated).toBe(choice);
    }
    // the choice overrides what we detect, in both directions
    await saveSettings(owner, brand, { ...FORM, what_sell: "Dental clinic", regulated: "none" });
    const v = await getSettings(owner, brand);
    expect(v.detected).toBe("health");
    expect(isRegulatedBrand(v.form.regulated || null, v.detected)).toBe(false);
    expect(isRegulatedBrand("legal", "none")).toBe(true);
    expect(isRegulatedBrand("other", "none")).toBe(true);
    expect(isRegulatedBrand(null, "health")).toBe(true);
    expect(isRegulatedBrand(null, "none")).toBe(false);

    // back to automatic
    await saveSettings(owner, brand, { ...FORM, what_sell: "Dental clinic", regulated: "" });
    expect((await row()).regulated).toBeNull();
    await saveSettings(owner, brand, { ...FORM, what_sell: "Dental clinic", regulated: null });
    expect((await row()).regulated).toBeNull();
  });

  it("shows the advertising-rules reminder for a regulated business only", () => {
    const form = { ...FORM, minutes_per_post: "30", regulated: "" } as never;
    expect(renderPanel(form, "health")).toContain(s.brandV2.settings.regulatedReminder); // detected
    expect(renderPanel(form, "none")).not.toContain(s.brandV2.settings.regulatedReminder);
    expect(renderPanel({ ...FORM, minutes_per_post: "30", regulated: "legal" } as never, "none")).toContain(s.brandV2.settings.regulatedReminder); // chosen
    expect(renderPanel({ ...FORM, minutes_per_post: "30", regulated: "none" } as never, "health")).not.toContain(s.brandV2.settings.regulatedReminder); // chosen: none
  });

  it("offers none, health, finance, alcohol, legal and other, plus automatic", () => {
    const html = renderPanel({ ...FORM, minutes_per_post: "30", regulated: "" } as never, "none");
    for (const label of ["None", "Health", "Finance", "Alcohol", "Legal", "Other"]) expect(html).toContain(`>${label}</option>`);
    expect(html).toContain(">Automatic (We think: None)</option>");
  });
});

describe("email status is read-only", () => {
  it("shows on, paused and unsubscribed, with no way to change them yet", async () => {
    expect(renderToString(createElement(EmailStatus, { email: { pausedUntil: null, unsubscribedAt: null } }))).toContain(s.brandV2.settings.emailOn);
    await db.withAdmin((tx) => tx.query("update public.brand_memory set email_paused_until = '2026-11-20' where brand_id = $1", [brand]));
    let v = await getSettings(owner, brand);
    expect(v.email.pausedUntil).toBe("2026-11-20");
    expect(renderToString(createElement(EmailStatus, { email: v.email }))).toContain("Weekly emails are paused until 20 Nov 2026.");
    await db.withAdmin((tx) => tx.query("update public.brand_memory set email_unsubscribed_at = '2026-10-01T10:00:00Z' where brand_id = $1", [brand]));
    v = await getSettings(owner, brand);
    expect(renderToString(createElement(EmailStatus, { email: v.email }))).toContain("You unsubscribed on 1 Oct 2026, so we do not send weekly emails.");
    expect(renderToString(createElement(EmailStatus, { email: v.email }))).not.toContain("<button");
  });
});

function renderPanel(form: Parameters<typeof SettingsPanel>[0]["initial"], detected: string): string {
  return renderToString(
    createElement(SettingsPanel, {
      brandId: brand,
      initial: form,
      detected,
      email: { pausedUntil: null, unsubscribedAt: null },
      websiteUrl: "https://cornerbakery.example",
      countries: countryOptions(),
      regions: regionsByCountry(),
      zonesByCountry: timezonesByCountry(),
      languages: languageOptions(),
    }),
  );
}

describe("the settings form", () => {
  it("shows every setting, with the link question in the owner's words", async () => {
    const html = renderPanel((await getSettings(owner, brand)).form, "none");
    for (const label of [
      s.brandV2.settings.businessName,
      s.brandV2.settings.whatSell,
      s.brandV2.settings.customers,
      s.brandV2.settings.country,
      s.brandV2.settings.city,
      s.brandV2.settings.timezone,
      s.brandV2.settings.goal,
      s.brandV2.settings.tone,
      s.brandV2.settings.postLanguage,
      s.brandV2.settings.minutes,
      s.brandV2.settings.weekday,
      s.brandV2.settings.time,
    ]) {
      expect(html).toContain(label);
    }
    expect(html).toContain("Where should &quot;learn more&quot; links go?");
    expect(html).toContain('value="Corner Bakery"');
    expect(html).toContain('placeholder="https://cornerbakery.example"'); // the default is the website
  });
});
