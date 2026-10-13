import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { isPublicPath } from "@/lib/auth/public-paths";
import { createMockDb, setMockDbForTests, type MockDb } from "@/lib/db/mock";
import { listOutbox, type OutboxEntry } from "@/lib/email/outbox";
import { s } from "@/lib/i18n/strings";
import { verifyLink } from "@/lib/links/tokens";
import { MAX_REMINDER_ATTEMPTS, REMINDER_AFTER_MS, buildReminderEmail, dueReminders, sendPostingReminders } from "@/lib/reminders/posting";
import { GET, maxDuration } from "@/app/api/cron/reminders/route";
import { freshWeek, postRow, setPost, type FreshWeek } from "../approvals/helpers";
import { lintEmailHtml } from "../email/lint";
import { tempStorage } from "../weekly/helpers";

const WEEK = "2026-12-21";
const T0 = new Date("2026-12-22T09:00:00Z"); // when the posts were approved
const after = (hours: number, from = T0) => new Date(from.getTime() + hours * 3600 * 1000);

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
const newWeek = () => freshWeek(db, store.storage);

/** Approves the given posts of the week at `at`. */
async function approve(w: FreshWeek, indexes: number[], at: Date = T0) {
  for (const i of indexes) await setPost(db, w.postIds[i], "status = 'approved', approved_at = $2::timestamptz, skipped_at = null, posted_at = null", [at.toISOString()]);
}
const markPostedRow = (w: FreshWeek, i: number, at: Date) => setPost(db, w.postIds[i], "status = 'posted', posted_at = $2::timestamptz", [at.toISOString()]);
const reminderSentAt = async (w: FreshWeek) => (await rows("select reminder_sent_at from public.weekly_batches where id = $1", [w.batchId]))[0].reminder_sent_at as Date | null;
const mailOf = async (w: FreshWeek): Promise<OutboxEntry[]> => (await listOutbox(1000)).filter((m) => m.brandId === w.brandId && m.kind === "reminder");
const logOf = (w: FreshWeek) => rows("select status::text as status, subject from public.email_log where brand_id = $1 and kind = 'reminder' and subject not like 'Reminder attempt failed%' order by id", [w.brandId]);
/** Runs the sweep and returns what it did for this one brand. */
async function run(w: FreshWeek, now: Date) {
  const summary = await sendPostingReminders({ now });
  return summary.items.filter((i) => i.brandId === w.brandId);
}

