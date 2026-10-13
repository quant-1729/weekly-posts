import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createMockDb, setMockDbForTests, type MockDb } from "@/lib/db/mock";
import { EmailSendError, getEmailTransport, sendEmail, type SendEmailInput } from "@/lib/email";
import { RESEND_URL } from "@/lib/email/resend";
import { listOutbox, setOutboxDirForTests } from "@/lib/email/outbox";
import { magicLinkEmail } from "@/lib/email/magic-link";
import { APP_NAME } from "@/lib/app";

let db: MockDb;
let outbox: string;

const mail: SendEmailInput = {
  to: "owner@example.com",
  subject: "Your week",
  html: "<p>Hello <b>there</b></p>",
  text: "Hello there",
  kind: "weekly",
  headers: { "List-Unsubscribe": "<https://example.com/u/abc>" },
};

const setResend = () => {
  vi.stubEnv("RESEND_API_KEY", "re_test_key");
  vi.stubEnv("EMAIL_FROM", "Weekly Posts <hello@mail.example.com>");
};
const clearResend = () => {
  vi.stubEnv("RESEND_API_KEY", "");
  vi.stubEnv("EMAIL_FROM", "");
  vi.stubEnv("EMAIL_REPLY_TO", "");
};

async function logRows() {
  return db.withService((tx) =>
    tx.query<{
      kind: string;
      to_email: string;
      subject: string;
      status: string;
      provider_id: string | null;
      error: string | null;
      brand_id: string | null;
      user_id: string | null;
    }>("select kind, to_email, subject, status, provider_id, error, brand_id, user_id from public.email_log order by id"),
  );
}

beforeAll(async () => {
  db = await createMockDb();
  setMockDbForTests(db);
});
afterAll(async () => {
  setMockDbForTests(null);
  await db.close();
});
beforeEach(async () => {
  await db.withAdmin((tx) => tx.query("delete from public.email_log"));
  outbox = await mkdtemp(path.join(os.tmpdir(), "outbox-"));
  setOutboxDirForTests(outbox);
  clearResend();
});
afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  setOutboxDirForTests(null);
  await rm(outbox, { recursive: true, force: true });
});

describe("mock email", () => {
  it("writes the email to the outbox as {timestamp}-{kind}.json with every field", async () => {
    const { id } = await sendEmail(mail);
    const files = await readdir(outbox);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-weekly\.json$/);
    expect(files[0]).toBe(`${id}.json`);

    const saved = JSON.parse(await readFile(path.join(outbox, files[0]), "utf8"));
    expect(saved).toMatchObject({
      id,
      to: mail.to,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
      kind: "weekly",
      headers: mail.headers,
      brandId: null,
      userId: null,
    });
    expect(typeof saved.createdAt).toBe("string");
  });

  it("inserts an email_log row with status sent and the provider id", async () => {
    const { id } = await sendEmail(mail);
    const rows = await logRows();
    expect(rows).toEqual([
      {
        kind: "weekly",
        to_email: mail.to,
        subject: mail.subject,
        status: "sent",
        provider_id: id,
        error: null,
        brand_id: null,
        user_id: null,
      },
    ]);
  });

  it("records the brand and user when given", async () => {
    const [{ id: userId }] = await db.withAdmin((tx) =>
      tx.query<{ id: string }>("insert into auth.users (email) values ('log-owner@example.com') returning id"),
    );
    await db.withService((tx) =>
      tx.query("insert into public.profiles (id, email, consent_at) values ($1, 'log-owner@example.com', now())", [
        userId,
      ]),
    );
    const [{ id: brandId }] = await db.withUser(userId, (tx) =>
      tx.query<{ id: string }>("select public.create_brand('Log brand') as id"),
    );
    await sendEmail({ ...mail, brandId, userId });
    const [row] = await logRows();
    expect(row).toMatchObject({ brand_id: brandId, user_id: userId });
  });

  it("two emails of one kind in the same millisecond do not overwrite each other, and list newest first", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-13T10:00:00.000Z"));
    await sendEmail({ ...mail, subject: "first" });
    await sendEmail({ ...mail, subject: "second" });
    vi.setSystemTime(new Date("2026-10-13T10:00:05.000Z"));
    await sendEmail({ ...mail, subject: "third", kind: "reminder" });
    vi.useRealTimers();

    expect(await readdir(outbox)).toHaveLength(3);
    expect((await listOutbox()).map((m) => m.subject)).toEqual(["third", "second", "first"]);
  });

  it("is used when the Resend variables are not set (or only one is)", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await sendEmail(mail);
    vi.stubEnv("RESEND_API_KEY", "re_test_key"); // no EMAIL_FROM
    await sendEmail(mail);
    clearResend();
    vi.stubEnv("EMAIL_FROM", "hello@mail.example.com"); // no key
    await sendEmail(mail);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await readdir(outbox)).toHaveLength(3);
  });
});

