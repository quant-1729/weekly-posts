import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setExecutor } from "@/lib/db";
import { ACTIVITY_KINDS_SQL, activitySql, listActivity, listActivityKinds } from "@/lib/queries/activity";
import { revokeSession } from "@/lib/queries/admin";
import { PAGE_SIZE } from "@/lib/queries/common";
import { devicesSql, listSessions } from "@/lib/queries/devices";
import { GEN_BY_DAY_SQL, GEN_BY_KIND_SQL, GEN_BY_MODEL_SQL, generationsSql, getGenerationTotals, listGenerations } from "@/lib/queries/generations";
import { OVERVIEW_SQL, getOverview } from "@/lib/queries/overview";
import {
  USER_AI_BY_KIND_SQL,
  USER_BRANDS_SQL,
  USER_COUNTS_SQL,
  USER_PROFILE_SQL,
  USER_SESSIONS_SQL,
  getUserDetail,
  getUserTimeline,
  listUsers,
  timelineSql,
  usersSql,
} from "@/lib/queries/users";
import { SECRETS, createTestDb, seed, type Seed, type TestDb } from "./helpers/pg";

let t: TestDb;
let s: Seed;
beforeAll(async () => {
  t = await createTestDb();
  setExecutor(t.executor);
  s = await seed(t.pg);
});
afterAll(async () => {
  setExecutor(null);
  await t.close();
});

// Columns and words that hold the owner's own content, secrets or personal data. No query may name them.
const FORBIDDEN = [
  "notes",
  "caption",
  "description",
  "payment",
  "input_text",
  "hashtags",
  "image_text",
  "user_agent",
  "ip_hash",
  "to_email",
  "subject",
  "token",
  "consent",
  "provenance",
  "master_path",
  "sheet_path",
  "usp_snapshot",
  "phone",
  "focus",
  "queries",
  "original",
  "fact_flags",
  "voice_description",
  "magic_links",
  "channel_tokens",
  "qr",
];
const forbiddenRe = new RegExp(`\\b(${FORBIDDEN.join("|")})`, "i");

function assertClean(sql: string) {
  expect(sql, "no select *").not.toMatch(/select\s+(distinct\s+)?\*/i);
  expect(sql, "no table.*").not.toMatch(/\b\w+\.\*/);
  const hit = sql.match(forbiddenRe);
  expect(hit, `SQL names a forbidden column or table: ${hit?.[0]}`).toBeNull();
}

describe("queries never select forbidden columns", () => {
  it("static SQL texts", () => {
    const full = {
      kind: "design.generated",
      ok: "failed",
      user: "a",
      brand: "b",
      from: "2026-01-01",
      to: "2026-12-31",
      cursor: Buffer.from(JSON.stringify({ t: "2026-01-01T00:00:00.000000Z", i: "1" })).toString("base64url"),
    };
    const uuidCursor = Buffer.from(JSON.stringify({ t: "2026-01-01T00:00:00.000000Z", i: "11111111-1111-1111-1111-111111111111" })).toString("base64url");
    const texts = [
      OVERVIEW_SQL,
      ACTIVITY_KINDS_SQL,
      GEN_BY_KIND_SQL,
      GEN_BY_MODEL_SQL,
      GEN_BY_DAY_SQL,
      USER_PROFILE_SQL,
      USER_BRANDS_SQL,
      USER_SESSIONS_SQL,
      USER_AI_BY_KIND_SQL,
      USER_COUNTS_SQL,
      activitySql(full).sql,
      generationsSql({ kind: "image", brand: "x", ok: "failed", cursor: full.cursor }).sql,
      devicesSql({ active: true, device: "mobile", country: "IN", q: "a", cursor: uuidCursor }).sql,
      usersSql({ q: "a", cursor: uuidCursor }).sql,
      timelineSql("11111111-1111-1111-1111-111111111111").sql,
      timelineSql("11111111-1111-1111-1111-111111111111", Buffer.from(JSON.stringify({ t: "2026-01-01T00:00:00.000000Z", i: "qd1" })).toString("base64url")).sql,
    ];
    for (const sql of texts) assertClean(sql);
  });

  it("every statement actually sent to the database while the pages' queries run", async () => {
    t.seen.length = 0;
    await getOverview();
    await listSessions({ active: true });
    await listUsers({});
    const d = await getUserDetail(s.userA);
    expect(d).not.toBeNull();
    await getUserTimeline(s.userA);
    await listActivity({ ok: "failed", user: "alice" });
    await listActivityKinds();
    await getGenerationTotals();
    await listGenerations({});
    expect(t.seen.length).toBeGreaterThan(10);
    for (const sql of t.seen) assertClean(sql);
  });

  it("the rows returned never carry the sensitive text that sits in the database", async () => {
    const out = JSON.stringify([
      await getOverview(),
      await listSessions({}),
      await listUsers({}),
      await getUserDetail(s.userA),
      await getUserTimeline(s.userA),
      await listActivity({}),
      await getGenerationTotals(),
      await listGenerations({}),
    ]);
    for (const secret of Object.values(SECRETS)) expect(out).not.toContain(secret);
    expect(out).not.toContain("SECRET-DETAIL"); // app_events.detail passes through safeDetail inside listActivity
  });
});

