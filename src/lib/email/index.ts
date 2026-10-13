import { getEnv } from "@/lib/env";
import { getDb } from "@/lib/db";
import { createMockEmail } from "./mock";
import { createResendEmail } from "./resend";
import { EmailSendError, type EmailTransport, type SendEmailInput, type SendEmailResult } from "./types";

export { EmailSendError } from "./types";
export type { EmailKind, SendEmailInput, SendEmailResult, EmailTransport } from "./types";

/** Resend when RESEND_API_KEY and EMAIL_FROM are both set; otherwise the mock outbox. */
export function getEmailTransport(): EmailTransport {
  const env = getEnv();
  if (env.resendApiKey && env.emailFrom) {
    return createResendEmail({
      apiKey: env.resendApiKey,
      from: env.emailFrom,
      replyTo: env.emailReplyTo,
    });
  }
  return createMockEmail();
}

async function logEmail(
  input: SendEmailInput,
  status: "sent" | "failed",
  providerId: string | null,
  error: string | null,
): Promise<void> {
  await getDb().withService((tx) =>
    tx.query(
      `insert into public.email_log (brand_id, user_id, kind, to_email, subject, provider_id, status, error)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [input.brandId ?? null, input.userId ?? null, input.kind, input.to, input.subject, providerId, status, error],
    ),
  );
}

/**
 * Sends one email and records it in email_log (status sent or failed). On a
 * failed send the failure is logged and EmailSendError is thrown. A logging
 * problem after a successful send is reported to the console but does not
 * fail the send (the owner already has the email).
 */
export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  let result: SendEmailResult;
  try {
    result = await getEmailTransport().send(input);
  } catch (e) {
    const message = e instanceof Error ? e.message : "unknown error";
    await logEmail(input, "failed", null, message).catch((logErr) =>
      console.error("[email] could not log failed send", logErr),
    );
    throw e instanceof EmailSendError ? e : new EmailSendError(message);
  }
  try {
    await logEmail(input, "sent", result.id, null);
  } catch (logErr) {
    console.error("[email] sent but could not log", logErr);
  }
  return result;
}
