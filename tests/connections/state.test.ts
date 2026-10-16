import { SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import { signMagicToken } from "@/lib/auth/magic-link";
import { verifySession } from "@/lib/auth/session";
import { signSessionNoRow as signSession } from "../helpers/session";
import { CONNECT_STATE_TTL_SECONDS, nonceMatches, signConnectState, verifyConnectState } from "@/lib/connections/state";
import { getEnv } from "@/lib/env";

const BRAND = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";

describe("connect state", () => {
  it("round-trips brand, user, provider and nonce", async () => {
    const { state, nonce } = await signConnectState({ brandId: BRAND, userId: USER, provider: "instagram" });
    const v = await verifyConnectState(state);
    expect(v).toMatchObject({ brandId: BRAND, userId: USER, provider: "instagram", nonce });
    expect(nonce.length).toBeGreaterThanOrEqual(20);
  });

  it("expires after 10 minutes", async () => {
    const t0 = Date.UTC(2026, 9, 14, 10, 0, 0);
    const { state } = await signConnectState({ brandId: BRAND, userId: USER, provider: "facebook" }, t0);
    expect(await verifyConnectState(state, t0 + (CONNECT_STATE_TTL_SECONDS - 5) * 1000)).not.toBeNull();
    expect(await verifyConnectState(state, t0 + (CONNECT_STATE_TTL_SECONDS + 5) * 1000)).toBeNull();
  });

  it("refuses a changed or garbage state", async () => {
    const { state } = await signConnectState({ brandId: BRAND, userId: USER, provider: "instagram" });
    const [h, p, s] = state.split(".");
    const forgedPayload = Buffer.from(
      JSON.stringify({ ...JSON.parse(Buffer.from(p, "base64url").toString()), brand: "33333333-3333-4333-8333-333333333333" }),
    ).toString("base64url");
    expect(await verifyConnectState(`${h}.${forgedPayload}.${s}`)).toBeNull();
    expect(await verifyConnectState(state.slice(0, -3) + "abc")).toBeNull();
    expect(await verifyConnectState("not-a-token")).toBeNull();
    expect(await verifyConnectState("")).toBeNull();
    expect(await verifyConnectState(null)).toBeNull();
  });

  it("is not accepted from, or as, another kind of token", async () => {
    expect(await verifyConnectState(await signSession({ id: USER, email: "a@b.co" }))).toBeNull();
    expect(await verifyConnectState((await signMagicToken("a@b.co")).token)).toBeNull();
    // A token signed with the raw AUTH_SECRET (not the derived key) does not verify either.
    const raw = await new SignJWT({ purpose: "connect", brand: BRAND, uid: USER, provider: "instagram", nonce: "x" })
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime("10m")
      .sign(new TextEncoder().encode(getEnv().authSecret));
    expect(await verifyConnectState(raw)).toBeNull();
    const { state } = await signConnectState({ brandId: BRAND, userId: USER, provider: "instagram" });
    expect(await verifySession(state)).toBeNull();
  });

  it("compares nonces in constant time and refuses blanks", () => {
    expect(nonceMatches("abc", "abc")).toBe(true);
    expect(nonceMatches("abc", "abd")).toBe(false);
    expect(nonceMatches("abc", "abcd")).toBe(false);
    expect(nonceMatches("", "")).toBe(false);
    expect(nonceMatches(null, "abc")).toBe(false);
  });
});
