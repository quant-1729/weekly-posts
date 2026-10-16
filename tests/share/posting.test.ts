import { createElement } from "react";
import { renderToString } from "react-dom/server";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const jar = vi.hoisted(() => {
  const store = new Map<string, string>();
  return {
    store,
    api: {
      get: (name: string) => (store.has(name) ? { name, value: store.get(name)! } : undefined),
      set: (name: string, value: string) => void store.set(name, value),
      delete: (name: string) => void store.delete(name),
    },
  };
});
vi.mock("next/headers", () => ({ cookies: async () => jar.api, headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

import { logDownload, logShare, markPosted, unmarkPosted } from "@/lib/approvals/ops";
import { logShareAction, markPostedAction, unmarkPostedAction } from "@/components/week/actions";
import { WeekView } from "@/components/week/week-view";
import { SESSION_COOKIE } from "@/lib/auth/session";
import { signSession } from "../helpers/session";
import { createMockDb, setMockDbForTests, type MockDb } from "@/lib/db/mock";
import { s } from "@/lib/i18n/strings";
import { PAGE_CSP, pageCsp } from "@/lib/links/page";
import { serveEmailImage } from "@/lib/links/image";
import { signLink, verifyLink } from "@/lib/links/tokens";
import { FORMAT_SIZE } from "@/lib/render";
import { setStorageForTests } from "@/lib/storage";
import { loadWeekView } from "@/lib/weekly/view";
import { createBrandFor, createUser } from "../brand/helpers";
import { actionsOf, dashActor, emailActor, freshWeek, postRow, refOf, setPost, type FreshWeek } from "../approvals/helpers";
import { cookieOf, nonceOf, openLink, pressLink } from "../links/helpers";
import { tempStorage } from "../weekly/helpers";

const WEEK = "2026-12-21";
const NOW = new Date("2026-12-22T10:00:00Z");

let db: MockDb;
let store: Awaited<ReturnType<typeof tempStorage>>;
let ops: FreshWeek;
let ready: FreshWeek;
let dash: FreshWeek;
let other: FreshWeek;
let outsider: string;

async function signIn(userId: string | null) {
  if (userId === null) jar.store.delete(SESSION_COOKIE);
  else jar.store.set(SESSION_COOKIE, await signSession({ id: userId, email: `${userId.slice(0, 6)}@example.com` }));
}

beforeAll(async () => {
  db = await createMockDb();
  setMockDbForTests(db);
  store = await tempStorage();
  setStorageForTests(store.storage);
  ops = await freshWeek(db, store.storage);
  ready = await freshWeek(db, store.storage);
  dash = await freshWeek(db, store.storage);
  other = await freshWeek(db, store.storage);
  outsider = (await createUser(db)).id;
  await createBrandFor(db, outsider, "Elsewhere");
}, 240_000);
afterAll(async () => {
  setStorageForTests(null);
  setMockDbForTests(null);
  await db.close();
  await store.cleanup();
});
beforeEach(() => signIn(null));

const approve = (postId: string, at = "2026-12-21T09:00:00Z") =>
  setPost(db, postId, "status = 'approved', approved_at = $2::timestamptz, skipped_at = null, posted_at = null", [at]);
const draft = (postId: string) => setPost(db, postId, "status = 'draft', approved_at = null, skipped_at = null, posted_at = null");
const skip = (postId: string) => setPost(db, postId, "status = 'skipped', skipped_at = now(), approved_at = null, posted_at = null");
const statusOf = async (id: string) => (await postRow(db, id)).status as string;
const actionNames = async (id: string) => (await actionsOf(db, id)).map((a) => a.action as string);

// ---------------------------------------------------------------------------------------------
// Ops (Req 18)
// ---------------------------------------------------------------------------------------------

describe("mark as posted", () => {
  it("approved becomes posted with posted_at, logged once with the jti hash; again is a quiet no-op", async () => {
    const id = ops.postIds[0];
    await approve(id);
    const actor = emailActor("jti-posted");
    const r = await markPosted(refOf(ops, 0, actor), { now: NOW });
    expect(r).toMatchObject({ ok: true, changed: true });
    const row = await postRow(db, id);
    expect(row.status).toBe("posted");
    expect(new Date(row.posted_at as string).toISOString()).toBe(NOW.toISOString());
    const [log] = await actionsOf(db, id);
    expect(log).toMatchObject({ action: "posted", via: "email_link", user_id: null });
    expect(log.detail).toEqual({ jti_hash: (actor as { jtiHash: string }).jtiHash });

    const again = await markPosted(refOf(ops, 0, actor), { now: new Date(NOW.getTime() + 1000) });
    expect(again).toMatchObject({ ok: true, changed: false });
    expect(await actionNames(id)).toEqual(["posted"]);
    expect(new Date((await postRow(db, id)).posted_at as string).toISOString()).toBe(NOW.toISOString());
  });

  it("as a dashboard user it logs the user and no jti", async () => {
    const id = ops.postIds[1];
    await approve(id);
    expect(await markPosted(refOf(ops, 1, dashActor(ops.userId)), { now: NOW })).toMatchObject({ ok: true, changed: true });
    const [log] = await actionsOf(db, id);
    expect(log).toMatchObject({ action: "posted", via: "dashboard", user_id: ops.userId });
    expect(log.detail).toEqual({});
  });

  it("refuses a draft and a skipped post, and changes nothing", async () => {
    const [a, b] = [ops.postIds[2], ops.postIds[3]];
    await draft(a);
    await skip(b);
    for (const [i, id] of [a, b].entries()) {
      const r = await markPosted(refOf(ops, i + 2, emailActor()), { now: NOW });
      expect(r).toMatchObject({ ok: false, code: "not_approved", message: s.share.errors.notApproved });
      expect(await actionNames(id)).toEqual([]);
    }
    expect(await statusOf(a)).toBe("draft");
    expect(await statusOf(b)).toBe("skipped");
    expect((await postRow(db, a)).posted_at).toBeNull();
  });

  it("is scoped to the brand: another brand's post, and a user outside the brand, are refused", async () => {
    await approve(other.postIds[0]);
    const cross = await markPosted({ brandId: ops.brandId, postId: other.postIds[0], actor: emailActor() }, { now: NOW });
    expect(cross).toMatchObject({ ok: false, code: "not_found" });
    const stranger = await markPosted({ brandId: other.brandId, postId: other.postIds[0], actor: dashActor(outsider) }, { now: NOW });
    expect(stranger).toMatchObject({ ok: false, code: "forbidden" });
    expect(await statusOf(other.postIds[0])).toBe("approved");
  });
});

describe("Not posted yet (undo within 24 hours)", () => {
  it("goes back to approved within a day, and is refused after that", async () => {
    const [a, b] = [ops.postIds[0], ops.postIds[1]];
    await approve(a);
    await approve(b);
    await markPosted(refOf(ops, 0, emailActor()), { now: NOW });
    await markPosted(refOf(ops, 1, dashActor(ops.userId)), { now: NOW });

    const soon = await unmarkPosted(refOf(ops, 0, emailActor("jti-undo")), { now: new Date(NOW.getTime() + 23 * 3600 * 1000) });
    expect(soon).toMatchObject({ ok: true, changed: true });
    const row = await postRow(db, a);
    expect(row.status).toBe("approved");
    expect(row.posted_at).toBeNull();
    expect(row.approved_at).not.toBeNull();
    expect((await actionsOf(db, a)).at(-1)).toMatchObject({ action: "undo", via: "email_link", detail: { from: "posted" } });

    const late = await unmarkPosted(refOf(ops, 1, dashActor(ops.userId)), { now: new Date(NOW.getTime() + 25 * 3600 * 1000) });
    expect(late).toMatchObject({ ok: false, code: "too_late", message: s.share.errors.tooLate });
    expect(await statusOf(b)).toBe("posted");
  });

  it("an approved post is a no-op, a draft or skipped one is refused", async () => {
    const [a, b, c] = [ops.postIds[0], ops.postIds[2], ops.postIds[3]];
    await approve(a);
    await draft(b);
    await skip(c);
    expect(await unmarkPosted(refOf(ops, 0, emailActor()), { now: NOW })).toMatchObject({ ok: true, changed: false });
    expect(await unmarkPosted(refOf(ops, 2, emailActor()), { now: NOW })).toMatchObject({ ok: false, code: "not_approved" });
    expect(await unmarkPosted(refOf(ops, 3, emailActor()), { now: NOW })).toMatchObject({ ok: false, code: "not_approved" });
  });
});

describe("logging a share or download", () => {
  it("writes share and download rows for both actors, with the format and story flag", async () => {
    const id = ops.postIds[0];
    await approve(id);
    const before = (await actionsOf(db, id)).length;
    expect(await logShare({ ...refOf(ops, 0, emailActor("jti-share")), format: "square" })).toMatchObject({ ok: true });
    expect(await logShare({ ...refOf(ops, 0, dashActor(ops.userId)), format: "vertical", story: true })).toMatchObject({ ok: true });
    expect(await logDownload({ ...refOf(ops, 0, emailActor("jti-dl")), format: "landscape" })).toMatchObject({ ok: true });
    expect(await logDownload({ ...refOf(ops, 0, dashActor(ops.userId)), format: "bogus" })).toMatchObject({ ok: true });
    const rows = (await actionsOf(db, id)).slice(before);
    expect(rows.map((r) => `${r.action}:${r.via}`)).toEqual(["share:email_link", "share:dashboard", "download:email_link", "download:dashboard"]);
    expect(rows[0].detail).toMatchObject({ format: "square", jti_hash: expect.any(String) });
    expect(rows[1]).toMatchObject({ user_id: ops.userId, detail: { format: "vertical", story: true } });
    expect(rows[2].detail).toMatchObject({ format: "landscape" });
    expect(rows[3].detail).toEqual({}); // an unknown format is not stored
  });

  it("refuses a draft or skipped post, for both actors", async () => {
    await draft(ops.postIds[2]);
    await skip(ops.postIds[3]);
    for (const i of [2, 3]) {
      for (const actor of [emailActor(), dashActor(ops.userId)]) {
        expect(await logShare({ ...refOf(ops, i, actor), format: "square" })).toMatchObject({ ok: false, code: "not_approved" });
        expect(await logDownload({ ...refOf(ops, i, actor), format: "square" })).toMatchObject({ ok: false, code: "not_approved" });
      }
      expect(await actionNames(ops.postIds[i])).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// The emailed "ready" page
// ---------------------------------------------------------------------------------------------

const readyToken = (w: FreshWeek, postId?: string) => signLink({ brandId: w.brandId, postId, act: "ready", weekStart: WEEK });
const getPage = async (token: string) => {
  const res = await openLink(token);
  return { res, html: await res.text() };
};
async function press(token: string, fields: Record<string, string>) {
  const got = await openLink(token);
  const cookie = cookieOf(got);
  const html = await got.text();
  const res = await pressLink(token, { nonce: nonceOf(html), ...fields }, cookie);
  return { res, html: await res.text() };
}

describe("the ready page", () => {
  it("shows Share, Download, Copy and Mark as posted for approved posts only", async () => {
    await draft(ready.postIds[0]);
    await approve(ready.postIds[0]);
    await draft(ready.postIds[1]);
    await skip(ready.postIds[2]);
    await draft(ready.postIds[3]);
    const { res, html } = await getPage(await readyToken(ready));
    expect(res.status).toBe(200);
    expect(html.match(/<div data-share-root/g)).toHaveLength(1);
    expect(html).toContain(`data-post="${ready.postIds[0]}"`);
    for (const id of ready.postIds.slice(1)) expect(html).not.toContain(id);
    expect(html).toContain(s.share.share);
    expect(html).toContain(s.share.shareStory);
    expect(html).toContain(s.share.copyCaption);
    expect(html).toContain(s.share.markPosted);
    expect(html).toContain(s.share.iosHint);
    expect(html).toContain(s.share.textToPaste);
    // H-11: without JavaScript the Share buttons stay hidden, and no failure message is sitting in the page as hidden text.
    expect(html).toContain("<div hidden data-needs-share>");
    expect(html).toContain("<div data-no-share>");
    const markup = html.replace(/<script>[\s\S]*<\/script>/, "");
    for (const msg of [s.share.shareFailed, s.share.imageFailed, s.share.tapAgain, s.share.copyFailed]) expect(markup).not.toContain(msg.slice(0, 15));
    // One mark-as-posted form for the one approved post, and the no-JS download links.
    expect(html.match(/name="op" value="posted"/g)).toHaveLength(1);
    expect(html.match(/<a href="\/i\/[^"]+" download=/g)).toHaveLength(3);
    expect(html).toMatch(/download="instagram-square\.png"/);
    expect(html).toMatch(/download="instagram-vertical\.png"/);
    expect(html).toMatch(/download="instagram-landscape\.png"/);
  });

  it("uses the format for the channel: landscape for LinkedIn and Google Business Profile, square for Facebook; story is vertical", async () => {
    const channels = (await db.withAdmin((tx) => tx.query<{ id: string; channel: string }>("select id::text as id, channel::text as channel from public.posts where brand_id = $1", [ready.brandId])));
    const by = Object.fromEntries(channels.map((c) => [c.channel, c.id]));
    for (const id of Object.values(by)) await approve(id);
    const { html } = await getPage(await readyToken(ready));
    const block = (id: string) => html.split("data-share-root").find((b) => b.includes(`data-post="${id}"`)) ?? "";
    const mainBtn = (b: string) => /data-share-btn data-url="[^"]+" data-filename="([\w-]+\.png)" data-format="(\w+)" data-default="1"/.exec(b);
    expect(mainBtn(block(by.facebook))?.slice(1)).toEqual(["facebook-square.png", "square"]);
    expect(mainBtn(block(by.linkedin))?.slice(1)).toEqual(["linkedin-landscape.png", "landscape"]);
    expect(mainBtn(block(by.gbp))?.slice(1)).toEqual(["gbp-landscape.png", "landscape"]);
    expect(mainBtn(block(by.instagram))?.slice(1)).toEqual(["instagram-square.png", "square"]);
    // "Share as story or status" is the vertical picture, with the story flag.
    expect(block(by.linkedin)).toMatch(/data-filename="linkedin-vertical\.png" data-format="vertical" data-story="1"/);
  });

  it("the share text is the composed caption, with the short link where the channel allows it", async () => {
    const [fb] = await db.withAdmin((tx) => tx.query<{ id: string; post_code: string; caption: string }>("select id::text as id, post_code, caption from public.posts where brand_id = $1 and channel = 'facebook'", [ready.brandId]));
    await approve(fb.id);
    const { html } = await getPage(await readyToken(ready));
    const text = new RegExp(`data-post="${fb.id}" data-text="([^"]*)"`).exec(html)![1].replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
    expect(text.startsWith(fb.caption.trim())).toBe(true);
    expect(text).toContain(`/r/${fb.post_code}`);
  });

  it("serves the full-size picture to the signed link, as a PNG of the right size", async () => {
    await approve(ready.postIds[0]);
    const { html } = await getPage(await readyToken(ready));
    const block = html.split("data-share-root").find((b) => b.includes(`data-post="${ready.postIds[0]}"`))!;
    const sq = /data-url="(\/i\/[\w.-]+)"[^>]*data-format="square"/.exec(block)![1];
    const vt = /data-url="(\/i\/[\w.-]+)"[^>]*data-format="vertical"/.exec(block)![1];
    const lookup = async (url: string) => serveEmailImage({ token: url.slice(3), storage: store.storage });
    const a = await lookup(sq);
    expect(a.status).toBe(200);
    expect(a.headers.get("content-type")).toBe("image/png");
    const meta = await sharp(Buffer.from(await a.arrayBuffer())).metadata();
    expect([meta.width, meta.height]).toEqual([FORMAT_SIZE.square.w, FORMAT_SIZE.square.h]);
    const b = await lookup(vt);
    const metaV = await sharp(Buffer.from(await b.arrayBuffer())).metadata();
    expect(metaV.height!).toBeGreaterThan(metaV.width!);
    // The same URL is same-origin (a relative path), so the page can fetch() it.
    expect(sq.startsWith("/i/")).toBe(true);
  });

  it("will not serve a full-size picture of a draft or skipped post", async () => {
    await draft(ready.postIds[1]);
    const tok = await signLink({ brandId: ready.brandId, postId: ready.postIds[1], act: "img", extra: { format: "square", full: true } });
    expect((await serveEmailImage({ token: tok, storage: store.storage })).status).toBe(404);
    await skip(ready.postIds[1]);
    expect((await serveEmailImage({ token: tok, storage: store.storage })).status).toBe(404);
    // The small email picture is still served: it is what the weekly email shows.
    const small = await signLink({ brandId: ready.brandId, postId: ready.postIds[1], act: "img", extra: { format: "square" } });
    expect((await serveEmailImage({ token: small, storage: store.storage })).status).toBe(200);
  });

  it("carries its script by hash, with same-origin fetch, and only when there is something to share", async () => {
    await approve(ready.postIds[0]);
    const res = await openLink(await readyToken(ready));
    const html = await res.text();
    const csp = res.headers.get("content-security-policy")!;
    expect(csp).toMatch(/script-src 'sha256-[A-Za-z0-9+/=]+'/);
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("default-src 'none'");
    const script = /<script>([\s\S]*?)<\/script>/.exec(html)![1];
    expect(pageCsp({ title: "", body: "", script })).toBe(csp);
    expect(html.match(/<script/g)).toHaveLength(1);

    for (const id of ready.postIds) await draft(id);
    const empty = await openLink(await readyToken(ready));
    expect(empty.headers.get("content-security-policy")).toBe(PAGE_CSP);
    expect(await empty.text()).not.toContain("<script");
  });

  it("opening the page logs nothing and changes nothing", async () => {
    await approve(ready.postIds[0]);
    const before = (await actionsOf(db, ready.postIds[0])).length;
    await getPage(await readyToken(ready));
    await getPage(await readyToken(ready));
    expect((await actionsOf(db, ready.postIds[0])).length).toBe(before);
    expect(await statusOf(ready.postIds[0])).toBe("approved");
  });

  it("Mark as posted works from the page (a POST), logs the link, and shows Posted on {date} with Not posted yet", async () => {
    await approve(ready.postIds[0]);
    const before = (await actionsOf(db, ready.postIds[0])).length;
    const tok = await readyToken(ready);
    const r = await press(tok, { op: "posted", post: ready.postIds[0] });
    expect(r.res.status).toBe(200);
    expect(r.html).toContain(s.share.markedPosted);
    expect(r.html).toMatch(/Posted on \d+ \w{3}/);
    expect(r.html).toContain(s.share.unmarkPosted);
    expect(r.html).not.toContain("data-share-root");
    expect(await statusOf(ready.postIds[0])).toBe("posted");
    const log = (await actionsOf(db, ready.postIds[0])).slice(before);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ action: "posted", via: "email_link", user_id: null });
    const claims = (await verifyLink(tok))!;
    expect(JSON.stringify(log[0].detail)).not.toContain(claims.jti);

    // Not posted yet (within a day) puts it back to approved.
    const undo = await press(tok, { op: "unposted", post: ready.postIds[0] });
    expect(undo.html).toContain(s.share.unmarked);
    expect(await statusOf(ready.postIds[0])).toBe("approved");
    expect(undo.html).toContain("data-share-root");
  });

  it("after a day the page no longer offers Not posted yet, and the server refuses it", async () => {
    await approve(ready.postIds[0]);
    await approve(ready.postIds[1]); // keeps a form (and its nonce) on the page
    await setPost(db, ready.postIds[0], "status = 'posted', posted_at = now() - interval '3 days'");
    const tok = await readyToken(ready);
    const { html } = await getPage(tok);
    expect(html).toMatch(/Posted on/);
    expect(html).not.toContain(s.share.unmarkPosted);
    const r = await press(tok, { op: "unposted", post: ready.postIds[0] });
    expect(r.html).toContain(s.share.errors.tooLate);
    expect(await statusOf(ready.postIds[0])).toBe("posted");
  });

  it("will not mark a draft, a skipped post, or another brand's post", async () => {
    await draft(ready.postIds[1]);
    await skip(ready.postIds[2]);
    await approve(other.postIds[1]);
    await approve(ready.postIds[0]);
    const tok = await readyToken(ready);
    expect((await press(tok, { op: "posted", post: ready.postIds[1] })).html).toContain(s.share.errors.notApproved);
    expect((await press(tok, { op: "posted", post: ready.postIds[2] })).html).toContain(s.share.errors.notApproved);
    expect((await press(tok, { op: "posted", post: other.postIds[1] })).html).toContain(s.approvals.errors.notFound);
    expect((await press(tok, { op: "posted", post: "not-an-id" })).html).toContain(s.approvals.errors.notFound);
    expect(await statusOf(ready.postIds[1])).toBe("draft");
    expect(await statusOf(ready.postIds[2])).toBe("skipped");
    expect(await statusOf(other.postIds[1])).toBe("approved");
  });

  it("the page's log request records a share or download once, with format and story; drafts and bad kinds are refused", async () => {
    await approve(ready.postIds[0]);
    await draft(ready.postIds[1]);
    const id = ready.postIds[0];
    const tok = await readyToken(ready);
    const before = (await actionsOf(db, id)).length;
    const share = await press(tok, { op: "log", kind: "share", post: id, format: "vertical", story: "1" });
    expect(share.res.status).toBe(200);
    const dl = await press(tok, { op: "log", kind: "download", post: id, format: "square" });
    expect(dl.res.status).toBe(200);
    const rows = (await actionsOf(db, id)).slice(before);
    expect(rows.map((r) => r.action)).toEqual(["share", "download"]);
    expect(rows[0]).toMatchObject({ via: "email_link", user_id: null, detail: { format: "vertical", story: true } });
    expect(rows[1].detail).toMatchObject({ format: "square" });

    expect((await press(tok, { op: "log", kind: "share", post: ready.postIds[1], format: "square" })).res.status).toBe(400);
    expect((await press(tok, { op: "log", kind: "copy", post: id })).res.status).toBe(400);
    expect(await actionNames(ready.postIds[1])).toEqual([]);
    expect((await actionsOf(db, id)).length).toBe(before + 2);
  });

  it("a POST without the page's nonce does nothing", async () => {
    await approve(ready.postIds[0]);
    const res = await pressLink(await readyToken(ready), { nonce: "wrong", op: "posted", post: ready.postIds[0] });
    expect(res.status).toBe(403);
    expect(await statusOf(ready.postIds[0])).toBe("approved");
  });
});

// ---------------------------------------------------------------------------------------------
// The dashboard
// ---------------------------------------------------------------------------------------------

const html = (v: Awaited<ReturnType<typeof loadWeekView>>) => renderToString(createElement(WeekView, { initial: v }));

describe("the /week cards", () => {
  const cards = (out: string) => out.split("data-post-id=").slice(1);

  it("show Download, Copy and Mark as posted for approved posts only, and a Posted chip with the date for posted ones", async () => {
    await approve(dash.postIds[0]);
    await draft(dash.postIds[1]);
    await skip(dash.postIds[2]);
    await approve(dash.postIds[3]);
    await markPosted(refOf(dash, 3, dashActor(dash.userId)), { now: new Date() });
    const view = await loadWeekView(dash.userId, dash.brandId, WEEK);
    const out = html(view);
    const byId = (id: string) => cards(out).find((c) => c.startsWith(`"${id}"`)) ?? "";
    const approved = byId(dash.postIds[0]);
    // On the server (before the browser can tell whether it can share a picture) the Download links show.
    expect(approved).toContain(s.share.markPosted);
    expect(approved).toContain(s.share.copyCaption);
    expect(approved).toContain(s.share.downloadFormat.square);
    expect(approved).toContain(s.share.downloadFormat.vertical);
    expect(approved).toContain(s.share.downloadFormat.landscape);
    expect(approved).toMatch(/download="instagram-square\.png"/);
    expect(approved).toMatch(/href="\/api\/files\/renders\/[\w-]+\/[\w-]+\/square\.png"/);
    for (const id of [dash.postIds[1], dash.postIds[2]]) {
      const c = byId(id);
      expect(c).not.toBe("");
      expect(c).not.toContain(s.share.markPosted);
      expect(c).not.toContain(s.share.copyCaption);
      expect(c).not.toContain("Download");
    }
    const posted = byId(dash.postIds[3]);
    expect(posted).toMatch(/Posted on \d+ \w{3}/);
    expect(posted).not.toContain(s.share.markPosted);
    expect(posted).not.toContain(s.share.copyCaption);
    expect(posted).toContain(s.share.unmarkPosted);
    expect(out.match(new RegExp(s.share.markPosted, "g"))).toHaveLength(1);
  });

  it("the week view carries pictures per format, the share text and the posted day", async () => {
    const view = await loadWeekView(dash.userId, dash.brandId, WEEK);
    const p = view.posts.find((x) => x.id === dash.postIds[3])!;
    expect(Object.keys(p.images).sort()).toEqual(["landscape", "square", "vertical"]);
    expect(p.images.vertical).toMatch(/^\/api\/files\/renders\/.+vertical\.png$/);
    expect(p.postedAt).not.toBeNull();
    expect(p.postedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const fb = view.posts.find((x) => x.channel === "facebook")!;
    expect(fb.shareText).toContain(fb.fullCaption.trim());
    expect(fb.shareText).toContain("/r/");
    expect(fb.shareText).toContain(fb.hashtags[0]);
  });

  it("Mark as posted, Not posted yet and the share log work from the dashboard, as the signed-in user", async () => {
    await signIn(dash.userId);
    const id = dash.postIds[0];
    await approve(id);
    const posted = await markPostedAction(WEEK, id);
    expect(posted.ok && posted.view.posts.find((p) => p.id === id)?.status).toBe("posted");
    expect((await actionsOf(db, id)).at(-1)).toMatchObject({ action: "posted", via: "dashboard", user_id: dash.userId });
    const undone = await unmarkPostedAction(WEEK, id);
    expect(undone.ok && undone.view.posts.find((p) => p.id === id)?.status).toBe("approved");

    expect(await logShareAction(id, "share", "square", false)).toEqual({ ok: true });
    expect(await logShareAction(id, "download", "vertical")).toEqual({ ok: true });
    const last = (await actionsOf(db, id)).slice(-2);
    expect(last.map((a) => a.action)).toEqual(["share", "download"]);
    expect(last[0]).toMatchObject({ via: "dashboard", user_id: dash.userId, detail: { format: "square" } });

    // A draft cannot be shared or marked.
    expect(await logShareAction(dash.postIds[1], "share", "square")).toEqual({ ok: false });
    expect(await markPostedAction(WEEK, dash.postIds[1])).toMatchObject({ ok: false, message: s.share.errors.notApproved });
  });

  it("refuses a signed-out visitor and a user of another brand", async () => {
    await approve(dash.postIds[0]);
    await signIn(null);
    expect(await markPostedAction(WEEK, dash.postIds[0])).toMatchObject({ ok: false });
    expect(await logShareAction(dash.postIds[0], "share", "square")).toEqual({ ok: false });
    await signIn(outsider);
    expect(await markPostedAction(WEEK, dash.postIds[0])).toMatchObject({ ok: false, message: s.approvals.errors.notFound });
    expect(await logShareAction(dash.postIds[0], "share", "square")).toEqual({ ok: false });
    expect(await statusOf(dash.postIds[0])).toBe("approved");
  });
});
