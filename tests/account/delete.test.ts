import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { AccountDeleteError, auditId, deleteAccount } from "@/lib/account/delete";
import { createMockDb, setMockDbForTests, type MockDb } from "@/lib/db/mock";
import { BUCKETS, type Storage } from "@/lib/storage";
import { createMockStorage } from "@/lib/storage/mock";
import { StoragePathError } from "@/lib/storage/types";
import { accountRowCounts, accountRules, authUserExists, newUser } from "./helpers";
import { filesUnder, seedAccount } from "./seed";

let db: MockDb;
let root: string;
let storage: Storage;

beforeAll(async () => {
  db = await createMockDb();
  setMockDbForTests(db);
});
afterAll(async () => {
  setMockDbForTests(null);
  await db.close();
});
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "pm-account-"));
  storage = createMockStorage(root);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});

const nonZero = (counts: Record<string, number>) => Object.entries(counts).filter(([, n]) => n > 0);

/** The tables the seed fills for sure. A table added later that the seed does not fill is only warned about. */
const CORE_TABLES = [
  "profiles", "brands", "brand_members", "brand_memory", "brand_facts", "photos", "owner_dates", "voice_feedback",
  "weekly_plans", "plan_ideas", "mascots", "weekly_batches", "posts", "post_images", "outputs", "post_actions", "clicks",
  "checkins", "approval_links", "approvals", "approval_comments", "summary_shares", "usage_events", "email_log", "magic_links",
  "usps", "contact_points", "post_briefs",
];

