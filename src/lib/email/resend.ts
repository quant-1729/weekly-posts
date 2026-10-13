import { EmailSendError, type EmailTransport } from "./types";

/**
 * Resend over plain fetch (no package). Needs a verified sending domain with
 * SPF, DKIM and DMARC set up, or mail lands in spam (PRD §8).
 * The API key is never put in an error message.
 */

export const RESEND_URL = "https://api.resend.com/emails";
const TIMEOUT_MS = 15_000;

export function createResendEmail(opts: {
  apiKey: string;
  from: string;
  replyTo?: string;
}): EmailTransport {
  return {
    async send(input) {
      let res: Response;
      try {
        res = await fetch(RESEND_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${opts.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: opts.from,
            to: [input.to],
            subject: input.subject,
            html: input.html,
            text: input.text,
            ...(opts.replyTo ? { reply_to: opts.replyTo } : {}),
            ...(input.headers && Object.keys(input.headers).length ? { headers: input.headers } : {}),
          }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch (e) {
        throw new EmailSendError(`Resend request failed: ${e instanceof Error ? e.message : "unknown error"}`);
      }

      const body = (await res.json().catch(() => null)) as { id?: unknown; message?: unknown } | null;
      if (!res.ok) {
        const msg = typeof body?.message === "string" ? body.message : "no details";
        throw new EmailSendError(`Resend answered ${res.status}: ${msg}`);
      }
      if (typeof body?.id !== "string") throw new EmailSendError("Resend answered without an id");
      return { id: body.id };
    },
  };
}
