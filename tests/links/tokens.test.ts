import { afterEach, describe, expect, it, vi } from "vitest";
import { SignJWT } from "jose";
import { LINK_ACTS, LINK_TTL_SECONDS, emailLinkSecret, jtiHash, signLink, verifyLink } from "@/lib/links/tokens";

const BRAND = "11111111-1111-4111-8111-111111111111";
const POST = "22222222-2222-4222-8222-222222222222";
const T0 = new Date("2026-11-09T08:00:00Z");
const minutes = (n: number) => n * 60_000;
const DAY = 24 * 3600_000;

afterEach(() => vi.unstubAllEnvs());

describe("signLink / verifyLink", () => {
  it("round-trips every claim", async () => {
    const token = await signLink({ brandId: BRAND, postId: POST, act: "approve", weekStart: "2026-11-09", extra: { answer: "few", ok: true }, now: T0 });
    const c = await verifyLink(token, { now: T0 });
    expect(c).toMatchObject({
      brandId: BRAND,
      postId: POST,
      act: "approve",
      weekStart: "2026-11-09",
      extra: { answer: "few", ok: true },
      iat: Math.floor(T0.getTime() / 1000),
      exp: Math.floor(T0.getTime() / 1000) + 14 * 24 * 3600,
    });
    expect(c!.jti).toMatch(/^[0-9a-f-]{36}$/);
    expect(LINK_TTL_SECONDS).toBe(14 * 24 * 3600);
  });

  it("works for brand-level acts without a post id", async () => {
    const token = await signLink({ brandId: BRAND, act: "pause", now: T0 });
    const c = await verifyLink(token, { now: T0 });
    expect(c).toMatchObject({ brandId: BRAND, act: "pause", extra: {} });
    expect(c!.postId).toBeUndefined();
  });

  it("gives each token its own jti", async () => {
    const a = await verifyLink(await signLink({ brandId: BRAND, act: "pause", now: T0 }), { now: T0 });
    const b = await verifyLink(await signLink({ brandId: BRAND, act: "pause", now: T0 }), { now: T0 });
    expect(a!.jti).not.toBe(b!.jti);
  });

  it("is valid at 13 days 23 hours and expired at 14 days 1 minute (AC 14)", async () => {
    const token = await signLink({ brandId: BRAND, act: "view_week", weekStart: "2026-11-09", now: T0 });
    expect(await verifyLink(token, { now: new Date(T0.getTime() + 13 * DAY + 23 * 3600_000) })).not.toBeNull();
    expect(await verifyLink(token, { now: new Date(T0.getTime() + 14 * DAY + minutes(1)) })).toBeNull();
  });

  it("follows the system clock when no clock is passed", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(T0);
      const token = await signLink({ brandId: BRAND, act: "pause" });
      vi.setSystemTime(new Date(T0.getTime() + 13 * DAY + 23 * 3600_000));
      expect(await verifyLink(token)).not.toBeNull();
      vi.setSystemTime(new Date(T0.getTime() + 14 * DAY + minutes(1)));
      expect(await verifyLink(token)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects a tampered token", async () => {
    const token = await signLink({ brandId: BRAND, postId: POST, act: "approve", now: T0 });
    const [h, p, sig] = token.split(".");
    const claims = JSON.parse(Buffer.from(p, "base64url").toString());
    claims.act = "skip";
    const forgedPayload = Buffer.from(JSON.stringify(claims)).toString("base64url");
    expect(await verifyLink(`${h}.${forgedPayload}.${sig}`, { now: T0 })).toBeNull();
    expect(await verifyLink(`${h}.${p}.${sig.slice(0, -2)}xx`, { now: T0 })).toBeNull();
    expect(await verifyLink("not a token", { now: T0 })).toBeNull();
    expect(await verifyLink("", { now: T0 })).toBeNull();
    expect(await verifyLink(undefined, { now: T0 })).toBeNull();
  });

  it("rejects a token signed with another secret, and one signed with the auth secret", async () => {
    vi.stubEnv("EMAIL_LINK_SECRET", "a".repeat(40));
    const token = await signLink({ brandId: BRAND, act: "pause", now: T0 });
    expect(await verifyLink(token, { now: T0 })).not.toBeNull();
    vi.stubEnv("EMAIL_LINK_SECRET", "b".repeat(40));
    expect(await verifyLink(token, { now: T0 })).toBeNull();

    const authKey = new TextEncoder().encode(process.env.AUTH_SECRET || "postmitra-dev-only-secret-do-not-use-in-production");
    const forged = await new SignJWT({ act: "unsubscribe" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(BRAND)
      .setJti("x")
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(authKey);
    expect(await verifyLink(forged)).toBeNull();
  });

  it("rejects an unsigned (alg none) token", async () => {
    const enc = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const none = `${enc({ alg: "none", typ: "JWT" })}.${enc({ sub: BRAND, act: "unsubscribe", jti: "x", iat: 1, exp: 9999999999 })}.`;
    expect(await verifyLink(none)).toBeNull();
  });

  it("checks the act when asked", async () => {
    const token = await signLink({ brandId: BRAND, act: "pause", now: T0 });
    expect(await verifyLink(token, { act: "pause", now: T0 })).not.toBeNull();
    expect(await verifyLink(token, { act: "unsubscribe", now: T0 })).toBeNull();
    expect(await verifyLink(token, { act: ["unsubscribe", "pause"], now: T0 })).not.toBeNull();
  });

  it("refuses to sign bad input and to verify a post act without a post", async () => {
    await expect(signLink({ brandId: "nope", act: "pause" })).rejects.toThrow();
    await expect(signLink({ brandId: BRAND, postId: "nope", act: "approve" })).rejects.toThrow();
    await expect(signLink({ brandId: BRAND, act: "pause", weekStart: "2026-02-30" })).rejects.toThrow();
    await expect(signLink({ brandId: BRAND, act: "bogus" as never })).rejects.toThrow();
    const noPost = await signLink({ brandId: BRAND, act: "approve", now: T0 });
    expect(await verifyLink(noPost, { now: T0 })).toBeNull();
  });

  it("knows the acts of the design", () => {
    for (const a of ["view_week", "approve", "skip", "edit", "ready", "checkin", "pause", "unsubscribe"]) {
      expect(LINK_ACTS).toContain(a);
    }
  });
});

describe("secret", () => {
  it("falls back to a value derived from AUTH_SECRET in development", () => {
    vi.stubEnv("EMAIL_LINK_SECRET", "");
    vi.stubEnv("AUTH_SECRET", "x".repeat(40));
    const a = emailLinkSecret();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toContain("xxxx");
    vi.stubEnv("AUTH_SECRET", "y".repeat(40));
    expect(emailLinkSecret()).not.toBe(a);
  });

  it("uses EMAIL_LINK_SECRET when set", () => {
    vi.stubEnv("EMAIL_LINK_SECRET", "my-link-secret");
    expect(emailLinkSecret()).toBe("my-link-secret");
  });

  it("throws in production when it is unset", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_SECRET", "z".repeat(40));
    vi.stubEnv("EMAIL_LINK_SECRET", "");
    expect(() => emailLinkSecret()).toThrow(/EMAIL_LINK_SECRET/);
  });
});

describe("jtiHash", () => {
  it("is a short stable hash that does not contain the jti", () => {
    const h = jtiHash("abc-123");
    expect(h).toMatch(/^[0-9a-f]{12}$/);
    expect(jtiHash("abc-123")).toBe(h);
    expect(jtiHash("abc-124")).not.toBe(h);
    expect(h).not.toContain("abc");
  });
});
