import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup, renderToString } from "react-dom/server";
import { NextRequest } from "next/server";
import { SignJWT, decodeJwt } from "jose";

const jar = vi.hoisted(() => {
  const store = new Map<string, { value: string; options?: Record<string, unknown> }>();
  return {
    store,
    api: {
      get: (name: string) => (store.has(name) ? { name, value: store.get(name)!.value } : undefined),
      set: (name: string, value: string, options?: Record<string, unknown>) => void store.set(name, { value, options }),
      delete: (name: string) => void store.delete(name),
    },
  };
});
vi.mock("next/headers", () => ({ cookies: async () => jar.api }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined, push: () => undefined }) }));

const holder = vi.hoisted(() => ({ storage: null as import("@/lib/storage").Storage | null }));
vi.mock("@/lib/storage", async (orig) => ({
  ...(await orig<typeof import("@/lib/storage")>()),
  getStorage: () => holder.storage!,
}));

import { requestAccountDeletionAction } from "@/app/(app)/brand/account-actions";
import { GET, POST } from "@/app/account/delete/route";
import { GET as exportGET } from "@/app/api/account/export/route";
import DeletedPage from "@/app/account/deleted/page";
import TermsPage from "@/app/terms/page";
import LoginPage from "@/app/(auth)/login/page";
import { AccountPanel } from "@/components/account/account-panel";
import { DELETE_LINK_TTL_SECONDS, DELETE_CSRF_COOKIE, claimDeleteLink, deleteNonce, isDeleteLinkUnused, registerDeleteLink, signDeleteToken, verifyDeleteToken } from "@/lib/account/delete-link";
import { DELETE_EMAILS_PER_HOUR, namesMatch } from "@/lib/account/request-delete";
import { resetRateLimits } from "@/lib/auth/rate-limit";
import { isPublicPath } from "@/lib/auth/public-paths";
import { signMagicToken, verifyMagicToken } from "@/lib/auth/magic-link";
import { newCsrfSecret } from "@/lib/auth/continue";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/session";
import { signSession } from "../helpers/session";
import { createMockDb, setMockDbForTests, type MockDb } from "@/lib/db/mock";
import { linksIn, listOutbox, setOutboxDirForTests } from "@/lib/email/outbox";
import { HOLIDAY_DATA_ATTRIBUTION } from "@/lib/occasions";
import { createMockStorage } from "@/lib/storage/mock";
import type { Storage } from "@/lib/storage";
import { proxy } from "@/proxy";
import { collect, parseZip } from "./zip-read";
import { accountRowCounts, authUserExists, newUser } from "./helpers";
import { filesUnder, seedAccount, type SeededAccount } from "./seed";

let db: MockDb;
let root: string;
let outbox: string;
let storage: Storage;

const BASE = "http://localhost:3000/account/delete";

beforeAll(async () => {
  db = await createMockDb();
  setMockDbForTests(db);
});
afterAll(async () => {
  setMockDbForTests(null);
  await db.close();
});
beforeEach(async () => {
  jar.store.clear();
  resetRateLimits();
  root = await mkdtemp(path.join(os.tmpdir(), "pm-delflow-"));
  outbox = await mkdtemp(path.join(os.tmpdir(), "pm-outbox-"));
  storage = createMockStorage(root);
  holder.storage = storage;
  setOutboxDirForTests(outbox);
});
afterEach(async () => {
  setOutboxDirForTests(null);
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
  await rm(outbox, { recursive: true, force: true });
});

async function signIn(a: { userId: string; email: string }) {
  jar.store.set(SESSION_COOKIE, { value: await signSession({ id: a.userId, email: a.email }) });
}

/** A delete link as it would be emailed: signed and registered. */
async function issue(a: { userId: string; email: string }, nowMs = Date.now()) {
  const t = await signDeleteToken({ id: a.userId, email: a.email }, nowMs);
  await registerDeleteLink(t.jti, t.expiresAt);
  return t;
}

const open = (token?: string, cookies = "") =>
  GET(new NextRequest(`${BASE}${token === undefined ? "" : `?token=${encodeURIComponent(token)}`}`, { headers: cookies ? { cookie: cookies } : {} }));

