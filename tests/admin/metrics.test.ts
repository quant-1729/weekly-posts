import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ user: null as { id: string; email: string | null; phone: null } | null }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: async () => session.user }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, refresh: () => undefined, replace: () => undefined }),
  redirect: (to: string) => {
    throw new Error(`REDIRECT ${to}`);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));

import AdminPage from "@/app/admin/page";
import { requireAdmin } from "@/lib/admin/access";
import { getAdminMetrics, type AdminMetrics } from "@/lib/admin/metrics";
import type { MockDb } from "@/lib/db/mock";
import { closeDb, openDb } from "../helpers/details";
import { connect, makeShop, NOW, rows, seedBrief, seedItem, seedPost, type Shop } from "../queue/helpers";

const SECRET_PAY = "secretpay.leak@okaxis";
const SECRET_CIPHER = "CIPHERTEXT-SENTINEL-0123456789";
const SECRET_JTI = "JTI-SENTINEL-abcdef";
const SECRET_HASH = "CONFIRM-HASH-SENTINEL";
const TOKEN_IN_ERROR = "EAAGm0PX4ZCpsBAKzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz";
const OWNER_EMAIL = "priyanshu@figitallabs.com";

let db: MockDb;
let a: Shop;
let b: Shop;
let m: AdminMetrics;

const usage = (brandId: string, iso: string, kind: string, usd: number) =>
  rows(db, "insert into public.usage_events (brand_id, kind, usd, created_at) values ($1, $2::public.usage_kind, $3, $4)", [brandId, kind, usd, iso]);

