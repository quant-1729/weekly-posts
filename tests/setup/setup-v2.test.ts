import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

// ---- mocks (hoisted) -----------------------------------------------------------------------
// The signed-in user comes from a cookie jar, as in the sign-in tests.
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

// The page redirects by throwing, like Next does.
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
  useRouter: () => ({ push: () => undefined }),
}));

// The website reader is mocked: no network, and each test decides how it ends.
const reader = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("@/lib/website/extract", () => ({ readWebsiteFacts: reader.read }));

import Page from "@/app/(app)/setup/page";
import { SetupWizard } from "@/app/(app)/setup/setup-wizard";
import {
  completeSetupAction,
  startWebsiteReadAction,
  websiteStatusAction,
} from "@/app/(app)/setup/actions";
import { SESSION_COOKIE, signSession } from "@/lib/auth/session";
import type { MockDb } from "@/lib/db/mock";
import { s } from "@/lib/i18n/strings";
import { countryOptions, ISO_COUNTRY_CODES, isIsoCountry, regionOfLocale } from "@/lib/setup/countries";
import { defaultPostLanguage, languageOptions, POST_LANGUAGE_CODES } from "@/lib/setup/languages";
import { regionsByCountry, timezonesByCountry } from "@/lib/setup/regions";
import { completeSetupV2, SetupValidationError } from "@/lib/setup/save";
import { parseSetup } from "@/lib/setup/schema";
import { SETUP_STEPS, stepsFor } from "@/lib/setup/steps";
import { browserTimezone, countryOfTimezone, describeTimezone, isValidTimezone } from "@/lib/setup/timezones";
import { validateSetup } from "@/lib/setup/validate";
import { runWebsiteRead } from "@/lib/setup/website";
import { closeTestDb, createBrandFor, createUser, openTestDb } from "../brand/helpers";

let db: MockDb;
let userId: string;
let userN = 0;

const ANSWERS = {
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
  minutes_per_post: 30,
  website_url: "",
  schedule_weekday: 1,
  schedule_time: "08:00",
};

async function signIn(): Promise<string> {
  userN += 1;
  const u = await createUser(db);
  userId = u.id;
  jar.store.set(SESSION_COOKIE, await signSession({ id: u.id, email: `owner${userN}@example.com` }));
  return u.id;
}

const memory = async (brandId: string) =>
  (
    await db.withAdmin((tx) =>
      tx.query<Record<string, unknown>>(
        `select business_name, category, audience, country, region, city, timezone, goal::text as goal, tone,
                post_language, minutes_per_post, website_url, website_status::text as website_status,
                website_read_at, schedule_weekday, to_char(schedule_time, 'HH24:MI') as schedule_time,
                link_destination, (setup_completed_at is not null) as completed
           from public.brand_memory where brand_id = $1`,
        [brandId],
      ),
    )
  )[0];

const facts = (brandId: string, source = "setup") =>
  db.withAdmin((tx) =>
    tx.query<{ kind: string; label: string; value: string; source_type: string; source_ref: string; active: boolean }>(
      `select kind::text as kind, label, value, source_type::text as source_type, source_ref, active
         from public.brand_facts where brand_id = $1 and source_type = $2::public.fact_source order by source_ref`,
      [brandId, source],
    ),
  );

const brandCount = (uid: string) =>
  db
    .withAdmin((tx) => tx.query<{ n: number }>("select count(*)::int as n from public.brand_members where user_id = $1", [uid]))
    .then((r) => r[0].n);

/** A fake reader that ends the way the real one would, writing its own result. */
function readerEnding(status: "ok" | "partial" | "blocked" | "failed", factCount = 0) {
  return async (args: { userId: string; brandId: string; url: string }) => {
    await db.withUser(args.userId, async (tx) => {
      for (let i = 0; i < factCount; i++) {
        await tx.query(
          `insert into public.brand_facts (brand_id, kind, label, value, source_type, source_ref, source_quote)
           values ($1, 'product', $2, $3, 'website', $4, $3)`,
          [args.brandId, `Fact ${i}`, `Value ${i}`, `${args.url}/page-${i % 4}`],
        );
      }
      await tx.query(
        `update public.brand_memory set website_url = $2, website_status = $3::public.website_status, website_read_at = now()
          where brand_id = $1`,
        [args.brandId, args.url, status],
      );
    });
    return { status };
  };
}

