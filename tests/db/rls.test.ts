// Schema + RLS checks (ported from the T-1 script) running through the real
// src/lib/db mock: a fresh in-memory PGlite with the stub auth schema and all
// migrations applied by createMockDb.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMockDb, type MockDb } from "@/lib/db/mock";
import type { Tx } from "@/lib/db";

let db: MockDb;
let a: string, b: string; // user ids
let a1: string, a2: string, b1: string; // brand ids
let postA1: string;

/** Raw role switch for cases withUser/withService do not cover (anon, no uid). */
function rawAs<T>(role: string, uid: string | null, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.raw.transaction(async (t) => {
    await t.query(`set local role ${role}`);
    await t.query(`select set_config('request.jwt.claim.sub', $1, true)`, [uid ?? ""]);
    return fn({ query: async (sql, params) => (await t.query(sql, params)).rows as never });
  });
}

async function fails(fn: () => Promise<unknown>): Promise<boolean> {
  try {
    await fn();
    return false;
  } catch {
    return true;
  }
}

/** Number of rows an update/delete touched (the Tx interface returns rows only). */
const touched = async (tx: Tx, sql: string, params: unknown[]) => {
  const rows = await tx.query<{ n: number }>(
    `with q as (${sql} returning 1) select count(*)::int as n from q`,
    params,
  );
  return rows[0].n;
};

beforeAll(async () => {
  db = await createMockDb();

  // Users (auth.users is owned by the auth service, so created as owner)
  const users = await db.withAdmin(async (tx) => {
    const [ua] = await tx.query<{ id: string }>(
      `insert into auth.users (phone) values ('+919800000001') returning id`,
    );
    const [ub] = await tx.query<{ id: string }>(
      `insert into auth.users (phone) values ('+919800000002') returning id`,
    );
    return [ua.id, ub.id];
  });
  [a, b] = users;
  for (const [u, p] of [
    [a, "1"],
    [b, "2"],
  ]) {
    await db.withUser(u, (tx) =>
      tx.query(`insert into public.profiles (id, phone, consent_at) values ($1, $2, now())`, [
        u,
        "+91980000000" + p,
      ]),
    );
  }

  // Brands: A has two (R14), B has one
  const mk = (u: string, n: string) =>
    db.withUser(u, (tx) => tx.query<{ id: string }>(`select public.create_brand($1) as id`, [n])).then((r) => r[0].id);
  a1 = await mk(a, "Sharma Sweets");
  a2 = await mk(a, "Sharma Salon");
  b1 = await mk(b, "Gupta Clinic");
});

afterAll(async () => {
  await db.close();
});

describe("brand scoping (R14)", () => {
  it("A sees exactly its 2 brands", async () => {
    const rows = await db.withUser(a, (tx) => tx.query<{ id: string }>(`select id from public.brands order by name`));
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => [a1, a2].includes(r.id))).toBe(true);
  });

  it("B sees only its 1 brand", async () => {
    const rows = await db.withUser(b, (tx) => tx.query<{ id: string }>(`select id from public.brands`));
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(b1);
  });

  it("create_brand made brand_memory rows (A sees 2)", async () => {
    const rows = await db.withUser(a, (tx) => tx.query<{ n: number }>(`select count(*)::int n from public.brand_memory`));
    expect(rows[0].n).toBe(2);
  });
});

describe("posts and outputs", () => {
  beforeAll(async () => {
    postA1 = await db
      .withUser(a, (tx) =>
        tx.query<{ id: string }>(
          `insert into public.posts (brand_id, created_by, input_type, input_text, language, post_code)
           values ($1, $2, 'text', 'Diwali special', 'hi', 'abc123') returning id`,
          [a1, a],
        ),
      )
      .then((r) => r[0].id);
    await db.withUser(a, (tx) =>
      tx.query(`insert into public.outputs (post_id, brand_id, channel, language, caption) values ($1, $2, 'ig_feed', 'hi', 'x')`, [
        postA1,
        a1,
      ]),
    );
  });

  it("B cannot read A posts", async () => {
    expect(await db.withUser(b, (tx) => tx.query(`select * from public.posts`))).toHaveLength(0);
  });
  it("B cannot read A outputs", async () => {
    expect(await db.withUser(b, (tx) => tx.query(`select * from public.outputs`))).toHaveLength(0);
  });
  it("B cannot read A brand_memory", async () => {
    expect(
      await db.withUser(b, (tx) => tx.query(`select * from public.brand_memory where brand_id = $1`, [a1])),
    ).toHaveLength(0);
  });
  it("B cannot insert a post into A brand", async () => {
    expect(
      await fails(() =>
        db.withUser(b, (tx) =>
          tx.query(`insert into public.posts (brand_id, input_type, language, post_code) values ($1, 'text', 'en', 'zzz999')`, [a1]),
        ),
      ),
    ).toBe(true);
  });
  it("B cannot attach an output in its brand to A post (composite FK)", async () => {
    expect(
      await fails(() =>
        db.withUser(b, (tx) =>
          tx.query(`insert into public.outputs (post_id, brand_id, channel, language) values ($1, $2, 'status', 'en')`, [postA1, b1]),
        ),
      ),
    ).toBe(true);
  });
  it("B update of A brand_memory touches 0 rows", async () => {
    const n = await db.withUser(b, (tx) =>
      touched(tx, `update public.brand_memory set city = 'X' where brand_id = $1`, [a1]),
    );
    expect(n).toBe(0);
  });
  it("B cannot add itself to A brand", async () => {
    expect(
      await fails(() =>
        db.withUser(b, (tx) =>
          tx.query(`insert into public.brand_members (brand_id, user_id, role) values ($1, $2, 'owner')`, [a1, b]),
        ),
      ),
    ).toBe(true);
  });
  it("B cannot point last_brand_id at A brand", async () => {
    expect(
      await fails(() =>
        db.withUser(b, (tx) => tx.query(`update public.profiles set last_brand_id = $1 where id = $2`, [a1, b])),
      ),
    ).toBe(true);
  });
  it("A can point last_brand_id at its second brand", async () => {
    expect(
      await fails(() =>
        db.withUser(a, (tx) => tx.query(`update public.profiles set last_brand_id = $1 where id = $2`, [a2, a])),
      ),
    ).toBe(false);
  });
  it("A brand 2 has none of brand 1 posts (R14 switching gives separate data)", async () => {
    expect(
      await db.withUser(a, (tx) => tx.query(`select * from public.posts where brand_id = $1`, [a2])),
    ).toHaveLength(0);
  });
});