const press = (fields: { token?: string; nonce?: string; name?: string }, cookies = "") => {
  const body = new URLSearchParams();
  if (fields.token !== undefined) body.set("token", fields.token);
  if (fields.nonce !== undefined) body.set("nonce", fields.nonce);
  if (fields.name !== undefined) body.set("confirm_name", fields.name);
  return POST(
    new NextRequest(BASE, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", ...(cookies ? { cookie: cookies } : {}) }, body }),
  );
};

/** Opens the link like the owner's browser: returns the form's nonce and the CSRF cookie header. */
async function browser(token: string, existing?: string) {
  const res = await open(token, existing ? `${DELETE_CSRF_COOKIE}=${existing}` : "");
  expect(res.status).toBe(200);
  const html = await res.text();
  const secret = res.cookies.get(DELETE_CSRF_COOKIE)?.value ?? existing!;
  return { res, html, secret, cookie: `${DELETE_CSRF_COOKIE}=${secret}`, nonce: /name="nonce" value="([^"]+)"/.exec(html)![1] };
}

const withSession = async (a: { userId: string; email: string }, cookie: string) =>
  `${cookie}; ${SESSION_COOKIE}=${await signSession({ id: a.userId, email: a.email })}`;

const exists = (a: SeededAccount) => authUserExists(db, a.userId);
const location = (res: Response) => new URL(res.headers.get("location")!).pathname;

describe("asking for the delete email", () => {
  it("emails a single-use link to the account's address and deletes nothing yet", async () => {
    const a = await seedAccount(db, storage);
    await signIn(a);
    expect(await requestAccountDeletionAction()).toEqual({ ok: true, email: a.email });

    const [mail] = await listOutbox(1);
    expect(mail).toMatchObject({ to: a.email, kind: "account_delete", userId: a.userId });
    expect(mail.subject).toContain("delete your Weekly Posts account");
    const link = new URL(linksIn(mail.text)[0]);
    expect(link.pathname).toBe("/account/delete");
    const token = link.searchParams.get("token")!;

    // Logged with kind account_delete.
    const log = await db.withAdmin((tx) => tx.query<{ kind: string; status: string }>("select kind, status from public.email_log where user_id = $1 and subject like '%delete your Weekly Posts%'", [a.userId]));
    expect(log).toEqual([{ kind: "account_delete", status: "sent" }]);

    // The token: purpose delete_account, the user id, one hour. No `sub`, so it can never be a session.
    const payload = (await verifyDeleteToken(token))!;
    expect(payload.uid).toBe(a.userId);
    const claims = decodeJwt(token);
    expect(claims.purpose).toBe("delete_account");
    expect(claims.sub).toBeUndefined();
    expect(claims.exp! - claims.iat!).toBe(DELETE_LINK_TTL_SECONDS);
    expect(DELETE_LINK_TTL_SECONDS).toBe(3600);
    expect(await verifySession(token)).toBeNull();
    expect(await verifyMagicToken(token)).toBeNull();

    expect(await exists(a)).toBe(true);
    expect((await accountRowCounts(db, a)).posts).toBeGreaterThan(0);
  });

  it("needs a signed-in user, an email address, and is limited per hour", async () => {
    expect(await requestAccountDeletionAction()).toEqual({ ok: false, error: "signed_out" });

    const a = await seedAccount(db, storage);
    await signIn(a);
    for (let i = 0; i < DELETE_EMAILS_PER_HOUR; i++) expect((await requestAccountDeletionAction()).ok).toBe(true);
    expect(await requestAccountDeletionAction()).toEqual({ ok: false, error: "rate_limited" });

    const phoneOnly = await db.withAdmin(async (tx) => {
      const [u] = await tx.query<{ id: string }>("insert into auth.users (phone) values ('+919800099999') returning id");
      await tx.query("insert into public.profiles (id, phone, consent_at) values ($1, '+919800099999', now())", [u.id]);
      return u.id;
    });
    const { requestAccountDeletion } = await import("@/lib/account/request-delete");
    await expect(requestAccountDeletion({ id: phoneOnly, email: null })).rejects.toMatchObject({ code: "no_email" });
  });

  it("a sign-in token is no good here, and a delete token is no good for sign-in", async () => {
    const a = await seedAccount(db, storage);
    const magic = await signMagicToken(a.email);
    expect(await verifyDeleteToken(magic.token)).toBeNull();
    const session = await signSession({ id: a.userId, email: a.email });
    expect(await verifyDeleteToken(session)).toBeNull();
    // A delete-shaped token signed with another key.
    const forged = await new SignJWT({ uid: a.userId, email: a.email, purpose: "delete_account" })
      .setProtectedHeader({ alg: "HS256" }).setJti("x").setExpirationTime("1h").sign(new TextEncoder().encode("another-secret-another-secret-123456"));
    expect(await verifyDeleteToken(forged)).toBeNull();
  });
});