const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  db = await openTestDb();
});
afterAll(async () => {
  await closeTestDb(db);
});
beforeEach(async () => {
  reader.read.mockReset();
  reader.read.mockImplementation(readerEnding("ok", 3));
  await signIn();
});

// ---------------------------------------------------------------------------------------------

describe("setup v2 without a website (AC 2/6)", () => {
  it("saves every answer into brand_memory and finishes setup; website_status stays 'none'", async () => {
    const res = await completeSetupAction(ANSWERS);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.hasWebsite).toBe(false);

    const m = await memory(res.brandId);
    expect(m).toMatchObject({
      business_name: "Corner Bakery",
      category: "Sourdough bread, cakes and coffee", // kept filled for regulated detection
      audience: "Families and office workers nearby",
      country: "GB",
      region: "GB-ENG",
      city: "London",
      timezone: "Europe/London",
      goal: "enquiries",
      tone: "friendly",
      post_language: "en-GB",
      minutes_per_post: 30,
      website_url: null,
      website_status: "none",
      website_read_at: null,
      schedule_weekday: 1,
      schedule_time: "08:00",
      link_destination: null,
      completed: true,
    });
    const [brand] = await db.withAdmin((tx) => tx.query<{ name: string }>("select name from public.brands where id = $1", [res.brandId]));
    expect(brand.name).toBe("Corner Bakery");
    expect(reader.read).not.toHaveBeenCalled();
  });

  it("stores 'what you sell' and 'your customers' as setup facts with the question key as source", async () => {
    const res = await completeSetupAction(ANSWERS);
    if (!res.ok) throw new Error("setup failed");
    const rows = await facts(res.brandId);
    expect(rows).toEqual([
      { kind: "other", label: s.setupV2.factLabels.customers, value: ANSWERS.customers, source_type: "setup", source_ref: "customers", active: true },
      { kind: "product", label: s.setupV2.factLabels.whatSell, value: ANSWERS.what_sell, source_type: "setup", source_ref: "what_sell", active: true },
    ]);
  });

  it("keeps the other choices: playful / like my past posts, footfall, a late weekday and time, other language", async () => {
    const res = await completeSetupAction({
      ...ANSWERS,
      goal: "footfall",
      tone: "like_past_posts",
      post_language: "hi",
      schedule_weekday: 7,
      schedule_time: "21:30",
      timezone: "Asia/Kolkata",
      country: "IN",
      region: "IN-MH",
    });
    if (!res.ok) throw new Error(JSON.stringify(res));
    expect(await memory(res.brandId)).toMatchObject({
      goal: "footfall",
      tone: "like_past_posts",
      post_language: "hi",
      schedule_weekday: 7,
      schedule_time: "21:30",
      timezone: "Asia/Kolkata",
      region: "IN-MH",
    });
  });

  it("an empty region and city are stored as null", async () => {
    const res = await completeSetupAction({ ...ANSWERS, region: "", city: "  " });
    if (!res.ok) throw new Error("setup failed");
    expect(await memory(res.brandId)).toMatchObject({ region: null, city: null });
  });

  it("is one business per account: a second setup is refused and makes no second brand", async () => {
    const first = await completeSetupAction(ANSWERS);
    expect(first.ok).toBe(true);
    const second = await completeSetupAction({ ...ANSWERS, business_name: "Another Shop" });
    expect(second).toMatchObject({ ok: false, message: s.setupV2.errors.already_done });
    expect(await brandCount(userId)).toBe(1);
    const started = await startWebsiteReadAction({ businessName: "Another Shop", url: "https://example.com" });
    expect(started.ok).toBe(false);
    expect(reader.read).not.toHaveBeenCalled();
  });

  it("an invalid submission writes nothing, not even a brand", async () => {
    const res = await completeSetupAction({ ...ANSWERS, minutes_per_post: 0 });
    expect(res).toMatchObject({ ok: false, fieldErrors: { minutes_per_post: "invalid_minutes" } });
    expect(await brandCount(userId)).toBe(0);
  });

  it("another owner's data is not touched", async () => {
    const other = (await createUser(db)).id;
    const otherBrand = await createBrandFor(db, other, "Other Shop");
    const res = await completeSetupAction(ANSWERS);
    if (!res.ok) throw new Error("setup failed");
    expect(res.brandId).not.toBe(otherBrand);
    expect((await memory(otherBrand)).completed).toBe(false);
  });

  it("is signed-out safe", async () => {
    jar.store.clear();
    expect(await completeSetupAction(ANSWERS)).toMatchObject({ ok: false });
    expect(await startWebsiteReadAction({ businessName: "x", url: "https://example.com" })).toMatchObject({ ok: false });
    expect(await websiteStatusAction()).toMatchObject({ ok: false });
  });
});

