import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_TTL_S, readSessionToken } from "./auth";
import { isProd } from "./env";

// "__Host-" cookies must be Secure with Path=/ and no Domain, which is what we want in production. On plain
// http://localhost the plain name is used.
export const sessionCookieName = () => (isProd() ? "__Host-admin_session" : "admin_session");

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: isProd(),
    sameSite: "strict" as const,
    path: "/",
    maxAge: SESSION_TTL_S,
  };
}

/** The signed-in admin's email, or null. */
export async function currentAdmin(): Promise<string | null> {
  const jar = await cookies();
  return readSessionToken(jar.get(sessionCookieName())?.value);
}

/** Every page and every server action starts with this. */
export async function requireAdmin(): Promise<string> {
  const email = await currentAdmin();
  if (!email) redirect("/login");
  return email;
}
