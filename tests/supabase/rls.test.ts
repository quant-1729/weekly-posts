import { IT, assertSafeEnvironment, cleanupAfterAll, createBrandAs, createUser, type ItUser } from "./helpers";
import { beforeAll, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import { randomId } from "./sweep";

/** Row-level security on the real Supabase project: brand separation, with the same withUser/withService the app uses. */

cleanupAfterAll();

describe.skipIf(!IT)("Supabase RLS: one brand cannot see or change another's", () => {
  const db = () => getDb();
  let a: ItUser, b: ItUser;
  let brandA: string, brandB: string;
  let postA: string, postB: string, factA: string, factB: string;

  beforeAll(async () => {
    assertSafeEnvironment();
    a = await createUser();
    b = await createUser();
    brandA = await createBrandAs(a.id, `a-${randomId()}`);
    brandB = await createBrandAs(b.id, `b-${randomId()}`);
    // Rows made by the server (the service role), one set per brand.
    const seed = async (brandId: string, userId: string, tag: string) =>
      db().withService(async (tx) => {
        const [post] = await tx.query<{ id: string }>(
          `insert into public.posts (brand_id, created_by, input_type, input_text, language, status, post_code)
           values ($1, $2, 'text', $3, 'en', 'draft', $4) returning id`,
          [brandId, userId, `${tag} post`, `it${randomId().slice(0, 7)}`],
        );
        const [fact] = await tx.query<{ id: string }>(
          `insert into public.brand_facts (brand_id, kind, value, source_type, created_by)
           values ($1, 'price', $2, 'owner', $3) returning id`,
          [brandId, `${tag} fact`, userId],
        );
        return { post: post.id, fact: fact.id };
      });
    const sa = await seed(brandA, a.id, "A");
    const sb = await seed(brandB, b.id, "B");
    postA = sa.post;
    factA = sa.fact;
    postB = sb.post;
    factB = sb.fact;
  });

  it("each user sees only their own brand and its rows", async () => {
    const seen = await db().withUser(a.id, async (tx) => ({
      brands: await tx.query<{ id: string }>("select id from public.brands"),
      memory: await tx.query<{ brand_id: string }>("select brand_id from public.brand_memory"),
      posts: await tx.query<{ id: string }>("select id from public.posts"),
      facts: await tx.query<{ id: string }>("select id from public.brand_facts"),
      members: await tx.query<{ brand_id: string }>("select brand_id from public.brand_members"),
    }));
    expect(seen.brands.map((r) => r.id)).toEqual([brandA]);
    expect(seen.memory.map((r) => r.brand_id)).toEqual([brandA]);
    expect(seen.posts.map((r) => r.id)).toEqual([postA]);
    expect(seen.facts.map((r) => r.id)).toEqual([factA]);
    expect(seen.members.map((r) => r.brand_id)).toEqual([brandA]);

    const bSees = await db().withUser(b.id, (tx) => tx.query<{ id: string }>("select id from public.posts"));
    expect(bSees.map((r) => r.id)).toEqual([postB]);
  });

  it("A cannot read B's rows even by asking for them by id", async () => {
    const rows = await db().withUser(a.id, async (tx) => [
      ...(await tx.query("select 1 from public.brand_memory where brand_id = $1", [brandB])),
      ...(await tx.query("select 1 from public.posts where id = $1 or brand_id = $2", [postB, brandB])),
      ...(await tx.query("select 1 from public.brand_facts where id = $1 or brand_id = $2", [factB, brandB])),
      ...(await tx.query("select 1 from public.brands where id = $1", [brandB])),
    ]);
    expect(rows).toEqual([]);
  });

  it("A cannot update or delete B's brand_memory, posts, brand_facts or brand, and nothing changes", async () => {
    const touched = await db().withUser(a.id, async (tx) => [
      ...(await tx.query("update public.brand_memory set business_name = 'hacked' where brand_id = $1 returning brand_id", [brandB])),
      ...(await tx.query("update public.posts set input_text = 'hacked' where id = $1 returning id", [postB])),
      ...(await tx.query("update public.brand_facts set value = 'hacked' where id = $1 returning id", [factB])),
      ...(await tx.query("update public.brands set name = 'it-hacked' where id = $1 returning id", [brandB])),
      ...(await tx.query("delete from public.posts where id = $1 returning id", [postB])),
    ]);
    expect(touched).toEqual([]);

    const after = await db().withService(async (tx) => ({
      memory: await tx.query<{ business_name: string }>("select business_name from public.brand_memory where brand_id = $1", [brandB]),
      post: await tx.query<{ input_text: string }>("select input_text from public.posts where id = $1", [postB]),
      fact: await tx.query<{ value: string }>("select value from public.brand_facts where id = $1", [factB]),
      brand: await tx.query<{ name: string }>("select name from public.brands where id = $1", [brandB]),
    }));
    expect(after.memory[0].business_name).toMatch(/^it-b-/);
    expect(after.post[0].input_text).toBe("B post");
    expect(after.fact[0].value).toBe("B fact");
    expect(after.brand[0].name).toMatch(/^it-b-/);
  });

  it("A cannot write into B's brand", async () => {
    await expect(
      db().withUser(a.id, (tx) =>
        tx.query(
          `insert into public.posts (brand_id, created_by, input_type, language, status, post_code)
           values ($1, $2, 'text', 'en', 'draft', $3)`,
          [brandB, a.id, `it${randomId().slice(0, 7)}`],
        ),
      ),
    ).rejects.toThrow(/row-level security/i);
    await expect(
      db().withUser(a.id, (tx) =>
        tx.query("insert into public.brand_members (brand_id, user_id, role) values ($1, $2, 'owner')", [brandB, a.id]),
      ),
    ).rejects.toThrow();
  });

  it("A can read and change A's own rows", async () => {
    const updated = await db().withUser(a.id, (tx) =>
      tx.query<{ value: string }>("update public.brand_facts set value = 'A fact v2' where id = $1 returning value", [factA]),
    );
    expect(updated).toEqual([{ value: "A fact v2" }]);
  });

  it("a signed-in user who belongs to no brand sees nothing", async () => {
    const c = await createUser();
    const rows = await db().withUser(c.id, async (tx) => [
      ...(await tx.query("select 1 from public.brands")),
      ...(await tx.query("select 1 from public.posts")),
      ...(await tx.query("select 1 from public.brand_memory")),
    ]);
    expect(rows).toEqual([]);
  });

  it("the server (withService) sees both brands", async () => {
    const rows = await db().withService((tx) =>
      tx.query<{ id: string }>("select id from public.brands where id = any($1::uuid[])", [[brandA, brandB]]),
    );
    expect(rows.map((r) => r.id).sort()).toEqual([brandA, brandB].sort());
    const posts = await db().withService((tx) => tx.query("select 1 from public.posts where id = any($1::uuid[])", [[postA, postB]]));
    expect(posts).toHaveLength(2);
  });

  it("is_brand_member answers from the signed-in user", async () => {
    const [mine] = await db().withUser(a.id, (tx) => tx.query<{ ok: boolean }>("select public.is_brand_member($1::uuid) as ok", [brandA]));
    const [theirs] = await db().withUser(a.id, (tx) => tx.query<{ ok: boolean }>("select public.is_brand_member($1::uuid) as ok", [brandB]));
    expect(mine.ok).toBe(true);
    expect(theirs.ok).toBe(false);
  });

  it("signed-in users cannot touch the sign-in link table or look up users by address", async () => {
    await expect(db().withUser(a.id, (tx) => tx.query("select 1 from public.magic_links"))).rejects.toThrow(/permission denied/i);
    await expect(db().withUser(a.id, (tx) => tx.query("select public.auth_user_id_by_email($1)", [b.email]))).rejects.toThrow(
      /permission denied/i,
    );
  });

  it("the server can find a user by address (service_role cannot read auth.users)", async () => {
    const [row] = await db().withService((tx) =>
      tx.query<{ id: string | null }>("select public.auth_user_id_by_email($1) as id", [b.email.toUpperCase()]),
    );
    expect(row.id).toBe(b.id);
    const [none] = await db().withService((tx) =>
      tx.query<{ id: string | null }>("select public.auth_user_id_by_email($1) as id", ["it-nobody@example.com"]),
    );
    expect(none.id).toBeNull();
  });

  it("returns bigint as a number and date as a Date, like the mock", async () => {
    const [row] = await db().withService((tx) =>
      tx.query<{ n: number; d: Date; c: number }>("select 7::bigint as n, '2026-10-12'::date as d, count(*) as c from public.brands where false"),
    );
    expect(row.n).toBe(7);
    expect(row.c).toBe(0);
    expect(row.d).toBeInstanceOf(Date);
    expect(row.d.toISOString()).toBe("2026-10-12T00:00:00.000Z");
  });
});
