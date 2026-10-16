import { isProd, requireEnv } from "./env";
import type { LoginMail } from "./auth";

/** Sends the sign-in link through Resend (plain fetch, no SDK). The body holds the link and nothing else. */
export async function sendLoginEmail(mail: LoginMail): Promise<void> {
  const key = (process.env.RESEND_API_KEY ?? "").trim();
  if (!key) {
    if (!isProd()) {
      // Local development only: show the link in the server console instead of sending it.
      console.log(`[admin-dashboard] sign-in link for ${mail.to}: ${mail.url}`);
      return;
    }
    throw new Error("Missing environment variable RESEND_API_KEY");
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      from: requireEnv("EMAIL_FROM"),
      to: [mail.to],
      subject: "Your Weekly Posts admin sign-in link",
      text: `Open this link to sign in (valid for 15 minutes, works once):\n\n${mail.url}\n\nIf you did not ask for it, ignore this email.`,
      html: `<p>Open this link to sign in (valid for 15 minutes, works once):</p><p><a href="${mail.url}">Sign in to the admin dashboard</a></p><p>If you did not ask for it, ignore this email.</p>`,
    }),
  });
  if (!res.ok) throw new Error(`Resend answered ${res.status}`);
}
