// Environment access. Everything here is server-only: no browser-exposed variables exist in this app, so nothing is ever
// compiled into browser code.

function read(name: string): string {
  return (process.env[name] ?? "").trim();
}

export function requireEnv(name: string): string {
  const v = read(name);
  if (!v) throw new Error(`Missing environment variable ${name}`);
  return v;
}

/** The addresses allowed to sign in (lower case). Empty = nobody. */
export function adminEmails(): string[] {
  return read("ADMIN_EMAILS")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function isAdminEmail(email: string): boolean {
  const e = email.trim().toLowerCase();
  return e.length > 0 && adminEmails().includes(e);
}

export function authSecret(): string {
  const s = read("ADMIN_AUTH_SECRET");
  if (s.length < 32) throw new Error("ADMIN_AUTH_SECRET must be at least 32 characters");
  return s;
}

export function appUrl(): string {
  return (read("ADMIN_APP_URL") || "http://localhost:3100").replace(/\/+$/, "");
}

export const isProd = () => process.env.NODE_ENV === "production";
