import { createHash } from "node:crypto";
import { APP_NAME } from "@/lib/app";
import { s } from "@/lib/i18n/strings";
import { escapeHtml as esc } from "./format";

export { escapeHtml as esc } from "./format";

/** What a link handler returns: a status, a title and a trusted HTML body (build it with esc()). */
export interface LinkPage {
  status?: number;
  title: string;
  /** Inner HTML of the page. Escape every dynamic value with esc(). */
  body: string;
  /**
   * JavaScript for the page (the ready page's Share buttons). It must contain no user data: the
   * page CSP allows exactly this script, by hash, and lets the page fetch from its own origin.
   */
  script?: string;
}

const BRAND = "#E4572E";
/** The fish-style theme, in inline CSS (these pages have no stylesheet and may not load fonts): warm cream page, near-black pill buttons. */
const INK = "#1d1d1c";

/**
 * Desktop layout for the no-login pages (decision D10): from 768 px the page is a centred card, 640 px wide.
 * Phones keep the plain 560 px column set inline. A plain style block, so it works without JavaScript
 * (PAGE_CSP allows inline styles).
 */
export const WIDE_PAGE_CSS = `@media (min-width:768px){body{background:#fbfaf9 !important}main{max-width:640px !important;margin:48px auto !important;padding:40px 48px 48px !important;background:#ffffff;border:1px solid rgba(0,0,0,0.05);box-shadow:0 1px 3px rgba(0,0,0,0.04);border-radius:16px}}`;

export const PAGE_CSP =
  "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'";

/** The CSP header of a page: PAGE_CSP, plus the page's own script (by hash) and same-origin fetch when it has one. */
export function pageCsp(page: LinkPage): string {
  if (!page.script) return PAGE_CSP;
  const hash = createHash("sha256").update(page.script).digest("base64");
  return PAGE_CSP.replace("form-action", `script-src 'sha256-${hash}'; connect-src 'self'; form-action`);
}

export function renderPage(page: LinkPage): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="referrer" content="no-referrer">
<title>${esc(page.title)} - ${esc(APP_NAME)}</title>
<style>${WIDE_PAGE_CSS}</style>
</head>
<body style="margin:0;background:#fbfaf9;color:#1d1d1c;font-family:Onest,system-ui,-apple-system,'Segoe UI',Roboto,'Noto Sans',Arial,sans-serif;line-height:1.5;">
<main style="box-sizing:border-box;max-width:560px;margin:0 auto;padding:28px 20px 48px;">
<p style="margin:0 0 4px;font-size:16px;font-weight:600;color:${INK};"><span style="display:inline-block;width:12px;height:12px;border-radius:4px;background:${BRAND};margin-right:8px;"></span>${esc(APP_NAME)}</p>
<h1 style="margin:20px 0 8px;font-size:20px;line-height:28px;font-weight:500;color:#161616;">${esc(page.title)}</h1>
${page.body}
</main>
${page.script ? `<script>${page.script}</script>\n` : ""}</body>
</html>`;
}

export const buttonStyle = (kind: "primary" | "secondary" = "primary") =>
  kind === "primary"
    ? `display:block;box-sizing:border-box;width:100%;border:0;border-radius:9999px;background:${INK};color:#ffffff;font:inherit;font-size:16px;font-weight:500;padding:12px 16px;text-align:center;text-decoration:none;cursor:pointer;`
    : `display:block;box-sizing:border-box;width:100%;border:0;border-radius:9999px;background:#f0e8e4;color:#161616;font:inherit;font-size:16px;font-weight:500;padding:12px 16px;text-align:center;text-decoration:none;cursor:pointer;`;

export const para = (text: string) => `<p style="margin:0 0 20px;color:#554f4c;">${esc(text)}</p>`;

/** A form that POSTs back to the same /e/ token with the CSRF nonce. `fields` are hidden inputs. */
export function postForm(args: {
  token: string;
  nonce: string;
  /** Inner HTML placed before the submit buttons (escape it yourself). */
  before?: string;
  buttons: Array<{ label: string; name?: string; value?: string; kind?: "primary" | "secondary" }>;
}): string {
  const buttons = args.buttons
    .map(
      (b) =>
        `<button type="submit"${b.name ? ` name="${esc(b.name)}" value="${esc(b.value ?? "")}"` : ""} style="${buttonStyle(b.kind)}margin:0 0 12px;">${esc(b.label)}</button>`,
    )
    .join("\n");
  return `<form method="post" action="/e/${esc(args.token)}" style="margin:0;">
<input type="hidden" name="nonce" value="${esc(args.nonce)}">
${args.before ?? ""}
${buttons}
</form>`;
}

export function signInLink(label: string = s.links.signIn): string {
  return `<p style="margin:16px 0 0;"><a href="/login" style="${buttonStyle("secondary")}">${esc(label)}</a></p>`;
}

export function messagePage(title: string, text: string, status = 200, withSignIn = true): LinkPage {
  return { status, title, body: `${para(text)}${withSignIn ? signInLink() : ""}` };
}

export const expiredPage = (): LinkPage => messagePage(s.links.expiredTitle, s.links.expiredBody, 410);
export const timedOutPage = (): LinkPage => messagePage(s.links.timedOutTitle, s.links.timedOutBody, 403, false);
export const unavailablePage = (): LinkPage => messagePage(s.links.unavailableTitle, s.links.unavailableBody, 404);
export const emailsOffPage = (): LinkPage => messagePage(s.links.emailsOffTitle, s.links.emailsOffBody, 403);
export const comingSoonPage = (): LinkPage => messagePage(s.links.comingSoonTitle, s.links.comingSoonBody, 200);