beforeAll(async () => {
  vi.stubEnv("ADMIN_EMAILS", "boss@example.com");
  db = await openDb();
  a = await makeShop(db, { name: "Corner Bakery", timezone: "Europe/London" });
  b = await makeShop(db, { name: "Chai Stop", timezone: "Asia/Kolkata" });
  const c = await makeShop(db, { name: "Quiet Cafe" }); // a brand with no activity
  // A fourth owner with no brand yet.
  const dUser = await rows<{ id: string }>(db, "insert into auth.users (email) values ('d-owner@example.com') returning id");
  await rows(db, "insert into public.profiles (id, email, consent_at) values ($1, 'd-owner@example.com', now())", [dUser[0].id]);

  // Sign-ups: A 2 days ago, B 14 days ago, C and D long ago.
  const signups: Array<[string, string]> = [
    [a.userId, "2026-10-12T09:00:00Z"],
    [b.userId, "2026-09-30T09:00:00Z"],
    [c.userId, "2026-08-01T09:00:00Z"],
    [dUser[0].id, "2026-07-01T09:00:00Z"],
  ];
  for (const [id, iso] of signups) await rows(db, "update public.profiles set created_at = $2::timestamptz where id = $1", [id, iso]);

  // AI usage. Week of Mon 12 Oct: A (London) 0.03, B (Kolkata, week starts Sun 11 Oct 18:30Z) 0.6, over the cap. A spent 0.30 the week before.
  await usage(a.brandId, "2026-10-14T08:00:00Z", "weekly_batch", 0.02);
  await usage(a.brandId, "2026-10-13T08:00:00Z", "rewrite", 0.01);
  await usage(a.brandId, "2026-10-05T08:00:00Z", "weekly_batch", 0.3);
  await usage(b.brandId, "2026-10-11T19:00:00Z", "weekly_batch", 0.6);
  await usage(b.brandId, "2025-01-01T00:00:00Z", "weekly_batch", 9); // too old for every window

  // Posts and queue.
  const briefA = await seedBrief(db, a);
  const briefB = await seedBrief(db, b);
  const p1 = await seedPost(db, a, briefA, "instagram"); // created and approved on the 14th, published
  const p2 = await seedPost(db, a, briefA, "facebook", { status: "draft" }); // created on the 13th, due and not done: stuck
  const p3 = await seedPost(db, b, briefB, "instagram"); // created and approved on the 14th, delivered on the 13th
  const p4 = await seedPost(db, b, briefB, "facebook"); // publishing for an hour: stuck
  const p5 = await seedPost(db, b, briefB, "linkedin"); // failed
  const p6 = await seedPost(db, a, briefA, "linkedin"); // 10 minutes late: not stuck yet
  const p7 = await seedPost(db, a, briefA, "gbp"); // in the future
  const p8 = await seedPost(db, a, briefA, "whatsapp"); // old, outside the 14 days
  const created: Array<[string, string]> = [
    [p1.id, "2026-10-14T08:00:00Z"],
    [p2.id, "2026-10-13T08:00:00Z"],
    [p3.id, "2026-10-14T09:00:00Z"],
    [p4.id, "2026-10-12T09:00:00Z"],
    [p5.id, "2026-10-12T09:30:00Z"],
    [p6.id, "2026-10-12T09:45:00Z"],
    [p7.id, "2026-10-12T10:00:00Z"],
    [p8.id, "2026-09-01T09:00:00Z"],
  ];
  for (const [id, iso] of created) await rows(db, "update public.posts set created_at = $2::timestamptz where id = $1", [id, iso]);
  await rows(db, "update public.posts set approved_at = '2026-10-14T10:00:00Z' where id = any($1::uuid[])", [[p1.id, p3.id]]);
  await rows(db, "update public.posts set approved_at = null where id = any($1::uuid[])", [[p2.id, p4.id, p5.id, p6.id, p7.id, p8.id]]);

  const i1 = await seedItem(db, a, p1, { slotAt: "2026-10-14T09:00:00Z", status: "published", mode: "publish" });
  await rows(db, "update public.queue_items set done_at = '2026-10-14T09:01:00Z' where id = $1", [i1]);
  await seedItem(db, a, p2, { slotAt: "2026-10-14T11:00:00Z", status: "scheduled" });
  const i3 = await seedItem(db, b, p3, { slotAt: "2026-10-13T09:00:00Z", status: "delivered" });
  await rows(db, "update public.queue_items set done_at = '2026-10-13T09:01:00Z' where id = $1", [i3]);
  const i4 = await seedItem(db, b, p4, { slotAt: "2026-10-14T10:30:00Z", status: "publishing", mode: "publish", attempts: 1 });
  await rows(db, "update public.queue_items set updated_at = '2026-10-14T11:00:00Z' where id = $1", [i4]);
  const i5 = await seedItem(db, b, p5, { slotAt: "2026-10-14T08:00:00Z", status: "failed", mode: "publish", attempts: 3 });
  await rows(db, "update public.queue_items set last_error = $2, updated_at = '2026-10-14T08:05:00Z' where id = $1", [i5, `Instagram said no: token ${TOKEN_IN_ERROR} rejected. ${"x ".repeat(150)}`]);
  await seedItem(db, a, p6, { slotAt: "2026-10-14T11:50:00Z", status: "scheduled" });
  await seedItem(db, a, p7, { slotAt: "2026-10-15T10:00:00Z", status: "scheduled" });

  // Connections, with a token row that must never be read.
  await connect(db, a, "instagram", { status: "active" });
  await connect(db, a, "facebook", { status: "error" });
  await connect(db, b, "facebook", { status: "expired" });
  await rows(db, "update public.channel_connections set last_error = 'Meta says the token expired' where brand_id = $1 and provider = 'facebook'", [b.brandId]);
  const [conn] = await rows<{ id: string }>(db, "select id::text as id from public.channel_connections where brand_id = $1 and provider = 'instagram'", [a.brandId]);
  await rows(db, "insert into public.channel_tokens (connection_id, brand_id, ciphertext, iv, tag) values ($1, $2, $3, 'iv', 'tag')", [conn.id, a.brandId, SECRET_CIPHER]);

  // Email.
  const mail = (brandId: string, kind: string, status: string, iso: string, to: string, error: string | null) =>
    rows(db, "insert into public.email_log (brand_id, kind, to_email, subject, status, error, created_at) values ($1, $2::public.email_kind, $3, 'Subject', $4::public.email_status, $5, $6)", [brandId, kind, to, status, error, iso]);
  await mail(a.brandId, "weekly", "sent", "2026-10-12T08:00:00Z", "a@example.com", null);
  await mail(b.brandId, "weekly", "sent", "2026-10-13T08:00:00Z", "b@example.com", null);
  await mail(b.brandId, "weekly", "failed", "2026-10-14T08:00:00Z", OWNER_EMAIL, `Resend 422: bad address. ${"y ".repeat(150)}`);
  await mail(a.brandId, "reminder", "sent", "2026-10-14T09:00:00Z", "a@example.com", null);
  await mail(a.brandId, "weekly", "sent", "2026-10-01T08:00:00Z", "a@example.com", null); // older than 7 days

  // Meta deletion requests.
  const del = (code: string, status: string, iso: string) =>
    rows(db, "insert into public.deletion_requests (code, provider, account_id, status, created_at) values ($1, 'instagram', 'acct', $2, $3)", [code, status, iso]);
  await del("code-aaaaaaaaaaaaaaaa", "received", "2026-10-10T08:00:00Z");
  await del("code-bbbbbbbbbbbbbbbb", "received", "2026-10-01T08:00:00Z");
  await del("code-cccccccccccccccc", "done", "2026-09-01T08:00:00Z");

  // Other secrets that must never be read.
  await rows(db, "insert into public.payment_ids (brand_id, scheme, address, payee_name, status, confirm_token_hash, confirmed_at) values ($1, 'upi', $2, 'Corner Bakery', 'active', $3, now())", [a.brandId, SECRET_PAY, SECRET_HASH]);
  await rows(db, "insert into public.magic_links (jti, email, expires_at) values ($1, 'leak@example.com', now() + interval '1 hour')", [SECRET_JTI]);

  session.user = { id: "admin", email: "boss@example.com", phone: null };
  m = await getAdminMetrics(await requireAdmin(), NOW);
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await closeDb(db);
});
afterEach(() => {
  session.user = null;
});

