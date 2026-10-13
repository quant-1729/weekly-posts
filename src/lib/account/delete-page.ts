import { APP_NAME } from "@/lib/app";
import { fill, s } from "@/lib/i18n/strings";

/** The small pages behind the emailed delete link. Plain HTML, no script. */

function esc(v: string): string {
  return v
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function shell(title: string, inner: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(title)}</title>
</head>
<body style="margin:0;background:#ffffff;color:#1c1917;font-family:system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif;">
<main style="box-sizing:border-box;max-width:480px;min-height:100vh;margin:0 auto;padding:32px 20px;display:flex;flex-direction:column;justify-content:center;">
<p style="margin:0 0 4px;font-size:24px;font-weight:700;color:#E4572E;">${esc(APP_NAME)}</p>
${inner}
</main>
</body>
</html>`;
}

/** "Delete everything? This can't be undone. Type your business name to confirm." */
export function deleteConfirmHtml(args: { token: string; nonce: string; name: string; error?: string }): string {
  const c = s.account.confirmPage;
  const err = args.error
    ? `<p role="alert" style="margin:0 0 16px;color:#b42318;">${esc(args.error)}</p>`
    : "";
  return shell(
    c.title,
    `<h1 style="margin:16px 0 8px;font-size:20px;font-weight:600;">${esc(c.title)}</h1>
<p style="margin:0 0 12px;color:#57534e;">${esc(c.body)}</p>
<p style="margin:0 0 20px;color:#57534e;">${esc(c.whatIsDeleted)}</p>
<form method="post" action="/account/delete">
<input type="hidden" name="token" value="${esc(args.token)}">
<input type="hidden" name="nonce" value="${esc(args.nonce)}">
<label for="confirm_name" style="display:block;margin:0 0 4px;font-weight:600;">${esc(c.nameLabel)}</label>
<p style="margin:0 0 8px;font-size:14px;color:#57534e;">${esc(fill(c.nameHint, { name: args.name }))}</p>
<input id="confirm_name" name="confirm_name" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" required maxlength="200" style="box-sizing:border-box;width:100%;border:1px solid #d6d3d1;border-radius:8px;padding:12px;font-size:16px;margin:0 0 16px;">
${err}
<button type="submit" style="width:100%;border:0;border-radius:8px;background:#b42318;color:#ffffff;font-size:18px;font-weight:600;padding:12px 16px;cursor:pointer;">${esc(c.button)}</button>
</form>
<p style="margin:20px 0 0;"><a href="/brand" style="color:#57534e;">${esc(c.cancel)}</a></p>`,
  );
}

/** The link is not valid: expired, used, forged or not ours. */
export function deleteInvalidHtml(): string {
  const c = s.account.invalidPage;
  return shell(
    c.title,
    `<h1 style="margin:16px 0 8px;font-size:20px;font-weight:600;">${esc(c.title)}</h1>
<p style="margin:0 0 20px;color:#57534e;">${esc(c.body)}</p>
<p style="margin:0;"><a href="/brand" style="color:#E4572E;">${esc(c.link)}</a></p>`,
  );
}

/** The delete failed part way. Nothing is lost: the link still works. */
export function deleteFailedHtml(args: { token: string; nonce: string; name: string }): string {
  return deleteConfirmHtml({ ...args, error: s.account.confirmPage.failed });
}
