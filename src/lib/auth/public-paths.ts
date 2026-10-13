import { isDevToolsEnabled } from "@/lib/env";

/**
 * Which paths need no sign-in. Used by src/proxy.ts. Everything else is
 * protected, so a new page is private by default.
 */

// /account/delete is the emailed delete link (GET shows a form; the POST checks its signed token,
// nonce and business name itself); /account/deleted is the page shown after the owner is signed out.
const PUBLIC_EXACT = ["/login", "/terms", "/auth/callback", "/auth/invalid", "/account/delete", "/account/deleted"];
const PUBLIC_PREFIXES = ["/a/", "/s/", "/r/", "/e/", "/i/", "/api/email/", "/api/files/", "/api/whatsapp/", "/api/cron/", "/_next/"];
/** Developer-only pages. Public only when dev tools are enabled (never in production or on Vercel). */
const DEV_EXACT = ["/dev/outbox"];

export function isPublicPath(pathname: string): boolean {
  if (DEV_EXACT.includes(pathname)) return isDevToolsEnabled();
  return PUBLIC_EXACT.includes(pathname) || PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));
}

/** Request header the proxy sets with the page path, so a layout can tell which page it wraps. */
export const PATHNAME_HEADER = "x-pathname";
