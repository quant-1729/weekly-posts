import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createMockDb, setMockDbForTests, type MockDb } from "@/lib/db/mock";
import { handleLinkGet, handleLinkPost } from "@/lib/links/dispatch";
import { registerLinkHandler } from "@/lib/links/handlers";
import { postForm } from "@/lib/links/page";
import { registerApprovalLinkHandlers } from "@/lib/approvals/link-handlers";
import { appBase, jtiHash, signLink, verifyLink } from "@/lib/links/tokens";
import { GET as oneClickGet, POST as oneClickPost } from "@/app/api/email/unsubscribe/route";
import { isPublicPath } from "@/lib/auth/public-paths";
import { cookieOf, nonceOf, openLink, openThenPress, pressLink, seedReadyWeek, type SeededWeek } from "./helpers";
import { tempStorage } from "../weekly/helpers";

let db: MockDb;
let store: Awaited<ReturnType<typeof tempStorage>>;
let week: SeededWeek;
let other: SeededWeek;

type Row = Record<string, unknown>;
const rows = (sql: string, params: unknown[] = []) => db.withAdmin((tx) => tx.query<Row>(sql, params));
const memory = async (brandId: string) =>
  (await rows("select email_paused_until::text as paused, email_unsubscribed_at as unsub from public.brand_memory where brand_id = $1", [brandId]))[0];
const checkins = (brandId: string) => rows("select week_start::text as wk, answer::text as answer, via from public.checkins where brand_id = $1", [brandId]);
const formOf = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};

beforeAll(async () => {
  db = await createMockDb();
  setMockDbForTests(db);
  store = await tempStorage();
  week = await seedReadyWeek(db, store.storage);
  other = await seedReadyWeek(db, store.storage);
}, 120_000);
afterAll(async () => {
  setMockDbForTests(null);
  await db.close();
  await store.cleanup();
});

const sign = (act: Parameters<typeof signLink>[0]["act"], extra: Partial<Parameters<typeof signLink>[0]> = {}) =>
  signLink({ brandId: week.brandId, act, ...extra });

describe("public paths", () => {
  it("/e/, /i/ and the one-click route need no sign-in", () => {
    expect(isPublicPath("/e/abc.def.ghi")).toBe(true);
    expect(isPublicPath("/i/abc.def.ghi")).toBe(true);
    expect(isPublicPath("/api/email/unsubscribe")).toBe(true);
    expect(isPublicPath("/week")).toBe(false);
  });
});

