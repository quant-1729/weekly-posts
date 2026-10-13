import { describe, expect, it } from "vitest";
import { normalizeEmail } from "@/lib/auth/email";

describe("normalizeEmail", () => {
  it("trims and lowercases", () => {
    expect(normalizeEmail("  Owner@Example.COM \n")).toBe("owner@example.com");
  });

  it("keeps a plus tag and subdomains", () => {
    expect(normalizeEmail("Jo.Smith+shop@mail.Example.co.uk")).toBe("jo.smith+shop@mail.example.co.uk");
  });

  it("accepts non-Latin letters", () => {
    expect(normalizeEmail("मालिक@example.com")).toBe("मालिक@example.com");
  });

  it.each([
    "",
    "   ",
    "plain",
    "a@b",
    "@example.com",
    "a@@example.com",
    "a b@example.com",
    "a@exa mple.com",
    ".a@example.com",
    "a..b@example.com",
    "a.@example.com",
    "a@example..com",
    "a@-example.com",
    "a@example.com.",
    "<a@example.com>",
    "a@example.com,b@example.com",
    '"a"@example.com',
    "a@example.com\r\nBcc: x@y.com",
    `${"a".repeat(65)}@example.com`,
    `a@${"b".repeat(64)}.com`,
  ])("rejects %j", (input) => {
    expect(normalizeEmail(input)).toBeNull();
  });

  it("rejects non-strings", () => {
    expect(normalizeEmail(undefined)).toBeNull();
    expect(normalizeEmail(null)).toBeNull();
    expect(normalizeEmail(42)).toBeNull();
  });
});
