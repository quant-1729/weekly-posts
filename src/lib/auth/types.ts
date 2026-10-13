export interface AuthUser {
  id: string;
  email: string | null;
  /** Only v1 owners have one; email sign-in does not set it. */
  phone: string | null;
}

export type AuthErrorCode =
  | "invalid_email"
  | "consent_required"
  | "rate_limited"
  | "invalid_link"
  | "email_failed"
  | "not_available";

export class AuthError extends Error {
  constructor(
    public readonly code: AuthErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = "AuthError";
  }
}

/** Email magic-link sign-in (Req 1). Mock and Supabase implement the same interface. */
export interface Auth {
  /**
   * Emails a single-use sign-in link. `consent` must be true. Resolves the same
   * way whether or not the address already has an account. `ip` is used for the
   * per-IP rate limit.
   */
  requestMagicLink(email: string, consent: boolean, opts?: { ip?: string }): Promise<void>;
  /**
   * True when the token is genuine, not expired and not used yet. Changes nothing: mail
   * scanners open links before the owner does, so the page that shows "Continue" only
   * looks (docs/email-links.md section 1).
   */
  checkMagicLink(token: string): Promise<boolean>;
  /**
   * Checks the link's token (signature, expiry, not used before), marks it used,
   * finds or creates the user and profile (storing consent time for a new
   * owner), and starts the session cookie. Throws AuthError("invalid_link").
   */
  consumeMagicLink(token: string): Promise<AuthUser>;
  /** The signed-in user from the session cookie, or null. */
  getCurrentUser(): Promise<AuthUser | null>;
  signOut(): Promise<void>;
}