describe("setup v2 with a website: the read never blocks or fails setup (Req 3, 6)", () => {
  const URL_TYPED = "https://www.cornerbakery.example/";

  it("starts the read at the website step and returns without waiting for it", async () => {
    let finish!: () => void;
    reader.read.mockImplementation(
      (args: { userId: string; brandId: string; url: string }) =>
        new Promise((resolve) => {
          finish = () => void readerEnding("ok", 22)(args).then(resolve);
        }),
    );

    const t0 = Date.now();
    const started = await startWebsiteReadAction({ businessName: "Corner Bakery", url: "www.cornerbakery.example" });
    expect(started.ok).toBe(true);
    expect(Date.now() - t0).toBeLessThan(2000); // returned while the read is still pending
    expect(reader.read).toHaveBeenCalledTimes(1);
    expect(reader.read.mock.calls[0][0]).toMatchObject({ userId, url: URL_TYPED });

    // Status while it runs, then the owner finishes the other steps.
    expect(await websiteStatusAction()).toMatchObject({ ok: true, summary: { state: "reading" } });
    const res = await completeSetupAction({ ...ANSWERS, website_url: "www.cornerbakery.example" });
    if (!res.ok) throw new Error("setup failed");
    expect(res.hasWebsite).toBe(true);
    expect(reader.read).toHaveBeenCalledTimes(1); // completing did not start a second read
    expect(await memory(res.brandId)).toMatchObject({
      website_url: URL_TYPED,
      link_destination: URL_TYPED,
      completed: true,
      website_status: "none",
    });
    expect(await websiteStatusAction()).toMatchObject({ ok: true, summary: { state: "reading" } });

    // The read ends: the Done screen can say what it found.
    finish();
    await tick(100);
    expect(await websiteStatusAction()).toMatchObject({ ok: true, summary: { state: "ok", facts: 22, pages: 4 } });
    expect((await memory(res.brandId)).website_status).toBe("ok");
    expect(await facts(res.brandId, "website")).toHaveLength(22);
    expect(await facts(res.brandId)).toHaveLength(2); // the setup facts are still there
  });

  it.each(["blocked", "failed"] as const)("a %s site does not stop setup; the status says so", async (status) => {
    reader.read.mockImplementation(readerEnding(status));
    expect((await startWebsiteReadAction({ businessName: "Corner Bakery", url: URL_TYPED })).ok).toBe(true);
    const res = await completeSetupAction({ ...ANSWERS, website_url: URL_TYPED });
    expect(res.ok).toBe(true);
    await tick(50);
    expect(await websiteStatusAction()).toMatchObject({ ok: true, summary: { state: status, facts: 0 } });
    if (res.ok) expect((await memory(res.brandId)).completed).toBe(true);
  });

  it("a reader that throws leaves status 'failed' and setup completes", async () => {
    reader.read.mockRejectedValue(new Error("boom"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect((await startWebsiteReadAction({ businessName: "Corner Bakery", url: URL_TYPED })).ok).toBe(true);
    await tick(100);
    spy.mockRestore();
    const res = await completeSetupAction({ ...ANSWERS, website_url: URL_TYPED });
    expect(res.ok).toBe(true);
    expect(await websiteStatusAction()).toMatchObject({ ok: true, summary: { state: "failed" } });
  });

  it("a read that never ends is marked failed after the time limit, without blocking anything", async () => {
    const brandId = await createBrandFor(db, userId, "Slow Shop");
    await db.withUser(userId, (tx) =>
      tx.query("update public.brand_memory set website_url = $2 where brand_id = $1", [brandId, URL_TYPED]),
    );
    const never = vi.fn(() => new Promise<never>(() => undefined));
    const t0 = Date.now();
    await runWebsiteRead({ userId, brandId, url: URL_TYPED, read: never as never, timeoutMs: 50 });
    expect(Date.now() - t0).toBeLessThan(2000);
    expect((await memory(brandId)).website_status).toBe("failed");
  });

  it("setup with a website that step 8 never started (start call failed) starts the read when it finishes", async () => {
    const res = await completeSetupAction({ ...ANSWERS, website_url: URL_TYPED });
    expect(res.ok).toBe(true);
    await tick(100);
    expect(reader.read).toHaveBeenCalledTimes(1);
    expect(reader.read.mock.calls[0][0]).toMatchObject({ url: URL_TYPED });
  });

  it("changing the address starts a new read; skipping the website afterwards clears it", async () => {
    await startWebsiteReadAction({ businessName: "Corner Bakery", url: URL_TYPED });
    await tick(50);
    await startWebsiteReadAction({ businessName: "Corner Bakery", url: URL_TYPED }); // same address: no second read
    expect(reader.read).toHaveBeenCalledTimes(1);
    await startWebsiteReadAction({ businessName: "Corner Bakery", url: "https://other.example/" });
    await tick(50);
    expect(reader.read).toHaveBeenCalledTimes(2);

    const res = await completeSetupAction({ ...ANSWERS, website_url: "" }); // the owner went back and skipped
    if (!res.ok) throw new Error("setup failed");
    expect(await memory(res.brandId)).toMatchObject({ website_url: null, website_status: "none", link_destination: null });
    expect((await facts(res.brandId, "website")).every((f) => !f.active)).toBe(true);
  });

  it("rejects a website that is not http(s) before anything starts", async () => {
    for (const url of ["ftp://example.com", "javascript:alert(1)", "not a url", ""]) {
      expect((await startWebsiteReadAction({ businessName: "x", url })).ok).toBe(false);
    }
    expect(reader.read).not.toHaveBeenCalled();
  });
});

describe("validation (server side)", () => {
  const bad = (patch: Record<string, unknown>) => validateSetup({ ...ANSWERS, ...patch });

  it("accepts the complete valid answers", () => {
    expect(validateSetup(ANSWERS).ok).toBe(true);
  });

  it("country must be a valid ISO code", () => {
    for (const country of ["", "XX", "gb", "GBR", "UK", "ZZ"]) {
      expect(bad({ country, region: "" })).toMatchObject({ ok: false, fieldErrors: { country: "invalid_country" } });
    }
    expect(bad({ country: 5, region: "" }).ok).toBe(false);
    expect(bad({ country: "SG", region: "", timezone: "Asia/Singapore" }).ok).toBe(true);
  });

  it("region must be valid for the country, or empty", () => {
    expect(bad({ region: "" }).ok).toBe(true);
    expect(bad({ country: "US", region: "US-OR", timezone: "America/Los_Angeles" }).ok).toBe(true);
    expect(bad({ country: "AU", region: "AU-NSW", timezone: "Australia/Sydney" }).ok).toBe(true);
    for (const patch of [
      { country: "US", region: "US-XX" }, // no such state
      { country: "US", region: "GB-ENG" }, // another country's region
      { country: "GB", region: "ENG" }, // not in CC-XX form
      { country: "SG", region: "SG-01" }, // country with no regions
      { country: "XX", region: "XX-1" }, // invalid country
    ]) {
      expect(bad(patch)).toMatchObject({ ok: false, fieldErrors: { region: "invalid_region" } });
    }
  });

  it("timezone must pass Intl.DateTimeFormat", () => {
    for (const timezone of ["Mars/Olympus", "", "UTC+5", "+01:00", "Europe/Londn"]) {
      expect(bad({ timezone })).toMatchObject({ ok: false, fieldErrors: { timezone: "invalid_timezone" } });
    }
    expect(bad({ timezone: 7 }).ok).toBe(false);
    for (const timezone of ["Asia/Kolkata", "UTC", "America/Argentina/Buenos_Aires", "Pacific/Auckland"]) {
      expect(bad({ timezone }).ok).toBe(true);
    }
  });

  it("language must match the BCP-47 pattern", () => {
    for (const post_language of ["", "English", "EN", "en_GB", "e", "en-", "zh Hans", "hi-IN-x-", "123"]) {
      expect(bad({ post_language })).toMatchObject({ ok: false, fieldErrors: { post_language: "invalid_language" } });
    }
    for (const post_language of ["en", "en-GB", "zh-Hans", "tl", "pt-BR", "fil"]) expect(bad({ post_language }).ok).toBe(true);
  });

  it("minutes must be a whole number from 1 to 600", () => {
    for (const minutes_per_post of [0, -5, 601, 12.5, "30", null, Number.NaN]) {
      expect(bad({ minutes_per_post }).ok).toBe(false);
    }
    for (const minutes_per_post of [1, 10, 600]) expect(bad({ minutes_per_post }).ok).toBe(true);
    expect(bad({ minutes_per_post: 0 })).toMatchObject({ fieldErrors: { minutes_per_post: "invalid_minutes" } });
  });

  it("the website must be http(s), or empty", () => {
    for (const website_url of ["ftp://example.com", "javascript:alert(1)", "data:text/html,hi", "file:///etc/passwd", "http://", "no spaces allowed.com"]) {
      expect(bad({ website_url })).toMatchObject({ ok: false, fieldErrors: { website_url: "invalid_url" } });
    }
    expect(bad({ website_url: "" }).ok).toBe(true);
    expect(bad({ website_url: "   " }).ok).toBe(true);
    const typed = parseSetup({ ...ANSWERS, website_url: " www.example.com/menu " });
    expect(typed.ok && typed.data.website_url).toBe("https://www.example.com/menu");
    const http = parseSetup({ ...ANSWERS, website_url: "http://example.com" });
    expect(http.ok && http.data.website_url).toBe("http://example.com/");
  });

  it("weekday is 1-7 and time is HH:MM", () => {
    for (const schedule_weekday of [0, 8, -1, 1.5]) {
      expect(bad({ schedule_weekday })).toMatchObject({ ok: false, fieldErrors: { schedule_weekday: "invalid_weekday" } });
    }
    expect(bad({ schedule_weekday: "1" }).ok).toBe(false);
    for (const schedule_weekday of [1, 4, 7]) expect(bad({ schedule_weekday }).ok).toBe(true);
    for (const schedule_time of ["", "8:00", "24:00", "08:60", "0800", "08:00:00", "ab:cd"]) {
      expect(bad({ schedule_time })).toMatchObject({ ok: false, fieldErrors: { schedule_time: "invalid_time" } });
    }
    for (const schedule_time of ["00:00", "08:00", "23:59"]) expect(bad({ schedule_time }).ok).toBe(true);
  });

  it("goal and tone must be one of the offered choices; the text fields are required", () => {
    expect(bad({ goal: "sales" }).ok).toBe(false);
    expect(bad({ tone: "formal" }).ok).toBe(false);
    for (const key of ["business_name", "what_sell", "customers"]) {
      expect(bad({ [key]: "   " })).toMatchObject({ ok: false, fieldErrors: { [key]: "required" } });
      expect(bad({ [key]: "x".repeat(201) }).ok).toBe(false);
    }
  });

  it("completeSetupV2 throws a validation error and writes nothing", async () => {
    await expect(completeSetupV2(userId, { ...ANSWERS, country: "XX" })).rejects.toBeInstanceOf(SetupValidationError);
    expect(await brandCount(userId)).toBe(0);
  });
});

describe("lists and defaults offered by the screens", () => {
  it("offers all 249 ISO countries with names, and recognises only those", () => {
    expect(ISO_COUNTRY_CODES).toHaveLength(249);
    expect(new Set(ISO_COUNTRY_CODES).size).toBe(249);
    const options = countryOptions();
    expect(options.every((c) => c.name !== c.code && c.name.length > 2)).toBe(true);
    expect(options.find((c) => c.code === "GB")?.name).toBe("United Kingdom");
    expect(isIsoCountry("IN")).toBe(true);
    expect(isIsoCountry("XX")).toBe(false);
    expect(regionOfLocale("en-GB")).toBe("GB");
    expect(regionOfLocale("fr-CA")).toBe("CA");
    expect(regionOfLocale("en")).toBeNull();
    expect(regionOfLocale("not a locale")).toBeNull();
  });

  it("regions are 'CC-XX' codes from the holiday dataset; zones come per country", () => {
    const regions = regionsByCountry();
    expect(regions.US.find((r) => r.code === "US-OR")?.name).toBe("Oregon");
    expect(regions.GB.map((r) => r.code)).toContain("GB-ENG");
    expect(regions.SG).toBeUndefined();
    expect(timezonesByCountry().IN).toEqual(["Asia/Kolkata"]);
    expect(timezonesByCountry().US.length).toBeGreaterThan(5);
  });

  it("every offered language is BCP-47 and labelled; English follows the country's variant", () => {
    const labels = languageOptions();
    expect(labels.map((l) => l.code)).toEqual(POST_LANGUAGE_CODES);
    for (const code of ["en", "en-GB", "en-US", "en-AU", "en-CA", "en-IN", "en-SG", "en-ZA", "en-NZ", "en-IE",
      "hi", "ar", "es", "fr", "de", "pt", "it", "nl", "id", "ms", "tl", "zh-Hans", "ja", "ko", "ta", "bn", "mr", "te", "ur"]) {
      expect(POST_LANGUAGE_CODES).toContain(code);
    }
    expect(labels.every((l) => l.label !== l.code)).toBe(true);
    for (const l of labels) expect(parseSetup({ ...ANSWERS, post_language: l.code, country: "GB", region: "" }).ok).toBe(true);
    expect(defaultPostLanguage("GB")).toBe("en-GB");
    expect(defaultPostLanguage("IN")).toBe("en-IN");
    expect(defaultPostLanguage("AE")).toBe("en");
    expect(defaultPostLanguage("")).toBe("en");
  });

  it("time zone helpers: plain words, aliases, country from the zone", () => {
    expect(isValidTimezone("Asia/Kolkata")).toBe(true);
    expect(isValidTimezone("Nowhere/Land")).toBe(false);
    expect(describeTimezone("Asia/Kolkata")).toContain("Kolkata time");
    expect(describeTimezone("Asia/Kolkata")).toContain("India Standard Time");
    expect(browserTimezone()).not.toBe("Asia/Calcutta");
    const zones = timezonesByCountry();
    expect(countryOfTimezone("Asia/Kolkata", zones)).toBe("IN");
    expect(countryOfTimezone("Europe/London", zones)).toBe("GB");
    expect(countryOfTimezone("Mars/Olympus", zones)).toBeNull();
  });
});

describe("the setup page and screens", () => {
  it("/setup redirects a user with a finished brand to /brand", async () => {
    const res = await completeSetupAction(ANSWERS);
    expect(res.ok).toBe(true);
    await expect(Page()).rejects.toThrow("REDIRECT:/brand");
  });

  it("/setup shows the wizard to a new owner and to one with an unfinished brand", async () => {
    expect(await Page()).toBeTruthy();
    await createBrandFor(db, userId, "Half done"); // brand made at the website step, setup not finished
    expect(await Page()).toBeTruthy();
  });

  it("/setup sends a signed-out visitor to /login", async () => {
    jar.store.clear();
    await expect(Page()).rejects.toThrow("REDIRECT:/login");
  });

  it("the first screen has a progress bar for the 13 screens of Path B and the business questions", () => {
    const html = renderToString(
      createElement(SetupWizard, {
        countries: countryOptions(),
        regions: regionsByCountry(),
        zonesByCountry: timezonesByCountry(),
        languages: languageOptions(),
      }),
    );
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-valuemax="13"');
    expect(html).toContain("Step 1 of 13");
    expect(html).toContain(s.setupV2.business.sellLabel);
    // The first screen asks only for the name and what is sold.
    expect(html).not.toMatch(/voice|logo|colou?r/i);
  });
});

describe("timing: a no-website setup is quick (AC 2/6, under 5 minutes)", () => {
  it("Path B has 13 screens, and a scripted run through the server actions takes seconds, not minutes", async () => {
    expect(SETUP_STEPS).toHaveLength(14);
    expect(SETUP_STEPS.at(-1)).toBe("done");
    // Path B has no "addresses" screen: 13 screens, one short question each, most of them skippable.
    // At a generous 20 s per screen that is under 4.5 minutes.
    expect(stepsFor([])).toHaveLength(13);
    expect(stepsFor([]).length * 20).toBeLessThan(5 * 60);

    const t0 = performance.now();
    // Screens 1-9 only collect answers in the browser; the server work is one save at screen 9.
    const res = await completeSetupAction(ANSWERS);
    const serverMs = performance.now() - t0;
    expect(res.ok).toBe(true);
    expect(serverMs).toBeLessThan(5_000); // the server's share of the 5-minute budget
    expect(reader.read).not.toHaveBeenCalled();
  });
});