describe("deleteAccount (AC 22)", () => {
  it("leaves zero rows in every public table, zero files in every bucket, and no auth user", async () => {
    const a = await seedAccount(db, storage);
    const b = await seedAccount(db, storage);

    const { rules, allTables } = await accountRules(db);
    // Every table must be tied to an account by some column, or this test cannot see it.
    // Only tables that hold no personal data may be left out, and each must be named here on purpose
    // (used_tokens: a hash of a random link id, no brand and no user; deletion_requests: Meta's
    // data-deletion receipts, only a platform account id and a code, kept after the account is gone;
    // admin_actions: what an admin did, keyed by the admin's own email, not an owner's data).
    const NO_PERSONAL_DATA = ["used_tokens", "deletion_requests", "admin_actions"];
    expect([...rules].filter(([t, conds]) => conds.length === 0 && !NO_PERSONAL_DATA.includes(t)).map(([t]) => t)).toEqual([]);
    expect(allTables).toEqual(expect.arrayContaining(CORE_TABLES));

    const beforeA = await accountRowCounts(db, a);
    const beforeB = await accountRowCounts(db, b);
    for (const t of CORE_TABLES) expect(beforeA[t], `seed should fill ${t}`).toBeGreaterThan(0);
    const unseeded = Object.entries(beforeA).filter(([, n]) => n === 0).map(([t]) => t);
    if (unseeded.length) console.warn(`[account test] tables the seed does not fill: ${unseeded.join(", ")}`);
    expect((await filesUnder(storage, a.brandId)).length).toBe(a.files.length);
    for (const bucket of BUCKETS) {
      if (bucket === "brand-assets" || bucket === "photos" || bucket === "inputs" || bucket === "renders" || bucket === "mascots") {
        expect(a.files.some((f) => f.bucket === bucket), `seed has a file in ${bucket}`).toBe(true);
      }
    }

    const result = await deleteAccount(a.userId, { storage });
    expect(result).toMatchObject({ deleted: true, brandsDeleted: 1, objectsRemoved: a.files.length });

    // Zero rows for the brand and the user in every public table, found from information_schema.
    const afterA = await accountRowCounts(db, a);
    expect(nonZero(afterA)).toEqual([]);
    // Zero storage objects under the brand prefix, in every bucket.
    expect(await filesUnder(storage, a.brandId)).toEqual([]);
    for (const bucket of BUCKETS) {
      expect(await readdir(path.join(root, bucket)).catch(() => [] as string[])).not.toContain(a.brandId);
      expect(await readdir(path.join(root, ".meta", bucket)).catch(() => [] as string[])).not.toContain(a.brandId);
    }
    // And no auth user.
    expect(await authUserExists(db, a.userId)).toBe(false);

    // The other account is untouched: every row, every file, byte for byte.
    expect(await accountRowCounts(db, b)).toEqual(beforeB);
    expect(await authUserExists(db, b.userId)).toBe(true);
    for (const f of b.files) {
      const got = await storage.get(f.bucket, f.path);
      expect(got && Buffer.from(got.bytes).equals(f.bytes)).toBe(true);
    }
  });

  it("removes email rows that name the user but no brand (the user_id cascade) and sign-in emails by address", async () => {
    const a = await seedAccount(db, storage);
    const row = (subject: string) =>
      db.withAdmin((tx) => tx.query("select 1 from public.email_log where subject = $1 and (user_id = $2 or lower(to_email) = lower($3))", [subject, a.userId, a.email]));
    expect(await row("User-only row, other address")).toHaveLength(1); // user id, no brand, a different address
    expect(await row("Sign in")).toHaveLength(1); // address only
    await deleteAccount(a.userId, { storage });
    expect(await row("User-only row, other address")).toHaveLength(0);
    expect(await row("Sign in")).toHaveLength(0);
    // Other people's emails are not touched.
    const other = await seedAccount(db, storage);
    await deleteAccount(a.userId, { storage });
    expect((await accountRowCounts(db, other)).email_log).toBe(5);
  });

  it("is safe to run again: nothing left, no error, nobody else touched", async () => {
    const a = await seedAccount(db, storage);
    const b = await seedAccount(db, storage);
    const beforeB = await accountRowCounts(db, b);
    expect((await deleteAccount(a.userId, { storage })).deleted).toBe(true);
    const again = await deleteAccount(a.userId, { storage });
    expect(again).toEqual({ deleted: false, brandsDeleted: 0, membershipsRemoved: 0, objectsRemoved: 0 });
    expect(await deleteAccount(randomUUID(), { storage })).toMatchObject({ deleted: false });
    expect(nonZero(await accountRowCounts(db, a))).toEqual([]);
    expect(await accountRowCounts(db, b)).toEqual(beforeB);
  });

  it("deletes files first, while the rows still exist", async () => {
    const a = await seedAccount(db, storage);
    const seen: Array<{ bucket: string; brandRows: number }> = [];
    const spy: Storage = {
      ...storage,
      async removePrefix(bucket, prefix) {
        const [r] = await db.withAdmin((tx) => tx.query<{ n: number }>("select count(*)::int as n from public.brands where id = $1", [a.brandId]));
        seen.push({ bucket, brandRows: r.n });
        return storage.removePrefix(bucket, prefix);
      },
    };
    await deleteAccount(a.userId, { storage: spy });
    expect(seen.map((s) => s.bucket)).toEqual([...BUCKETS]);
    expect(seen.every((s) => s.brandRows === 1)).toBe(true);
  });

  it("if deleting files fails part way, it stops and keeps every row so a retry can finish", async () => {
    const a = await seedAccount(db, storage);
    const b = await seedAccount(db, storage);
    const beforeA = await accountRowCounts(db, a);
    const beforeB = await accountRowCounts(db, b);

    const failing: Storage = {
      ...storage,
      async removePrefix(bucket, prefix) {
        if (bucket === "renders") throw new Error("storage is down");
        return storage.removePrefix(bucket, prefix);
      },
    };
    const err = await deleteAccount(a.userId, { storage: failing }).catch((e) => e);
    expect(err).toBeInstanceOf(AccountDeleteError);
    expect(err.stage).toBe("storage");

    // Every row is still there, and so is the user: nothing was half deleted.
    expect(await accountRowCounts(db, a)).toEqual(beforeA);
    expect(await authUserExists(db, a.userId)).toBe(true);
    // Files before the failing bucket are gone; the rest are still there, so the retry has work to do.
    const left = await filesUnder(storage, a.brandId);
    expect(left.some((p) => p.startsWith("renders/"))).toBe(true);
    expect(left.some((p) => p.startsWith("brand-assets/"))).toBe(false);

    // The retry finishes the job.
    expect((await deleteAccount(a.userId, { storage })).deleted).toBe(true);
    expect(nonZero(await accountRowCounts(db, a))).toEqual([]);
    expect(await filesUnder(storage, a.brandId)).toEqual([]);
    expect(await accountRowCounts(db, b)).toEqual(beforeB);
  });

  it("if the database step fails, the rows stay (one transaction) and the retry works", async () => {
    const a = await seedAccount(db, storage);
    const beforeA = await accountRowCounts(db, a);
    // A trigger that refuses the delete of this brand.
    await db.withAdmin((tx) =>
      tx.query(`create or replace function public.test_refuse_delete() returns trigger language plpgsql as $$ begin raise exception 'refused'; end $$`),
    );
    await db.withAdmin((tx) => tx.query("create trigger test_refuse before delete on public.brands for each row execute function public.test_refuse_delete()"));
    try {
      const err = await deleteAccount(a.userId, { storage }).catch((e) => e);
      expect(err).toBeInstanceOf(AccountDeleteError);
      expect(err.stage).toBe("database");
      expect(await accountRowCounts(db, a)).toEqual(beforeA);
    } finally {
      await db.withAdmin((tx) => tx.query("drop trigger test_refuse on public.brands"));
      await db.withAdmin((tx) => tx.query("drop function public.test_refuse_delete()"));
    }
    expect((await deleteAccount(a.userId, { storage })).deleted).toBe(true);
    expect(nonZero(await accountRowCounts(db, a))).toEqual([]);
  });

  describe("brands shared with other people", () => {
    async function sharedSetup() {
      const a = await seedAccount(db, storage); // a's own brand, nobody else in it
      const c = await newUser(db, `colleague-${randomUUID().slice(0, 6)}@example.com`);
      // A second brand, made by A, shared with C (the agency case).
      const [{ id: sharedBrand }] = await db.withUser(a.userId, (tx) => tx.query<{ id: string }>("select public.create_brand('Shared Cafe') as id"));
      const postId = randomUUID();
      await db.withAdmin(async (tx) => {
        await tx.query("insert into public.brand_members (brand_id, user_id, role) values ($1, $2, 'editor')", [sharedBrand, c]);
        await tx.query(
          "insert into public.brand_facts (brand_id, kind, value, source_type, created_by) values ($1, 'other', 'Open late', 'owner', $2)",
          [sharedBrand, a.userId],
        );
        await tx.query(
          "insert into public.posts (id, brand_id, created_by, caption, status, post_code) values ($1, $2, $3, 'Shared post', 'draft', $4)",
          [postId, sharedBrand, a.userId, `s${randomUUID().slice(0, 6).replace(/-/g, "x")}`],
        );
        await tx.query("insert into public.post_actions (post_id, brand_id, action, via, user_id) values ($1, $2, 'approve', 'dashboard', $3)", [postId, sharedBrand, a.userId]);
        await tx.query("insert into public.usage_events (brand_id, user_id, kind) values ($1, $2, 'rewrite')", [sharedBrand, a.userId]);
        await tx.query("insert into public.email_log (brand_id, user_id, kind, to_email, subject, status) values ($1, $2, 'weekly', $3, 'Shared week', 'sent')", [sharedBrand, a.userId, a.email]);
        await tx.query("update public.profiles set last_brand_id = $2 where id = $1", [a.userId, sharedBrand]);
      });
      await storage.put("photos", `${sharedBrand}/shared.jpg`, new Uint8Array([1, 2, 3]), "image/jpeg");
      return { a, c, sharedBrand, postId };
    }

    it("removes only the user's membership, keeps the brand, its data and its files, and still deletes the user", async () => {
      const { a, c, sharedBrand } = await sharedSetup();
      const result = await deleteAccount(a.userId, { storage });
      expect(result).toMatchObject({ deleted: true, brandsDeleted: 1, membershipsRemoved: 1 });

      // The user's own brand is gone; the shared one is not.
      expect(nonZero(await accountRowCounts(db, a))).toEqual([]);
      const brand = await db.withAdmin((tx) => tx.query<{ created_by: string }>("select created_by from public.brands where id = $1", [sharedBrand]));
      expect(brand).toHaveLength(1);
      expect(brand[0].created_by).toBe(c); // handed to the remaining member, so the user can be deleted
      const members = await db.withAdmin((tx) => tx.query<{ user_id: string }>("select user_id from public.brand_members where brand_id = $1", [sharedBrand]));
      expect(members.map((m) => m.user_id)).toEqual([c]);
      expect(await authUserExists(db, a.userId)).toBe(false);
      expect(await authUserExists(db, c)).toBe(true);

      // The shared brand's data and files are all still there; the user's name is gone from them.
      const kept = await db.withAdmin(async (tx) => ({
        facts: await tx.query<{ created_by: string | null }>("select created_by from public.brand_facts where brand_id = $1", [sharedBrand]),
        posts: await tx.query<{ created_by: string | null }>("select created_by from public.posts where brand_id = $1", [sharedBrand]),
        actions: await tx.query<{ user_id: string | null }>("select user_id from public.post_actions where brand_id = $1", [sharedBrand]),
        usage: await tx.query<{ user_id: string | null }>("select user_id from public.usage_events where brand_id = $1", [sharedBrand]),
        mail: await tx.query("select 1 from public.email_log where brand_id = $1", [sharedBrand]),
      }));
      expect(kept.facts).toEqual([{ created_by: null }]);
      expect(kept.posts).toEqual([{ created_by: null }]);
      expect(kept.actions).toEqual([{ user_id: null }]);
      expect(kept.usage).toEqual([{ user_id: null }]);
      expect(kept.mail).toHaveLength(0); // that email was sent to the deleted user's address
      expect(await storage.get("photos", `${sharedBrand}/shared.jpg`)).not.toBeNull();
    });

    it("works the same when the shared brand is the user's only brand, and when a re-run follows", async () => {
      const { a, sharedBrand } = await sharedSetup();
      await deleteAccount(a.userId, { storage });
      expect((await deleteAccount(a.userId, { storage })).deleted).toBe(false);
      const left = await db.withAdmin((tx) => tx.query("select 1 from public.brands where id = $1", [sharedBrand]));
      expect(left).toHaveLength(1);
    });
  });

  it("deletes a brand that the user made but nobody belongs to, which would otherwise block deleting the user", async () => {
    const userId = await newUser(db, `lonely-${randomUUID().slice(0, 6)}@example.com`);
    const brandId = randomUUID();
    await db.withAdmin((tx) => tx.query("insert into public.brands (id, name, created_by) values ($1, 'Orphan', $2)", [brandId, userId]));
    await storage.put("inputs", `${brandId}/x.wav`, new Uint8Array([1]), "audio/wav");
    const r = await deleteAccount(userId, { storage });
    expect(r).toMatchObject({ deleted: true, brandsDeleted: 1, objectsRemoved: 1 });
    expect(await db.withAdmin((tx) => tx.query("select 1 from public.brands where id = $1", [brandId]))).toHaveLength(0);
  });

  it("deletes a user who never finished setup (no brand)", async () => {
    const userId = await newUser(db, `new-${randomUUID().slice(0, 6)}@example.com`);
    expect(await deleteAccount(userId, { storage })).toMatchObject({ deleted: true, brandsDeleted: 0 });
    expect(await authUserExists(db, userId)).toBe(false);
  });

  it("logs one line, with a hash and no id, email or business name", async () => {
    const a = await seedAccount(db, storage);
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    await deleteAccount(a.userId, { storage });
    expect(info).toHaveBeenCalledTimes(1);
    const line = String(info.mock.calls[0][0]);
    expect(line).toContain(auditId(a.userId));
    for (const secret of [a.userId, a.email, a.name, a.brandId]) expect(line).not.toContain(secret);
    // A re-run deletes nothing, so it logs nothing.
    await deleteAccount(a.userId, { storage });
    expect(info).toHaveBeenCalledTimes(1);
  });

  it("rejects a malformed user id before touching anything", async () => {
    await expect(deleteAccount("not-a-uuid", { storage })).rejects.toThrow("Invalid user id");
  });
});