describe("when a reminder is due (AC 25: exactly one, 3 days later)", () => {
  it("sends nothing before 72 hours, exactly one at 72 hours, and never a second", async () => {
    const w = await newWeek();
    await approve(w, [0, 1, 2]); // the fourth post stays a draft

    expect(await run(w, after(71.9))).toEqual([]);
    expect(await mailOf(w)).toHaveLength(0);
    expect(await reminderSentAt(w)).toBeNull();

    const at72 = after(REMINDER_AFTER_MS / 3600000);
    const first = await run(w, at72);
    expect(first).toMatchObject([{ batchId: w.batchId, outcome: "sent", recipients: 1 }]);
    expect(await mailOf(w)).toHaveLength(1);
    expect((await reminderSentAt(w))?.toISOString()).toBe(at72.toISOString());
    expect(await logOf(w)).toMatchObject([{ status: "sent", subject: "You have 3 posts ready to share" }]);

    // The hourly runs that follow, and days later: nothing more.
    for (const h of [73, 74, 96, 24 * 8]) expect(await run(w, after(h))).toEqual([]);
    expect(await mailOf(w)).toHaveLength(1);
    expect(await logOf(w)).toHaveLength(1);
  });

  it("the reminder email: subject, one row per unposted approved post, ready links, footer, headers, and it passes the HTML lint", async () => {
    const w = await newWeek();
    await approve(w, [0, 1, 3]);
    await markPostedRow(w, 1, after(1)); // already posted: not listed
    await run(w, after(72));
    const [mail] = await mailOf(w);
    expect(mail.subject).toBe("You have 2 posts ready to share");
    expect(mail.html).not.toContain("<form");
    expect(lintEmailHtml(mail.html)).toEqual([]);
    expect(mail.html.match(/<img /g)).toHaveLength(2);
    expect(mail.html.match(new RegExp(`>${s.share.reminder.share}<`, "g"))).toHaveLength(2);
    expect(mail.html).toContain("Pause for 2 weeks");
    expect(mail.html).toContain("Unsubscribe");
    expect(mail.headers["List-Unsubscribe"]).toMatch(/^<http/);
    expect(mail.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");

    // Each Share button is a "ready" link for that post and week; each picture is a signed /i/ link.
    const links = [...mail.html.matchAll(/href="(https?:\/\/[^"]+\/e\/([\w.-]+))"/g)].map((m) => m[2]);
    const ready = [];
    for (const l of links) {
      const c = await verifyLink(l);
      if (c?.act === "ready") ready.push(c);
    }
    expect(ready.map((c) => c.postId).sort()).toEqual([w.postIds[0], w.postIds[3]].sort());
    expect(ready.every((c) => c.brandId === w.brandId && c.weekStart === WEEK)).toBe(true);
    expect(mail.html).toContain((await postRow(db, w.postIds[0])).caption!.toString().split("\n")[0].replace(/'/g, "&#39;").slice(0, 20));

    // Plain text carries the same links.
    expect(mail.text).toContain(s.share.reminder.share);
    expect(mail.text.match(/\/e\/[\w.-]+/g)!.length).toBeGreaterThanOrEqual(4);
  });

  it("a single post reads \"1 post\"", async () => {
    const w = await newWeek();
    await approve(w, [2]);
    await run(w, after(72));
    expect((await mailOf(w))[0].subject).toBe(s.share.reminder.subjectOne);
  });

  it("is measured from the EARLIEST approval of the unposted posts", async () => {
    const w = await newWeek();
    await approve(w, [0], after(0));
    await approve(w, [1], after(40)); // approved later
    expect(await run(w, after(71))).toEqual([]);
    expect(await run(w, after(72))).toMatchObject([{ outcome: "sent" }]);
    expect((await mailOf(w))[0].subject).toBe("You have 2 posts ready to share");
  });

  it("does not remind about approvals older than 14 days", async () => {
    const w = await newWeek();
    await approve(w, [0]);
    expect(await run(w, after(24 * 15))).toEqual([]);
    expect(await mailOf(w)).toHaveLength(0);
  });
});

describe("when nothing is sent", () => {
  it("all approved posts are marked Posted: no reminder", async () => {
    const w = await newWeek();
    await approve(w, [0, 1]);
    await markPostedRow(w, 0, after(5));
    await markPostedRow(w, 1, after(30));
    expect(await run(w, after(100))).toEqual([]);
    expect(await mailOf(w)).toHaveLength(0);
    expect(await reminderSentAt(w)).toBeNull();
  });

  it("nothing is approved (drafts and skipped only): no reminder", async () => {
    const w = await newWeek();
    await setPost(db, w.postIds[0], "status = 'skipped', skipped_at = now()");
    expect(await run(w, after(100))).toEqual([]);
    expect(await mailOf(w)).toHaveLength(0);
  });

  it("a brand that unsubscribed gets none", async () => {
    const w = await newWeek();
    await approve(w, [0]);
    await rows("update public.brand_memory set email_unsubscribed_at = now() where brand_id = $1", [w.brandId]);
    expect(await run(w, after(80))).toEqual([]);
    expect(await mailOf(w)).toHaveLength(0);
  });

  it("a paused brand gets none until the pause ends, and then gets its one", async () => {
    const w = await newWeek();
    await approve(w, [0]);
    await rows("update public.brand_memory set email_paused_until = '2026-12-27'::date, timezone = 'UTC' where brand_id = $1", [w.brandId]);
    expect(await run(w, new Date("2026-12-26T10:00:00Z"))).toEqual([]);
    expect(await mailOf(w)).toHaveLength(0);
    expect(await reminderSentAt(w)).toBeNull();
    expect(await run(w, new Date("2026-12-27T10:00:00Z"))).toMatchObject([{ outcome: "sent" }]);
    expect(await mailOf(w)).toHaveLength(1);
  });

  it("marking the posts Posted before the 3 days means no reminder, even for a mixed week", async () => {
    const w = await newWeek();
    await approve(w, [0, 1, 2, 3]);
    for (const i of [0, 1, 2, 3]) await markPostedRow(w, i, after(10));
    const due = (await dueReminders(after(80))).filter((d) => d.brandId === w.brandId);
    expect(due).toEqual([]);
  });

  it("each weekly batch is reminded at most once, so at most once a week", async () => {
    const w = await newWeek();
    await approve(w, [0]);
    expect(await run(w, after(72))).toMatchObject([{ outcome: "sent" }]);
    // A later approval in the same batch does not earn a second reminder.
    await approve(w, [1], after(100));
    expect(await run(w, after(100 + 80))).toEqual([]);
    expect(await mailOf(w)).toHaveLength(1);
  });
});

describe("a failed send is retried by the next hourly run, up to 3 times", () => {
  const down = () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("EMAIL_FROM", "Weekly Posts <hello@example.com>");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ message: "down" }), { status: 500 })));
  };
  const up = () => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  };

  it("leaves reminder_sent_at empty on failure, counts the attempts, and sends once when the service is back", async () => {
    const w = await newWeek();
    await approve(w, [0, 1]);
    down();
    expect(await run(w, after(72))).toMatchObject([{ outcome: "failed", attempts: 1 }]);
    expect(await reminderSentAt(w)).toBeNull();
    expect(await run(w, after(73))).toMatchObject([{ outcome: "failed", attempts: 2 }]);
    expect(await reminderSentAt(w)).toBeNull();
    expect((await logOf(w)).map((l) => l.status)).toEqual(["failed", "failed"]);

    up();
    expect(await run(w, after(74))).toMatchObject([{ outcome: "sent" }]);
    expect(await reminderSentAt(w)).not.toBeNull();
    expect((await logOf(w)).map((l) => l.status)).toEqual(["failed", "failed", "sent"]);
    expect(await mailOf(w)).toHaveLength(1);
    expect(await run(w, after(75))).toEqual([]);
  });

  it("gives up after 3 failed attempts and stays quiet", async () => {
    const w = await newWeek();
    await approve(w, [0]);
    down();
    for (let n = 1; n <= MAX_REMINDER_ATTEMPTS; n++) {
      expect(await run(w, after(71 + n))).toMatchObject([{ outcome: "failed", attempts: n }]);
    }
    up();
    expect(await run(w, after(80))).toMatchObject([{ outcome: "gave_up", attempts: MAX_REMINDER_ATTEMPTS }]);
    expect(await run(w, after(81))).toMatchObject([{ outcome: "gave_up" }]);
    expect(await mailOf(w)).toHaveLength(0);
    expect((await logOf(w)).filter((l) => l.status === "failed")).toHaveLength(MAX_REMINDER_ATTEMPTS);
    expect(await reminderSentAt(w)).toBeNull();
  });
});

