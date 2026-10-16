import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  LINK_LIMIT_PER_EMAIL,
  LINK_LIMIT_TOTAL,
  LINK_TTL_S,
  SESSION_TTL_S,
  consumeLinkToken,
  createLinkToken,
  createSessionToken,
  linkAlreadyUsed,
  normaliseEmail,
  readLinkToken,
  readSessionToken,
  requestLoginLink,
} from "@/lib/auth";
import { setExecutor } from "@/lib/db";
import { createTestDb, type TestDb } from "./helpers/pg";

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
  setExecutor(t.executor);
});
afterAll(async () => {
  setExecutor(null);
  await t.close();
});

const rows = async (sql: string, params: unknown[] = []) => (await t.pg.query<Record<string, unknown>>(sql, params)).rows;

describe("allowlist", () => {
  it("normalises addresses", () => {
    expect(normaliseEmail("  Boss@Example.com ")).toBe("boss@example.com");
    expect(normaliseEmail("nope")).toBeNull();
    expect(normaliseEmail(42)).toBeNull();
    expect(normaliseEmail("a@b.c")).toBeNull();
  });

  it("sends a link only to addresses in ADMIN_EMAILS (case-insensitive)", async () => {
    const ok = await requestLoginLink("BOSS@example.com");
    expect(ok?.to).toBe("boss@example.com");
    expect(ok?.url.startsWith("https://admin.example.test/auth/verify?t=")).toBe(true);
    expect(await requestLoginLink("stranger@example.com")).toBeNull();
    expect(await requestLoginLink("")).toBeNull();
  });

  it("logs requests for unknown addresses too, but never stores the raw address", async () => {
    await requestLoginLink("enumeration-probe@example.com");
    const r = await rows("select admin_email, action, target from public.admin_actions where action = 'link_requested'");
    expect(r.length).toBeGreaterThan(0);
    for (const row of r) {
      expect(row.admin_email).toBe("anonymous");
      expect(String(row.target)).not.toContain("example.com");
    }
  });

  it("refuses a link for an address that was removed from the allowlist after it was sent", () => {
    const { token } = createLinkToken("removed@example.com");
    expect(readLinkToken(token)).toBeNull();
  });
});