describe("storage list and removePrefix (mock)", () => {
  it("lists and removes only under the prefix, ignores a missing prefix, and rejects bad prefixes", async () => {
    const brand = randomUUID();
    const other = randomUUID();
    await storage.put("photos", `${brand}/a.jpg`, new Uint8Array([1]), "image/jpeg");
    await storage.put("photos", `${brand}/sub/b.jpg`, new Uint8Array([2]), "image/jpeg");
    await storage.put("photos", `${other}/c.jpg`, new Uint8Array([3]), "image/jpeg");
    expect(await storage.list("photos", brand)).toEqual([`${brand}/a.jpg`, `${brand}/sub/b.jpg`]);
    expect(await storage.list("photos", `${brand}/sub/`)).toEqual([`${brand}/sub/b.jpg`]);
    expect(await storage.list("renders", brand)).toEqual([]);
    expect(await storage.removePrefix("photos", brand)).toBe(2);
    expect(await storage.removePrefix("photos", brand)).toBe(0);
    expect(await storage.get("photos", `${brand}/a.jpg`)).toBeNull();
    expect(await storage.get("photos", `${other}/c.jpg`)).not.toBeNull();
    for (const bad of ["", "..", "../x", "not-a-uuid", `${brand}/../${other}`, "/abs", `${brand}//x`]) {
      await expect(storage.removePrefix("photos", bad)).rejects.toThrow(StoragePathError);
      await expect(storage.list("photos", bad)).rejects.toThrow(StoragePathError);
    }
    await expect(storage.removePrefix("secrets" as never, brand)).rejects.toThrow(StoragePathError);
  });
});
