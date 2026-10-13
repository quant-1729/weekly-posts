import { APP_NAME } from "@/lib/app";
import { takeAll } from "@/lib/auth/rate-limit";
import { getDb } from "@/lib/db";
import { sendEmail, EmailSendError } from "@/lib/email";
import { getEnv } from "@/lib/env";
import { fill, s } from "@/lib/i18n/strings";
import { registerDeleteLink, signDeleteToken } from "./delete-link";

/**
 * Step one of deleting an account: email the signed-in owner a confirmation link. Nothing is
 * deleted until they open the link and type their business name (see app/account/delete/route.ts).
 */

export const DELETE_EMAILS_PER_HOUR = 3;

export type AccountRequestErrorCode = "no_email" | "rate_limited" | "email_failed";

export class AccountRequestError extends Error {
  constructor(public readonly code: AccountRequestErrorCode) {
    super(code);
    this.name = "AccountRequestError";
  }
}

function escapeHtml(v: string): string {
  return v
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function deleteConfirmationEmail(link: string): { subject: string; html: string; text: string } {
  const t = s.account.email;
  const vars = { appName: APP_NAME };
  const href = escapeHtml(link);
  const html = `<!doctype html>
<html lang="en">
<body style="margin:0;padding:24px;background:#fafaf9;font-family:Arial,Helvetica,sans-serif;color:#1c1917;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:8px;padding:24px;">
<tr><td>
<p style="margin:0 0 16px;font-size:20px;font-weight:bold;color:#E4572E;">${escapeHtml(APP_NAME)}</p>
<p style="margin:0 0 20px;font-size:16px;line-height:1.5;">${escapeHtml(fill(t.intro, vars))}</p>
<p style="margin:0 0 20px;"><a href="${href}" style="display:inline-block;background:#B42318;color:#ffffff;text-decoration:none;font-weight:bold;font-size:16px;padding:12px 24px;border-radius:8px;">${escapeHtml(t.button)}</a></p>
<p style="margin:0 0 8px;font-size:13px;color:#57534e;">${escapeHtml(t.linkFallback)}</p>
<p style="margin:0 0 20px;font-size:13px;word-break:break-all;"><a href="${href}" style="color:#57534e;">${href}</a></p>
<p style="margin:0;font-size:13px;color:#57534e;">${escapeHtml(t.ignore)}</p>
</td></tr>
</table>
</body>
</html>`;
  const text = [fill(t.intro, vars), "", link, "", t.ignore, ""].join("\n");
  return { subject: fill(t.subject, vars), html, text };
}

/**
 * Emails the delete-confirmation link to the account's own address, logged with kind "account_delete"
 * (migration 0009). EmailKind in src/lib/email/types.ts does not list it yet, hence the cast.
 */
export async function requestAccountDeletion(
  user: { id: string; email: string | null },
  nowMs: number = Date.now(),
): Promise<{ email: string }> {
  if (!user.email) throw new AccountRequestError("no_email");
  if (!takeAll([{ key: `delete-email:${user.id}`, limit: DELETE_EMAILS_PER_HOUR, windowMs: 60 * 60 * 1000 }], nowMs)) {
    throw new AccountRequestError("rate_limited");
  }
  const base = getEnv().appUrl;
  if (!base) throw new Error("NEXT_PUBLIC_APP_URL is required to build links in production.");

  const { token, jti, expiresAt } = await signDeleteToken({ id: user.id, email: user.email }, nowMs);
  await registerDeleteLink(jti, expiresAt);
  const message = deleteConfirmationEmail(`${base}/account/delete?token=${encodeURIComponent(token)}`);
  try {
    await sendEmail({ to: user.email, kind: "account_delete", userId: user.id, ...message });
  } catch (e) {
    if (e instanceof EmailSendError) throw new AccountRequestError("email_failed");
    throw e;
  }
  return { email: user.email };
}

/** What the owner must type to confirm: their business name, or their email if they have no business yet. */
export async function confirmationNameFor(userId: string): Promise<string | null> {
  const rows = await getDb().withService((tx) =>
    tx.query<{ name: string | null }>(
      `select coalesce(
                (select b.name from public.brand_members bm join public.brands b on b.id = bm.brand_id
                  where bm.user_id = $1 order by bm.created_at, b.id limit 1),
                (select p.email from public.profiles p where p.id = $1)) as name`,
      [userId],
    ),
  );
  return rows[0]?.name ?? null;
}

const normalizeName = (v: string) => v.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();

/** Typed name matches, ignoring case and extra spaces. */
export function namesMatch(typed: string, expected: string): boolean {
  const t = normalizeName(typed);
  return t.length > 0 && t === normalizeName(expected);
}
