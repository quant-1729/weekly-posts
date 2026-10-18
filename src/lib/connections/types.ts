import type { Provider } from "@/lib/queue/types";

export type ConnectionStatus = "active" | "expired" | "revoked" | "error";

/** What the screens and the publisher see of a connection. Never holds a token. */
export interface ConnectionView {
  id: string;
  brandId: string;
  provider: Provider;
  accountId: string;
  accountName: string | null;
  status: ConnectionStatus;
  /** When the token stops working; null for Facebook Page tokens, which do not expire. */
  expiresAt: string | null;
  lastError: string | null;
  connectedAt: string;
  /** Active, but the token ends within 10 days (the daily refresh did not renew it yet). */
  expiresSoon: boolean;
}

export type ConnectionErrorCode =
  | "not_owner"
  | "not_configured"
  | "key_missing"
  | "bad_state"
  | "denied"
  | "missing_permission"
  | "personal_account"
  | "exchange_failed"
  | "no_pages"
  | "page_not_found"
  | "pending_expired"
  | "no_token"
  | "demo"; // a demo session (docs/15-demo-login.md)

export class ConnectionError extends Error {
  constructor(public readonly code: ConnectionErrorCode) {
    super(`Connection: ${code}`);
    this.name = "ConnectionError";
  }
}

/** Facebook Login finished but the owner still has to pick a Page. */
export interface PagePick {
  id: string;
  name: string;
}

export type ConnectOutcome =
  | { ok: true; next: "done"; provider: Provider }
  | { ok: true; next: "pick_page"; pending: string }
  | { ok: false; code: ConnectionErrorCode };

export const REFRESH_WINDOW_DAYS = 10;
export const REFRESH_MIN_AGE_HOURS = 24;
