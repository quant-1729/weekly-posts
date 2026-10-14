import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";

const jar = vi.hoisted(() => {
  const store = new Map<string, { value: string; options?: Record<string, unknown> }>();
  return {
    store,
    api: {
      get: (name: string) => (store.has(name) ? { name, value: store.get(name)!.value } : undefined),
      set: (name: string, value: string, options?: Record<string, unknown>) => {
        store.set(name, { value, options });
      },
      delete: (name: string) => {
        store.delete(name);
      },
    },
  };
});
vi.mock("next/headers", () => ({ cookies: async () => jar.api }));

import { GET, POST } from "@/app/auth/callback/route";
import { createMockAuth, resetMockAuthState } from "@/lib/auth/mock";
import { CSRF_COOKIE, continueNonce, continuePageHtml, newCsrfSecret } from "@/lib/auth/continue";
import { verifyMagicToken } from "@/lib/auth/magic-link";
import { SESSION_COOKIE, SESSION_MAX_AGE_SECONDS, verifySession } from "@/lib/auth/session";
import { createMockDb, setMockDbForTests, type MockDb } from "@/lib/db/mock";
import { linksIn, listOutbox, setOutboxDirForTests } from "@/lib/email/outbox";
import { homePathFor } from "@/lib/auth/home";

let db: MockDb;
let outbox: string;

const URL_BASE = "http://localhost:3100/auth/callback";

/** What the emailed link does when opened: a GET, with the browser's cookie if it has one. */
const open = (token?: string, cookie?: string) =>
  GET(
    new NextRequest(`${URL_BASE}${token === undefined ? "" : `?token=${token}`}`, {
      headers: cookie ? { cookie: `${CSRF_COOKIE}=${cookie}` } : {},
    }),
  );

/** What the Continue button does: POST the form fields, with the browser's cookie. */
const press = (fields: { token?: string; nonce?: string }, cookie?: string) => {
  const body = new URLSearchParams();
  if (fields.token !== undefined) body.set("token", fields.token);
  if (fields.nonce !== undefined) body.set("nonce", fields.nonce);
  return POST(
    new NextRequest(URL_BASE, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        ...(cookie ? { cookie: `${CSRF_COOKIE}=${cookie}` } : {}),
      },
      body,
    }),
  );
};

/** Opens the link like an owner's browser; returns the form it shows and the cookie it set. */
async function openAsBrowser(token: string, cookie?: string) {
  const res = await open(token, cookie);
  expect(res.status).toBe(200);
  const html = await res.text();
  const nonce = /name="nonce" value="([^"]+)"/.exec(html)![1];
  const formToken = /name="token" value="([^"]+)"/.exec(html)![1];
  const set = res.cookies.get(CSRF_COOKIE)?.value ?? cookie!;
  return { res, html, nonce, formToken, cookie: set };
}

const pathOf = (res: Response) => new URL(res.headers.get("location")!).pathname;
const usedCount = () =>
  db
    .withAdmin((tx) =>
      tx.query<{ n: number }>("select count(*)::int as n from public.magic_links where used_at is not null"),
    )
    .then((r) => r[0].n);

async function newLink(email: string): Promise<string> {
  await createMockAuth().requestMagicLink(email, true);
  const [mail] = await listOutbox(1);
  return new URL(linksIn(mail.text)[0]).searchParams.get("token")!;
}

beforeAll(async () => {
  db = await createMockDb();
  setMockDbForTests(db);
});
afterAll(async () => {
  setMockDbForTests(null);
  await db.close();
});
beforeEach(async () => {
  await resetMockAuthState();
  jar.store.clear();
  outbox = await mkdtemp(path.join(os.tmpdir(), "outbox-"));
  setOutboxDirForTests(outbox);
  await db.withAdmin((tx) => tx.query("delete from public.magic_links"));
});
afterEach(async () => {
  vi.unstubAllEnvs();
  setOutboxDirForTests(null);
  await rm(outbox, { recursive: true, force: true });
});