describe("Resend email (fetch is always mocked)", () => {
  it("is used only when RESEND_API_KEY and EMAIL_FROM are both set, via plain fetch", async () => {
    setResend();
    vi.stubEnv("EMAIL_REPLY_TO", "support@example.com");
    const fetchSpy = vi.fn(async () => Response.json({ id: "re_123" }));
    vi.stubGlobal("fetch", fetchSpy);

    const result = await sendEmail({ ...mail, kind: "reminder" });
    expect(result).toEqual({ id: "re_123" });
    expect(await readdir(outbox)).toHaveLength(0); // nothing written to the mock outbox

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(RESEND_URL);
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer re_test_key");
    expect(JSON.parse(init.body as string)).toEqual({
      from: "Weekly Posts <hello@mail.example.com>",
      to: ["owner@example.com"],
      subject: "Your week",
      html: mail.html,
      text: mail.text,
      reply_to: "support@example.com",
      headers: mail.headers,
    });

    expect(await logRows()).toEqual([
      expect.objectContaining({ kind: "reminder", status: "sent", provider_id: "re_123", error: null }),
    ]);
  });

  it("omits reply_to and headers when not given", async () => {
    setResend();
    const fetchSpy = vi.fn(async () => Response.json({ id: "re_1" }));
    vi.stubGlobal("fetch", fetchSpy);
    await sendEmail({ to: "a@example.com", subject: "s", html: "h", text: "t", kind: "magic_link" });
    const [, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body).not.toHaveProperty("reply_to");
    expect(body).not.toHaveProperty("headers");
  });

  it("logs a failed send as failed with the error, and throws", async () => {
    setResend();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ message: "The domain is not verified" }, { status: 403 })),
    );

    await expect(sendEmail(mail)).rejects.toBeInstanceOf(EmailSendError);
    const rows = await logRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "failed", provider_id: null, kind: "weekly" });
    expect(rows[0].error).toContain("403");
    expect(rows[0].error).toContain("The domain is not verified");
    expect(rows[0].error).not.toContain("re_test_key");
  });

  it("logs a network failure as failed", async () => {
    setResend();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );
    await expect(sendEmail(mail)).rejects.toBeInstanceOf(EmailSendError);
    const [row] = await logRows();
    expect(row).toMatchObject({ status: "failed" });
    expect(row.error).toContain("fetch failed");
  });

  it("treats a success answer without an id as a failure", async () => {
    setResend();
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({})));
    await expect(sendEmail(mail)).rejects.toBeInstanceOf(EmailSendError);
    expect((await logRows())[0]).toMatchObject({ status: "failed" });
  });

  it("getEmailTransport picks by env", () => {
    const mock = getEmailTransport();
    setResend();
    const resend = getEmailTransport();
    expect(resend).not.toBe(mock);
  });
});

describe("magic-link email content", () => {
  it("uses the app name, has html and text, and escapes the link in html", () => {
    const link = "http://localhost:3000/auth/callback?token=a.b.c&x=1";
    const m = magicLinkEmail(link);
    expect(m.subject).toContain(APP_NAME);
    expect(m.subject).not.toContain("PostMitra");
    expect(m.html).toContain(APP_NAME);
    expect(m.html).not.toContain("PostMitra");
    expect(m.html).toContain("token=a.b.c&amp;x=1");
    expect(m.text).toContain(link);
    expect(m.text).not.toMatch(/<[a-z]/);
  });
});
