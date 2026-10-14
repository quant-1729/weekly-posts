/** Matches the email_kind enum in supabase/migrations/0005_v2.sql. */
export type EmailKind =
  | "magic_link"
  | "weekly"
  | "reminder"
  | "late_notice"
  | "paused_notice"
  | "missed_weeks"
  | "account_delete"
  | "payment_confirm"
  | "post_delivery"
  | "connection_problem";

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  /** Plain-text version. Required: it is the fallback when HTML is blocked (PRD §8). */
  text: string;
  kind: EmailKind;
  brandId?: string;
  userId?: string;
  /** Extra headers, for example List-Unsubscribe. */
  headers?: Record<string, string>;
}

export interface SendEmailResult {
  id: string;
}

/** Delivers one email. Mock writes a file; Resend calls its API. Does not log. */
export interface EmailTransport {
  send(input: SendEmailInput): Promise<SendEmailResult>;
}

export class EmailSendError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmailSendError";
  }
}
