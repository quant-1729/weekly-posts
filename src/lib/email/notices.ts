import { APP_NAME } from "@/lib/app";
import { s } from "@/lib/i18n/strings";
import { appBase, linkUrl, signLink } from "@/lib/links/tokens";
import { button, footerParts, footerRow, footerText, headerRow, paragraph, row, shell } from "./layout";

/** Short one-message emails (PRD section 8): the late notice and the "we paused your emails" notice. */

export interface BuiltEmail {
  subject: string;
  html: string;
  text: string;
  headers: Record<string, string>;
}

interface NoticeInput {
  brand: { id: string; name: string };
  now?: Date;
}

/** The late notice (§8): says retries stopped and points to the dashboard button. */
export async function buildLateNotice({ brand, now }: NoticeInput): Promise<BuiltEmail> {
  const n = s.email.lateNotice;
  const { links, headers } = await footerParts(brand.id, now);
  const dashboardUrl = `${appBase()}/week`;
  const html = shell({
    title: n.subject,
    preheader: n.preheader,
    rows: [
      headerRow(brand.name),
      row(paragraph(n.body, { size: 18 }), "24px 20px 0 20px"),
      row(button(dashboardUrl, n.button, "primary", true), "8px 20px 0 20px"),
      footerRow(brand.name, links),
    ],
  });
  const text = [`${APP_NAME} - ${brand.name}`, "", n.body, "", `${n.button}: ${dashboardUrl}`, "", ...footerText(brand.name, links), ""].join("\n");
  return { subject: n.subject, html, text, headers };
}

/** "We've paused your weekly posts. Want them back?" with a one-tap resume button. */
export async function buildPausedNotice({ brand, now }: NoticeInput): Promise<BuiltEmail> {
  const n = s.email.pausedNotice;
  const [{ links, headers }, resumeToken] = await Promise.all([
    footerParts(brand.id, now),
    signLink({ brandId: brand.id, act: "resume", now }),
  ]);
  const resumeUrl = linkUrl(resumeToken);
  const html = shell({
    title: n.subject,
    preheader: n.preheader,
    rows: [
      headerRow(brand.name),
      row(`${paragraph(n.body, { size: 18, bold: true })}${paragraph(n.detail)}`, "24px 20px 0 20px"),
      row(button(resumeUrl, n.button, "primary", true), "8px 20px 0 20px"),
      footerRow(brand.name, links),
    ],
  });
  const text = [`${APP_NAME} - ${brand.name}`, "", n.body, n.detail, "", `${n.button}: ${resumeUrl}`, "", ...footerText(brand.name, links), ""].join("\n");
  return { subject: n.subject, html, text, headers };
}