describe("overview", () => {
  it("counts sessions, users, spend and failures", async () => {
    const o = await getOverview();
    expect(o.active_sessions).toBe(1); // sessionA1 is recent and not revoked
    expect(o.sign_ins_today).toBe(3);
    expect(o.users).toBe(2);
    expect(o.brands).toBe(1);
    expect(o.spend_today).toBeCloseTo(0.0523, 4);
    expect(o.spend_30d).toBeCloseTo(0.0523, 4);
    expect(o.posts_made_7d).toBe(1);
    expect(o.posts_failed_7d).toBe(1);
    expect(o.research_runs_7d).toBe(1);
    expect(o.errors_24h).toBe(2); // one failed activity event + one failed AI call
  });
});

describe("devices", () => {
  it("lists sessions with user, brand and device details", async () => {
    const page = await listSessions({});
    expect(page.rows).toHaveLength(3);
    const a1 = page.rows.find((r) => r.id === s.sessionA1)!;
    expect(a1.email).toBe("alice@gmail.com");
    expect(a1.brand_name).toBe("Alice Bakery");
    expect(a1.online).toBe(true);
    expect(a1.device_type).toBe("desktop");
    expect(Object.keys(a1)).not.toContain("user_agent");
    expect(Object.keys(a1)).not.toContain("ip_hash");
  });

  it("filters by active only, device type, country and email", async () => {
    expect((await listSessions({ active: true })).rows.map((r) => r.id).sort()).toEqual([s.sessionA1, s.sessionB1].sort());
    expect((await listSessions({ device: "tablet" })).rows.map((r) => r.id)).toEqual([s.sessionB1]);
    expect((await listSessions({ country: "gb" })).rows.map((r) => r.id)).toEqual([s.sessionB1]);
    expect((await listSessions({ q: "ALICE" })).rows).toHaveLength(2);
    expect((await listSessions({ q: "%" })).rows).toHaveLength(0); // wildcards are literal
    expect((await listSessions({ device: "'; drop table x; --" })).rows).toHaveLength(3); // invalid choice is ignored
  });

  it("pages with a keyset cursor and no repeats", async () => {
    for (let i = 0; i < PAGE_SIZE + 5; i++) {
      await t.pg.query(
        "insert into public.user_sessions (user_id, device_type, last_seen_at) values ($1, 'desktop', '2026-03-01T00:00:00Z'::timestamptz + ($2 || ' seconds')::interval)",
        [s.userB, String(i)],
      );
    }
    const first = await listSessions({});
    expect(first.rows).toHaveLength(PAGE_SIZE);
    expect(first.next).not.toBeNull();
    const second = await listSessions({ cursor: first.next! });
    const ids = new Set(first.rows.map((r) => r.id));
    for (const r of second.rows) expect(ids.has(r.id)).toBe(false);
    expect(first.rows.length + second.rows.length).toBe(3 + PAGE_SIZE + 5);
    // A forged cursor is ignored rather than injected.
    const bad = await listSessions({ cursor: "not-a-cursor" });
    expect(bad.rows).toHaveLength(PAGE_SIZE);
    await t.pg.query("delete from public.user_sessions where user_id = $1 and device_type = 'desktop'", [s.userB]);
  });
});