describe("the email builder", () => {
  it("builds a short email for any count and survives a post without an image", async () => {
    const w = await newWeek();
    const built = await buildReminderEmail({
      brand: { id: w.brandId, name: "Anil's Bakery" },
      weekStart: WEEK,
      posts: [
        { id: w.postIds[0], suggestedDay: "2026-12-22", channel: "instagram", caption: "Fresh <b>bread</b> today\nSecond line", hasImage: true },
        { id: w.postIds[1], suggestedDay: "2026-12-24", channel: "gbp", caption: "", hasImage: false },
      ],
      now: T0,
    });
    expect(built.subject).toBe("You have 2 posts ready to share");
    expect(built.html).toContain("Fresh &lt;b&gt;bread&lt;/b&gt; today");
    expect(built.html).not.toContain("Second line");
    expect(built.html).toContain(s.share.reminder.noImage);
    expect(built.html).toContain("Anil&#39;s Bakery");
    expect(lintEmailHtml(built.html)).toEqual([]);
  });
});

describe("GET /api/cron/reminders", () => {
  const call = (headers: Record<string, string> = {}) => GET(new NextRequest("http://localhost/api/cron/reminders", { headers }));

  it("answers 401 without the secret, with a wrong one, or when none is configured", async () => {
    vi.stubEnv("CRON_SECRET", "");
    expect((await call()).status).toBe(401);
    expect((await call({ authorization: "Bearer " })).status).toBe(401);
    vi.stubEnv("CRON_SECRET", "s3cret-value");
    expect((await call()).status).toBe(401);
    expect((await call({ authorization: "Bearer wrong" })).status).toBe(401);
    expect((await call({ authorization: "s3cret-value" })).status).toBe(401);
  });

  it("runs the reminders with the right secret and returns a summary; its path is public", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret-value");
    const res = await call({ authorization: "Bearer s3cret-value" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, due: expect.any(Number), sent: expect.any(Number), failed: expect.any(Number), skipped: expect.any(Number) });
    expect(maxDuration).toBeGreaterThan(0);
    expect(isPublicPath("/api/cron/reminders")).toBe(true);
  });
});
