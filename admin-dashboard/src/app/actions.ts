"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { consumeLinkToken, createSessionToken, requestLoginLink } from "@/lib/auth";
import { db } from "@/lib/db";
import { sendLoginEmail } from "@/lib/mail";
import { revokeSession } from "@/lib/queries/admin";
import { requireAdmin, sessionCookieName, sessionCookieOptions } from "@/lib/session";

/** Asks for a sign-in link. The answer is the same whether or not the address is allowed (no enumeration). */
export async function requestLinkAction(formData: FormData): Promise<void> {
  try {
    const mail = await requestLoginLink(formData.get("email"));
    if (mail) {
      // Sent after the response goes out, so the request takes the same time for every address.
      after(async () => {
        try {
          await sendLoginEmail(mail);
        } catch (e) {
          console.error("[admin-dashboard] could not send the sign-in email:", e instanceof Error ? e.message : "error");
        }
      });
    }
  } catch (e) {
    console.error("[admin-dashboard] sign-in request failed:", e instanceof Error ? e.message : "error");
  }
  redirect("/login?sent=1");
}

/** The button on /auth/verify. Opening the emailed link alone never signs anyone in (mail scanners open links). */
export async function confirmSignInAction(formData: FormData): Promise<void> {
  const token = formData.get("t");
  const email = await consumeLinkToken(typeof token === "string" ? token : null);
  if (!email) redirect("/login?error=1");
  const jar = await cookies();
  jar.set(sessionCookieName(), createSessionToken(email), sessionCookieOptions());
  redirect("/");
}

export async function signOutAction(): Promise<void> {
  const admin = await requireAdmin();
  await db().query(
    "insert into public.admin_actions (admin_email, action, target, detail) values ($1, 'sign_out', null, '{}'::jsonb)",
    [admin],
  );
  const jar = await cookies();
  jar.delete(sessionCookieName());
  redirect("/login");
}

/** Signs one device out (sets revoked_at / revoked_by = 'admin' and logs it). */
export async function revokeSessionAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const id = formData.get("id");
  if (typeof id === "string") await revokeSession(admin, id);
  revalidatePath("/devices");
  revalidatePath("/users", "layout");
  revalidatePath("/");
}
