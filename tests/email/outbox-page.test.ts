import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import OutboxPage from "@/app/dev/outbox/page";
import { setOutboxDirForTests, writeOutbox } from "@/lib/email/outbox";
import { isDevToolsEnabled } from "@/lib/env";

let outbox: string;

async function render(plain = false): Promise<string> {
  const props = plain ? { searchParams: Promise.resolve({ plain: "1" }) } : undefined;
  return renderToString(createElement("div", null, await OutboxPage(props)));
}

beforeEach(async () => {
  outbox = await mkdtemp(path.join(os.tmpdir(), "outbox-"));
  setOutboxDirForTests(outbox);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  setOutboxDirForTests(null);
  await rm(outbox, { recursive: true, force: true });
});

describe("/dev/outbox", () => {
  it("lists emails newest first, each in a sandboxed iframe with srcdoc", async () => {
    await writeOutbox(
      { to: "a@example.com", subject: "Older", html: "<p>old</p>", text: "old", kind: "weekly" },
      new Date("2026-10-13T10:00:00Z"),
    );
    await writeOutbox(
      {
        to: "b@example.com",
        subject: "Newer",
        html: "<p>new</p><script>alert(1)</script>",
        text: "Open http://localhost:3000/auth/callback?token=abc.def",
        kind: "magic_link",
      },
      new Date("2026-10-13T10:05:00Z"),
    );
    const html = await render();

    expect(html.indexOf("Newer")).toBeGreaterThan(-1);
    expect(html.indexOf("Newer")).toBeLessThan(html.indexOf("Older"));
    expect(html.match(/<iframe/g)).toHaveLength(2);
    // Every iframe has an empty sandbox attribute and srcdoc, and the email HTML is escaped inside it.
    for (const tag of html.match(/<iframe[^>]*>/g)!) {
      expect(tag).toMatch(/\bsandbox=""/);
      expect(tag).toMatch(/\bsrcDoc=|\bsrcdoc=/);
      expect(tag).not.toContain("<script>");
    }
    expect(html).not.toContain("<script>alert(1)</script>");
    // The link in the text version is offered as a normal link outside the iframe.
    expect(html).toContain('href="http://localhost:3000/auth/callback?token=abc.def"');
  });

  it("?plain=1 shows the plain-text part instead of the HTML, and the headers", async () => {
    await writeOutbox({
      to: "a@example.com",
      subject: "Weekly",
      html: "<p>the html version</p>",
      text: "the plain version http://localhost:3000/e/abc",
      kind: "weekly",
      headers: { "List-Unsubscribe": "<http://localhost:3000/api/email/unsubscribe?t=abc>" },
    });
    const plain = await render(true);
    expect(plain).not.toContain("<iframe");
    expect(plain).toContain("the plain version");
    expect(plain).toContain("List-Unsubscribe: ");
    expect(plain).toContain('href="/dev/outbox"');
    const html = await render();
    expect(html).toContain("<iframe");
    expect(html).toContain('href="/dev/outbox?plain=1"');
  });

  it("says so when there are no emails", async () => {
    expect(await render()).toContain("No emails yet");
  });

  it("is a 404 in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(isDevToolsEnabled()).toBe(false);
    await expect(OutboxPage()).rejects.toMatchObject({ digest: expect.stringContaining("404") });
  });

  it("is a 404 when VERCEL_ENV is set, whatever its value", async () => {
    for (const v of ["production", "preview", "development"]) {
      vi.stubEnv("VERCEL_ENV", v);
      expect(isDevToolsEnabled()).toBe(false);
      await expect(OutboxPage()).rejects.toMatchObject({ digest: expect.stringContaining("404") });
    }
  });

  it("is enabled in development and test, and with a blank VERCEL_ENV", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("VERCEL_ENV", "");
    expect(isDevToolsEnabled()).toBe(true);
  });
});
