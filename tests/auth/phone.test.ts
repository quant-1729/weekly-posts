import { describe, expect, it } from "vitest";
import { normalizePhone } from "@/lib/auth/phone";

describe("normalizePhone", () => {
  it.each([
    ["9876543210", "+919876543210"],
    ["98765 43210", "+919876543210"],
    ["+919876543210", "+919876543210"],
    ["+91 98765 43210", "+919876543210"],
    ["91 98765-43210", "+919876543210"],
    ["919876543210", "+919876543210"],
    ["09876543210", "+919876543210"],
    ["  6000000000 ", "+916000000000"],
  ])("accepts %j", (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it.each([
    "",
    "12345",
    "5876543210", // must start 6-9
    "98765432101", // 11 digits, not 0-prefixed
    "+14155550123", // not India
    "+91 5876543210",
    "98765abcde",
    "98765 4321",
    "+91+919876543210",
  ])("rejects %j", (input) => {
    expect(normalizePhone(input)).toBeNull();
  });
});