describe("/account/delete: GET shows, POST deletes", () => {
  it("GET shows the confirmation and changes nothing, even when opened twice by a mail scanner", async () => {
    const a = await seedAccount(db, storage, { name: "Corner Bakery" });
    const t = await issue(a);
    const before = await accountRowCounts(db, a);

    const first = await browser(t.token);
    await open(t.token); // a scanner, no cookies
    await browser(t.token, first.secret);
    expect(first.html).toContain("Delete everything?");
    expect(first.html).toContain("This can&#39;t be undone.");
    expect(first.html).toContain("Type your business name to confirm");
    expect(first.html).toContain("Corner Bakery");
    expect(first.html).toContain('<form method="post" action="/account/delete">');
    expect(first.html).not.toContain("<script");
    expect(first.res.headers.get("cache-control")).toBe("no-store");
    expect(first.res.headers.get("x-frame-options")).toBe("DENY");
    expect(first.res.cookies.get(DELETE_CSRF_COOKIE)).toMatchObject({ httpOnly: true, path: "/account/delete" });

    expect(await exists(a)).toBe(true);
    expect(await accountRowCounts(db, a)).toEqual(before);
    expect(await isDeleteLinkUnused(t.jti)).toBe(true);
    expect((await filesUnder(storage, a.brandId)).length).toBe(a.files.length);
  });

  it("POST with the right business name deletes everything, signs out, and the link cannot be used again", async () => {
    const a = await seedAccount(db, storage, { name: "Corner Bakery" });
    const b = await seedAccount(db, storage);
    const beforeB = await accountRowCounts(db, b);
    await signIn(a);
    const t = await issue(a);
    const b1 = await browser(t.token);

    // Case and spacing do not matter.
    const res = await press({ token: t.token, nonce: b1.nonce, name: "  corner   BAKERY " }, await withSession(a, b1.cookie));
    expect(res.status).toBe(303);
    expect(location(res)).toBe("/account/deleted");
    expect(res.headers.get("location")).not.toContain("token");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");

    expect(await exists(a)).toBe(false);
    expect((await accountRowCounts(db, a)).brands).toBe(0);
    expect(await filesUnder(storage, a.brandId)).toEqual([]);
    expect(jar.store.has(SESSION_COOKIE)).toBe(false); // signed out
    expect(await accountRowCounts(db, b)).toEqual(beforeB);

    // Single use, on POST and on GET.
    const again = await press({ token: t.token, nonce: b1.nonce, name: "Corner Bakery" }, b1.cookie);
    expect(again.status).toBe(410);
    expect((await open(t.token)).status).toBe(410);
  });

  it("does not sign out a browser that is signed in as someone else", async () => {
    const a = await seedAccount(db, storage, { name: "Corner Bakery" });
    const other = await newUser(db, "someone-else@example.com");
    await signIn({ userId: other, email: "someone-else@example.com" });
    const t = await issue(a);
    const b1 = await browser(t.token);
    const res = await press({ token: t.token, nonce: b1.nonce, name: "Corner Bakery" }, await withSession({ userId: other, email: "someone-else@example.com" }, b1.cookie));
    expect(res.status).toBe(303);
    expect(jar.store.has(SESSION_COOKIE)).toBe(true);
    expect(await exists(a)).toBe(false);
  });

  it("needs the business name: a wrong or empty name deletes nothing and keeps the link", async () => {
    const a = await seedAccount(db, storage, { name: "Corner Bakery" });
    const t = await issue(a);
    const b1 = await browser(t.token);
    const before = await accountRowCounts(db, a);
    for (const name of ["", "Corner", "Other Bakery", "Corner Bakery 2", "   "]) {
      const res = await press({ token: t.token, nonce: b1.nonce, name }, b1.cookie);
      expect(res.status).toBe(422);
      expect(await res.text()).toContain("That is not your business name");
    }
    expect(await press({ token: t.token, nonce: b1.nonce }, b1.cookie).then((r) => r.status)).toBe(422); // field missing
    expect(await exists(a)).toBe(true);
    expect(await accountRowCounts(db, a)).toEqual(before);
    expect(await isDeleteLinkUnused(t.jti)).toBe(true);
    expect((await press({ token: t.token, nonce: b1.nonce, name: "Corner Bakery" }, b1.cookie)).status).toBe(303);
  });

  it("an account without a business is confirmed by its email address", async () => {
    const email = "nobiz@example.com";
    const userId = await newUser(db, email);
    const t = await issue({ userId, email });
    const b1 = await browser(t.token);
    expect(b1.html).toContain(email);
    expect((await press({ token: t.token, nonce: b1.nonce, name: "nobiz" }, b1.cookie)).status).toBe(422);
    expect((await press({ token: t.token, nonce: b1.nonce, name: email }, b1.cookie)).status).toBe(303);
    expect(await authUserExists(db, userId)).toBe(false);
  });

  it("expires after one hour", async () => {
    const a = await seedAccount(db, storage, { name: "Corner Bakery" });
    const old = await issue(a, Date.now() - (DELETE_LINK_TTL_SECONDS + 60) * 1000);
    expect((await open(old.token)).status).toBe(410);
    const secret = newCsrfSecret();
    const res = await press({ token: old.token, nonce: deleteNonce(old.jti, secret), name: "Corner Bakery" }, `${DELETE_CSRF_COOKIE}=${secret}`);
    expect(res.status).toBe(410);
    expect(await exists(a)).toBe(true);

    // Just inside the hour still works.
    const fresh = await issue(a, Date.now() - (DELETE_LINK_TTL_SECONDS - 120) * 1000);
    expect((await open(fresh.token)).status).toBe(200);
  });

  it("refuses a missing, garbage, forged or never-issued token", async () => {
    const a = await seedAccount(db, storage, { name: "Corner Bakery" });
    for (const tkn of [undefined, "", "garbage", "a.b.c"]) {
      expect((await open(tkn)).status).toBe(410);
      expect((await press({ token: tkn, nonce: "n", name: "Corner Bakery" }, `${DELETE_CSRF_COOKIE}=${newCsrfSecret()}`)).status).toBe(410);
    }
    // Properly signed but never registered (for example, the store was wiped).
    const unregistered = await signDeleteToken({ id: a.userId, email: a.email });
    expect((await open(unregistered.token)).status).toBe(410);
    expect(await exists(a)).toBe(true);
  });

  it("CSRF: a POST from another site (no cookie, or no or wrong nonce) is refused before the link is used", async () => {
    const a = await seedAccount(db, storage, { name: "Corner Bakery" });
    const t = await issue(a);
    const b1 = await browser(t.token);
    const attempts = [
      press({ token: t.token, nonce: b1.nonce, name: "Corner Bakery" }), // right nonce, but a cross-site POST has no cookie
      press({ token: t.token, name: "Corner Bakery" }, b1.cookie), // no nonce
      press({ token: t.token, nonce: "x".repeat(43), name: "Corner Bakery" }, b1.cookie),
      press({ token: t.token, nonce: deleteNonce(t.jti, newCsrfSecret()), name: "Corner Bakery" }, b1.cookie), // nonce for another cookie
    ];
    for (const attempt of attempts) expect((await attempt).status).toBe(410);
    expect(await exists(a)).toBe(true);
    expect(await isDeleteLinkUnused(t.jti)).toBe(true);
    expect((await press({ token: t.token, nonce: b1.nonce, name: "Corner Bakery" }, b1.cookie)).status).toBe(303);
  });

  it("two clicks at once: only one wins the link", async () => {
    const a = await seedAccount(db, storage);
    const t = await issue(a);
    expect(await claimDeleteLink(t.jti)).toBe(true);
    expect(await claimDeleteLink(t.jti)).toBe(false);
  });

  it("if deleting fails, it says so, keeps the data, and the same link works for a retry", async () => {
    const a = await seedAccount(db, storage, { name: "Corner Bakery" });
    const before = await accountRowCounts(db, a);
    const t = await issue(a);
    const b1 = await browser(t.token);

    holder.storage = { ...storage, removePrefix: async () => { throw new Error("storage is down"); } };
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const failed = await press({ token: t.token, nonce: b1.nonce, name: "Corner Bakery" }, b1.cookie);
    expect(failed.status).toBe(500);
    expect(await failed.text()).toContain("We could not finish deleting");
    expect(await exists(a)).toBe(true);
    expect(await accountRowCounts(db, a)).toEqual(before);
    expect(await isDeleteLinkUnused(t.jti)).toBe(true);

    holder.storage = storage;
    expect((await press({ token: t.token, nonce: b1.nonce, name: "Corner Bakery" }, b1.cookie)).status).toBe(303);
    expect(await exists(a)).toBe(false);
    expect(await filesUnder(storage, a.brandId)).toEqual([]);
  });

  it("is reachable without signing in; the export is not", async () => {
    expect(isPublicPath("/account/delete")).toBe(true);
    expect(isPublicPath("/account/deleted")).toBe(true);
    expect(isPublicPath("/account/other")).toBe(false);
    expect(isPublicPath("/api/account/export")).toBe(false);
    const res = await proxy(new NextRequest("http://localhost:3000/api/account/export"));
    expect(res.status).toBe(401);
  });

  it("namesMatch ignores case and spaces only", () => {
    expect(namesMatch(" Shri  Ram Sweets ", "shri ram sweets")).toBe(true);
    expect(namesMatch("श्री राम स्वीट्स", "श्री  राम स्वीट्स")).toBe(true);
    expect(namesMatch("", "")).toBe(false);
    expect(namesMatch("Ram", "Shri Ram")).toBe(false);
  });
});