describe("sign a device out", () => {
  it("sets revoked_at and revoked_by = admin and writes an admin_actions row with the admin's email", async () => {
    expect(await revokeSession("boss@example.com", s.sessionB1)).toBe(true);
    const r = await t.pg.query<{ revoked_at: Date | null; revoked_by: string }>("select revoked_at, revoked_by from public.user_sessions where id = $1", [s.sessionB1]);
    expect(r.rows[0].revoked_at).not.toBeNull();
    expect(r.rows[0].revoked_by).toBe("admin");
    const log = await t.pg.query<{ admin_email: string; action: string; target: string; detail: { user_id: string } }>(
      "select admin_email, action, target, detail from public.admin_actions where action = 'session_revoke'",
    );
    expect(log.rows).toHaveLength(1);
    expect(log.rows[0].admin_email).toBe("boss@example.com");
    expect(log.rows[0].target).toBe(s.sessionB1);
    expect(log.rows[0].detail.user_id).toBe(s.userB);
  });

  it("does nothing the second time, for an unknown id, or for a malformed id", async () => {
    expect(await revokeSession("boss@example.com", s.sessionB1)).toBe(false);
    expect(await revokeSession("boss@example.com", "00000000-0000-0000-0000-000000000000")).toBe(false);
    expect(await revokeSession("boss@example.com", "1; drop table user_sessions")).toBe(false);
    const n = await t.pg.query<{ n: number }>("select count(*)::int as n from public.admin_actions where action = 'session_revoke'");
    expect(n.rows[0].n).toBe(1);
  });

  it("the change is rolled back with the log row if the log insert fails", async () => {
    const long = "x".repeat(300); // admin_email is limited to 254 characters
    await expect(revokeSession(long, s.sessionA2)).resolves.toBe(false); // already revoked: nothing to do
    await expect(revokeSession(long, s.sessionA1)).rejects.toThrow();
    const r = await t.pg.query<{ revoked_at: Date | null }>("select revoked_at from public.user_sessions where id = $1", [s.sessionA1]);
    expect(r.rows[0].revoked_at).toBeNull();
  });
});

describe("users", () => {
  it("lists users with sessions, posts and AI spend", async () => {
    const page = await listUsers({});
    const a = page.rows.find((u) => u.id === s.userA)!;
    expect(a.email).toBe("alice@gmail.com");
    expect(a.brand_name).toBe("Alice Bakery");
    expect(a.sessions).toBe(2);
    expect(a.posts).toBe(1);
    expect(a.ai_spend).toBeCloseTo(0.0523, 4);
    expect((await listUsers({ q: "bob@" })).rows).toHaveLength(1);
  });

  it("user detail has sessions, brands, AI by kind and counts", async () => {
    const d = (await getUserDetail(s.userA))!;
    expect(d.profile.email).toBe("alice@gmail.com");
    expect(d.brands).toEqual([{ name: "Alice Bakery", role: "owner" }]);
    expect(d.sessions).toHaveLength(2);
    expect(d.aiByKind.map((k) => k.kind).sort()).toEqual(["generate", "image"]);
    expect(d.counts).toMatchObject({ briefs: 1, posts: 1, approved: 1, failed: 1, published: 0, research_runs: 1, faces: 1 });
    expect(await getUserDetail("not-a-uuid")).toBeNull();
    expect(await getUserDetail("00000000-0000-0000-0000-000000000000")).toBeNull();
  });

  it("the timeline merges events, briefs, AI calls, posts, queue, research, faces and emails, newest first", async () => {
    const tl = await getUserTimeline(s.userA);
    const kinds = tl.rows.map((r) => r.kind);
    for (const k of ["auth.sign_in", "design.generated", "session.started", "brief.created", "ai.generate", "ai.image", "post.created", "post.approved", "queue.scheduled", "queue.failed", "research.manual", "face.mascot", "email.weekly"]) {
      expect(kinds, k).toContain(k);
    }
    const times = tl.rows.map((r) => Date.parse(r.ts));
    expect([...times].sort((x, y) => y - x)).toEqual(times);
    const q = tl.rows.find((r) => r.kind === "queue.failed")!;
    expect(q.status).toBe("failed");
    expect(q.info).not.toContain("access_token");
    expect(q.info).not.toContain("EAAB1234567890");
    expect(q.link).toBe("https://instagram.com/p/xyz");
    const b = tl.rows.find((r) => r.kind === "brief.created")!;
    expect(b.info).toBe("offer +2");
    expect(JSON.stringify(tl)).not.toContain(SECRETS.notes);
  });

  it("the timeline pages without gaps or repeats", async () => {
    for (let i = 0; i < 60; i++) {
      await t.pg.query("insert into public.app_events (user_id, kind, at) values ($1, 'bulk.event', '2026-04-01T00:00:00Z'::timestamptz + ($2 || ' seconds')::interval)", [s.userB, String(i)]);
    }
    const p1 = await getUserTimeline(s.userB);
    expect(p1.rows).toHaveLength(PAGE_SIZE);
    expect(p1.next).not.toBeNull();
    const p2 = await getUserTimeline(s.userB, p1.next!);
    const ids = [...p1.rows, ...p2.rows].map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(p2.rows.length).toBeGreaterThanOrEqual(10);
    await t.pg.query("delete from public.app_events where kind = 'bulk.event'");
  });
});

