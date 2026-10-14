import { afterEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ user: null as { id: string; email: string | null; phone: null } | null }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: async () => session.user }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT ${to}`);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));

import { adminEmails, cleanError, isAdminEmail, maskEmail, requireAdmin } from "@/lib/admin/access";

afterEach(() => {
  vi.unstubAllEnvs();
  session.user = null;
});

describe("isAdminEmail", () => {
  it("admits nobody when the list is empty or unset", () => {
    vi.stubEnv("ADMIN_EMAILS", "");
    expect(adminEmails()).toEqual([]);
    expect(isAdminEmail("a@example.com")).toBe(false);
    expect(isAdminEmail("")).toBe(false);
    vi.stubEnv("ADMIN_EMAILS", " , ,");
    expect(isAdminEmail("a@example.com")).toBe(false);
  });

  it("refuses an email that is not in the list, or no email at all", () => {
    vi.stubEnv("ADMIN_EMAILS", "boss@example.com");
    expect(isAdminEmail("other@example.com")).toBe(false);
    expect(isAdminEmail("xboss@example.com")).toBe(false);
    expect(isAdminEmail(null)).toBe(false);
    expect(isAdminEmail(undefined)).toBe(false);
  });

  it("admits listed emails, ignoring case and spaces on either side", () => {
    vi.stubEnv("ADMIN_EMAILS", "  Boss@Example.com ,second@example.com,, ");
    expect(adminEmails()).toEqual(["boss@example.com", "second@example.com"]);
    expect(isAdminEmail("boss@example.com")).toBe(true);
    expect(isAdminEmail("BOSS@EXAMPLE.COM")).toBe(true);
    expect(isAdminEmail("  second@example.com ")).toBe(true);
  });
});

describe("requireAdmin", () => {
  it("sends a signed-out visitor to /login", async () => {
    vi.stubEnv("ADMIN_EMAILS", "boss@example.com");
    await expect(requireAdmin()).rejects.toThrow("REDIRECT /login");
  });

  it("answers 404 for a signed-in user who is not an admin, and for everyone when the list is empty", async () => {
    vi.stubEnv("ADMIN_EMAILS", "boss@example.com");
    session.user = { id: "u1", email: "owner@example.com", phone: null };
    await expect(requireAdmin()).rejects.toThrow("NOT_FOUND");
    session.user = { id: "u2", email: null, phone: null };
    await expect(requireAdmin()).rejects.toThrow("NOT_FOUND");
    vi.stubEnv("ADMIN_EMAILS", "");
    session.user = { id: "u3", email: "boss@example.com", phone: null };
    await expect(requireAdmin()).rejects.toThrow("NOT_FOUND");
  });

  it("returns the admin for a listed email", async () => {
    vi.stubEnv("ADMIN_EMAILS", "boss@example.com");
    session.user = { id: "u3", email: "Boss@Example.com", phone: null };
    await expect(requireAdmin()).resolves.toMatchObject({ id: "u3", email: "boss@example.com", isAdmin: true });
  });
});

describe("display helpers", () => {
  it("masks owner emails", () => {
    expect(maskEmail("priyanshu@figitallabs.com")).toBe("pr•••@figitallabs.com");
    expect(maskEmail("ab@x.com")).toBe("a•••@x.com");
    expect(maskEmail("a@x.com")).toBe("a•••@x.com");
    expect(maskEmail(null)).toBe("");
  });

  it("cuts error texts to 200 characters and hides long token-like strings", () => {
    expect(cleanError("x ".repeat(300)).length).toBeLessThanOrEqual(200);
    expect(cleanError("Bad token EAAGm0PX4ZCpsBAKzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz sorry")).toBe("Bad token [hidden] sorry");
    expect(cleanError("line one\nline two")).toBe("line one line two");
    expect(cleanError(null)).toBe("");
  });
});
