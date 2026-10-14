import { IT, assertSafeEnvironment, cleanupAfterAll, createNamespacedBrand, createUser, trackEmail } from "./helpers";
import { beforeAll, describe, expect, it } from "vitest";
import { deleteAccount, AccountDeleteError } from "@/lib/account/delete";
import { getDb } from "@/lib/db";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { createSupabaseStorage } from "@/lib/storage/supabase";
import { BUCKETS, type Storage } from "@/lib/storage/types";
import { randomId } from "./sweep";

/** Account deletion (Req 22) on the real project: auth user, rows, sign-in links and stored files all gone. */

cleanupAfterAll();

const bytes = (s: string) => new TextEncoder().encode(s);

describe.skipIf(!IT)("Supabase account deletion", () => {
  const storage = createSupabaseStorage();
  const db = () => getDb();

  beforeAll(() => assertSafeEnvironment());

  async function seed() {
    const user = await createUser();
    const brandId = await createNamespacedBrand(user.id, `del-${randomId()}`);
    // One small file per bucket (each upload is a network round trip, so side by side).
    const files = BUCKETS.map((bucket) => ({ bucket, path: `${brandId}/${bucket}/file.txt` }));
    await Promise.all(files.map((f) => storage.put(f.bucket, f.path, bytes(`${f.bucket} bytes`), "text/plain")));
    await db().withService(async (tx) => {
      await tx.query(
        `insert into public.posts (brand_id, created_by, input_type, input_text, language, status, post_code)
         values ($1, $2, 'text', 'hello', 'en', 'draft', $3)`,
        [brandId, user.id, `it${randomId().slice(0, 7)}`],
      );
      await tx.query(
        "insert into public.brand_facts (brand_id, kind, value, source_type, created_by) values ($1, 'hours', '9 to 5', 'owner', $2)",
        [brandId, user.id],
      );
      await tx.query(
        "insert into public.magic_links (jti, email, ip, expires_at, used_at) values ($1, $2, null, now() + interval '15 minutes', now())",
        [`it-${randomId()}`, user.email],
      );
      await tx.query(
        "insert into public.email_log (brand_id, user_id, kind, to_email, subject, status) values (null, null, 'magic_link', $1, 'Sign in', 'sent'), ($2, $3, 'weekly', $1, 'Your posts', 'sent')",
        [user.email, brandId, user.id],
      );
    });
    return { user, brandId, files };
  }

  /** Rows for the account in the tables that matter, in one query. */
  const rowsFor = async (brandId: string, userId: string, email: string) =>
    (
      await db().withService((tx) =>
        tx.query<Record<string, number>>(
          `select
             (select count(*)::int from public.brands where id = $1) as brands,
             (select count(*)::int from public.brand_members where brand_id = $1 or user_id = $2) as members,
             (select count(*)::int from public.brand_memory where brand_id = $1) as memory,
             (select count(*)::int from public.posts where brand_id = $1) as posts,
             (select count(*)::int from public.brand_facts where brand_id = $1) as facts,
             (select count(*)::int from public.profiles where id = $2) as profiles,
             (select count(*)::int from public.magic_links where lower(email) = $3) as "magicLinks",
             (select count(*)::int from public.email_log where lower(to_email) = $3 or user_id = $2 or brand_id = $1) as emails`,
          [brandId, userId, email],
        ),
      )
    )[0];

  const filesLeft = async (brandId: string) => (await Promise.all(BUCKETS.map((b) => storage.list(b, brandId)))).flat();

  it("deletes the auth user, every row, the sign-in links and every stored file; another account is untouched", async () => {
    const a = await seed();
    const b = await seed();
    const beforeA = await rowsFor(a.brandId, a.user.id, a.user.email);
    expect(Object.values(beforeA).every((v) => v > 0)).toBe(true);
    const beforeB = await rowsFor(b.brandId, b.user.id, b.user.email);
    expect(await filesLeft(a.brandId)).toHaveLength(BUCKETS.length);

    const result = await deleteAccount(a.user.id);
    expect(result).toMatchObject({ deleted: true, brandsDeleted: 1, objectsRemoved: BUCKETS.length });

    // The auth user is gone (both through the lookup the app uses and the admin API).
    const [lookup] = await db().withService((tx) =>
      tx.query<{ id: string | null }>("select public.auth_user_id_by_email($1) as id", [a.user.email]),
    );
    expect(lookup.id).toBeNull();
    const { data } = await getSupabaseAdmin().auth.admin.getUserById(a.user.id);
    expect(data.user).toBeNull();

    // Zero rows, zero files.
    expect(Object.values(await rowsFor(a.brandId, a.user.id, a.user.email)).every((v) => v === 0)).toBe(true);
    expect(await filesLeft(a.brandId)).toEqual([]);

    // The other account is untouched.
    expect(await rowsFor(b.brandId, b.user.id, b.user.email)).toEqual(beforeB);
    expect(await filesLeft(b.brandId)).toHaveLength(BUCKETS.length);
    expect((await getSupabaseAdmin().auth.admin.getUserById(b.user.id)).data.user?.email).toBe(b.user.email);

    // Running it again finds nothing and does not fail.
    expect(await deleteAccount(a.user.id)).toMatchObject({ deleted: false, brandsDeleted: 0, objectsRemoved: 0 });
  });

  it("if deleting files fails, it stops and keeps every row and the user, and a retry finishes", async () => {
    const a = await seed();
    const before = await rowsFor(a.brandId, a.user.id, a.user.email);

    const failing: Storage = {
      ...storage,
      async removePrefix(bucket, prefix) {
        if (bucket === "renders") throw new Error("storage is down");
        return storage.removePrefix(bucket, prefix);
      },
    };
    const err = await deleteAccount(a.user.id, { storage: failing }).catch((e) => e);
    expect(err).toBeInstanceOf(AccountDeleteError);
    expect(err.stage).toBe("storage");

    expect(await rowsFor(a.brandId, a.user.id, a.user.email)).toEqual(before);
    const [still] = await db().withService((tx) =>
      tx.query<{ id: string | null }>("select public.auth_user_id_by_email($1) as id", [a.user.email]),
    );
    expect(still.id).toBe(a.user.id);

    const retry = await deleteAccount(a.user.id);
    expect(retry.deleted).toBe(true);
    expect(Object.values(await rowsFor(a.brandId, a.user.id, a.user.email)).every((v) => v === 0)).toBe(true);
    expect(await filesLeft(a.brandId)).toEqual([]);
  });

  it("a user made the way sign-in makes them (find or create by address) can be deleted", async () => {
    const email = `it-${randomId()}@example.com`;
    trackEmail(email);
    // Make the user the way sign-in does: through findOrCreate, then a profile.
    const { findOrCreateSupabaseUser } = await import("@/lib/supabase/users");
    const id = await findOrCreateSupabaseUser(email);
    expect(await findOrCreateSupabaseUser(email)).toBe(id); // finds, does not create a second
    await db().withService((tx) =>
      tx.query("insert into public.profiles (id, email, consent_at) values ($1, $2, now()) on conflict do nothing", [id, email]),
    );
    expect((await deleteAccount(id)).deleted).toBe(true);
    const [lookup] = await db().withService((tx) =>
      tx.query<{ id: string | null }>("select public.auth_user_id_by_email($1) as id", [email]),
    );
    expect(lookup.id).toBeNull();
  });
});
