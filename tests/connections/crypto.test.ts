import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  TOKEN_KEY_VERSION,
  TokenKeyError,
  decryptToken,
  encryptToken,
  resetTokenKeyForTests,
  tokenAad,
  tokenEncryptionAvailable,
} from "@/lib/connections/crypto";
import { TEST_KEY } from "./helpers";

const AAD = tokenAad("brand-1", "instagram");

beforeEach(() => {
  vi.stubEnv("TOKEN_ENCRYPTION_KEY", TEST_KEY);
  resetTokenKeyForTests();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  resetTokenKeyForTests();
});

describe("token encryption (AES-256-GCM)", () => {
  it("round-trips a token and never stores it in the clear", () => {
    const enc = encryptToken("IGAAsecret-token-123", AAD);
    expect(enc.keyVersion).toBe(TOKEN_KEY_VERSION);
    expect(enc.ciphertext).not.toContain("IGAAsecret");
    expect(Buffer.from(enc.iv, "base64")).toHaveLength(12);
    expect(Buffer.from(enc.tag, "base64")).toHaveLength(16);
    expect(decryptToken(enc, AAD)).toBe("IGAAsecret-token-123");
  });

  it("uses a new IV every time", () => {
    expect(encryptToken("same", AAD).iv).not.toBe(encryptToken("same", AAD).iv);
  });

  it("detects any tampering with the ciphertext, the tag or the IV", () => {
    const enc = encryptToken("IGAAsecret-token-123", AAD);
    const flip = (b64: string) => {
      const buf = Buffer.from(b64, "base64");
      buf[0] ^= 1;
      return buf.toString("base64");
    };
    expect(() => decryptToken({ ...enc, ciphertext: flip(enc.ciphertext) }, AAD)).toThrow(TokenKeyError);
    expect(() => decryptToken({ ...enc, tag: flip(enc.tag) }, AAD)).toThrow(TokenKeyError);
    expect(() => decryptToken({ ...enc, iv: flip(enc.iv) }, AAD)).toThrow(TokenKeyError);
  });

  it("does not open for another brand or provider (the AAD binds it)", () => {
    const enc = encryptToken("tok", AAD);
    expect(() => decryptToken(enc, tokenAad("brand-2", "instagram"))).toThrow(TokenKeyError);
    expect(() => decryptToken(enc, tokenAad("brand-1", "facebook"))).toThrow(TokenKeyError);
  });

  it("does not open with another key, or another key version", () => {
    const enc = encryptToken("tok", AAD);
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", Buffer.alloc(32, 9).toString("base64"));
    expect(() => decryptToken(enc, AAD)).toThrow(TokenKeyError);
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", TEST_KEY);
    expect(() => decryptToken({ ...enc, keyVersion: 2 }, AAD)).toThrow(/key version/);
  });

  it("errors never contain the token", () => {
    const enc = encryptToken("IGAAsecret-token-123", AAD);
    try {
      decryptToken({ ...enc, tag: Buffer.alloc(16).toString("base64") }, AAD);
      expect.unreachable();
    } catch (e) {
      expect(String(e)).not.toContain("IGAAsecret");
    }
  });

  it("rejects a key that is not 32 bytes", () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", Buffer.alloc(16, 1).toString("base64"));
    expect(() => encryptToken("tok", AAD)).toThrow(/32 bytes/);
    expect(tokenEncryptionAvailable()).toBe(false);
  });

  it("refuses to run in production without a key", () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", "");
    vi.stubEnv("NODE_ENV", "production");
    expect(tokenEncryptionAvailable()).toBe(false);
    expect(() => encryptToken("tok", AAD)).toThrow(/TOKEN_ENCRYPTION_KEY is required in production/);
  });

  it("uses a temporary key with one warning outside production", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", "");
    expect(tokenEncryptionAvailable()).toBe(true);
    const enc = encryptToken("tok", AAD);
    expect(decryptToken(enc, AAD)).toBe("tok");
    encryptToken("tok2", AAD);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("TOKEN_ENCRYPTION_KEY");
  });
});
