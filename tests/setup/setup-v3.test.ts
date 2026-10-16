// Setup with two paths (C-01, PRD v3 D-1 to D-3): the screens for each path, the choices on "Are you online
// already?", contact points in E.164, opening hours, the owner's own selling points, the examples, and resuming
// after a reload (H-16).
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement, type ReactElement } from "react";
import { renderToString } from "react-dom/server";

const jar = vi.hoisted(() => {
  const store = new Map<string, string>();
  const path = { value: "/setup" as string };
  return {
    store,
    path,
    api: {
      get: (name: string) => (store.has(name) ? { name, value: store.get(name)! } : undefined),
      set: (name: string, value: string) => void store.set(name, value),
      delete: (name: string) => void store.delete(name),
    },
  };
});
vi.mock("next/headers", () => ({
  cookies: async () => jar.api,
  headers: async () => new Headers({ "x-pathname": jar.path.value }),
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
  useRouter: () => ({ refresh: () => undefined, push: () => undefined }),
  usePathname: () => jar.path.value,
}));
vi.mock("@/components/instagram/actions", () => ({
  importInstagramAction: vi.fn(),
  refreshInstagramAction: vi.fn(),
  removeInstagramPostsAction: vi.fn(),
  loadInstagramImagesAction: vi.fn(),
  addInstagramPhotosAction: vi.fn(),
}));

// The website reader is mocked: no network, and each test decides how it ends.
const reader = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("@/lib/website/extract", () => ({ readWebsiteFacts: reader.read }));

import AppLayout from "@/app/(app)/layout";
import Page from "@/app/(app)/setup/page";
import { SetupWizard } from "@/app/(app)/setup/setup-wizard";
import {
  completeSetupAction,
  contactSuggestionsAction,
  saveStepAction,
  setupFindingsAction,
} from "@/app/(app)/setup/actions";
import { SESSION_COOKIE } from "@/lib/auth/session";
import { signSession } from "../helpers/session";
import { getCurrentBrand } from "@/lib/brand/current";
import { listContacts } from "@/lib/contacts/service";
import type { MockDb } from "@/lib/db/mock";
import { s } from "@/lib/i18n/strings";
import { getInstagramState } from "@/lib/instagram/import";
import { countryOptions } from "@/lib/setup/countries";
import { loadSetupResume } from "@/lib/setup/details";
import { DRAFT_PREFIX, emptyAnswers, parseAnswers, parseDraft, serializeDraft, type DraftAnswers } from "@/lib/setup/draft";
import { languageOptions } from "@/lib/setup/languages";
import { regionsByCountry, timezonesByCountry } from "@/lib/setup/regions";
import { MINUTE_PICKS, nextStep, ONLINE_CHOICES, pathOf, previousStep, SETUP_STEPS, stepsFor, toggleOnline, type SetupStep } from "@/lib/setup/steps";
import { allUspExamples, exampleGroupFor, uspExamplesFor } from "@/lib/setup/usp-examples";
import { listUsps } from "@/lib/usps/service";
import { closeTestDb, createUser, openTestDb } from "../brand/helpers";

let db: MockDb;
let userId: string;
let userN = 0;

async function signIn(): Promise<string> {
  userN += 1;
  const u = await createUser(db);
  userId = u.id;
  jar.store.set(SESSION_COOKIE, await signSession({ id: u.id, email: `v3owner${userN}@example.com` }));
  return u.id;
}

/** The answers typed so far, with the wanted changes. */
const answers = (patch: Partial<DraftAnswers> = {}): DraftAnswers => ({
  ...parseAnswers({}),
  name: "Corner Bakery",
  sell: "Sourdough bread, cakes and coffee",
  country: "GB",
  timezone: "Europe/London",
  ...patch,
});

/** Saves one screen the way the wizard does: the answers so far, and the screen that comes next. */
async function save(step: SetupStep, a: DraftAnswers, next?: SetupStep) {
  return saveStepAction({ step, next: next ?? nextStep(step, a.online), answers: a });
}

const contacts = async (kind?: string) => {
  const brand = await getCurrentBrand(userId);
  const list = await listContacts(userId, brand!.id);
  return kind ? list.filter((c) => c.kind === kind) : list;
};