describe("link token", () => {
  it("is single use", async () => {
    const { token, nonce } = createLinkToken("boss@example.com");
    expect(await linkAlreadyUsed(nonce)).toBe(false);
    expect(await consumeLinkToken(token)).toBe("boss@example.com");
    expect(await linkAlreadyUsed(nonce)).toBe(true);
    expect(await consumeLinkToken(token)).toBeNull();
    const used = await rows("select count(*)::int as n from public.admin_actions where action = 'link_used'");
    expect(used[0].n).toBeGreaterThanOrEqual(1);
    const signins = await rows("select admin_email from public.admin_actions where action = 'sign_in'");
    expect(signins.some((r) => r.admin_email === "boss@example.com")).toBe(true);
  });

  it("lets only one of two simultaneous clicks win", async () => {
    const { token } = createLinkToken("second@example.com");
    const results = await Promise.all([consumeLinkToken(token), consumeLinkToken(token)]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("expires after 15 minutes", async () => {
    const now = Date.now();
    const { token } = createLinkToken("boss@example.com", now);
    expect(readLinkToken(token, now + (LINK_TTL_S - 5) * 1000)).not.toBeNull();
    expect(readLinkToken(token, now + (LINK_TTL_S + 5) * 1000)).toBeNull();
    expect(await consumeLinkToken(token, now + (LINK_TTL_S + 5) * 1000)).toBeNull();
  });

  it("rejects a tampered payload or signature", () => {
    const { token } = createLinkToken("boss@example.com");
    const [body, sig] = token.split(".");
    const payload = JSON.parse(Buffer.from(body, "base64url").toString());
    const forged = Buffer.from(JSON.stringify({ ...payload, e: "second@example.com" })).toString("base64url");
    expect(readLinkToken(`${forged}.${sig}`)).toBeNull();
    expect(readLinkToken(`${body}.${sig.slice(0, -2)}AA`)).toBeNull();
    expect(readLinkToken(`${body}.`)).toBeNull();
    expect(readLinkToken(body)).toBeNull();
    expect(readLinkToken("")).toBeNull();
    expect(readLinkToken(undefined)).toBeNull();
  });

  it("a sign-in link cannot be used as a session cookie, and the reverse", () => {
    const { token } = createLinkToken("boss@example.com");
    expect(readSessionToken(token)).toBeNull();
    expect(readLinkToken(createSessionToken("boss@example.com"))).toBeNull();
  });
});

describe("session cookie", () => {
  it("is valid for 12 hours", () => {
    const now = Date.now();
    const c = createSessionToken("boss@example.com", now);
    expect(readSessionToken(c, now + 1000)).toBe("boss@example.com");
    expect(readSessionToken(c, now + (SESSION_TTL_S - 5) * 1000)).toBe("boss@example.com");
    expect(readSessionToken(c, now + (SESSION_TTL_S + 5) * 1000)).toBeNull();
  });

  it("rejects tampering: changed email, extended expiry, wrong signature", () => {
    const c = createSessionToken("boss@example.com");
    const [body, sig] = c.split(".");
    const p = JSON.parse(Buffer.from(body, "base64url").toString());
    const enc = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
    expect(readSessionToken(`${enc({ ...p, e: "second@example.com" })}.${sig}`)).toBeNull();
    expect(readSessionToken(`${enc({ ...p, x: p.x + 999999 })}.${sig}`)).toBeNull();
    expect(readSessionToken(`${body}.${"A".repeat(sig.length)}`)).toBeNull();
    expect(readSessionToken("garbage")).toBeNull();
    expect(readSessionToken(null)).toBeNull();
  });

  it("is signed with the secret: a token made with another secret is refused", async () => {
    const good = createSessionToken("boss@example.com");
    const saved = process.env.ADMIN_AUTH_SECRET;
    process.env.ADMIN_AUTH_SECRET = "another-secret-another-secret-another-secret-9";
    const other = createSessionToken("boss@example.com");
    expect(readSessionToken(good)).toBeNull();
    process.env.ADMIN_AUTH_SECRET = saved;
    expect(readSessionToken(other)).toBeNull();
    expect(readSessionToken(good)).toBe("boss@example.com");
  });

  it("stops working when the address leaves ADMIN_EMAILS", () => {
    const c = createSessionToken("second@example.com");
    const saved = process.env.ADMIN_EMAILS;
    process.env.ADMIN_EMAILS = "boss@example.com";
    expect(readSessionToken(c)).toBeNull();
    process.env.ADMIN_EMAILS = saved;
    expect(readSessionToken(c)).toBe("second@example.com");
  });
});

describe("rate limit", () => {
  it("stops sending after the per-address limit, with no visible difference", async () => {
    let sent = 0;
    for (let i = 0; i < LINK_LIMIT_PER_EMAIL + 3; i++) {
      if (await requestLoginLink("limit-me@example.com")) sent++;
    }
    expect(sent).toBe(0); // not an admin: never sends
    // For an admin address the limit applies the same way.
    await rows("delete from public.admin_actions where action = 'link_requested'");
    let adminSent = 0;
    for (let i = 0; i < LINK_LIMIT_PER_EMAIL + 3; i++) {
      if (await requestLoginLink("second@example.com")) adminSent++;
    }
    expect(adminSent).toBe(LINK_LIMIT_PER_EMAIL);
  });

  it("caps the total number of logged requests so random addresses cannot fill the table", async () => {
    await rows("delete from public.admin_actions where action = 'link_requested'");
    for (let i = 0; i < LINK_LIMIT_TOTAL + 10; i++) await requestLoginLink(`random${i}@example.com`);
    const n = await rows("select count(*)::int as n from public.admin_actions where action = 'link_requested'");
    expect(n[0].n).toBe(LINK_LIMIT_TOTAL);
  });
});
