import { afterEach, describe, expect, it, vi } from "vitest";
import { clientIpFromHeaders, hashIp } from "@/lib/sessions/ip";
import { lookupGeo, resetGeoForTests } from "@/lib/sessions/geo";
import { parseUserAgent } from "@/lib/sessions/ua";

afterEach(() => {
  vi.unstubAllEnvs();
  resetGeoForTests();
});

describe("parseUserAgent", () => {
  it.each([
    [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
      { browser: "Chrome 130", os: "Windows", deviceType: "desktop" },
    ],
    [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.2849.5",
      { browser: "Edge 130", os: "Windows", deviceType: "desktop" },
    ],
    [
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
      { browser: "Safari 17", os: "macOS", deviceType: "desktop" },
    ],
    [
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
      { browser: "Safari 17", os: "iOS 17", deviceType: "mobile" },
    ],
    [
      "Mozilla/5.0 (iPad; CPU OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.6723.37 Mobile/15E148 Safari/604.1",
      { browser: "Chrome 130", os: "iOS 16", deviceType: "tablet" },
    ],
    [
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36",
      { browser: "Chrome 130", os: "Android 14", deviceType: "mobile" },
    ],
    [
      "Mozilla/5.0 (Linux; Android 13; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
      { browser: "Chrome 130", os: "Android 13", deviceType: "tablet" },
    ],
    [
      "Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0",
      { browser: "Firefox 131", os: "Linux", deviceType: "desktop" },
    ],
    [
      "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
      { browser: null, os: null, deviceType: "bot" },
    ],
    ["curl/8.5.0", { browser: null, os: null, deviceType: "bot" }],
  ])("%s", (ua, want) => {
    expect(parseUserAgent(ua)).toEqual(want);
  });

  it("gives unknown for missing or odd input and never throws", () => {
    expect(parseUserAgent(null)).toEqual({ browser: null, os: null, deviceType: "unknown" });
    expect(parseUserAgent("")).toEqual({ browser: null, os: null, deviceType: "unknown" });
    expect(parseUserAgent("x".repeat(5000)).deviceType).toBe("unknown");
    expect(parseUserAgent("\u0000\u202e weird").browser).toBeNull();
  });

  it("keeps browser and OS within the 40-character column limit", () => {
    const r = parseUserAgent(`Mozilla/5.0 (Windows NT 10.0) Chrome/${"1".repeat(200)} Safari/537.36`);
    expect((r.browser ?? "").length).toBeLessThanOrEqual(40);
  });
});

describe("client IP and hash", () => {
  const h = (v: Record<string, string>) => new Headers(v);
  it("takes the first hop of x-forwarded-for, else x-real-ip", () => {
    expect(clientIpFromHeaders(h({ "x-forwarded-for": "203.0.113.5, 10.0.0.2, 10.0.0.3" }))).toBe("203.0.113.5");
    expect(clientIpFromHeaders(h({ "x-real-ip": "198.51.100.2" }))).toBe("198.51.100.2");
    expect(clientIpFromHeaders(h({ "x-forwarded-for": "2001:db8::1" }))).toBe("2001:db8::1");
    expect(clientIpFromHeaders(h({ "x-forwarded-for": "203.0.113.5:4433" }))).toBe("203.0.113.5");
  });
  it("ignores anything that is not an address", () => {
    expect(clientIpFromHeaders(h({}))).toBeNull();
    expect(clientIpFromHeaders(h({ "x-forwarded-for": "unknown" }))).toBeNull();
    expect(clientIpFromHeaders(h({ "x-forwarded-for": "<script>alert(1)</script>" }))).toBeNull();
  });
  it("hashes with a key derived from AUTH_SECRET: stable, 32 hex, no address in it, another secret gives another hash", () => {
    const a = hashIp("203.0.113.5")!;
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(hashIp("203.0.113.5")).toBe(a);
    expect(hashIp("203.0.113.6")).not.toBe(a);
    vi.stubEnv("AUTH_SECRET", "another-secret-another-secret-another");
    expect(hashIp("203.0.113.5")).not.toBe(a);
    expect(hashIp(null)).toBeNull();
  });
});

describe("geo lookup", () => {
  it("is null without GEOIP_DB_PATH", async () => {
    vi.stubEnv("GEOIP_DB_PATH", "");
    expect(await lookupGeo("8.8.8.8")).toEqual({ country: null, city: null });
  });
  it("is null when the file is missing, and does not throw", async () => {
    vi.stubEnv("GEOIP_DB_PATH", "C:/definitely/not/here.mmdb");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(await lookupGeo("8.8.8.8")).toEqual({ country: null, city: null });
    warn.mockRestore();
  });
  it("is null for no address", async () => {
    expect(await lookupGeo(null)).toEqual({ country: null, city: null });
  });
  // Only with a real DB-IP file: GEOIP_TEST_DB=path npx vitest run tests/sessions
  it.runIf(Boolean(process.env.GEOIP_TEST_DB))("finds a country for a public address and nothing for a private one", async () => {
    vi.stubEnv("GEOIP_DB_PATH", process.env.GEOIP_TEST_DB!);
    const g = await lookupGeo("8.8.8.8");
    expect(g.country).toBe("US");
    expect(await lookupGeo("10.0.0.1")).toEqual({ country: null, city: null });
    expect(await lookupGeo("not-an-ip")).toEqual({ country: null, city: null });
  });
});
