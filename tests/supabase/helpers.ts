import "./env";
import { afterAll } from "vitest";
import { getDb } from "@/lib/db";
import { closeSupabasePool } from "@/lib/db/supabase";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getEnv } from "@/lib/env";
import { closeRawDb, itEmail, purge, testBrandId } from "./sweep";

export { IT } from "./env";
export { itEmail, testBrandId } from "./sweep";

export interface ItUser {
  id: string;
  email: string;
}

const users: ItUser[] = [];
const emails = new Set<string>();
const brandIds = new Set<string>();

/** Safety: these tests must never reach a real inbox, a live model or the mock database. */
export function assertSafeEnvironment(): void {
  const env = getEnv();
  if (env.dataBackend !== "supabase") throw new Error("Expected DATA_BACKEND=supabase in the test process");
  if (env.resendApiKey || env.emailFrom) throw new Error("Resend must be off in the integration tests");
  if (process.env.AI_MODE !== "fixture") throw new Error("AI_MODE must be fixture");
}

/** Remember an address (e.g. one created by the sign-in flow) so afterAll removes it. */
export function trackEmail(email: string): void {
  emails.add(email.toLowerCase());
}
export function trackBrand(id: string): void {
  brandIds.add(id);
}

/** A confirmed auth user with a profile, made through the Auth admin API. */
export async function createUser(): Promise<ItUser> {
  const email = itEmail();
  trackEmail(email);
  const { data, error } = await getSupabaseAdmin().auth.admin.createUser({ email, email_confirm: true });
  if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`);
  const user = { id: data.user.id, email };
  users.push(user);
  await getDb().withService((tx) =>
    tx.query("insert into public.profiles (id, email, consent_at) values ($1, $2, now()) on conflict (id) do nothing", [
      user.id,
      email,
    ]),
  );
  return user;
}

/** A brand made the way the app does it: create_brand() as the user, who becomes its owner. */
export async function createBrandAs(userId: string, label: string): Promise<string> {
  const [row] = await getDb().withUser(userId, (tx) =>
    tx.query<{ id: string }>("select public.create_brand($1) as id", [`it-${label}`]),
  );
  trackBrand(row.id);
  return row.id;
}

/** A brand with an id inside the test namespace (so its stored files are found by a sweep), owned by the user. */
export async function createNamespacedBrand(userId: string, label: string): Promise<string> {
  const id = testBrandId();
  trackBrand(id);
  await getDb().withService(async (tx) => {
    await tx.query("insert into public.brands (id, name, created_by) values ($1, $2, $3)", [id, `it-${label}`, userId]);
    await tx.query("insert into public.brand_members (brand_id, user_id, role) values ($1, $2, 'owner')", [id, userId]);
    await tx.query("insert into public.brand_memory (brand_id, business_name) values ($1, $2)", [id, `it-${label}`]);
  });
  return id;
}

/** Removes everything this file created, even when a test failed. Call once from the file's afterAll. */
export function cleanupAfterAll(): void {
  afterAll(async () => {
    try {
      await purge({ userIds: users.map((u) => u.id), emails: [...emails], brandIds: [...brandIds] });
    } finally {
      await closeSupabasePool();
      await closeRawDb();
    }
  });
}