describe("a link never acts on GET", () => {
  it("GET twice on every act changes nothing", async () => {
    const tokens = [
      await sign("checkin", { weekStart: "2026-12-14", extra: { answer: "many" } }),
      await sign("pause"),
      await sign("unsubscribe"),
      await sign("resume"),
      await sign("view_week", { weekStart: "2026-12-21" }),
      await sign("approve", { postId: week.postIds[0] }),
      await sign("skip", { postId: week.postIds[0] }),
      await sign("edit", { postId: week.postIds[0] }),
    ];
    const snapshot = async () =>
      JSON.stringify([
        await rows("select email_paused_until::text, email_unsubscribed_at from public.brand_memory where brand_id = $1", [week.brandId]),
        await rows("select count(*)::int as n from public.checkins"),
        await rows("select count(*)::int as n from public.post_actions"),
        await rows("select status::text from public.posts where brand_id = $1 order by id", [week.brandId]),
      ]);
    const before = await snapshot();
    for (const t of tokens) {
      for (let i = 0; i < 2; i++) {
        const res = await openLink(t);
        expect(res.status).toBe(200);
      }
    }
    expect(await snapshot()).toBe(before);
  });

  it("the page headers forbid framing and caching", async () => {
    const res = await openLink(await sign("pause"));
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(res.headers.get("content-type")).toContain("text/html");
  });

  it("POST without the cookie or with a wrong nonce does nothing", async () => {
    const token = await sign("unsubscribe");
    const html = await (await openLink(token)).text();
    const nonce = nonceOf(html);
    // no cookie at all
    expect((await pressLink(token, { nonce })).status).toBe(403);
    // a cookie, but a made-up nonce
    const cookie = cookieOf(await openLink(token))!;
    expect((await pressLink(token, { nonce: "x".repeat(43) }, cookie)).status).toBe(403);
    // a nonce that belongs to another browser's cookie
    expect((await pressLink(token, { nonce }, cookie)).status).toBe(403);
    // no form fields at all
    expect((await pressLink(token, {}, cookie)).status).toBe(403);
    expect((await memory(week.brandId)).unsub).toBeNull();
  });

  it("a scanner GET does not stop the owner: scanner GET, owner GET, owner POST works", async () => {
    const token = await sign("checkin", { weekStart: "2026-12-14", extra: { answer: "few" } });
    const scanner = await openLink(token);
    expect(scanner.status).toBe(200);
    expect(await checkins(week.brandId)).toHaveLength(0);

    const owner = await openLink(token);
    const cookie = cookieOf(owner)!;
    const html = await owner.text();
    const done = await pressLink(token, { nonce: nonceOf(html) }, cookie);
    expect(done.status).toBe(200);
    expect(await checkins(week.brandId)).toEqual([{ wk: "2026-12-14", answer: "few", via: "email_link" }]);
    await rows("delete from public.checkins");
  });

  it("keeps the same cookie across pages, so two tabs both work", async () => {
    const t1 = await sign("pause");
    const t2 = await sign("unsubscribe");
    const c1 = cookieOf(await openLink(t1))!;
    const second = await openLink(t2, c1);
    expect(cookieOf(second)).toBe(c1);
  });
});

describe("expired and invalid links", () => {
  it("show a friendly page about the 14 days, with a sign-in link", async () => {
    const old = await signLink({ brandId: week.brandId, act: "pause", now: new Date(Date.now() - 15 * 24 * 3600_000) });
    for (const token of [old, "garbage.token.here"]) {
      const res = await openLink(token);
      expect(res.status).toBe(410);
      const html = await res.text();
      expect(html).toContain("14 days");
      expect(html).toContain('href="/login"');
      expect(res.headers.getSetCookie()).toEqual([]);
      expect((await pressLink(token, { nonce: "n" }, "c")).status).toBe(410);
    }
  });

  it("a link expires 14 days after it was made, checked on GET and POST", async () => {
    const t0 = new Date("2026-11-09T08:00:00Z");
    const token = await signLink({ brandId: week.brandId, act: "pause", now: t0 });
    const inside = new Date(t0.getTime() + 13 * 24 * 3600_000 + 23 * 3600_000);
    const outside = new Date(t0.getTime() + 14 * 24 * 3600_000 + 60_000);
    expect((await handleLinkGet(token, undefined, inside)).status).toBe(200);
    expect((await handleLinkGet(token, undefined, outside)).status).toBe(410);
    const got = await handleLinkGet(token, undefined, inside);
    const form = formOf({ nonce: nonceOf(got.html) });
    expect((await handleLinkPost(token, form, got.cookie!.value, outside)).status).toBe(410);
    expect((await memory(week.brandId)).paused).toBeNull();
  });

  it("an image token is not an action link", async () => {
    const img = await signLink({ brandId: week.brandId, postId: week.postIds[0], act: "img", extra: { format: "square" } });
    expect((await openLink(img)).status).toBe(410);
  });
});

