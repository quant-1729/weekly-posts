import { describe, expect, it } from "vitest";
import { formatHours, parseHours } from "@/lib/contacts/hours";
import { normalizeContact, normalizeEmail, normalizeFacebook, normalizePhone, normalizeUrl, normalizeYoutube } from "@/lib/contacts/normalize";

describe("normalizePhone", () => {
  const cases: Array<[string, string, string, string]> = [
    // country, typed, E.164, how a post shows it
    ["GB", "020 7946 0958", "+442079460958", "+44 20 7946 0958"],
    ["US", "(415) 555-2671", "+14155552671", "+1 415 555 2671"],
    ["IN", "98765 43210", "+919876543210", "+91 98765 43210"],
    ["DE", "030 901820", "+4930901820", "+49 30 901820"],
    ["BR", "(11) 91234-5678", "+5511912345678", "+55 11 91234 5678"],
    ["AE", "050 123 4567", "+971501234567", "+971 50 123 4567"],
  ];
  it.each(cases)("%s: %s", (country, typed, e164, display) => {
    expect(normalizePhone(typed, country)).toMatchObject({ ok: true, e164, display });
  });

  it("reads a number typed with + in any country, and shows it in the international format when it is abroad", () => {
    expect(normalizePhone("+1 415 555 2671", "GB")).toMatchObject({ ok: true, e164: "+14155552671", display: "+1 415 555 2671" });
    expect(normalizePhone("+44 20 7946 0958", "GB")).toMatchObject({ ok: true, e164: "+442079460958", display: "+44 20 7946 0958" });
    expect(normalizePhone("0044 20 7946 0958", "GB")).toMatchObject({ ok: true, e164: "+442079460958" });
  });

  it("needs a country for a number without +", () => {
    expect(normalizePhone("020 7946 0958", null).ok).toBe(false);
    expect(normalizePhone("+442079460958", null)).toMatchObject({ ok: true, e164: "+442079460958" });
  });

  it.each(["", "12345", "abcdefgh", "+44 20", "0000000000", "+999 123456789", "1".repeat(50)])("rejects %j", (typed) => {
    expect(normalizePhone(typed, "GB").ok).toBe(false);
  });

  it("makes the WhatsApp link from the E.164 number", () => {
    const r = normalizeContact({ kind: "whatsapp", value: "07911 123456" }, { country: "GB" });
    expect(r).toMatchObject({ ok: true, value: "+447911123456", details: { link: "https://wa.me/447911123456" } });
    expect(normalizeContact({ kind: "phone", value: "nope" }, { country: "GB" })).toEqual({ ok: false, fieldErrors: { value: "invalid_phone" } });
  });
});

describe("normalizeUrl", () => {
  it("adds https, upgrades http, drops the hash and a bare trailing slash", () => {
    expect(normalizeUrl("bakery.example.com")).toMatchObject({ ok: true, url: "https://bakery.example.com", display: "bakery.example.com" });
    expect(normalizeUrl("http://bakery.example.com/menu#top")).toMatchObject({ ok: true, url: "https://bakery.example.com/menu", display: "bakery.example.com/menu" });
    expect(normalizeUrl("  HTTPS://Bakery.Example.com/  ")).toMatchObject({ ok: true, url: "https://bakery.example.com" });
    expect(normalizeUrl("https://maps.app.goo.gl/abc123")).toMatchObject({ ok: true, url: "https://maps.app.goo.gl/abc123" });
  });

  it.each([
    "javascript:alert(1)",
    "data:text/html,hi",
    "ftp://example.com/file",
    "file:///etc/passwd",
    "https://user:pass@example.com",
    "https://localhost/admin",
    "https://intranet",
    "http://127.0.0.1/",
    "https://10.0.0.5/x",
    "https://192.168.1.1",
    "https://169.254.169.254/latest/meta-data",
    "https://[::1]/",
    "https://printer.local",
    "https://service.internal/x",
    "https://example.com:8080/",
    "https://exa mple.com",
    "",
    "not a url",
  ])("rejects %j", (raw) => {
    expect(normalizeUrl(raw)).toEqual({ ok: false, error: "invalid_url" });
  });

  it("keeps a long address short for display", () => {
    const r = normalizeUrl(`example.com/${"a".repeat(200)}`);
    expect(r).toMatchObject({ ok: true, display: "example.com" });
  });

  it("needs a label for a custom link", () => {
    expect(normalizeContact({ kind: "custom_link", value: "example.com/menu" }, { country: "GB" })).toEqual({ ok: false, fieldErrors: { label: "required" } });
    expect(normalizeContact({ kind: "custom_link", value: "example.com/menu", label: "Our menu" }, { country: "GB" })).toMatchObject({ ok: true, display: "Our menu" });
  });
});

