import { afterEach, describe, expect, it, vi } from "vitest";
import { DEV_AUTH_SECRET, getEnv } from "@/lib/env";

const clear = () => {
  for (const k of [
    "DATA_BACKEND",
    "AUTH_SECRET",
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "VERCEL_ENV",
  ]) {
    vi.stubEnv(k, "");
  }
};

afterEach(() => vi.unstubAllEnvs());

describe("getEnv", () => {
  it("defaults to the mock backend when Supabase keys are missing", () => {
    clear();
    expect(getEnv().dataBackend).toBe("mock");
  });

  it("uses supabase when all keys are set", () => {
    clear();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://x.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service");
    vi.stubEnv("AUTH_SECRET", "s".repeat(32));
    expect(getEnv().dataBackend).toBe("supabase");
  });

  it("an explicit DATA_BACKEND wins", () => {
    clear();
    vi.stubEnv("DATA_BACKEND", "mock");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://x.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service");
    expect(getEnv().dataBackend).toBe("mock");
  });

  it("uses a fixed dev secret in mock mode when AUTH_SECRET is blank, warning once", () => {
    clear();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(getEnv().authSecret).toBe(DEV_AUTH_SECRET);
    getEnv();
    expect(warn.mock.calls.length).toBeLessThanOrEqual(1);
    warn.mockRestore();
  });

  it("throws in production when AUTH_SECRET is blank or short", () => {
    clear();
    vi.stubEnv("NODE_ENV", "production");
    expect(() => getEnv()).toThrow(/AUTH_SECRET/);
    vi.stubEnv("AUTH_SECRET", "short");
    expect(() => getEnv()).toThrow(/32/);
    vi.stubEnv("AUTH_SECRET", "s".repeat(32));
    expect(getEnv().authSecret).toBe("s".repeat(32));
  });
});

describe("email and app URL settings", () => {
  it("are all optional; blank counts as not set", () => {
    clear();
    for (const k of ["RESEND_API_KEY", "EMAIL_FROM", "EMAIL_REPLY_TO", "NEXT_PUBLIC_APP_URL"]) vi.stubEnv(k, "");
    const env = getEnv();
    expect(env.resendApiKey).toBeUndefined();
    expect(env.emailFrom).toBeUndefined();
    expect(env.emailReplyTo).toBeUndefined();
    expect(env.appUrl).toBe("http://localhost:3000");
  });

  it("reads the values and trims the trailing slash from the app URL", () => {
    clear();
    vi.stubEnv("RESEND_API_KEY", "re_x");
    vi.stubEnv("EMAIL_FROM", "Weekly Posts <hi@example.com>");
    vi.stubEnv("EMAIL_REPLY_TO", "help@example.com");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.com//");
    const env = getEnv();
    expect(env).toMatchObject({
      resendApiKey: "re_x",
      emailFrom: "Weekly Posts <hi@example.com>",
      emailReplyTo: "help@example.com",
      appUrl: "https://app.example.com",
    });
  });

  it("has no localhost default for the app URL in production", () => {
    clear();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_SECRET", "s".repeat(32));
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    expect(getEnv().appUrl).toBe("");
  });
});
