import { APP_NAME } from "@/lib/app";
import { fill, s } from "@/lib/i18n/strings";

function escapeHtml(v: string): string {
  return v
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** The sign-in email: short, plain HTML plus a text version. */
export function magicLinkEmail(link: string): { subject: string; html: string; text: string } {
  const t = s.login.email;
  const vars = { appName: APP_NAME };
  const href = escapeHtml(link);

  const html = `<!doctype html>
<html lang="en">
<body style="margin:0;padding:24px;background:#fafaf9;font-family:Arial,Helvetica,sans-serif;color:#1c1917;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:8px;padding:24px;">
<tr><td>
<p style="margin:0 0 16px;font-size:20px;font-weight:bold;color:#E4572E;">${escapeHtml(APP_NAME)}</p>
<p style="margin:0 0 20px;font-size:16px;line-height:1.5;">${escapeHtml(fill(t.intro, vars))}</p>
<p style="margin:0 0 20px;"><a href="${href}" style="display:inline-block;background:#E4572E;color:#ffffff;text-decoration:none;font-weight:bold;font-size:16px;padding:12px 24px;border-radius:8px;">${escapeHtml(t.button)}</a></p>
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
