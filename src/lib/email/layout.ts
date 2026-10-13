import { APP_NAME } from "@/lib/app";
import { getEnv } from "@/lib/env";
import { fill, s } from "@/lib/i18n/strings";
import { escapeHtml } from "@/lib/links/format";
import { appBase, linkUrl, signLink } from "@/lib/links/tokens";

/**
 * Shared pieces of the HTML emails (docs/email-links.md section 4; AC 14).
 *
 * Built to known-safe rules, since we cannot test in Gmail and Outlook here: tables only (no
 * flex or grid), every style inline, widths in attributes, images with explicit width, height and
 * alt, no <style>, script, form or SVG, and explicit colours on every container so dark-mode
 * clients do not turn white text into white-on-white. tests/email/html-lint.test.ts checks these.
 */

export const esc = escapeHtml;

export const FONT = "-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
export const COLORS = {
  page: "#f5f5f4",
  card: "#ffffff",
  text: "#1c1917",
  muted: "#57534e",
  line: "#e7e5e4",
  button: "#C2410C",
  buttonText: "#ffffff",
  secondary: "#f5f5f4",
  secondaryText: "#1c1917",
  warnBg: "#fef3c7",
  warnText: "#92400e",
} as const;

/** One bulletproof button: a link inside a table cell that carries the background colour. */
export function button(href: string, label: string, kind: "primary" | "secondary" = "primary", wide = false): string {
  const bg = kind === "primary" ? COLORS.button : COLORS.secondary;
  const fg = kind === "primary" ? COLORS.buttonText : COLORS.secondaryText;
  const border = kind === "primary" ? `1px solid ${COLORS.button}` : "1px solid #d6d3d1";
  const size = wide ? 18 : 15;
  const pad = wide ? "16px 12px" : "12px 4px";
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" bgcolor="${bg}" style="background-color:${bg};border:${border};border-radius:6px;padding:${pad};"><a href="${esc(href)}" target="_blank" style="display:block;font-family:${FONT};font-size:${size}px;line-height:20px;font-weight:bold;color:${fg};text-decoration:none;background-color:${bg};">${esc(label)}</a></td></tr></table>`;
}

/** Several equal-width buttons in one row (three cells; stays in a row on phones). */
export function buttonRow(buttons: Array<{ href: string; label: string; kind?: "primary" | "secondary" }>): string {
  const width = Math.floor(100 / buttons.length);
  const cells = buttons
    .map(
      (b, i) =>
        `<td width="${width}%" valign="top" style="width:${width}%;padding:0 ${i === buttons.length - 1 ? 0 : 6}px 0 0;">${button(b.href, b.label, b.kind ?? "secondary")}</td>`,
    )
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>${cells}</tr></table>`;
}

export function paragraph(text: string, opts: { size?: number; color?: string; bold?: boolean; margin?: string } = {}): string {
  return `<p style="margin:${opts.margin ?? "0 0 12px"};font-family:${FONT};font-size:${opts.size ?? 16}px;line-height:1.5;color:${opts.color ?? COLORS.text};${opts.bold ? "font-weight:bold;" : ""}">${esc(text)}</p>`;
}

/** A table row holding `inner` with the standard side padding. */
export function row(inner: string, padding = "20px 20px 0 20px"): string {
  return `<tr><td bgcolor="${COLORS.card}" style="background-color:${COLORS.card};padding:${padding};">${inner}</td></tr>`;
}

export function shell(args: { title: string; preheader: string; rows: string[] }): string {
  const pre = esc(args.preheader);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${esc(args.title)}</title>
</head>
<body style="margin:0;padding:0;background-color:${COLORS.page};">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${COLORS.page};">${pre}${"&nbsp;&zwnj;".repeat(40)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${COLORS.page}" style="background-color:${COLORS.page};"><tr><td align="center" style="padding:16px 8px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" bgcolor="${COLORS.card}" style="width:100%;max-width:600px;background-color:${COLORS.card};">
${args.rows.join("\n")}
</table>
</td></tr></table>
</body>
</html>`;
}

/** Heading row with the app name. */
export function headerRow(brandName: string): string {
  return row(
    `${paragraph(APP_NAME, { size: 22, bold: true, color: COLORS.button, margin: "0 0 2px" })}${paragraph(fill(s.email.forBrand, { name: brandName }), { size: 14, color: COLORS.muted, margin: "0" })}`,
    "24px 20px 0 20px",
  );
}

export interface FooterLinks {
  pauseUrl: string;
  unsubscribeUrl: string;
}

/** Footer: why they get this email, Pause for 2 weeks, Unsubscribe (Req 24). */
export function footerRow(brandName: string, links: FooterLinks): string {
  const e = s.email;
  const link = (href: string, label: string) =>
    `<a href="${esc(href)}" target="_blank" style="color:${COLORS.muted};text-decoration:underline;">${esc(label)}</a>`;
  return row(
    `<p style="margin:0 0 8px;font-family:${FONT};font-size:13px;line-height:1.5;color:${COLORS.muted};">${esc(fill(e.footerWhy, { appName: APP_NAME, name: brandName }))}</p>
<p style="margin:0;font-family:${FONT};font-size:13px;line-height:1.5;color:${COLORS.muted};">${link(links.pauseUrl, e.pause)} &nbsp;|&nbsp; ${link(links.unsubscribeUrl, e.unsubscribe)}</p>`,
    "24px 20px 24px 20px",
  );
}

export function footerText(brandName: string, links: FooterLinks): string[] {
  const e = s.email;
  return [
    "--",
    fill(e.footerWhy, { appName: APP_NAME, name: brandName }),
    `${e.pause}: ${links.pauseUrl}`,
    `${e.unsubscribe}: ${links.unsubscribeUrl}`,
  ];
}

/** The address in EMAIL_REPLY_TO ("a@b.com" or "Name <a@b.com>"), or null. */
function replyAddress(): string | null {
  const raw = getEnv().emailReplyTo;
  if (!raw) return null;
  const m = /<([^<>\s]+@[^<>\s]+)>/.exec(raw) ?? /^([^<>\s]+@[^<>\s]+)$/.exec(raw.trim());
  return m ? m[1] : null;
}

/**
 * List-Unsubscribe headers with RFC 8058 one-click (POST /api/email/unsubscribe?t=...). The
 * mailto: form is added only when EMAIL_REPLY_TO is set.
 */
export function unsubscribeHeaders(unsubscribeToken: string): Record<string, string> {
  const parts = [`<${appBase()}/api/email/unsubscribe?t=${unsubscribeToken}>`];
  const mailto = replyAddress();
  if (mailto) parts.push(`<mailto:${mailto}?subject=unsubscribe>`);
  return {
    "List-Unsubscribe": parts.join(", "),
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}

/** The pause and unsubscribe links, headers included, for one email. */
export async function footerParts(brandId: string, now?: Date) {
  const [pauseToken, unsubToken] = await Promise.all([
    signLink({ brandId, act: "pause", now }),
    signLink({ brandId, act: "unsubscribe", now }),
  ]);
  return {
    links: { pauseUrl: linkUrl(pauseToken), unsubscribeUrl: linkUrl(unsubToken) } satisfies FooterLinks,
    headers: unsubscribeHeaders(unsubToken),
  };
}
