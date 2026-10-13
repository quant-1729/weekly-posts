import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getCurrentBrand, needsSetup, requireBrandMember, BrandAccessError } from "@/lib/brand/current";
import type { MockDb } from "@/lib/db/mock";
import { closeTestDb, createBrandFor, createUser, openTestDb } from "./helpers";

let db: MockDb;
beforeAll(async () => {
  db = await openTestDb();
});
afterAll(async () => {
  await closeTestDb(db);
});

describe("getCurrentBrand", () => {
  it("is null for a user with no brand", async () => {
    const u = await createUser(db);
    expect(await getCurrentBrand(u.id)).toBeNull();
    expect(needsSetup(null)).toBe(true);
  });

  it("uses profiles.last_brand_id when the user is a member", async () => {
    const u = await createUser(db);
    const first = await createBrandFor(db, u.id, "First");
    const second = await createBrandFor(db, u.id, "Second");
    await db.withUser(u.id, (tx) => tx.query("update public.profiles set last_brand_id = $2 where id = $1", [u.id, second]));
    const b = await getCurrentBrand(u.id);
    expect(b?.id).toBe(second);
    expect(b?.name).toBe("Second");
    expect(first).not.toBe(second);
  });

  it("falls back to the first membership when last_brand_id is not set", async () => {
    const u = await createUser(db);
    const first = await createBrandFor(db, u.id, "Oldest");
    await createBrandFor(db, u.id, "Newer");
    expect((await getCurrentBrand(u.id))?.id).toBe(first);
  });

  it("falls back to the first membership when the user left the last brand", async () => {
    const u = await createUser(db);
    const kept = await createBrandFor(db, u.id, "Kept");
    const left = await createBrandFor(db, u.id, "Left");
    await db.withUser(u.id, (tx) => tx.query("update public.profiles set last_brand_id = $2 where id = $1", [u.id, left]));
    await db.withAdmin((tx) => tx.query("delete from public.brand_members where brand_id = $1 and user_id = $2", [left, u.id]));
    expect((await getCurrentBrand(u.id))?.id).toBe(kept);
  });

  it("never returns another user's brand, even if last_brand_id was forced to it", async () => {
    const a = await createUser(db);
    const b = await createUser(db);
    const brandA = await createBrandFor(db, a.id, "A only");
    // Forced with the owner connection (RLS would refuse this for the user).
    await db.withAdmin((tx) => tx.query("update public.profiles set last_brand_id = $2 where id = $1", [b.id, brandA]));
    expect(await getCurrentBrand(b.id)).toBeNull();
    await expect(requireBrandMember(b.id, brandA)).rejects.toBeInstanceOf(BrandAccessError);
    await expect(requireBrandMember(a.id, brandA)).resolves.toBeUndefined();
  });

  it("reports whether setup is finished", async () => {
    const u = await createUser(db);
    const id = await createBrandFor(db, u.id);
    const before = await getCurrentBrand(u.id);
    expect(before?.setupCompleted).toBe(false);
    expect(needsSetup(before)).toBe(true);
    await db.withUser(u.id, (tx) => tx.query("update public.brand_memory set setup_completed_at = now() where brand_id = $1", [id]));
    const after = await getCurrentBrand(u.id);
    expect(after?.setupCompleted).toBe(true);
    expect(needsSetup(after)).toBe(false);
  });
});