describe("GET /api/account/export", () => {
  it("answers 401 when signed out", async () => {
    expect((await exportGET()).status).toBe(401);
  });

  it("streams a valid ZIP as an attachment for the signed-in owner", async () => {
    const a = await seedAccount(db, storage);
    await signIn(a);
    const res = await exportGET();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/zip");
    expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename="weekly-posts-export-\d{4}-\d{2}-\d{2}\.zip"$/);
    expect(res.headers.get("cache-control")).toContain("no-store");
    const zip = parseZip(await collect(res.body!));
    expect(zip.names).toContain("brand.json");
    expect(zip.names).toContain(`photos/${a.photoId}.jpg`);
  });
});

describe("pages", () => {
  it("the deleted page says the account has been deleted", () => {
    expect(renderToStaticMarkup(createElement(DeletedPage))).toContain("Your account has been deleted");
  });

  it("the terms page is marked draft and covers what we store, why, no selling, export and delete, consent, Gemini, Resend and holiday data", () => {
    const html = renderToStaticMarkup(createElement(TermsPage));
    for (const part of [
      "Draft — to be reviewed by a lawyer before launch",
      "What we store",
      "Why",
      "We never sell your data",
      "Download or delete",
      "Photos of people",
      "consent",
      "Google Gemini",
      "Resend",
      HOLIDAY_DATA_ATTRIBUTION,
    ]) {
      expect(html).toContain(part);
    }
  });

  it("the login page links to /terms", async () => {
    jar.store.delete(SESSION_COOKIE); // the page sends a signed-in visitor on to /, so look at it signed out
    const html = renderToString(await LoginPage());
    expect(html).toMatch(/href="\/terms"[^>]*>Terms and privacy</);
  });

  it("Your data offers the download and the delete, says what is deleted, and links to /terms", () => {
    const html = renderToStaticMarkup(createElement(AccountPanel));
    expect(html).toContain('href="/api/account/export"');
    expect(html).toContain("Download my data");
    expect(html).toContain("Delete my account");
    expect(html).toContain("your photos and logo, all your posts and images");
    expect(html).toContain('href="/terms"');
  });
});