describe("server-only tables", () => {
  it("member cannot write clicks", async () => {
    expect(
      await fails(() =>
        db.withUser(a, (tx) => tx.query(`insert into public.clicks (post_id, brand_id) values ($1, $2)`, [postA1, a1])),
      ),
    ).toBe(true);
  });
  it("service role writes clicks; A reads 1", async () => {
    await db.withService((tx) => tx.query(`insert into public.clicks (post_id, brand_id) values ($1, $2)`, [postA1, a1]));
    expect(await db.withUser(a, (tx) => tx.query(`select * from public.clicks`))).toHaveLength(1);
  });
  it("B reads 0 clicks", async () => {
    expect(await db.withUser(b, (tx) => tx.query(`select * from public.clicks`))).toHaveLength(0);
  });
});

describe("anon and signed-out", () => {
  it("anon denied on posts", async () => {
    expect(await fails(() => rawAs("anon", null, (tx) => tx.query(`select * from public.posts`)))).toBe(true);
  });
  it("anon denied on brands", async () => {
    expect(await fails(() => rawAs("anon", null, (tx) => tx.query(`select * from public.brands`)))).toBe(true);
  });
  it("anon cannot call create_brand", async () => {
    expect(await fails(() => rawAs("anon", null, (tx) => tx.query(`select public.create_brand('x')`)))).toBe(true);
  });
  it("authenticated without uid sees no brands", async () => {
    expect(await rawAs("authenticated", null, (tx) => tx.query(`select * from public.brands`))).toHaveLength(0);
  });
  it("create_brand without uid fails", async () => {
    expect(await fails(() => rawAs("authenticated", null, (tx) => tx.query(`select public.create_brand('x')`)))).toBe(true);
  });
});

describe("approvals, plans, mascots, deletes", () => {
  it("B cannot see approval links", async () => {
    const link = await db
      .withUser(a, (tx) =>
        tx.query<{ id: string }>(`insert into public.approval_links (brand_id, token_hash) values ($1, 'h1') returning id`, [a1]),
      )
      .then((r) => r[0].id);
    await db.withUser(a, (tx) =>
      tx.query(`insert into public.approvals (link_id, post_id, brand_id) values ($1, $2, $3)`, [link, postA1, a1]),
    );
    expect(await db.withUser(b, (tx) => tx.query(`select * from public.approval_links`))).toHaveLength(0);
  });

  it("deleting a plan nulls post.plan_idea_id and keeps brand_id", async () => {
    const plan = await db
      .withUser(a, (tx) =>
        tx.query<{ id: string }>(`insert into public.weekly_plans (brand_id, week_start) values ($1, '2026-10-12') returning id`, [a1]),
      )
      .then((r) => r[0].id);
    const idea = await db
      .withUser(a, (tx) =>
        tx.query<{ id: string }>(
          `insert into public.plan_ideas (plan_id, brand_id, title, suggested_day) values ($1, $2, 'Diwali', '2026-10-15') returning id`,
          [plan, a1],
        ),
      )
      .then((r) => r[0].id);
    await db.withUser(a, (tx) => tx.query(`update public.posts set plan_idea_id = $1 where id = $2`, [idea, postA1]));
    await db.withUser(a, (tx) => tx.query(`delete from public.weekly_plans where id = $1`, [plan]));
    const [p] = await db.withUser(a, (tx) =>
      tx.query<{ plan_idea_id: string | null; brand_id: string }>(`select plan_idea_id, brand_id from public.posts where id = $1`, [postA1]),
    );
    expect(p.plan_idea_id).toBeNull();
    expect(p.brand_id).toBe(a1);
  });

  it("second active mascot rejected", async () => {
    await db.withUser(a, (tx) => tx.query(`insert into public.mascots (brand_id, name, status) values ($1, 'Laddoo', 'active')`, [a1]));
    expect(
      await fails(() =>
        db.withUser(a, (tx) => tx.query(`insert into public.mascots (brand_id, name, status) values ($1, 'Jalebi', 'active')`, [a1])),
      ),
    ).toBe(true);
  });

  it("brand delete cascades posts, outputs, clicks", async () => {
    await db.withUser(a, (tx) => tx.query(`delete from public.brands where id = $1`, [a1]));
    const [left] = await db.withAdmin((tx) =>
      tx.query<{ p: number; o: number; c: number }>(
        `select (select count(*) from public.posts where brand_id = $1)::int p,
                (select count(*) from public.outputs where brand_id = $1)::int o,
                (select count(*) from public.clicks where brand_id = $1)::int c`,
        [a1],
      ),
    );
    expect(left).toEqual({ p: 0, o: 0, c: 0 });
  });

  it("B (non-owner) cannot delete brand", async () => {
    const n = await db.withUser(b, (tx) => touched(tx, `delete from public.brands where id = $1`, [a2]));
    expect(n).toBe(0);
  });
});
