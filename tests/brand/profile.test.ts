import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BrandAccessError } from "@/lib/brand/current";
import {
  ProfileValidationError,
  ensureSetupBrand,
  getBrandProfile,
  saveBrandProfile,
  SetupAlreadyCompletedError,
} from "@/lib/brand/profile";
import { emptyDraft, parseProfile } from "@/lib/brand/schema";
import type { MockDb } from "@/lib/db/mock";
import { s } from "@/lib/i18n/strings";
import { closeTestDb, createBrandFor, createUser, openTestDb, validProfile } from "./helpers";

let db: MockDb;
let owner: { id: string; phone: string };
let other: { id: string; phone: string };
let brandId: string;

beforeAll(async () => {
  db = await openTestDb();
  owner = await createUser(db);
  other = await createUser(db);
  brandId = await createBrandFor(db, owner.id, "Placeholder");
});
afterAll(async () => {
  await closeTestDb(db);
});

const memory = (id: string) =>
  db
    .withAdmin((tx) =>
      tx.query<Record<string, unknown>>(
        `select business_name, category, city, products, audience, tone, languages::text[] as languages,
                default_language::text as default_language, colors, whatsapp_number, notes,
                setup_transcript, setup_completed_at from public.brand_memory where brand_id = $1`,
        [id],
      ),
    )
    .then((r) => r[0]);

describe("saving the profile (R2: every field editable)", () => {
  it("writes every field and renames the brand", async () => {
    await saveBrandProfile(owner.id, brandId, validProfile());
    const m = await memory(brandId);
    expect(m.business_name).toBe("श्री राम स्वीट्स");
    expect(m.category).toBe("sweet shop");
    expect(m.city).toBe("Indore, Sarafa Road");
    expect(m.products).toEqual([
      { name: "काजू कतली", price: "600", unit: "per kg", note: "gift box packing available" },
      { name: "बेसन लड्डू", price: "", unit: "per kg", note: "" },
    ]);
    expect(m.audience).toBe("families and office-goers");
    expect(m.tone).toBe("Festive and lively");
    expect(m.languages).toEqual(["hi", "hinglish"]);
    expect(m.default_language).toBe("hi");
    expect(m.colors).toEqual({ primary: "#B5121B", secondary: "#FFF4E0", accent: "#F2A900" });
    expect(m.whatsapp_number).toBe("+919876543210");
    expect(m.notes).toBe("Open 8 AM to 10 PM daily");
    // Saving after setup edits does not mark setup complete by itself.
    expect(m.setup_completed_at).toBeNull();

    const [brand] = await db.withUser(owner.id, (tx) =>
      tx.query<{ name: string }>("select name from public.brands where id = $1", [brandId]),
    );
    expect(brand.name).toBe("श्री राम स्वीट्स");
  });

  it("edits each field again and reads it back for the form", async () => {
    await saveBrandProfile(
      owner.id,
      brandId,
      validProfile({
        business_name: "Ram Sweets",
        category: "mithai shop",
        city: "Bhopal",
        products: [{ name: "Jalebi", price: "240.50", unit: "kg", note: "hot" }],
        audience: "students",
        tone: "Premium",
        languages: ["en"],
        default_language: "en",
        colors: { primary: "#112233", secondary: "#EEF1F4", accent: "#AABBCC" },
        whatsapp_number: "+91 90000 00001",
        notes: "",
      }),
    );
    const stored = await getBrandProfile(owner.id, brandId);
    expect(stored?.draft).toEqual({
      business_name: "Ram Sweets",
      category: "mithai shop",
      city: "Bhopal",
      products: [{ name: "Jalebi", price: "240.50", unit: "kg", note: "hot" }],
      audience: "students",
      tone: "Premium",
      languages: ["en"],
      default_language: "en",
      colors: { primary: "#112233", secondary: "#EEF1F4", accent: "#AABBCC" },
      whatsapp_number: "+919000000001",
      notes: "",
    });
  });

  it("finishing setup stores the transcript and the completion time", async () => {
    const u = await createUser(db);
    const id = await createBrandFor(db, u.id);
    await saveBrandProfile(u.id, id, validProfile(), { completeSetup: { transcript: "Q: ...\nA: ..." } });
    const m = await memory(id);
    expect(m.setup_transcript).toBe("Q: ...\nA: ...");
    expect(m.setup_completed_at).not.toBeNull();
  });

  it("drops fully blank product rows but keeps a row with only a price as an error", () => {
    const ok = parseProfile(validProfile({ products: [{ name: "", price: "", unit: "", note: "" }] }));
    expect(ok.ok && ok.data.products).toEqual([]);
    const bad = parseProfile(validProfile({ products: [{ name: "", price: "50", unit: "", note: "" }] }));
    expect(bad.ok).toBe(false);
  });
});

