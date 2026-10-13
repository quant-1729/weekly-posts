import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createMockDb, setMockDbForTests, type MockDb } from "@/lib/db/mock";
import { listOutbox, type OutboxEntry } from "@/lib/email/outbox";
import { countMissedWeeks, sendLateNotice, sendWeeklyEmail } from "@/lib/email/weekly";
import { generateWeek } from "@/lib/weekly/generate";
import { verifyLink } from "@/lib/links/tokens";
import { seedHistoryPost } from "../guardrail/helpers";
import { insertBatch, seedWeeklyBrand, tempStorage, type WeeklyBrandOpts } from "../weekly/helpers";

const WEEK = "2026-12-21";
const NOW = new Date("2026-12-21T08:00:00Z");
const week = (back: number) => {
  const d = new Date(Date.UTC(2026, 11, 21 - 7 * back));
  return d.toISOString().slice(0, 10);
};

let db: MockDb;
let store: Awaited<ReturnType<typeof tempStorage>>;

beforeAll(async () => {
  db = await createMockDb();
  setMockDbForTests(db);
  store = await tempStorage();
});
afterAll(async () => {
  setMockDbForTests(null);
  await db.close();
  await store.cleanup();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

type Row = Record<string, unknown>;
const rows = (sql: string, params: unknown[] = []) => db.withAdmin((tx) => tx.query<Row>(sql, params));

async function newBrand(opts: WeeklyBrandOpts = {}) {
  return seedWeeklyBrand(db, { photos: 1, storage: store.storage, ...opts });
}
const generate = (brandId: string, extra: Parameters<typeof generateWeek>[1] = {}) =>
  generateWeek({ brandId, weekStart: WEEK, trigger: "cron" }, { now: NOW, storage: store.storage, ...extra });

const log = (brandId: string) =>
  rows("select kind::text as kind, to_email, subject, status::text as status from public.email_log where brand_id = $1 order by id", [brandId]);
const batchRow = async (batchId: string) =>
  (await rows("select email_sent_at, late, status::text as status from public.weekly_batches where id = $1", [batchId]))[0];
async function outboxOf(brandId: string, kind?: string): Promise<OutboxEntry[]> {
  return (await listOutbox(500)).filter((m) => m.brandId === brandId && (!kind || m.kind === kind));
}
async function addMember(brandId: string, role: "owner" | "editor", email = `${role}-${randomUUID().slice(0, 8)}@example.com`) {
  await db.withAdmin(async (tx) => {
    const [u] = await tx.query<{ id: string }>("insert into auth.users (email) values ($1) returning id", [email]);
    await tx.query("insert into public.profiles (id, email, consent_at) values ($1, $2, now())", [u.id, email]);
    await tx.query("insert into public.brand_members (brand_id, user_id, role) values ($1, $2, $3::public.brand_role)", [brandId, u.id, role]);
  });
  return email;
}
async function ownerEmail(brandId: string): Promise<string> {
  const [r] = await rows(
    "select p.email from public.brand_members m join public.profiles p on p.id = m.user_id where m.brand_id = $1 and m.role = 'owner'",
    [brandId],
  );
  return String(r.email);
}
/** An earlier week whose email was sent. */
async function sentWeek(brandId: string, weekStart: string): Promise<string> {
  const id = await insertBatch(db, brandId, weekStart, { status: "ready" });
  await rows("update public.weekly_batches set email_sent_at = now() where id = $1", [id]);
  return id;
}

describe("sendWeeklyEmail: who, when, and only once", () => {
  it("is sent by the generation step to the owner, once, and recorded", async () => {
    const { brandId } = await newBrand();
    const res = await generate(brandId);
    if (res.status !== "ready") throw new Error("not ready");
    const sent = await log(brandId);
    expect(sent).toEqual([
      { kind: "weekly", to_email: await ownerEmail(brandId), subject: "Your 4 posts for the week of 21 Dec are ready", status: "sent" },
    ]);
    expect((await batchRow(res.batchId)).email_sent_at).not.toBeNull();
    expect((await batchRow(res.batchId)).late).toBe(false);

    // The mail has the headers and the two parts.
    const [mail] = await outboxOf(brandId, "weekly");
    expect(mail.headers["List-Unsubscribe"]).toContain("/api/email/unsubscribe?t=");
    expect(mail.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(mail.html).toContain("<!doctype html>");
    expect(mail.text).toContain("Approve: ");
    expect(mail.html.match(/<img /g)).toHaveLength(4);

    // Asking again sends nothing.
    expect(await sendWeeklyEmail(res.batchId)).toEqual({ status: "skipped", reason: "already_sent" });
    expect(await log(brandId)).toHaveLength(1);
  });

  it("does not send twice when two callers race", async () => {
    const { brandId } = await newBrand();
    const res = await generate(brandId);
    if (res.status !== "ready") throw new Error("not ready");
    await rows("update public.weekly_batches set email_sent_at = null where id = $1", [res.batchId]);
    await rows("delete from public.email_log where brand_id = $1", [brandId]);
    const results = await Promise.all([sendWeeklyEmail(res.batchId), sendWeeklyEmail(res.batchId)]);
    expect(results.filter((r) => r.status === "sent")).toHaveLength(1);
    expect(await log(brandId)).toHaveLength(1);
  });

  it("goes to every owner and to no editor", async () => {
    const { brandId } = await newBrand();
    const second = await addMember(brandId, "owner");
    const editor = await addMember(brandId, "editor");
    const res = await generate(brandId);
    if (res.status !== "ready") throw new Error("not ready");
    const to = (await log(brandId)).map((r) => r.to_email).sort();
    expect(to).toEqual([await ownerEmail(brandId), second].sort());
    expect(to).not.toContain(editor);
  });

  it("is not sent to an unsubscribed brand", async () => {
    const { brandId } = await newBrand({ unsubscribed: true });
    const res = await generate(brandId);
    if (res.status !== "ready") throw new Error("not ready");
    expect(await log(brandId)).toEqual([]);
    expect((await batchRow(res.batchId)).email_sent_at).toBeNull();
    expect(await sendWeeklyEmail(res.batchId)).toEqual({ status: "skipped", reason: "unsubscribed" });
  });

  it("is not sent while paused, and is sent once the pause has ended", async () => {
    const { brandId } = await newBrand();
    await rows("update public.brand_memory set email_paused_until = '2099-01-01' where brand_id = $1", [brandId]);
    const res = await generate(brandId);
    if (res.status !== "ready") throw new Error("not ready");
    expect(await log(brandId)).toEqual([]);
    expect(await sendWeeklyEmail(res.batchId)).toEqual({ status: "skipped", reason: "paused" });

    await rows("update public.brand_memory set email_paused_until = '2020-01-01' where brand_id = $1", [brandId]);
    expect(await sendWeeklyEmail(res.batchId)).toMatchObject({ status: "sent" });
    expect(await log(brandId)).toHaveLength(1);
  });

  it("does not send for a batch that is not ready, has no posts, or does not exist", async () => {
    const { brandId } = await newBrand();
    const failed = await insertBatch(db, brandId, WEEK, { status: "failed" });
    expect(await sendWeeklyEmail(failed)).toEqual({ status: "skipped", reason: "not_ready" });
    const empty = await insertBatch(db, brandId, week(-1), { status: "ready" });
    expect(await sendWeeklyEmail(empty)).toEqual({ status: "skipped", reason: "no_posts" });
    expect((await batchRow(empty)).email_sent_at).toBeNull();
    expect(await sendWeeklyEmail(randomUUID())).toEqual({ status: "skipped", reason: "not_found" });
    expect(await log(brandId)).toEqual([]);
  });

  it("includes last week's check-in only when last week's email went out", async () => {
    const withPrev = await newBrand();
    await sentWeek(withPrev.brandId, week(1));
    await generate(withPrev.brandId);
    const [a] = await outboxOf(withPrev.brandId, "weekly");
    expect(a.html).toContain("bring enquiries");

    const noPrev = await newBrand();
    await generate(noPrev.brandId);
    const [b] = await outboxOf(noPrev.brandId, "weekly");
    expect(b.html).not.toContain("bring enquiries");
  });
});

describe("missed weeks (PRD section 8)", () => {
  const subject = async (brandId: string) => (await log(brandId)).map((r) => `${r.kind}:${r.subject}`);

  it.each([
    [0, "weekly:Your 4 posts for the week of 21 Dec are ready"],
    [1, "weekly:Your 4 posts for the week of 21 Dec are ready"],
    [2, "weekly:3 posts ready — 1 tap"],
    [3, "weekly:3 posts ready — 1 tap"],
  ])("after %i ignored weeks sends: %s", async (n, expected) => {
    const { brandId } = await newBrand();
    for (let k = 1; k <= n; k++) await sentWeek(brandId, week(k));
    expect(await countMissedWeeks(brandId, WEEK)).toBe(n);
    await generate(brandId);
    expect(await subject(brandId)).toEqual([expected]);
    if (n >= 2) {
      const [mail] = await outboxOf(brandId, "weekly");
      expect(mail.html).toContain(">See and approve<");
      expect(mail.html.match(/<img /g)).toHaveLength(3);
    }
  });

  it("after 4 ignored weeks pauses the brand and sends the paused notice instead", async () => {
    const { brandId } = await newBrand();
    for (let k = 1; k <= 4; k++) await sentWeek(brandId, week(k));
    const res = await generate(brandId);
    if (res.status !== "ready") throw new Error("not ready");
    expect(await subject(brandId)).toEqual(["paused_notice:We've paused your weekly posts"]);
    expect((await rows("select email_paused_until::text as d from public.brand_memory where brand_id = $1", [brandId]))[0].d).toBe("2099-12-31");
    expect((await batchRow(res.batchId)).email_sent_at).toBeNull();

    const [mail] = await outboxOf(brandId, "paused_notice");
    expect(mail.text).toContain("We've paused your weekly posts. Want them back?");
    const resume = /(https?:\/\/\S+\/e\/([\w.-]+))/.exec(mail.text.split("Yes, send them again: ")[1])!;
    expect(await verifyLink(resume[2])).toMatchObject({ act: "resume", brandId });
    expect(mail.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");

    // Nothing more goes out, and the notice is not repeated.
    expect(await sendWeeklyEmail(res.batchId)).toEqual({ status: "skipped", reason: "paused" });
    expect(await log(brandId)).toHaveLength(1);
  });

  it("an owner who engaged breaks the count: a check-in or a post action", async () => {
    // newest ignored, then a check-in, then ignored weeks: count is 1
    const a = await newBrand();
    await sentWeek(a.brandId, week(1));
    await sentWeek(a.brandId, week(2));
    await sentWeek(a.brandId, week(3));
    await rows("insert into public.checkins (brand_id, week_start, answer, via) values ($1, $2::date, 'few', 'email_link')", [a.brandId, week(2)]);
    expect(await countMissedWeeks(a.brandId, WEEK)).toBe(1);

    // a post action on the newest week: count is 0
    const b = await newBrand();
    const postId = await seedHistoryPost(db, b.brandId, b.userId, week(1), "An old post");
    await rows("update public.weekly_batches set email_sent_at = now() where brand_id = $1", [b.brandId]);
    await sentWeek(b.brandId, week(2));
    expect(await countMissedWeeks(b.brandId, WEEK)).toBe(2);
    await rows("insert into public.post_actions (post_id, brand_id, action, via) values ($1, $2, 'approve', 'dashboard')", [postId, b.brandId]);
    expect(await countMissedWeeks(b.brandId, WEEK)).toBe(0);
  });

  it("a week that was not emailed ends the count", async () => {
    const { brandId } = await newBrand();
    await sentWeek(brandId, week(1));
    await insertBatch(db, brandId, week(2), { status: "ready" }); // never emailed (for example, paused)
    await sentWeek(brandId, week(3));
    expect(await countMissedWeeks(brandId, WEEK)).toBe(1);
  });
});

describe("late notice (PRD section 8)", () => {
  const failing = { fixtures: { weekly: () => { throw new Error("model is down"); } } };

  it("is sent once after the retries are used up, then the success email says sorry and is marked late", async () => {
    const { brandId, userId } = await newBrand();
    // Attempts 1 and 2 fail quietly: the cron will retry.
    for (let i = 1; i <= 2; i++) {
      const r = await generate(brandId, failing);
      expect(r.status).toBe("failed");
      expect(await log(brandId)).toEqual([]);
    }
    // The third failure is final: one late notice.
    const third = await generate(brandId, failing);
    expect(third.status).toBe("failed");
    const notices = await log(brandId);
    expect(notices).toEqual([
      { kind: "late_notice", to_email: await ownerEmail(brandId), subject: "This week's posts are running late", status: "sent" },
    ]);
    const [notice] = await outboxOf(brandId, "late_notice");
    expect(notice.text).toContain("This week's posts are running late because our writing service had trouble.");
    expect(notice.headers["List-Unsubscribe"]).toBeTruthy();

    // Nothing more is sent on later skips or calls.
    const skipped = await generate(brandId, failing);
    expect(skipped).toMatchObject({ status: "skipped" });
    const batchId = third.batchId!;
    expect(await sendLateNotice(batchId)).toEqual({ status: "skipped", reason: "already_sent" });
    expect(await log(brandId)).toHaveLength(1);

    // The owner presses the button and it works: the weekly email goes out late.
    const ok = await generateWeek({ brandId, weekStart: WEEK, trigger: "button", userId }, { now: NOW, storage: store.storage });
    expect(ok.status).toBe("ready");
    expect((await log(brandId)).map((r) => r.kind)).toEqual(["late_notice", "weekly"]);
    const [weekly] = await outboxOf(brandId, "weekly");
    expect(weekly.html).toContain("Sorry these are late.");
    expect(weekly.text).toContain("Sorry these are late.");
    expect((await batchRow(batchId)).late).toBe(true);
    expect((await batchRow(batchId)).email_sent_at).not.toBeNull();
  });

  it("does not say sorry when no late notice was sent", async () => {
    const { brandId } = await newBrand();
    expect((await generate(brandId, failing)).status).toBe("failed");
    const ok = await generate(brandId);
    expect(ok.status).toBe("ready");
    const [weekly] = await outboxOf(brandId, "weekly");
    expect(weekly.html).not.toContain("Sorry these are late.");
    expect((await batchRow(ok.batchId!)).late).toBe(false);
  });

  it("is not sent while retries are left, for a ready batch, or to an unsubscribed brand", async () => {
    const { brandId } = await newBrand();
    const one = await insertBatch(db, brandId, WEEK, { status: "failed", error: "x", attempts: 1, createdAt: new Date().toISOString() });
    expect(await sendLateNotice(one)).toEqual({ status: "skipped", reason: "retries_left" });
    const ready = await insertBatch(db, brandId, week(-1), { status: "ready" });
    expect(await sendLateNotice(ready)).toEqual({ status: "skipped", reason: "not_failed" });
    expect(await sendLateNotice(randomUUID())).toEqual({ status: "skipped", reason: "not_found" });

    const u = await newBrand({ unsubscribed: true });
    const exhausted = await insertBatch(db, u.brandId, WEEK, { status: "failed", error: "x", attempts: 3 });
    expect(await sendLateNotice(exhausted)).toEqual({ status: "skipped", reason: "unsubscribed" });
    expect(await log(brandId)).toEqual([]);
    expect(await log(u.brandId)).toEqual([]);
  });

  it("is also due for a failed batch older than 24 hours", async () => {
    const { brandId } = await newBrand();
    const old = await insertBatch(db, brandId, WEEK, {
      status: "failed",
      error: "x",
      attempts: 1,
      createdAt: new Date(NOW.getTime() - 25 * 3600_000).toISOString(),
    });
    expect(await sendLateNotice(old, { now: NOW })).toMatchObject({ status: "sent" });
  });
});

describe("email trouble never changes the week", () => {
  it("a send that fails leaves the posts ready and the batch unsent, and a later call sends it", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("EMAIL_FROM", "Weekly Posts <hello@example.com>");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ message: "down" }), { status: 500 })));
    const { brandId } = await newBrand();
    const res = await generate(brandId);
    expect(res.status).toBe("ready");
    expect(await rows("select count(*)::int as n from public.posts where brand_id = $1", [brandId])).toEqual([{ n: 4 }]);
    expect(await log(brandId)).toMatchObject([{ kind: "weekly", status: "failed" }]);
    expect((await batchRow(res.batchId!)).email_sent_at).toBeNull();
    expect((await batchRow(res.batchId!)).status).toBe("ready");

    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    expect(await sendWeeklyEmail(res.batchId!)).toMatchObject({ status: "sent" });
    expect((await batchRow(res.batchId!)).email_sent_at).not.toBeNull();
  });
});