describe("activity", () => {
  it("filters by kind, result, user, brand and date range", async () => {
    expect((await listActivity({})).rows.length).toBeGreaterThanOrEqual(2);
    expect((await listActivity({ kind: "design.generated" })).rows).toHaveLength(1);
    expect((await listActivity({ ok: "failed" })).rows.map((r) => r.kind)).toEqual(["design.generated"]);
    expect((await listActivity({ ok: "ok", user: "alice" })).rows.map((r) => r.kind)).toEqual(["auth.sign_in"]);
    expect((await listActivity({ user: "nobody" })).rows).toHaveLength(0);
    expect((await listActivity({ brand: "bakery" })).rows.length).toBe(2);
    expect((await listActivity({ from: "2000-01-01", to: "2000-01-02" })).rows).toHaveLength(0);
    const today = new Date().toISOString().slice(0, 10);
    expect((await listActivity({ from: today, to: today })).rows.length).toBe(2);
    expect(await listActivityKinds()).toEqual(["auth.sign_in", "design.generated"]);
  });

  it("shows only a filtered summary of the detail JSON", async () => {
    const r = (await listActivity({ kind: "design.generated" })).rows[0];
    expect(r.detail).toBe("code=E42");
  });

  it("pages by keyset", async () => {
    for (let i = 0; i < 60; i++) {
      await t.pg.query("insert into public.app_events (user_id, kind, at) values ($1, 'bulk.page', '2026-05-01T00:00:00Z'::timestamptz)", [s.userB]);
    }
    const p1 = await listActivity({ kind: "bulk.page" });
    expect(p1.rows).toHaveLength(PAGE_SIZE);
    const p2 = await listActivity({ kind: "bulk.page", cursor: p1.next! });
    expect(p2.rows).toHaveLength(10); // same timestamp: the id breaks the tie
    expect(new Set([...p1.rows, ...p2.rows].map((r) => r.id)).size).toBe(60);
    expect(p2.next).toBeNull();
    await t.pg.query("delete from public.app_events where kind = 'bulk.page'");
  });
});

describe("generations", () => {
  it("totals per kind, per model and per day, counting failed calls", async () => {
    const totals = await getGenerationTotals();
    expect(totals.byKind.map((k) => k.kind)).toEqual(["image", "generate"]);
    expect(totals.byKind[0].usd).toBeCloseTo(0.04, 4);
    expect(totals.byKind[1]).toMatchObject({ n: 2, failed: 1 });
    const models = Object.fromEntries(totals.byModel.map((m) => [String(m.model), m]));
    expect(models["gemini-test"]).toMatchObject({ n: 2, failed: 1 });
    expect(models["gemini-test"].usd).toBeCloseTo(0.0123, 4);
    expect(models["null"]).toMatchObject({ n: 1, failed: 0 }); // older row without a model
    expect(totals.byDay).toHaveLength(1);
    expect(totals.byDay[0].n).toBe(3);
  });

  it("lists model and result, and can show failed calls only", async () => {
    const all = await listGenerations({ kind: "generate" });
    expect(all.rows).toHaveLength(2);
    expect(all.rows[0].brand_name).toBe("Alice Bakery");
    const failed = await listGenerations({ ok: "failed" });
    expect(failed.rows).toHaveLength(1);
    expect(failed.rows[0]).toMatchObject({ ok: false, model: "gemini-test", kind: "generate" });
    const old = (await listGenerations({ kind: "image" })).rows[0];
    expect(old.model).toBeNull();
    expect(old.ok).toBe(true);
  });
});