describe("scope: the brand and post are re-checked", () => {
  it("a post of another brand is not found", async () => {
    const token = await signLink({ brandId: week.brandId, postId: other.postIds[0], act: "approve" });
    expect((await openLink(token)).status).toBe(404);
  });

  it("an unknown brand is not found", async () => {
    const token = await signLink({ brandId: "99999999-9999-4999-8999-999999999999", act: "pause" });
    expect((await openLink(token)).status).toBe(404);
  });

  it("post links show the real approval pages (V-16)", async () => {
    const titles = { approve: "Approve this post?", skip: "Skip this post?", edit: "Edit this post" } as const;
    for (const act of ["approve", "skip", "edit"] as const) {
      const res = await openLink(await signLink({ brandId: week.brandId, postId: week.postIds[0], act }));
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain(titles[act]);
      expect(html).not.toContain("coming soon");
    }
  });
});

describe("handler registry", () => {
  it("lets a later task register a post act and log it with the jti hash", async () => {
    const seen: string[] = [];
    registerLinkHandler("approve", {
      async view(ctx) {
        seen.push(`view:${ctx.claims.postId}`);
        return { title: "Approve this post", body: postForm({ token: ctx.token, nonce: ctx.nonce, buttons: [{ label: "Approve" }] }) };
      },
      async act(ctx) {
        await ctx.logPostAction("approve", { note: "test" });
        seen.push(`act:${ctx.jtiHash}`);
        return { title: "Approved", body: "<p>done</p>" };
      },
    });
    try {
      const token = await signLink({ brandId: week.brandId, postId: week.postIds[1], act: "approve" });
      const { resultHtml } = await openThenPress(token);
      expect(resultHtml).toContain("Approved");
      const claims = await verifyLink(token);
      const [log] = await rows(
        "select action::text as action, via, user_id, detail, brand_id::text as brand_id from public.post_actions where post_id = $1",
        [week.postIds[1]],
      );
      expect(log).toMatchObject({ action: "approve", via: "email_link", user_id: null, brand_id: week.brandId });
      expect(log.detail).toEqual({ note: "test", jti_hash: jtiHash(claims!.jti) });
      expect(JSON.stringify(log.detail)).not.toContain(token);
      expect(seen[0]).toBe(`view:${week.postIds[1]}`);
      expect(seen[1]).toBe(`act:${jtiHash(claims!.jti)}`);
    } finally {
      registerApprovalLinkHandlers();
      await rows("delete from public.post_actions");
    }
  });
});

describe("view_week", () => {
  it("lists every post with image, caption, status and three action links", async () => {
    const token = await sign("view_week", { weekStart: "2026-12-21" });
    const html = await (await openLink(token)).text();
    expect(html).toContain("Your posts for the week of 21 Dec");
    expect(html.match(/<img /g)).toHaveLength(4);
    expect(html.match(/src="\/i\/[\w.-]+"/g)).toHaveLength(4);
    expect(html.match(/href="\/e\/[\w.-]+"/g)).toHaveLength(12);
    expect(html.match(/Not approved yet/g)).toHaveLength(4);
    // The buttons are links to action tokens of the right acts, each for its own post.
    const hrefs = [...html.matchAll(/href="\/e\/([\w.-]+)"/g)].map((m) => m[1]);
    const acts: string[] = [];
    for (const h of hrefs) {
      const c = await verifyLink(h);
      acts.push(c!.act);
      expect(week.postIds).toContain(c!.postId);
    }
    for (const a of ["approve", "edit", "skip"]) expect(acts.filter((x) => x === a)).toHaveLength(4);
  });

  it("does not show another brand's posts", async () => {
    const token = await sign("view_week", { weekStart: "2026-12-21" });
    const html = await (await openLink(token)).text();
    for (const id of other.postIds) expect(html).not.toContain(id);
  });
});