const wizard = (initial?: Parameters<typeof SetupWizard>[0]["initial"]) =>
  renderToString(
    createElement(SetupWizard, {
      countries: countryOptions(),
      regions: regionsByCountry(),
      zonesByCountry: timezonesByCountry(),
      languages: languageOptions(),
      initial,
    }),
  );

const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  db = await openTestDb();
});
afterAll(async () => {
  await closeTestDb(db);
});
beforeEach(async () => {
  reader.read.mockReset();
  reader.read.mockResolvedValue({ status: "ok" });
  jar.path.value = "/setup";
  await signIn();
});

// ---------------------------------------------------------------------------------------------

describe("the screens of each path", () => {
  const PATH_B = ["business", "online", "location", "customers", "reach", "hours", "logo", "likes", "goal", "style", "minutes", "schedule", "done"];
  const PATH_A = ["business", "online", "addresses", ...PATH_B.slice(2)];

  it("Path B (nothing online yet) skips the addresses screen", () => {
    expect(stepsFor(["none"])).toEqual(PATH_B);
    expect(stepsFor([])).toEqual(PATH_B); // skipping the question is the same as "Not yet"
    expect(pathOf(["none"])).toBe("B");
    expect(pathOf([])).toBe("B");
  });

  it.each([[["website"]], [["instagram"]], [["youtube"]], [["website", "instagram", "youtube"]]] as Array<[DraftAnswers["online"]]>)(
    "Path A (%j) adds the addresses screen after the question",
    (chosen) => {
      expect(stepsFor(chosen)).toEqual(PATH_A);
      expect(pathOf(chosen)).toBe("A");
    },
  );

  it("SETUP_STEPS lists every screen once and ends at done", () => {
    expect([...SETUP_STEPS]).toEqual(PATH_A);
    expect(new Set(SETUP_STEPS).size).toBe(SETUP_STEPS.length);
  });

  it("next and previous follow the path", () => {
    expect(nextStep("online", ["website"])).toBe("addresses");
    expect(nextStep("online", ["none"])).toBe("location");
    expect(previousStep("location", ["instagram"])).toBe("addresses");
    expect(previousStep("location", [])).toBe("online");
    expect(previousStep("business", [])).toBe("business");
    expect(nextStep("done", [])).toBe("done");
  });

  it("the first screen is the business and what is sold; the second asks 'Are you online already?' with the four cards", () => {
    expect(wizard()).toContain(s.setupV2.business.sellLabel);
    const second = wizard({ brandId: null, step: "online", answers: answers(), logoPath: null });
    expect(second).toContain("Are you online already?");
    for (const label of ["Website", "Instagram", "YouTube", "Not yet"]) expect(second).toContain(label);
    expect(second).toContain('data-setup-step="online"');
    expect((second.match(/role="checkbox"/g) ?? []).length).toBe(4);
  });

  it("the addresses screen shows only the chosen ones and says the reads happen while the owner carries on", () => {
    const html = wizard({ brandId: null, step: "addresses", answers: answers({ online: ["website", "youtube"] }), logoPath: null });
    expect(html).toContain('data-setup-step="addresses"');
    expect(html).toContain('data-setup-path="A"');
    expect(html).toContain("sv2-website");
    expect(html).toContain("sv2-youtube");
    expect(html).not.toContain("sv2-instagram");
    expect(html.replace(/&#x27;/g, "'")).toContain("We'll read these while you answer the rest.");
  });

  it("a Path B owner never sees the addresses screen, even from an old draft", () => {
    const html = wizard({ brandId: null, step: "addresses", answers: answers({ online: ["none"] }), logoPath: null });
    expect(html).toContain('data-setup-step="online"');
    expect(html).toContain('data-setup-path="B"');
  });

  it("the progress bar counts the screens of the chosen path", () => {
    expect(wizard({ brandId: null, step: "location", answers: answers({ online: ["none"] }), logoPath: null })).toContain("Step 3 of 13");
    expect(wizard({ brandId: null, step: "location", answers: answers({ online: ["website"] }), logoPath: null })).toContain("Step 4 of 14");
  });
});

describe('"Are you online already?" cards', () => {
  it('"Not yet" deselects the others, and choosing another one deselects "Not yet"', () => {
    let on = toggleOnline([], "website");
    on = toggleOnline(on, "instagram");
    expect(on).toEqual(["website", "instagram"]);
    on = toggleOnline(on, "none");
    expect(on).toEqual(["none"]);
    on = toggleOnline(on, "youtube");
    expect(on).toEqual(["youtube"]);
    on = toggleOnline(on, "website");
    expect(on).toEqual(["website", "youtube"]); // kept in the order of the cards
  });

  it("tapping a chosen card again un-chooses it, including Not yet", () => {
    expect(toggleOnline(["website", "instagram"], "website")).toEqual(["instagram"]);
    expect(toggleOnline(["none"], "none")).toEqual([]);
    expect(toggleOnline([], "none")).toEqual(["none"]);
  });

  it("never mixes Not yet with anything else, whatever order the taps come in", () => {
    for (const first of ONLINE_CHOICES) {
      for (const second of ONLINE_CHOICES) {
        const result = toggleOnline(toggleOnline([], first), second);
        if (result.includes("none")) expect(result).toEqual(["none"]);
      }
    }
  });
});

describe("the draft that lets a reload resume", () => {
  it("round-trips the screen and the answers", () => {
    const a = answers({ online: ["website", "instagram"], website: "cornerbakery.example", likes: ["Friendly service"], hoursMode: "always" });
    const text = serializeDraft({ step: "reach", answers: a });
    expect(text.startsWith(DRAFT_PREFIX)).toBe(true);
    expect(parseDraft(text)).toEqual({ step: "reach", answers: a });
  });

  it("reads anything else as no draft, and junk fields as empty ones", () => {
    expect(parseDraft(null)).toBeNull();
    expect(parseDraft("Q: ...\nA: ...")).toBeNull(); // an old v1 transcript
    expect(parseDraft(`${DRAFT_PREFIX}{not json`)).toBeNull();
    const odd = parseDraft(`${DRAFT_PREFIX}${JSON.stringify({ step: "nope", answers: { name: 5, online: ["website", "bogus"], weekday: 99, hours: 3 } })}`);
    expect(odd?.step).toBe("business");
    expect(odd?.answers.name).toBe("");
    expect(odd?.answers.online).toEqual(["website"]);
    expect(odd?.answers.weekday).toBe(1);
    expect(odd?.answers.hours.mon).toEqual({ on: true, open: "09:00", close: "17:00" });
  });

  it("starts from sensible defaults", () => {
    const e = emptyAnswers();
    expect(e).toMatchObject({ name: "", online: [], language: "en", weekday: 1, time: "08:00", hoursMode: "", likes: [] });
  });
});

describe("the examples for 'what customers like'", () => {
  const BAD = /\d|\b(best|top|leading|cheapest|greatest|finest|number|first|only|most|award\w*|certified|famous|guarantee\w*|#)\b/i;

  it("have no numbers, prices, ratings or superlatives, and fit a 60-character line", () => {
    const all = allUspExamples();
    expect(all.length).toBeGreaterThanOrEqual(10);
    for (const ex of all) {
      expect(ex, ex).not.toMatch(BAD);
      expect(ex.length, ex).toBeLessThanOrEqual(60);
      expect(ex.trim(), ex).toBe(ex);
    }
  });

  it("offer 3 or 4 lines matching what is sold", () => {
    expect(exampleGroupFor("Sourdough bread, cakes and coffee")).toBe("food");
    expect(exampleGroupFor("Hair salon services")).toBe("beauty");
    expect(exampleGroupFor("Plumbing repairs")).toBe("trades");
    expect(exampleGroupFor("Gifts and toys")).toBe("shop");
    expect(exampleGroupFor("something else entirely")).toBe("general");
    expect(uspExamplesFor("fresh bread")).toContain("Made fresh every day");
    expect(uspExamplesFor("Hair salon")).not.toContain("Made fresh every day");
    for (const sell of ["bread", "salon", "repairs", "gifts", "xyz", ""]) {
      const n = uspExamplesFor(sell).length;
      expect(n === 3 || n === 4).toBe(true);
    }
  });

  it("the quick picks for minutes are unchanged", () => {
    expect([...MINUTE_PICKS]).toEqual([10, 20, 30, 60]);
  });
});

describe("contact points from the 'reach' screen", () => {
  async function startWithCountry(country = "GB", timezone = "Europe/London") {
    const a = answers({ country, timezone });
    expect((await save("business", a)).ok).toBe(true);
    expect((await save("location", a)).ok).toBe(true);
    return a;
  }

  it("saves the phone as an E.164 number read in the brand's country, and the email in lower case", async () => {
    const a = await startWithCountry();
    const res = await save("reach", { ...a, phone: "020 7946 0958", email: "  Hello@CornerBakery.Example " });
    expect(res.ok).toBe(true);
    const list = await contacts();
    expect(list.map((c) => [c.kind, c.value])).toEqual([
      ["phone", "+442079460958"],
      ["email", "hello@cornerbakery.example"],
    ]);
    expect(list[0].display).toBe("+44 20 7946 0958");
    expect(list.map((c) => c.source)).toEqual(["setup", "setup"]); // typed on a setup screen
  });

  it('"same number for WhatsApp" saves one number as a phone and as a WhatsApp contact', async () => {
    const a = await startWithCountry();
    expect((await save("reach", { ...a, phone: "+44 20 7946 0958", sameWhatsapp: true, whatsapp: "ignored" })).ok).toBe(true);
    const list = await contacts();
    expect(list.map((c) => [c.kind, c.value])).toEqual([
      ["phone", "+442079460958"],
      ["whatsapp", "+442079460958"],
    ]);
    expect(list[1].details.link).toBe("https://wa.me/442079460958");
  });

  it("a different WhatsApp number is its own contact; the numbers are read in the country chosen (India here)", async () => {
    const a = await startWithCountry("IN", "Asia/Kolkata");
    expect((await save("reach", { ...a, phone: "98765 43210", whatsapp: "+91 99887 76655" })).ok).toBe(true);
    expect((await contacts()).map((c) => [c.kind, c.value])).toEqual([
      ["phone", "+919876543210"],
      ["whatsapp", "+919988776655"],
    ]);
  });

  it("an invalid number or email stops the screen with the answer's error, and writes nothing", async () => {
    const a = await startWithCountry();
    const res = await save("reach", { ...a, phone: "12345", email: "not an email" });
    expect(res).toMatchObject({ ok: false, fieldErrors: { phone: "invalid_phone", email: "invalid_email" } });
    expect(await contacts()).toEqual([]);
    // The draft did not move on.
    expect((await loadSetupResume(userId))?.draft?.step).toBe("customers");
  });

  it("saving again replaces, never duplicates; an empty screen removes the contacts", async () => {
    const a = await startWithCountry();
    const withPhone = { ...a, phone: "020 7946 0958", sameWhatsapp: true, email: "hello@cornerbakery.example" };
    await save("reach", withPhone);
    await save("reach", withPhone);
    expect(await contacts()).toHaveLength(3);
    await save("reach", { ...withPhone, phone: "+44 113 496 0000" });
    expect((await contacts("phone")).map((c) => c.value)).toEqual(["+441134960000"]);
    expect(await contacts()).toHaveLength(3);
    await save("reach", { ...a, phone: "", whatsapp: "", sameWhatsapp: false, email: "" });
    expect(await contacts()).toEqual([]);
  });

  it("the phone number needs the country the owner picked: it is saved before the contact screen", async () => {
    const a = answers({ country: "GB" });
    await save("business", a);
    const res = await save("location", { ...a, country: "XX" });
    expect(res).toMatchObject({ ok: false, fieldErrors: { country: "invalid_country" } });
    expect(await save("location", { ...a, country: "GB", region: "GB-ENG", city: "London" })).toMatchObject({ ok: true });
    const brand = await getCurrentBrand(userId);
    const [m] = await db.withAdmin((tx) =>
      tx.query<{ country: string; region: string; city: string; timezone: string }>(
        "select country, region, city, timezone from public.brand_memory where brand_id = $1",
        [brand!.id],
      ),
    );
    expect(m).toEqual({ country: "GB", region: "GB-ENG", city: "London", timezone: "Europe/London" });
    expect(await save("location", { ...a, region: "US-OR" })).toMatchObject({ ok: false, fieldErrors: { region: "invalid_region" } });
  });
});

describe("opening hours from the 'hours' screen", () => {
  async function startBrand() {
    const a = answers();
    await save("business", a);
    await save("location", a);
    return a;
  }

  it("saves per-day hours as the brand's one hours contact, with the days kept for editing", async () => {
    const a = await startBrand();
    const res = await save("hours", { ...a, hoursMode: "days" });
    expect(res.ok).toBe(true);
    const [h] = await contacts("hours");
    expect(h.value).toBe("Mon-Fri 9:00-17:00, Sat-Sun closed");
    expect((h.details.days as Record<string, unknown[]>).mon).toEqual([{ open: "09:00", close: "17:00" }]);
    expect((h.details.days as Record<string, unknown[]>).sat).toEqual([]);
    expect(h.source).toBe("setup");
  });

  it("keeps the owner's own times and days", async () => {
    const a = await startBrand();
    const hours = { ...a.hours, sat: { on: true, open: "10:00", close: "14:00" }, mon: { on: false, open: "09:00", close: "17:00" } };
    await save("hours", { ...a, hoursMode: "days", hours });
    const [h] = await contacts("hours");
    expect(h.value).toBe("Mon closed, Tue-Fri 9:00-17:00, Sat 10:00-14:00, Sun closed");
  });

  it('"Always open" and "By appointment" are saved as the hours text', async () => {
    const a = await startBrand();
    await save("hours", { ...a, hoursMode: "always" });
    expect((await contacts("hours")).map((c) => c.value)).toEqual(["Open 24 hours, 7 days"]);
    await save("hours", { ...a, hoursMode: "appointment" });
    expect((await contacts("hours")).map((c) => c.value)).toEqual(["By appointment"]);
  });

  it("skipping removes the hours; nothing open, or times the wrong way round, are refused and change nothing", async () => {
    const a = await startBrand();
    await save("hours", { ...a, hoursMode: "days" });
    const none = Object.fromEntries(Object.entries(a.hours).map(([d, v]) => [d, { ...v, on: false }])) as DraftAnswers["hours"];
    expect(await save("hours", { ...a, hoursMode: "days", hours: none })).toMatchObject({ ok: false, fieldErrors: { hours: "hours_none_open" } });
    expect(await save("hours", { ...a, hoursMode: "days", hours: { ...a.hours, mon: { on: true, open: "18:00", close: "09:00" } } })).toMatchObject({
      ok: false,
      fieldErrors: { hours: "hours_time" },
    });
    expect(await contacts("hours")).toHaveLength(1); // the earlier hours are still there
    await save("hours", { ...a, hoursMode: "" });
    expect(await contacts("hours")).toEqual([]);
  });
});

describe("the owner's own selling points ('likes' screen)", () => {
  it("are saved as custom selling points: source setup, confirmed, active, in order", async () => {
    const a = answers();
    await save("business", a);
    const res = await save("likes", { ...a, likes: ["Friendly service", "  Made   fresh every day ", "", "Friendly service"] });
    expect(res.ok).toBe(true);
    const brand = await getCurrentBrand(userId);
    const list = await listUsps(userId, brand!.id);
    expect(list.map((u) => u.title)).toEqual(["Friendly service", "Made fresh every day"]);
    for (const u of list) {
      expect(u).toMatchObject({ kind: "custom", source: "setup", confirmed: true, active: true, details: {} });
    }
  });

  it("saving again replaces them (no duplicates), at most three, and an empty screen removes them", async () => {
    const a = answers();
    await save("business", a);
    await save("likes", { ...a, likes: ["One", "Two", "Three", "Four"] });
    const brand = await getCurrentBrand(userId);
    expect((await listUsps(userId, brand!.id)).map((u) => u.title)).toEqual(["One", "Two", "Three"]);
    await save("likes", { ...a, likes: ["One", "Two", "Three"] });
    expect(await listUsps(userId, brand!.id)).toHaveLength(3);
    await save("likes", { ...a, likes: ["Only this"] });
    expect((await listUsps(userId, brand!.id)).map((u) => u.title)).toEqual(["Only this"]);
    await save("likes", { ...a, likes: [] });
    expect(await listUsps(userId, brand!.id)).toEqual([]);
  });

  it("a line over 60 characters is refused", async () => {
    const a = answers();
    await save("business", a);
    const res = await save("likes", { ...a, likes: ["x".repeat(61)] });
    expect(res).toMatchObject({ ok: false, fieldErrors: { likes: "too_long" } });
    const brand = await getCurrentBrand(userId);
    expect(await listUsps(userId, brand!.id)).toEqual([]);
  });
});

describe("Path A: the addresses screen starts the reads and saves contact points", () => {
  const ADDRESSES = { online: ["website", "instagram", "youtube"] as DraftAnswers["online"], website: "www.cornerbakery.example", instagram: "@sample.loaf", youtube: "@cornerbakery" };

  it("saves the website, Instagram and YouTube as contact points and starts the website read once", async () => {
    vi.stubEnv("INSTAGRAM_MODE", "fixture");
    try {
      const a = answers(ADDRESSES);
      await save("business", a);
      const res = await save("addresses", a);
      expect(res.ok).toBe(true);
      await tick(60);
      expect(reader.read).toHaveBeenCalledTimes(1);
      expect(reader.read.mock.calls[0][0]).toMatchObject({ userId, url: "https://www.cornerbakery.example/" });
      expect((await contacts()).map((c) => [c.kind, c.value])).toEqual([
        ["website", "https://www.cornerbakery.example"],
        ["instagram", "sample.loaf"],
        ["youtube", "@cornerbakery"],
      ]);
      const brand = await getCurrentBrand(userId);
      expect(await getInstagramState(userId, brand!.id)).toMatchObject({ handle: "sample.loaf", handleSource: "owner" });

      // Pressing Next again does not read the same website a second time.
      await save("addresses", a);
      await tick(30);
      expect(reader.read).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("does not wait for the read: it returns while the reader is still working", async () => {
    reader.read.mockImplementation(() => new Promise(() => undefined));
    const a = answers({ online: ["website"], website: "cornerbakery.example" });
    await save("business", a);
    const t0 = Date.now();
    expect((await save("addresses", a)).ok).toBe(true);
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(reader.read).toHaveBeenCalledTimes(1);
  });

  it("a bad address stops the screen before anything is saved or started", async () => {
    const a = answers({ ...ADDRESSES, youtube: "https://example.com/not-youtube", website: "cornerbakery.example" });
    await save("business", a);
    const res = await save("addresses", a);
    expect(res).toMatchObject({ ok: false, fieldErrors: { youtube: "invalid_handle" } });
    expect(await save("addresses", { ...a, youtube: "", instagram: "not a handle!" })).toMatchObject({
      ok: false,
      fieldErrors: { instagram: "invalid_handle" },
    });
    expect(await save("addresses", { ...a, youtube: "", instagram: "", website: "ftp://x.example" })).toMatchObject({
      ok: false,
      fieldErrors: { website: "invalid_url" },
    });
    await tick(30);
    expect(reader.read).not.toHaveBeenCalled();
    expect(await contacts()).toEqual([]);
  });

  it("only the chosen ones are used; changing the choice drops the old contact points", async () => {
    const a = answers({ ...ADDRESSES, instagram: "", online: ["website", "youtube"] });
    await save("business", a);
    await save("addresses", a);
    expect((await contacts()).map((c) => c.kind)).toEqual(["website", "youtube"]);
    // The owner goes back and picks "Not yet".
    expect((await save("online", { ...a, online: ["none"] })).ok).toBe(true);
    expect(await contacts()).toEqual([]);
  });

  it("prefills the phone and email from what the website read has found so far, without waiting for it", async () => {
    const a = answers({ online: ["website"], website: "cornerbakery.example" });
    await save("business", a);
    await save("location", a);
    reader.read.mockImplementation(() => new Promise(() => undefined)); // still reading
    await save("addresses", a);
    const brand = await getCurrentBrand(userId);
    const none = await contactSuggestionsAction();
    expect(none).toMatchObject({ ok: true, suggestions: { phone: "", email: "", reading: true } });

    await db.withAdmin((tx) =>
      tx.query(
        `insert into public.brand_facts (brand_id, kind, label, value, source_type, source_ref, source_quote) values
          ($1, 'phone', 'Phone', '020 7946 0958', 'website', 'https://cornerbakery.example/contact', '020 7946 0958'),
          ($1, 'email', 'Email', 'Hello@CornerBakery.example', 'website', 'https://cornerbakery.example/contact', 'x'),
          ($1, 'phone', 'Other', 'call us anytime', 'website', 'https://cornerbakery.example/', 'x')`,
        [brand!.id],
      ),
    );
    expect(await contactSuggestionsAction()).toMatchObject({
      ok: true,
      suggestions: { phone: "+44 20 7946 0958", email: "hello@cornerbakery.example" },
    });
  });
});

describe("resuming after a reload (H-16)", () => {
  it("every saved screen moves the draft on, and the setup page opens at that screen with the answers back", async () => {
    const a = answers({ online: ["none"], customers: "Families nearby" });
    expect((await save("business", a)).ok).toBe(true);
    expect((await save("online", a)).ok).toBe(true);
    expect((await save("location", a)).ok).toBe(true);
    expect((await save("customers", a)).ok).toBe(true); // next: reach

    const resume = await loadSetupResume(userId);
    expect(resume?.draft?.step).toBe("reach");
    expect(resume?.draft?.answers).toMatchObject({ name: "Corner Bakery", online: ["none"], customers: "Families nearby", country: "GB" });

    const element = (await Page()) as ReactElement<{ initial?: { step: string; answers: DraftAnswers } }>;
    expect(element.props.initial).toMatchObject({ step: "reach", brandId: resume!.brandId });
    const html = renderToString(element);
    expect(html).toContain('data-setup-step="reach"');
    expect(html).toContain("How do customers reach you?");
    expect(html).toContain("Step 5 of 13");
  });

  it("a Path A owner resumes on the right screen and with the chosen addresses", async () => {
    const a = answers({ online: ["website", "instagram"], website: "cornerbakery.example", instagram: "@sample.loaf" });
    await save("business", a);
    await save("online", a);
    const element = (await Page()) as ReactElement;
    const html = renderToString(element);
    expect(html).toContain('data-setup-step="addresses"');
    expect(html).toContain("sv2-website");
    expect(html).toContain("sv2-instagram");
  });

  it("a new owner starts at the first screen; a failed screen does not move the draft", async () => {
    const element = (await Page()) as ReactElement<{ initial?: unknown }>;
    expect(element.props.initial).toBeUndefined();
    expect(renderToString(element)).toContain('data-setup-step="business"');

    const a = answers();
    await save("business", a);
    await save("hours", { ...a, hoursMode: "days", hours: { ...a.hours, mon: { on: true, open: "18:00", close: "09:00" } } });
    expect((await loadSetupResume(userId))?.draft?.step).toBe("online");
  });

  it("the first screen is checked on the server too (name and what is sold)", async () => {
    expect(await saveStepAction({ step: "business", next: "online", answers: answers({ name: " ", sell: "" }) })).toMatchObject({
      ok: false,
      fieldErrors: { name: "required", sell: "required" },
    });
    expect(await getCurrentBrand(userId)).toBeNull();
  });

  it("finishing clears the draft, and a finished brand is not sent back to the screens", async () => {
    const a = answers({ online: ["none"], customers: "Families nearby", goal: "enquiries", tone: "friendly", language: "en-GB", minutes: "30" });
    await save("business", a);
    const res = await completeSetupAction({
      business_name: a.name,
      what_sell: a.sell,
      customers: a.customers,
      country: a.country,
      region: "",
      city: "",
      timezone: a.timezone,
      goal: a.goal,
      tone: a.tone,
      post_language: a.language,
      minutes_per_post: 30,
      website_url: "",
      schedule_weekday: 1,
      schedule_time: "08:00",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const [row] = await db.withAdmin((tx) =>
      tx.query<{ setup_transcript: string | null; completed: boolean }>(
        "select setup_transcript, (setup_completed_at is not null) as completed from public.brand_memory where brand_id = $1",
        [res.brandId],
      ),
    );
    expect(row).toEqual({ setup_transcript: null, completed: true });
    expect(await loadSetupResume(userId)).toBeNull();
    await expect(Page()).rejects.toThrow("REDIRECT:/brand");
    // Saving a screen after the end is refused and changes nothing.
    expect(await save("likes", { ...a, likes: ["Late line"] })).toMatchObject({ ok: false });
  });

  it("only a signed-in owner can save a screen, and it cannot jump to the end", async () => {
    expect(await saveStepAction({ step: "schedule", next: "done", answers: answers() })).toMatchObject({ ok: false });
    expect(await saveStepAction({ step: "business", next: "bogus", answers: answers() })).toMatchObject({ ok: false });
    jar.store.clear();
    expect(await save("business", answers())).toMatchObject({ ok: false });
    expect(await contactSuggestionsAction()).toMatchObject({ ok: false });
    expect(await setupFindingsAction()).toMatchObject({ ok: false });
  });

  it("an unfinished brand is still sent to /setup from every other page; /setup itself opens", async () => {
    await save("business", answers());
    jar.path.value = "/brand";
    await expect(AppLayout({ children: null })).rejects.toThrow("REDIRECT:/setup");
    jar.path.value = "/connections";
    await expect(AppLayout({ children: null })).rejects.toThrow("REDIRECT:/setup");
    jar.path.value = "/setup";
    await expect(AppLayout({ children: null })).resolves.toBeTruthy();
  });
});

describe("the Done screen's findings (Path A)", () => {
  async function finishedBrand(a: DraftAnswers) {
    await save("business", a);
    const res = await completeSetupAction({
      business_name: a.name,
      what_sell: a.sell,
      customers: "Families nearby",
      country: "GB",
      region: "",
      city: "",
      timezone: "Europe/London",
      goal: "enquiries",
      tone: "friendly",
      post_language: "en-GB",
      minutes_per_post: 30,
      website_url: a.online.includes("website") ? "https://cornerbakery.example/" : "",
      schedule_weekday: 1,
      schedule_time: "08:00",
    });
    if (!res.ok) throw new Error(res.message);
    return res.brandId;
  }

  it("counts what the website read found, suggests selling points from it, and never confirms them", async () => {
    const a = answers({ online: ["website"], website: "cornerbakery.example" });
    reader.read.mockImplementation(async (args: { userId: string; brandId: string; url: string }) => {
      await db.withUser(args.userId, async (tx) => {
        await tx.query(
          `insert into public.brand_facts (brand_id, kind, label, value, source_type, source_ref, source_quote) values
            ($1, 'claim', 'Claim', 'Baked fresh every morning', 'website', $2, 'Baked fresh every morning'),
            ($1, 'phone', 'Phone', '020 7946 0958', 'website', $2, '020 7946 0958')`,
          [args.brandId, args.url],
        );
        await tx.query(
          "update public.brand_memory set website_status = 'ok', website_read_at = now() where brand_id = $1",
          [args.brandId],
        );
      });
      return { status: "ok" };
    });
    await save("business", a);
    await save("addresses", a);
    const brandId = await finishedBrand(a);
    await tick(60);

    const res = await setupFindingsAction();
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.findings.website).toMatchObject({ state: "ok", facts: 2 });
    expect(res.findings.uspsSuggested).toBe(1);
    expect(res.findings.contactsFound).toBeGreaterThanOrEqual(1);
    expect(res.findings.finished).toBe(true);
    const suggested = (await listUsps(userId, brandId)).filter((u) => u.source === "website");
    expect(suggested).toHaveLength(1);
    expect(suggested[0]).toMatchObject({ kind: "quality", confirmed: false });
    // Asking again adds nothing.
    const again = await setupFindingsAction();
    expect(again.ok && again.findings.uspsSuggested).toBe(1);
  });

  it("while the website is still being read it says so and does not finish", async () => {
    reader.read.mockImplementation(() => new Promise(() => undefined));
    const a = answers({ online: ["website"], website: "cornerbakery.example" });
    await save("business", a);
    await save("addresses", a);
    await finishedBrand(a);
    const res = await setupFindingsAction();
    expect(res).toMatchObject({ ok: true, findings: { website: { state: "reading" }, finished: false, uspsSuggested: 0 } });
  });
});
