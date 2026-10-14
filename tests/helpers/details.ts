import { randomUUID } from "node:crypto";
import { createMockDb, setMockDbForTests, type MockDb } from "@/lib/db/mock";

/** A fresh in-memory database used as the process-wide mock backend. Call `closeDb` in afterAll. */
export async function openDb(): Promise<MockDb> {
  const db = await createMockDb();
  setMockDbForTests(db);
  return db;
}

export async function closeDb(db: MockDb): Promise<void> {
  setMockDbForTests(null);
  await db.close();
}

export interface Owner {
  userId: string;
  brandId: string;
}

/** A signed-up owner with a brand whose country and time zone are set. */
export async function makeOwner(
  db: MockDb,
  o: { name?: string; country?: string | null; timezone?: string; city?: string | null; website?: string | null } = {},
): Promise<Owner> {
  const email = `owner-${randomUUID().slice(0, 8)}@example.com`;
  const userId = await db.withAdmin(async (tx) => {
    const [u] = await tx.query<{ id: string }>("insert into auth.users (email) values ($1) returning id", [email]);
    await tx.query("insert into public.profiles (id, email, consent_at) values ($1, $2, now())", [u.id, email]);
    return u.id;
  });
  const [{ id: brandId }] = await db.withUser(userId, (tx) =>
    tx.query<{ id: string }>("select public.create_brand($1) as id", [o.name ?? "Corner Bakery"]),
  );
  await db.withUser(userId, (tx) =>
    tx.query(
      `update public.brand_memory set country = $2, timezone = $3, city = $4, website_url = $5, post_language = 'en',
              setup_completed_at = now() where brand_id = $1`,
      [brandId, o.country === undefined ? "GB" : o.country, o.timezone ?? "Europe/London", o.city ?? null, o.website ?? null],
    ),
  );
  return { userId, brandId };
}

export async function addFact(
  db: MockDb,
  owner: Owner,
  f: { kind: string; value: string; label?: string | null; source?: "website" | "setup" | "upload" | "owner"; active?: boolean },
): Promise<string> {
  const [row] = await db.withUser(owner.userId, (tx) =>
    tx.query<{ id: string }>(
      `insert into public.brand_facts (brand_id, kind, label, value, source_type, active, created_by)
       values ($1, $2::public.fact_kind, $3, $4, $5::public.fact_source, $6, $7) returning id`,
      [owner.brandId, f.kind, f.label ?? null, f.value, f.source ?? "website", f.active ?? true, owner.userId],
    ),
  );
  return row.id;
}
