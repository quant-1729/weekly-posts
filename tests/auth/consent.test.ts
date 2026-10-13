import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/(auth)/login/actions", () => ({ requestLinkAction: vi.fn() }));

import { LoginForm } from "@/app/(auth)/login/login-form";
import { s } from "@/lib/i18n/strings";

describe("login consent line (H-12)", () => {
  it("says owners can delete their data any time in settings, and links Terms and privacy", () => {
    expect(s.login.consent).toContain("delete your data any time in settings");
    expect(s.login.consent).not.toMatch(/ask us/i);
    const html = renderToString(createElement(LoginForm, { showDevLink: false }));
    expect(html).toContain("delete your data any time in settings");
    expect(html).toMatch(/<a [^>]*href="\/terms"[^>]*>Terms and privacy<\/a>/);
  });
});
