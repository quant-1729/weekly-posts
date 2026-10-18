import { NextResponse, type NextRequest } from "next/server";
import { AccountDeleteError, deleteAccount } from "@/lib/account/delete";
import {
  DELETE_CSRF_COOKIE,
  claimDeleteLink,
  deleteCsrfCookieOptions,
  deleteNonce,
  deleteNonceMatches,
  isCsrfSecret,
  isDeleteLinkUnused,
  newCsrfSecret,
  releaseDeleteLink,
  verifyDeleteToken,
  type DeleteLinkPayload,
} from "@/lib/account/delete-link";
import { deleteConfirmHtml, deleteFailedHtml, deleteInvalidHtml } from "@/lib/account/delete-page";
import { confirmationNameFor, namesMatch } from "@/lib/account/request-delete";
import { signOut } from "@/lib/auth";
import { currentSessionIsDemo } from "@/lib/demo/guard";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/session";
import { s } from "@/lib/i18n/strings";
import { publicUrl } from "@/lib/links/public-url";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The emailed "delete my account" link (Req 22), in two steps like the sign-in link
 * (docs/email-links.md section 1).
 *
 * GET shows "Delete everything?" with a field for the business name and changes nothing, so a
 * mail scanner that opens the link does not use it up or delete anything. Only the POST,
 * with the single-use link, the CSRF nonce and the typed business name, deletes the account,
 * signs the browser out and redirects (303) to /account/deleted.
 */

const HTML = { "Content-Type": "text/html; charset=utf-8" };

function harden(res: NextResponse): NextResponse {
  res.headers.set("Referrer-Policy", "no-referrer");
  res.headers.set("Cache-Control", "no-store");
  // The button on this page must not be framed and clicked by another site.
  res.headers.set("X-Frame-Options", "DENY");
  res.headers.set("Content-Security-Policy", "frame-ancestors 'none'; form-action 'self'");
  return res;
}

const invalid = () => harden(new NextResponse(deleteInvalidHtml(), { status: 410, headers: HTML }));

/** The token's payload if it is genuine, not expired and not used yet. */
async function usable(token: string | null | undefined): Promise<DeleteLinkPayload | null> {
  const payload = await verifyDeleteToken(token);
  if (!payload || !(await isDeleteLinkUnused(payload.jti))) return null;
  return payload;
}

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  let payload: DeleteLinkPayload | null = null;
  try {
    payload = await usable(token);
  } catch (e) {
    console.error("[account] delete link check", e);
  }
  if (!token || !payload) return invalid();

  const name = (await confirmationNameFor(payload.uid)) ?? "";
  // Two tabs from the same browser share one cookie, so both forms stay valid.
  const existing = request.cookies.get(DELETE_CSRF_COOKIE)?.value;
  const secret = isCsrfSecret(existing) ? existing : newCsrfSecret();
  const res = harden(
    new NextResponse(deleteConfirmHtml({ token, nonce: deleteNonce(payload.jti, secret), name }), { status: 200, headers: HTML }),
  );
  res.cookies.set(DELETE_CSRF_COOKIE, secret, deleteCsrfCookieOptions());
  return res;
}

export async function POST(request: NextRequest) {
  let token: string | undefined;
  let nonce: string | undefined;
  let typed = "";
  try {
    const form = await request.formData();
    const t = form.get("token");
    const n = form.get("nonce");
    const c = form.get("confirm_name");
    token = typeof t === "string" ? t : undefined;
    nonce = typeof n === "string" ? n : undefined;
    typed = typeof c === "string" ? c : "";
  } catch {
    return invalid();
  }

  const cookieSecret = request.cookies.get(DELETE_CSRF_COOKIE)?.value;
  let payload: DeleteLinkPayload | null = null;
  try {
    payload = await usable(token);
  } catch (e) {
    console.error("[account] delete link check", e);
  }
  if (!token || !payload) return invalid();
  // Not from our own page in this browser: refuse before the link is used up.
  if (!deleteNonceMatches(payload.jti, cookieSecret, nonce) || !isCsrfSecret(cookieSecret)) return invalid();

  const expected = await confirmationNameFor(payload.uid);
  const page = { token, nonce: deleteNonce(payload.jti, cookieSecret), name: expected ?? "" };
  // A demo session never deletes an account, even with a valid link (docs/15-demo-login.md).
  if (await currentSessionIsDemo()) {
    return harden(new NextResponse(deleteConfirmHtml({ ...page, error: s.demo.refused }), { status: 403, headers: HTML }));
  }
  if (expected === null || !namesMatch(typed, expected)) {
    return harden(
      new NextResponse(deleteConfirmHtml({ ...page, error: s.account.confirmPage.wrongName }), { status: 422, headers: HTML }),
    );
  }

  // One statement marks the link used, so two clicks at once cannot both delete.
  if (!(await claimDeleteLink(payload.jti))) return invalid();
  try {
    await deleteAccount(payload.uid);
  } catch (e) {
    // Give the link back so the owner can try again; deleteAccount can be run again safely.
    await releaseDeleteLink(payload.jti).catch(() => undefined);
    if (!(e instanceof AccountDeleteError)) console.error("[account] delete failed", e);
    return harden(new NextResponse(deleteFailedHtml(page), { status: 500, headers: HTML }));
  }

  // Sign this browser out, but only if it was signed in as the deleted account.
  const session = await verifySession(request.cookies.get(SESSION_COOKIE)?.value);
  if (session?.sub === payload.uid) await signOut();

  const url = publicUrl(request); // behind Cloud Run's proxy the request's own host is internal (0.0.0.0:8080)
  url.pathname = "/account/deleted";
  url.search = "";
  const res = harden(NextResponse.redirect(url, 303));
  res.cookies.delete({ name: DELETE_CSRF_COOKIE, path: "/account/delete" });
  return res;
}