describe("email, address and social handles", () => {
  it("lower-cases and checks emails", () => {
    expect(normalizeEmail("  Hello@Bakery.EXAMPLE.com ")).toBe("hello@bakery.example.com");
    for (const bad of ["no-at.example.com", "a@b", "a b@example.com", "a@@example.com", ".a@example.com", "a..b@example.com", "a@example..com"]) {
      expect(normalizeEmail(bad), bad).toBeNull();
    }
  });

  it("keeps a short address for the post and the full one in details", () => {
    expect(normalizeContact({ kind: "address", value: "12 High St, Leeds", full: "12 High Street, Leeds LS1 4AB, United Kingdom" }, { country: "GB" })).toMatchObject({
      ok: true,
      display: "12 High St, Leeds",
      value: "12 High Street, Leeds LS1 4AB, United Kingdom",
      details: { full: "12 High Street, Leeds LS1 4AB, United Kingdom" },
    });
    expect(normalizeContact({ kind: "address", value: "x".repeat(121) }, { country: "GB" })).toEqual({ ok: false, fieldErrors: { value: "too_long" } });
  });

  it("reads Instagram, YouTube and Facebook handles", () => {
    expect(normalizeContact({ kind: "instagram", value: "https://www.instagram.com/Corner.Bakery/?hl=en" }, { country: "GB" })).toMatchObject({ ok: true, value: "corner.bakery", display: "@corner.bakery" });
    expect(normalizeContact({ kind: "instagram", value: "https://www.instagram.com/p/abc/" }, { country: "GB" })).toMatchObject({ ok: false });
    expect(normalizeYoutube("@cornerbakery")).toEqual({ ok: true, value: "@cornerbakery", display: "@cornerbakery" });
    expect(normalizeYoutube("https://www.youtube.com/@cornerbakery/videos")).toMatchObject({ ok: true, value: "@cornerbakery" });
    expect(normalizeYoutube("https://youtube.com/channel/UCabc123def")).toMatchObject({ ok: true, value: "https://www.youtube.com/channel/UCabc123def" });
    expect(normalizeYoutube("https://evil.example/@cornerbakery").ok).toBe(false);
    expect(normalizeFacebook("https://www.facebook.com/cornerbakery.leeds/")).toEqual({ ok: true, value: "cornerbakery.leeds", display: "facebook.com/cornerbakery.leeds" });
    expect(normalizeFacebook("https://facebook.com/sharer.php?u=x").ok).toBe(false);
    expect(normalizeFacebook("https://www.facebook.com/profile.php?id=100012345678")).toMatchObject({ ok: true, value: "https://www.facebook.com/profile.php?id=100012345678" });
  });
});

describe("opening hours", () => {
  const range = (open: string, close: string) => [{ open, close }];
  const week = (over: Record<string, Array<{ open: string; close: string }>> = {}) => ({
    mon: range("09:00", "18:00"),
    tue: range("09:00", "18:00"),
    wed: range("09:00", "18:00"),
    thu: range("09:00", "18:00"),
    fri: range("09:00", "18:00"),
    sat: range("09:00", "18:00"),
    sun: [],
    ...over,
  });

  it("writes the short text a post shows", () => {
    const ok = parseHours(week());
    expect(ok.ok && formatHours(ok.days)).toBe("Mon-Sat 9:00-18:00, Sun closed");
    const daily = parseHours(Object.fromEntries(["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((d) => [d, range("09:00", "21:00")])));
    expect(daily.ok && formatHours(daily.days)).toBe("Daily 9:00-21:00");
    const split = parseHours(week({ sat: [{ open: "10:00", close: "13:00" }, { open: "14:00", close: "16:00" }] }));
    expect(split.ok && formatHours(split.days)).toBe("Mon-Fri 9:00-18:00, Sat 10:00-13:00 & 14:00-16:00, Sun closed");
    const odd = parseHours(week({ wed: [], sun: range("10:00", "24:00") }));
    expect(odd.ok && formatHours(odd.days)).toBe("Mon-Tue 9:00-18:00, Wed closed, Thu-Sat 9:00-18:00, Sun 10:00-24:00");
  });

  it("stores days and the generated text through normalizeContact", () => {
    const r = normalizeContact({ kind: "hours", days: week() }, { country: "GB" });
    expect(r).toMatchObject({ ok: true, display: "Mon-Sat 9:00-18:00, Sun closed", value: "Mon-Sat 9:00-18:00, Sun closed" });
    expect(r.ok && (r.details.days as { sun: unknown[] }).sun).toEqual([]);
  });

  it("rejects bad times, overlaps and a week with nothing open", () => {
    expect(parseHours(week({ mon: range("18:00", "09:00") }))).toEqual({ ok: false, error: "hours_time" });
    expect(parseHours(week({ mon: range("9:00", "18:00") }))).toEqual({ ok: false, error: "hours_time" });
    expect(parseHours(week({ mon: range("09:00", "25:00") }))).toEqual({ ok: false, error: "hours_time" });
    expect(parseHours(week({ mon: [{ open: "09:00", close: "13:00" }, { open: "12:00", close: "15:00" }] }))).toEqual({ ok: false, error: "hours_overlap" });
    expect(parseHours({ mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] })).toEqual({ ok: false, error: "hours_none_open" });
    expect(parseHours("9 to 5")).toEqual({ ok: false, error: "invalid_hours" });
  });
});
