import { describe, expect, it } from "vitest";
import { cleanError, fmtTime, fmtUsd, maskEmail, safeDetail, safeHttpUrl } from "@/lib/format";
import { likeContains } from "@/lib/queries/common";

describe("maskEmail", () => {
  it("keeps the first letters and the top-level domain only", () => {
    expect(maskEmail("jane.doe@gmail.com")).toBe("j***@g***.com");
    expect(maskEmail("a@b.co.uk")).toBe("a***@b***.uk");
  });
  it("never shows the middle of the address", () => {
    const m = maskEmail("priyanshu.sharma@figitallabs.com");
    expect(m).not.toContain("priyanshu");
    expect(m).not.toContain("figitallabs");
    expect(m.endsWith(".com")).toBe(true);
  });
  it("copes with missing or odd values", () => {
    expect(maskEmail(null)).toBe("(no email)");
    expect(maskEmail("")).toBe("(no email)");
    expect(maskEmail("not-an-email")).toBe("***");
    expect(maskEmail("@x.com")).toBe("***");
  });
});

describe("safeDetail", () => {
  it("drops keys that look like content or secrets and long strings", () => {
    const out = safeDetail({ code: "E42", caption: "SECRET", note: "x", payment_id: "a@b", token: "t", text: "t", long: "x".repeat(200), n: 3, ok: true, nested: { a: 1 } });
    expect(out).toContain("code=E42");
    expect(out).toContain("n=3");
    expect(out).not.toContain("SECRET");
    expect(out).not.toContain("payment");
    expect(out).not.toContain("token");
    expect(out).not.toContain("xxxx");
    expect(out).not.toContain("nested");
  });
  it("returns an empty string for non-objects", () => {
    expect(safeDetail(null)).toBe("");
    expect(safeDetail([1, 2])).toBe("");
    expect(safeDetail("abc")).toBe("");
  });
});

describe("cleanError", () => {
  it("removes links, tokens and long numbers and cuts the length", () => {
    const e = cleanError("Failed https://graph.facebook.com/v1?access_token=EAAB123 Bearer abc123 id 1234567890123 " + "y".repeat(300));
    expect(e).not.toContain("graph.facebook.com");
    expect(e).not.toContain("EAAB123");
    expect(e).not.toContain("1234567890123");
    expect(e.length).toBeLessThanOrEqual(160);
  });
});

describe("misc helpers", () => {
  it("only allows http(s) links", () => {
    expect(safeHttpUrl("https://instagram.com/p/x")).toContain("https://instagram.com");
    expect(safeHttpUrl("javascript:alert(1)")).toBeNull();
    expect(safeHttpUrl("data:text/html,x")).toBeNull();
    expect(safeHttpUrl(null)).toBeNull();
  });
  it("formats time and money", () => {
    expect(fmtTime("2026-10-15T14:03:59.123456Z")).toBe("2026-10-15 14:03");
    expect(fmtUsd(1.5)).toBe("$1.50");
    expect(fmtUsd(0.0123)).toBe("$0.0123");
  });
  it("escapes LIKE wildcards in searches", () => {
    expect(likeContains("50%_off\\")).toBe("%50\\%\\_off\\\\%");
  });
});
