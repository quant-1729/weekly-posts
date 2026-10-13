import { createMockDb, setMockDbForTests, type MockDb } from "@/lib/db/mock";

/** In-memory database with the real schema, installed as the process-wide mock db. */
export async function openTestDb(): Promise<MockDb> {
  const db = await createMockDb();
  setMockDbForTests(db);
  return db;
}

export async function closeTestDb(db: MockDb): Promise<void> {
  setMockDbForTests(null);
  await db.close();
}

let counter = 0;

/** A signed-up user: auth.users row plus profile, like mock sign-in creates. */
export async function createUser(db: MockDb, phone?: string): Promise<{ id: string; phone: string }> {
  counter += 1;
  const p = phone ?? `+9198100${String(counter).padStart(5, "0")}`;
  return db.withAdmin(async (tx) => {
    const [r] = await tx.query<{ id: string }>("insert into auth.users (phone) values ($1) returning id", [p]);
    await tx.query("insert into public.profiles (id, phone, consent_at) values ($1, $2, now())", [r.id, p]);
    return { id: r.id, phone: p };
  });
}

export async function createBrandFor(db: MockDb, userId: string, name = "Test brand"): Promise<string> {
  const [row] = await db.withUser(userId, (tx) =>
    tx.query<{ id: string }>("select public.create_brand($1) as id", [name]),
  );
  return row.id;
}

/** A complete, valid profile (the Hindi sweet shop), as a form would send it. */
export function validProfile(overrides: Record<string, unknown> = {}) {
  return {
    business_name: "श्री राम स्वीट्स",
    category: "sweet shop",
    city: "Indore, Sarafa Road",
    products: [
      { name: "काजू कतली", price: "600", unit: "per kg", note: "gift box packing available" },
      { name: "बेसन लड्डू", price: "", unit: "per kg", note: "" },
    ],
    audience: "families and office-goers",
    tone: "Festive and lively",
    languages: ["hi", "hinglish"],
    default_language: "hi",
    colors: { primary: "#b5121b", secondary: "#fff4e0", accent: "#f2a900" },
    whatsapp_number: "98765 43210",
    notes: "Open 8 AM to 10 PM daily",
    ...overrides,
  };
}