describe("/auth/callback: the Continue step", () => {
  it("GET shows a Continue page and does not use the link up or sign anyone in", async () => {
    const token = await newLink("cb@example.com");
    const { res, html, formToken } = await openAsBrowser(token);
    expect(html).toContain("Continue to Weekly Posts");
    expect(html).toContain('<form method="post" action="/auth/callback">');
    expect(formToken).toBe(token);
    expect(html).not.toContain("<script");
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.cookies.get(CSRF_COOKIE)?.httpOnly).toBe(true);
    expect(jar.store.has(SESSION_COOKIE)).toBe(false); // no session
    expect(await usedCount()).toBe(0);
  });

  it("two GETs, then one POST, signs in: 30-day cookie, 303 to /, a new owner goes to setup", async () => {
    const token = await newLink("cb1@example.com");
    await open(token);
    const b = await openAsBrowser(token);
    expect(await usedCount()).toBe(0);

    const res = await press({ token: b.formToken, nonce: b.nonce }, b.cookie);
    expect(res.status).toBe(303);
    const loc = new URL(res.headers.get("location")!);
    expect(loc.pathname).toBe("/");
    expect(loc.search).toBe(""); // the token is not passed on
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(res.headers.get("cache-control")).toBe("no-store");

    const cookie = jar.store.get(SESSION_COOKIE)!;
    expect(cookie.options).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/", maxAge: 30 * 24 * 60 * 60 });
    expect(cookie.options!.maxAge).toBe(SESSION_MAX_AGE_SECONDS);
    const session = (await verifySession(cookie.value))!;
    expect(session.email).toBe("cb1@example.com");
    expect(session.exp - session.iat).toBe(30 * 24 * 60 * 60);
    expect(await usedCount()).toBe(1);

    // "/" sends an owner with no brand to /setup.
    expect(await homePathFor(session.sub)).toBe("/setup");
  });

  it("a second POST of the same link fails and sets no cookie", async () => {
    const token = await newLink("cb2@example.com");
    const b = await openAsBrowser(token);
    expect((await press({ token, nonce: b.nonce }, b.cookie)).status).toBe(303);
    jar.store.clear();

    const again = await press({ token, nonce: b.nonce }, b.cookie);
    expect(again.status).toBe(303);
    expect(pathOf(again)).toBe("/auth/invalid");
    expect(jar.store.has(SESSION_COOKIE)).toBe(false);
  });

  it("a GET of a used link goes to the friendly page", async () => {
    const token = await newLink("cb3@example.com");
    const b = await openAsBrowser(token);
    await press({ token, nonce: b.nonce }, b.cookie);
    expect(pathOf(await open(token))).toBe("/auth/invalid");
  });

  it("scanner simulation: a cookie-less GET first, then the owner's GET and POST, still signs in", async () => {
    const token = await newLink("cb4@example.com");
    const scanner = await open(token); // a mail gateway or link preview, no cookies
    expect(scanner.status).toBe(200);
    expect(jar.store.has(SESSION_COOKIE)).toBe(false);
    expect(await usedCount()).toBe(0);

    const owner = await openAsBrowser(token);
    const res = await press({ token: owner.formToken, nonce: owner.nonce }, owner.cookie);
    expect(pathOf(res)).toBe("/");
    const session = (await verifySession(jar.store.get(SESSION_COOKIE)!.value))!;
    expect(session.email).toBe("cb4@example.com");
  });

  it("the scanner's form does not work in the owner's browser, and a refused POST does not burn the link", async () => {
    const token = await newLink("cb5@example.com");
    const scanner = await openAsBrowser(token); // its own cookie
    const owner = await openAsBrowser(token); // the owner's own, different cookie
    expect(owner.cookie).not.toBe(scanner.cookie);
    const bad = await press({ token, nonce: scanner.nonce }, owner.cookie);
    expect(pathOf(bad)).toBe("/auth/invalid");
    expect(await usedCount()).toBe(0);
    expect(pathOf(await press({ token, nonce: owner.nonce }, owner.cookie))).toBe("/");
  });

  it("CSRF: a POST from another site (no cookie, no or wrong nonce) is refused before the link is used", async () => {
    const token = await newLink("cb6@example.com");
    const b = await openAsBrowser(token);
    const jti = (await verifyMagicToken(token))!.jti;

    const attempts = [
      press({ token, nonce: b.nonce }), // right nonce but no cookie: a cross-site POST sends none
      press({ token }, b.cookie), // no nonce
      press({ token, nonce: "x".repeat(43) }, b.cookie), // wrong nonce
      press({ token, nonce: continueNonce(jti, newCsrfSecret()) }, b.cookie), // nonce made for another cookie
      press({ nonce: b.nonce }, b.cookie), // no token
    ];
    for (const attempt of attempts) expect(pathOf(await attempt)).toBe("/auth/invalid");
    expect(jar.store.has(SESSION_COOKIE)).toBe(false);
    expect(await usedCount()).toBe(0);
    // The real button still works afterwards.
    expect(pathOf(await press({ token, nonce: b.nonce }, b.cookie))).toBe("/");
  });

  it("two tabs in one browser share the cookie, so both forms work", async () => {
    const token = await newLink("cb7@example.com");
    const first = await openAsBrowser(token);
    const second = await openAsBrowser(token, first.cookie);
    expect(second.cookie).toBe(first.cookie);
    expect(second.nonce).toBe(first.nonce);
  });

  it("a missing, garbage or tampered token goes to the friendly page, on GET and on POST", async () => {
    for (const tkn of [undefined, "", "garbage", "a.b.c"]) {
      expect(pathOf(await open(tkn))).toBe("/auth/invalid");
      expect(pathOf(await press({ token: tkn, nonce: "n" }, newCsrfSecret()))).toBe("/auth/invalid");
    }
    expect(jar.store.has(SESSION_COOKIE)).toBe(false);
  });

  it("does not sign in on Vercel production", async () => {
    const token = await newLink("cb8@example.com");
    const b = await openAsBrowser(token);
    vi.stubEnv("VERCEL_ENV", "production");
    expect(pathOf(await open(token))).toBe("/auth/invalid");
    expect(pathOf(await press({ token, nonce: b.nonce }, b.cookie))).toBe("/auth/invalid");
    expect(jar.store.has(SESSION_COOKIE)).toBe(false);
  });

  it("escapes the token and nonce in the page", () => {
    const html = continuePageHtml({ token: '"><script>alert(1)</script>', nonce: "n" });
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&quot;&gt;&lt;script&gt;");
  });
});