describe("check-in (Req 20)", () => {
  it("pre-selects the answer from the token, saves it, and lets it be changed", async () => {
    const token = await sign("checkin", { weekStart: "2026-12-14", extra: { answer: "few" } });
    const page = await (await openLink(token)).text();
    expect(page).toContain("posts bring enquiries?");
    expect(page).toMatch(/value="few" checked/);
    expect(page).not.toMatch(/value="none" checked/);

    const first = await openThenPress(token);
    expect(first.resultHtml).toContain("A few");
    expect(await checkins(week.brandId)).toEqual([{ wk: "2026-12-14", answer: "few", via: "email_link" }]);

    // change it, with the same token and a fresh page
    const second = await openThenPress(token, { answer: "many" });
    expect(second.resultHtml).toMatch(/value="many" checked/);
    expect(await checkins(week.brandId)).toEqual([{ wk: "2026-12-14", answer: "many", via: "email_link" }]);

    // pressing again is the same as once
    await openThenPress(token, { answer: "many" });
    expect(await checkins(week.brandId)).toHaveLength(1);
    await rows("delete from public.checkins");
  });

  it("ignores an answer that is not none/few/many", async () => {
    const token = await sign("checkin", { weekStart: "2026-12-14", extra: { answer: "few" } });
    await openThenPress(token, { answer: "lots" });
    expect(await checkins(week.brandId)).toHaveLength(0);
  });

  it("writes only the token's own brand and week", async () => {
    const token = await sign("checkin", { weekStart: "2026-12-14", extra: { answer: "none" } });
    await openThenPress(token);
    expect(await checkins(other.brandId)).toHaveLength(0);
    expect(await checkins(week.brandId)).toHaveLength(1);
    await rows("delete from public.checkins");
  });
});

describe("pause", () => {
  it("sets email_paused_until to the brand's local today plus 14 days", async () => {
    // Europe/London on 9 Nov 2026 (GMT)
    const now = new Date("2026-11-09T23:30:00Z");
    const token = await signLink({ brandId: week.brandId, act: "pause", now });
    const got = await handleLinkGet(token, undefined, now);
    expect(got.html).toContain("Pause emails for 2 weeks?");
    expect(got.html).toContain("23 Nov 2026");
    expect((await memory(week.brandId)).paused).toBeNull();
    const done = await handleLinkPost(token, formOf({ nonce: nonceOf(got.html) }), got.cookie!.value, now);
    expect(done.html).toContain("Emails paused");
    expect((await memory(week.brandId)).paused).toBe("2026-11-23");
    await rows("update public.brand_memory set email_paused_until = null where brand_id = $1", [week.brandId]);
  });

  it("uses the brand's own time zone for today", async () => {
    const kolkata = await seedReadyWeek(db, store.storage, { timezone: "Asia/Kolkata" });
    const now = new Date("2026-11-09T20:00:00Z"); // 10 Nov, 01:30 in Kolkata
    const token = await signLink({ brandId: kolkata.brandId, act: "pause", now });
    const got = await handleLinkGet(token, undefined, now);
    await handleLinkPost(token, formOf({ nonce: nonceOf(got.html) }), got.cookie!.value, now);
    expect((await memory(kolkata.brandId)).paused).toBe("2026-11-24");
  });

  it("can be undone from the done page", async () => {
    const token = await sign("pause");
    const r = await openThenPress(token);
    expect(r.resultHtml).toContain("Resume now");
    expect((await memory(week.brandId)).paused).not.toBeNull();
    const again = await pressLink(token, { nonce: nonceOf(r.resultHtml), do: "resume" }, r.cookie);
    expect(await again.text()).toContain("Emails are back on");
    expect((await memory(week.brandId)).paused).toBeNull();
  });
});

