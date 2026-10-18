// Who may open the read-only admin dashboard (/admin). One place decides: the signed-in user's email
// must be in ADMIN_EMAILS. Anyone else, and an empty list, gets a plain 404 so the page does not
// reveal that it exists. Every page, action or route the dashboard uses calls requireAdmin() itself.

import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getEnv } from "@/lib/env";

/** Proof that requireAdmin() passed. The metrics reader asks for it, so it cannot be called without the check. */
export interface AdminUser {
  readonly id: string;
  readonly email: string;
  readonly isAdmin: true;
}

/** The allowed emails from ADMIN_EMAILS: trimmed, lower-case, blanks dropped. */
export function adminEmails(): string[] {
  return getEnv().adminEmails;
}

/** True when `email` is in ADMIN_EMAILS (case and surrounding spaces ignored). An empty list admits nobody. */
export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const list = adminEmails();
  return list.length > 0 && list.includes(email.trim().toLowerCase());
}

/**
 * Signed out: redirect to /login. Signed in but not an admin (or no admins configured): 404.
 * Call at the top of the page and of every server action or route used by the dashboard.
 */
export async function requireAdmin(): Promise<AdminUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.demo || !isAdminEmail(user.email)) notFound(); // a demo session never opens the dashboard
  return { id: user.id, email: user.email!.trim().toLowerCase(), isAdmin: true };
}

/** "pr•••@figitallabs.com": enough to recognise an owner, not enough to contact them. */
export function maskEmail(email: string | null | undefined): string {
  if (!email) return "";
  const at = email.lastIndexOf("@");
  if (at < 1) return "•••";
  const local = email.slice(0, at);
  return `${local.slice(0, Math.min(2, Math.max(1, local.length - 1)))}•••${email.slice(at)}`;
}

/** An error text safe to show: long token-like strings hidden, newlines flattened, cut to 200 characters. */
export function cleanError(text: string | null | undefined): string {
  if (!text) return "";
  const flat = text
    .replace(/\s+/g, " ")
    .replace(/[A-Za-z0-9_\-.~+/=]{32,}/g, "[hidden]")
    .trim();
  return flat.length > 200 ? `${flat.slice(0, 199)}…` : flat;
}