describe("admin metrics", () => {
  it("counts owners, brands, new sign-ups and active brands", () => {
    expect(m.overview).toEqual({ owners: 4, brands: 3, newOwners7d: 1, newOwners30d: 2, activeBrands7d: 2 });
  });

  it("adds up AI cost for today, 7 days and 30 days, by kind, and ranks brands against the weekly cap", () => {
    expect(m.cost.todayUsd).toBeCloseTo(0.02, 6);
    expect(m.cost.last7dUsd).toBeCloseTo(0.63, 6);
    expect(m.cost.last30dUsd).toBeCloseTo(0.93, 6);
    const batch = m.cost.byKind.find((k) => k.kind === "weekly_batch")!;
    expect(batch).toMatchObject({ calls7d: 2, calls30d: 3 });
    expect(batch.usd7d).toBeCloseTo(0.62, 6);
    expect(batch.usd30d).toBeCloseTo(0.92, 6);
    expect(m.cost.byKind.find((k) => k.kind === "rewrite")).toMatchObject({ calls7d: 1, calls30d: 1 });
    expect(m.cost.weeklyCapUsd).toBe(0.5);
    expect(m.cost.topBrands.map((t) => [t.brandName, t.overCap])).toEqual([
      ["Chai Stop", true],
      ["Corner Bakery", false],
    ]);
    expect(m.cost.topBrands[0].usd).toBeCloseTo(0.6, 6);
    expect(m.cost.topBrands[1].usd).toBeCloseTo(0.03, 6);
    expect(m.cost.topBrands[1].calls).toBe(2);
  });

  it("gives 14 days of created, approved, published and delivered posts, oldest first", () => {
    expect(m.postsPerDay).toHaveLength(14);
    expect(m.postsPerDay[0].day).toBe("2026-10-01");
    expect(m.postsPerDay[13].day).toBe("2026-10-14");
    const day = (d: string) => m.postsPerDay.find((x) => x.day === d)!;
    expect(day("2026-10-14")).toEqual({ day: "2026-10-14", created: 2, approved: 2, published: 1, delivered: 0 });
    expect(day("2026-10-13")).toEqual({ day: "2026-10-13", created: 1, approved: 0, published: 0, delivered: 1 });
    expect(day("2026-10-12")).toMatchObject({ created: 4, approved: 0 });
    expect(m.postsPerDay.reduce((n, d) => n + d.created, 0)).toBe(7); // the September post is outside the window
  });

  it("counts the queue by status and finds stuck items and the latest failures", () => {
    expect(Object.fromEntries(m.queue.byStatus.map((r) => [r.key, r.n]))).toEqual({ published: 1, delivered: 1, scheduled: 3, publishing: 1, failed: 1 });
    expect(m.queue.stuckMinutes).toBe(30);
    // Ordered by planned time: the publishing one (10:30) then the late scheduled one (11:00). The one 10 minutes late is not stuck.
    expect(m.queue.stuck.map((s) => [s.brandName, s.status, s.minutesLate])).toEqual([
      ["Chai Stop", "publishing", 60],
      ["Corner Bakery", "scheduled", 60],
    ]);
    expect(m.queue.failures).toHaveLength(1);
    expect(m.queue.failures[0]).toMatchObject({ brandName: "Chai Stop", channel: "linkedin", attempts: 3, at: "2026-10-14T08:05:00Z" });
    expect(m.queue.failures[0].error.length).toBeLessThanOrEqual(200);
    expect(m.queue.failures[0].error).toContain("[hidden]");
  });

  it("counts connections by provider and status and lists problems", () => {
    expect(m.connections.byProviderStatus).toEqual([
      { provider: "facebook", status: "error", n: 1 },
      { provider: "facebook", status: "expired", n: 1 },
      { provider: "instagram", status: "active", n: 1 },
    ]);
    expect(m.connections.problems.map((p) => [p.brandName, p.provider, p.status])).toEqual(
      expect.arrayContaining([
        ["Chai Stop", "facebook", "expired"],
        ["Corner Bakery", "facebook", "error"],
      ]),
    );
    expect(m.connections.problems.find((p) => p.brandName === "Chai Stop")!.error).toBe("Meta says the token expired");
  });

  it("counts email sent and failed by kind over 7 days and masks the address of failures", () => {
    expect(m.email.byKindStatus).toEqual([
      { kind: "reminder", sent: 1, failed: 0, queued: 0 },
      { kind: "weekly", sent: 2, failed: 1, queued: 0 },
    ]);
    expect(m.email.failures).toHaveLength(1);
    expect(m.email.failures[0]).toMatchObject({ kind: "weekly", brandName: "Chai Stop", to: "pr•••@figitallabs.com" });
    expect(m.email.failures[0].error.length).toBeLessThanOrEqual(200);
  });

  it("counts deletion requests by status and gives the oldest waiting one", () => {
    expect(Object.fromEntries(m.deletions.byStatus.map((r) => [r.key, r.n]))).toEqual({ received: 2, done: 1 });
    expect(m.deletions.oldestPendingAt).toBe("2026-10-01T08:00:00Z");
  });

  it("refuses to run without the result of requireAdmin()", async () => {
    await expect(getAdminMetrics({} as never, NOW)).rejects.toThrow(/requireAdmin/);
  });
});

