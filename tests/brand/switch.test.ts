import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BrandAccessError, getCurrentBrand, listUserBrands, switchBrand } from "@/lib/brand/current";
import type { MockDb } from "@/lib/db/mock";
import { listPosts } from "@/lib/posts/history";
import { allChannels, seedPost } from "../posts/seed";
import { closeTestDb, createBrandFor, createUser, openTestDb } from "./helpers";

// R14: a user can belong to several brands and switch between them, with fully separate data.

let db: MockDb;
beforeAll(async () => {
  db = await openTestDb();
});
afterAll(async () => {
  await closeTestDb(db);
});

const lastBrand = (userId: string) =>
  db
    .withAdmin((tx) => tx.query<{ last_brand_id: string | null }>("select last_brand_id from public.profiles where id = $1", [userId]))
    .then((r) => r[0].last_brand_id);

async function twoBrandUser() {
  const user = await createUser(db);
  const a = await createBrandFor(db, user.id, "Shop A");
  const b = await createBrandFor(db, user.id, "Shop B");
  const postA = await seedPost(db, a, user.id, { createdAt: "2026-10-10 10:00:00+05:30", outputs: allChannels("hi", "Post of A") });
  const postB = await seedPost(db, b, user.id, { createdAt: "2026-10-11 10:00:00+05:30", outputs: allChannels("en", "Post of B") });
  return { user, a, b, postA, postB };
}

describe("brand switching (R14)", () => {
  it("lists every brand the user belongs to", async () => {
    const { user, a, b } = await twoBrandUser();
    expect((await listUserBrands(user.id)).map((x) => x.id)).toEqual([a, b]);
  });

  it("keeps the data of two brands fully separate when switching", async () => {
    const { user, a, b, postA, postB } = await twoBrandUser();

    // Brand A is current (oldest membership): only its post is listed.
    expect((await getCurrentBrand(user.id))?.id).toBe(a);
    expect((await listPosts(user.id, a)).posts.map((p) => p.id)).toEqual([postA]);

    await switchBrand(user.id, b);
    expect(await lastBrand(user.id)).toBe(b);
    expect((await getCurrentBrand(user.id))?.id).toBe(b);
    expect((await getCurrentBrand(user.id))?.name).toBe("Shop B");
    expect((await listPosts(user.id, b)).posts.map((p) => p.id)).toEqual([postB]);

    // Brand B's list never holds A's post, and the reverse.
    expect((await listPosts(user.id, b)).posts.map((p) => p.id)).not.toContain(postA);
    expect((await listPosts(user.id, a)).posts.map((p) => p.id)).not.toContain(postB);

    await switchBrand(user.id, a);
    expect(await lastBrand(user.id)).toBe(a);
    expect((await getCurrentBrand(user.id))?.id).toBe(a);
  });

  it("rejects a brand the user is not a member of and leaves last_brand_id unchanged", async () => {
    const { user, b } = await twoBrandUser();
    await switchBrand(user.id, b);
    const stranger = await createUser(db);
    const strangerBrand = await createBrandFor(db, stranger.id, "Not yours");

    await expect(switchBrand(user.id, strangerBrand)).rejects.toBeInstanceOf(BrandAccessError);
    await expect(switchBrand(user.id, "not-a-uuid")).rejects.toBeInstanceOf(BrandAccessError);
    await expect(switchBrand(user.id, "00000000-0000-4000-8000-000000000000")).rejects.toBeInstanceOf(BrandAccessError);
    expect(await lastBrand(user.id)).toBe(b);
    expect((await getCurrentBrand(user.id))?.id).toBe(b);
  });

  it("shows a second user nothing of either brand", async () => {
    const { user, a, b } = await twoBrandUser();
    const other = await createUser(db);
    expect(await listUserBrands(other.id)).toEqual([]);
    expect(await getCurrentBrand(other.id)).toBeNull();
    expect((await listPosts(other.id, a)).posts).toEqual([]);
    expect((await listPosts(other.id, b)).posts).toEqual([]);
    await expect(switchBrand(other.id, a)).rejects.toBeInstanceOf(BrandAccessError);
    expect(await lastBrand(other.id)).toBeNull();
    expect(await lastBrand(user.id)).toBeNull();
  });

  it("can switch to a brand where the user is a member but not the owner", async () => {
    const owner = await createUser(db);
    const shared = await createBrandFor(db, owner.id, "Shared");
    const member = await createUser(db);
    const mine = await createBrandFor(db, member.id, "Mine");
    await db.withAdmin((tx) => tx.query("insert into public.brand_members (brand_id, user_id, role) values ($1, $2, 'editor')", [shared, member.id]));
    expect((await listUserBrands(member.id)).map((x) => x.id).sort()).toEqual([mine, shared].sort());
    await switchBrand(member.id, shared);
    expect((await getCurrentBrand(member.id))?.id).toBe(shared);
  });
});