describe("unsubscribe and resubscribe (Req 24)", () => {
  it("unsubscribes on POST and resubscribes with another POST on the same token", async () => {
    const token = await sign("unsubscribe");
    const first = await openThenPress(token);
    expect(first.resultHtml).toContain("You are unsubscribed");
    expect(first.resultHtml).toContain("Resubscribe");
    expect((await memory(week.brandId)).unsub).not.toBeNull();

    // Unsubscribing stops the emails. Links in weeks already sent keep working (V-16); the check-in does not.
    expect((await openLink(await sign("view_week", { weekStart: "2026-12-21" }))).status).toBe(200);
    expect((await openLink(await sign("approve", { postId: week.postIds[0] }))).status).toBe(200);
    const checkin = await openLink(await sign("checkin", { weekStart: "2026-12-14", extra: { answer: "few" } }));
    expect(checkin.status).toBe(403);
    expect(await checkin.text()).toContain("Weekly emails are turned off");

    const back = await pressLink(token, { nonce: nonceOf(first.resultHtml), do: "resubscribe" }, first.cookie);
    expect(await back.text()).toContain("Welcome back");
    expect((await memory(week.brandId)).unsub).toBeNull();
    expect((await openLink(await sign("view_week", { weekStart: "2026-12-21" }))).status).toBe(200);
  });

  it("unsubscribing twice keeps the first time", async () => {
    const token = await sign("unsubscribe");
    await openThenPress(token);
    const first = (await memory(week.brandId)).unsub;
    await openThenPress(token);
    expect((await memory(week.brandId)).unsub).toEqual(first);
    await rows("update public.brand_memory set email_unsubscribed_at = null where brand_id = $1", [week.brandId]);
  });
});

describe("resume (after the paused notice)", () => {
  it("clears a long pause on POST only", async () => {
    await rows("update public.brand_memory set email_paused_until = '2099-12-31' where brand_id = $1", [week.brandId]);
    const token = await sign("resume");
    await openLink(token);
    expect((await memory(week.brandId)).paused).toBe("2099-12-31");
    await openThenPress(token);
    expect((await memory(week.brandId)).paused).toBeNull();
  });
});

describe("one-click unsubscribe (RFC 8058)", () => {
  const url = (t: string) => `http://localhost:3100/api/email/unsubscribe?t=${t}`;

  it("a POST unsubscribes with no cookie", async () => {
    const token = await sign("unsubscribe");
    const res = await oneClickPost(
      new NextRequest(url(token), {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "List-Unsubscribe=One-Click",
      }),
    );
    expect(res.status).toBe(200);
    expect((await memory(week.brandId)).unsub).not.toBeNull();
    await rows("update public.brand_memory set email_unsubscribed_at = null where brand_id = $1", [week.brandId]);
  });

  it("a GET only redirects to the normal page and does not act", async () => {
    const token = await sign("unsubscribe");
    const res = await oneClickGet(new NextRequest(url(token)));
    expect(res.status).toBe(303);
    // Redirects start from the public app address, not the request's own host (Cloud Run serves on 0.0.0.0:8080).
    expect(res.headers.get("location")).toBe(new URL(`/e/${token}`, appBase()).toString());
    expect((await memory(week.brandId)).unsub).toBeNull();
    const page = await (await openLink(token)).text();
    expect(page).toContain("Stop weekly emails?");
  });

  it("rejects a token for another act, an expired token and a missing token", async () => {
    const wrongAct = await sign("pause");
    const expired = await signLink({ brandId: week.brandId, act: "unsubscribe", now: new Date(Date.now() - 15 * 24 * 3600_000) });
    for (const t of [wrongAct, expired, "junk", ""]) {
      const res = await oneClickPost(new NextRequest(url(t), { method: "POST" }));
      expect(res.status).toBe(400);
    }
    expect((await memory(week.brandId)).unsub).toBeNull();
  });
});

describe("logging", () => {
  it("never writes a whole token to the console", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const token = await sign("checkin", { weekStart: "2026-12-14", extra: { answer: "few" } });
    await openThenPress(token);
    const logged = [...info.mock.calls, ...err.mock.calls].flat().join("\n");
    info.mockRestore();
    err.mockRestore();
    expect(logged).toContain("[link] act=checkin");
    expect(logged).not.toContain(token);
    expect(logged).not.toContain(token.split(".")[2]);
    await rows("delete from public.checkins");
  });
});