describe("validation (nothing is written when it fails)", () => {
  const cases: [string, Record<string, unknown>, string, string][] = [
    ["a missing business name", { business_name: "  " }, "business_name", "required"],
    ["an invalid WhatsApp number", { whatsapp_number: "12345" }, "whatsapp_number", "invalid_phone"],
    ["no language", { languages: [], default_language: "hi" }, "languages", "pick_language"],
    [
      "a default outside the chosen languages",
      { languages: ["en"], default_language: "hi" },
      "default_language",
      "default_not_selected",
    ],
    [
      "a bad colour",
      { colors: { primary: "red", secondary: "#FFFFFF", accent: "#000000" } },
      "colors.primary",
      "invalid_color",
    ],
    [
      "a price with letters",
      { products: [{ name: "Tea", price: "Rs 20", unit: "", note: "" }] },
      "products.0.price",
      "invalid_price",
    ],
    ["a very long note", { notes: "x".repeat(1501) }, "notes", "too_long"],
  ];
  it.each(cases)("rejects %s", async (_label, override, field, code) => {
    const before = await memory(brandId);
    const err = await saveBrandProfile(owner.id, brandId, validProfile(override)).catch((e) => e);
    expect(err).toBeInstanceOf(ProfileValidationError);
    expect((err as ProfileValidationError).fieldErrors[field]).toBe(code);
    expect(await memory(brandId)).toEqual(before);
  });

  it("has a plain-words message for every error code", () => {
    for (const code of [
      "required",
      "too_long",
      "invalid_phone",
      "invalid_color",
      "invalid_price",
      "pick_language",
      "default_not_selected",
      "too_many_products",
      "invalid",
    ]) {
      expect(s.brand.errors).toHaveProperty(code);
    }
  });

  it("rejects an empty form", () => {
    expect(parseProfile(emptyDraft()).ok).toBe(false);
  });
});

describe("brand separation (RLS through the profile code path)", () => {
  it("another user cannot read the profile", async () => {
    expect(await getBrandProfile(other.id, brandId)).toBeNull();
  });

  it("another user cannot edit it, and nothing changes", async () => {
    const before = await memory(brandId);
    await expect(
      saveBrandProfile(other.id, brandId, validProfile({ business_name: "Hijacked" })),
    ).rejects.toBeInstanceOf(BrandAccessError);
    expect(await memory(brandId)).toEqual(before);
    const [brand] = await db.withUser(owner.id, (tx) =>
      tx.query<{ name: string }>("select name from public.brands where id = $1", [brandId]),
    );
    expect(brand.name).toBe("Ram Sweets");
  });

  it("a malformed brand id is refused, not a database error", async () => {
    expect(await getBrandProfile(owner.id, "not-a-uuid")).toBeNull();
    await expect(saveBrandProfile(owner.id, "not-a-uuid", validProfile())).rejects.toBeInstanceOf(BrandAccessError);
  });
});

describe("starting setup", () => {
  it("creates the brand with the placeholder name and makes it current", async () => {
    const u = await createUser(db);
    const id = await ensureSetupBrand(u.id);
    const [p] = await db.withUser(u.id, (tx) =>
      tx.query<{ last_brand_id: string }>("select last_brand_id from public.profiles where id = $1", [u.id]),
    );
    expect(p.last_brand_id).toBe(id);
    const [b] = await db.withUser(u.id, (tx) =>
      tx.query<{ name: string }>("select name from public.brands where id = $1", [id]),
    );
    expect(b.name).toBe(s.setup.placeholderBrandName);
  });

  it("reuses an unfinished brand instead of creating another", async () => {
    const u = await createUser(db);
    const first = await ensureSetupBrand(u.id);
    expect(await ensureSetupBrand(u.id)).toBe(first);
    const [n] = await db.withUser(u.id, (tx) =>
      tx.query<{ n: number }>("select count(*)::int as n from public.brand_members where user_id = $1", [u.id]),
    );
    expect(n.n).toBe(1);
  });

  it("refuses to start over a finished brand", async () => {
    const u = await createUser(db);
    const id = await ensureSetupBrand(u.id);
    await saveBrandProfile(u.id, id, validProfile(), { completeSetup: { transcript: "t" } });
    await expect(ensureSetupBrand(u.id)).rejects.toBeInstanceOf(SetupAlreadyCompletedError);
  });
});