describe("privacy", () => {
  it("contains no payment ID, token, magic link or full owner email from the seeded data", () => {
    const text = JSON.stringify(m);
    for (const secret of [SECRET_PAY, "secretpay", SECRET_CIPHER, SECRET_JTI, SECRET_HASH, TOKEN_IN_ERROR, OWNER_EMAIL, "leak@example.com", "owner-"]) {
      expect(text).not.toContain(secret);
    }
  });

  it("reads none of the private tables or post text in the source", () => {
    const src = readFileSync(path.join(process.cwd(), "src/lib/admin/metrics.ts"), "utf8").replace(/\/\/.*$/gm, "");
    for (const forbidden of ["payment_ids", "channel_tokens", "magic_links", "used_tokens", "approval_links", "caption", "input_text", "image_text", "address"]) {
      expect(src).not.toContain(forbidden);
    }
  });
});

describe("/admin page", () => {
  it("redirects a signed-out visitor to /login", async () => {
    await expect(AdminPage()).rejects.toThrow("REDIRECT /login");
  });

  it("is a 404 for a signed-in user who is not an admin, and when the list is empty", async () => {
    session.user = { id: "u", email: "owner@example.com", phone: null };
    await expect(AdminPage()).rejects.toThrow("NOT_FOUND");
    vi.stubEnv("ADMIN_EMAILS", "");
    session.user = { id: "u", email: "boss@example.com", phone: null };
    await expect(AdminPage()).rejects.toThrow("NOT_FOUND");
    vi.stubEnv("ADMIN_EMAILS", "boss@example.com");
  });

  it("shows every panel for an admin, with brands by name and nothing private", async () => {
    session.user = { id: "u", email: "boss@example.com", phone: null };
    const html = renderToString(createElement("div", null, await AdminPage()));
    for (const heading of ["Overview", "AI cost", "Posts, last 14 days", "Publishing queue", "Connected accounts", "Email, last 7 days", "Meta data-deletion requests"]) {
      expect(html).toContain(heading);
    }
    expect(html).toContain("Corner Bakery");
    expect(html).toContain("Chai Stop");
    expect(html).toContain("Refresh");
    expect(html).toContain("Last updated");
    for (const secret of [SECRET_PAY, SECRET_CIPHER, SECRET_JTI, SECRET_HASH, TOKEN_IN_ERROR, OWNER_EMAIL]) expect(html).not.toContain(secret);
  });
});
